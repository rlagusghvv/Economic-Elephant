import "dotenv/config";
import { sendBriefingAsKakao } from "./step11_send_from_briefing.js";

const DEBUG = process.env.DEBUG_STEP12 === "1";
const log = (...a) => DEBUG && console.log("[step12]", ...a);

// ===== 설정 =====
const LIMIT_KR = Number(process.env.LIMIT_KR || 5);
const LIMIT_WORLD = Number(process.env.LIMIT_WORLD || 5);

// Gemini
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash"; // 추천: 너가 성공한 모델로 고정
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(
  GEMINI_API_KEY || ""
)}`;

function kstNowString() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace("T", " ").slice(0, 16) + " KST";
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildPrompt() {
  const nowStr = kstNowString();
  return `
너는 "경제 코끼리" 뉴스 브리핑 작성자다.
현재 시각은 ${nowStr} 이다.

[목표]
1) 한국 주요 뉴스 TOP${LIMIT_KR}
2) 세계 경제 주요 뉴스 TOP${LIMIT_WORLD}

[규칙 - 매우 중요]
- 반드시 아래 출력 포맷을 100% 지켜라.
- 각 항목은 "객관 요약 3줄" + "한줄결론(중립 코멘트 1문장)"을 포함한다.
- 감정적 표현/선동/확신 단정 금지. 사실 기반.
- URL은 가능한 한 신뢰할 수 있는 출처의 대표 링크를 넣어라.
- 불필요한 서론/설명/코드블록/마크다운 추가 금지. 오직 포맷만 출력.

[출력 포맷]
==한국 주요뉴스 TOP${LIMIT_KR}==
### 1. 제목
- 객관요약1
- 객관요약2
- 객관요약3
한줄결론: ...
URL: https://...

(… ${LIMIT_KR}개)

==세계 경제 주요뉴스 TOP${LIMIT_WORLD}==
### 1. 제목
- 객관요약1
- 객관요약2
- 객관요약3
한줄결론: ...
URL: https://...

(… ${LIMIT_WORLD}개)
`.trim();
}

function extractTextFromGemini(json) {
  const cands = json?.candidates || [];
  const parts = cands?.[0]?.content?.parts || [];
  return parts
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n")
    .trim();
}

// ✅ 429 에러 메시지에서 "retry in 41s" 같은 값을 파싱
function parseRetrySecondsFrom429(message) {
  // 예: "Please retry in 41.4063s." or "retryDelay":"41s"
  const m1 = String(message || "").match(/retry in\s+([\d.]+)s/i);
  if (m1) return Math.ceil(Number(m1[1]) || 0);

  const m2 = String(message || "").match(/"retryDelay"\s*:\s*"(\d+)s"/i);
  if (m2) return Number(m2[1]) || 0;

  return 0;
}

async function geminiOnce(prompt) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY가 .env에 없습니다.");

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 4096,
    },
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    const msg = json?.error?.message || JSON.stringify(json);
    const err = new Error(`Gemini HTTP ${res.status}: ${msg}`);
    err.status = res.status;
    err.json = json;
    throw err;
  }

  const text = extractTextFromGemini(json);
  if (!text) throw new Error("Gemini 응답 텍스트가 비어있음");
  return text;
}

async function geminiWith429Retry(prompt, { maxAttempts = 6 } = {}) {
  let lastErr;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      log("Gemini attempt", attempt, "/", maxAttempts, "model:", GEMINI_MODEL);
      return await geminiOnce(prompt);
    } catch (e) {
      lastErr = e;
      const status = e?.status;

      // ✅ 429만 자동 대기 재시도
      if (status === 429) {
        const msg = e?.json?.error?.message || e?.message || "";
        const sec = parseRetrySecondsFrom429(msg) || 45;

        // 백오프(최소 5초, 최대 90초)
        const waitSec = Math.min(90, Math.max(5, sec));
        const jitterMs = Math.floor(Math.random() * 500);

        console.log(
          `[step12] Gemini 429 -> wait ${waitSec}s (attempt ${attempt}/${maxAttempts})`
        );
        await sleep(waitSec * 1000 + jitterMs);
        continue;
      }

      // 그 외 에러는 즉시 종료
      throw e;
    }
  }

  throw lastErr;
}

function splitSections(fullText) {
  const koreaMarker = "==한국 주요뉴스";
  const worldMarker = "==세계 경제 주요뉴스";

  const kIdx = fullText.indexOf(koreaMarker);
  const wIdx = fullText.indexOf(worldMarker);

  if (kIdx === -1 || wIdx === -1) {
    return { korea: fullText.trim(), world: "", ok: false };
  }

  const korea = fullText.slice(kIdx, wIdx).trim();
  const world = fullText.slice(wIdx).trim();

  // 마커 라인 제거(파서가 ### 블록만 있으면 되도록)
  const stripMarkerLine = (s) =>
    s
      .split("\n")
      .filter((line) => !line.trim().startsWith("=="))
      .join("\n")
      .trim();

  return {
    korea: stripMarkerLine(korea),
    world: stripMarkerLine(world),
    ok: true,
  };
}

// ===== 폴백: 요약 없이 "제목만" 브리핑 만들어서 전송 =====
// (Gemini가 막히거나 쿼터 소진 시에도 카톡은 매일 오게)
function googleNewsSearchUrl(q) {
  return `https://news.google.com/search?q=${encodeURIComponent(
    q
  )}&hl=ko&gl=KR&ceid=KR:ko`;
}

function buildFallbackBriefing({ category, topics }) {
  // topics: string[]
  const lines = [];
  topics.slice(0, 10).forEach((t, i) => {
    const title = t.trim();
    lines.push(`### ${i + 1}. ${title}`);
    lines.push(
      `- (요약 대기: Gemini 쿼터/속도 제한으로 오늘은 제목만 제공합니다)`
    );
    lines.push(`- (내일 다시 요약을 시도합니다)`);
    lines.push(
      `- (필요하면 이슈 키워드를 더 구체화해 정확도를 올릴 수 있어요)`
    );
    lines.push(
      `한줄결론: 오늘은 제목 기반 브리핑(요약은 제한 해제 후 자동 복구)`
    );
    lines.push(`URL: ${googleNewsSearchUrl(title)}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}

async function main() {
  console.log("[step12] start");

  const prompt = buildPrompt();
  log("prompt:\n" + prompt);

  let fullText = "";
  try {
    fullText = await geminiWith429Retry(prompt, { maxAttempts: 6 });
  } catch (e) {
    console.log("[step12] Gemini 실패 -> 폴백 전송:", e?.message);
    // 폴백 브리핑 전송(카테고리 2개)
    const krFallback = buildFallbackBriefing({
      category: "한국 주요뉴스 TOP10",
      topics: [
        "한국 주요 이슈 1",
        "한국 주요 이슈 2",
        "한국 주요 이슈 3",
        "한국 주요 이슈 4",
        "한국 주요 이슈 5",
        "한국 주요 이슈 6",
        "한국 주요 이슈 7",
        "한국 주요 이슈 8",
        "한국 주요 이슈 9",
        "한국 주요 이슈 10",
      ],
    });

    const worldFallback = buildFallbackBriefing({
      category: "세계 경제 주요뉴스 TOP10",
      topics: [
        "세계 경제 이슈 1",
        "세계 경제 이슈 2",
        "세계 경제 이슈 3",
        "세계 경제 이슈 4",
        "세계 경제 이슈 5",
        "세계 경제 이슈 6",
        "세계 경제 이슈 7",
        "세계 경제 이슈 8",
        "세계 경제 이슈 9",
        "세계 경제 이슈 10",
      ],
    });

    await sendBriefingAsKakao({
      category: "한국 주요뉴스 TOP10",
      briefingText: krFallback,
    });
    await sendBriefingAsKakao({
      category: "세계 경제 주요뉴스 TOP10",
      briefingText: worldFallback,
    });

    console.log("[step12] done (fallback)");
    return;
  }

  log("gemini full text:\n" + fullText);

  const { korea, world, ok } = splitSections(fullText);
  if (!ok)
    console.log("[step12] 섹션 마커 인식이 불완전할 수 있음(그래도 전송 시도)");

  if (korea.trim()) {
    await sendBriefingAsKakao({
      category: "한국 주요뉴스 TOP10",
      briefingText: korea.trim(),
    });
  }

  if (world.trim()) {
    await sendBriefingAsKakao({
      category: "세계 경제 주요뉴스 TOP10",
      briefingText: world.trim(),
    });
  }

  console.log("[step12] done");
}

main().catch((e) => {
  console.error("❌ step12 실패:", e.message);
  process.exit(1);
});
