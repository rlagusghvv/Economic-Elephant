import "dotenv/config";
import { sendBriefingAsKakao } from "./step11_send_from_briefing.js";

const DEBUG = process.env.DEBUG_STEP12 === "1";
const log = (...a) => DEBUG && console.log("[step12]", ...a);

// ✅ Gemini 설정
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(
  GEMINI_API_KEY || ""
)}`;

function kstNowString() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().replace("T", " ").slice(0, 16) + " KST";
}

/**
 * ✅ “우린 기사 목록 제공 안 함”
 * Gemini에게 “현재 시점”의 주요 뉴스/세계경제 TOP10을
 * step11 파서가 먹는 포맷으로 강제 출력시키는 프롬프트
 */
function buildPrompt() {
  const nowStr = kstNowString();

  return `
너는 "경제 코끼리" 뉴스 브리핑 작성자다.
현재 시각은 ${nowStr} 이다.

아래 요구사항을 정확히 지켜서 브리핑을 작성하라.

[목표]
1) 한국 주요 뉴스 TOP10
2) 세계 경제 주요 뉴스 TOP10

[규칙 - 매우 중요]
- 반드시 아래 출력 포맷을 100% 지켜라. (형식이 깨지면 전송이 실패한다)
- 각 항목은 "객관 요약 3줄" + "한줄결론(중립 코멘트 1문장)"을 포함한다.
- 감정적 표현/선동/확신 단정 금지. 숫자/사실 기반으로.
- URL은 가능한 한 신뢰할 수 있는 출처의 대표 링크를 넣어라.
  (정확한 원문 링크를 모르면, 해당 이슈를 가장 잘 요약한 신뢰 출처 링크라도 넣어라)
- 불필요한 서론/설명/코드블록/마크다운 추가 금지.
- 오직 아래 포맷만 출력.

[출력 포맷]
==한국 주요뉴스 TOP10==
### 1. 제목
- 객관요약1
- 객관요약2
- 객관요약3
한줄결론: ...
URL: https://...

### 2. 제목
- ...
한줄결론: ...
URL: https://...

(10개까지)

==세계 경제 주요뉴스 TOP10==
### 1. 제목
- 객관요약1
- 객관요약2
- 객관요약3
한줄결론: ...
URL: https://...

(10개까지)
`.trim();
}

function extractTextFromGemini(json) {
  // v1beta 응답에서 텍스트 꺼내기 (모델/버전에 따라 케이스가 달라서 방어적으로)
  const cands = json?.candidates || [];
  const parts = cands?.[0]?.content?.parts || [];
  const text = parts
    .map((p) => p.text)
    .filter(Boolean)
    .join("\n");
  return String(text || "").trim();
}

function splitSections(fullText) {
  // ==한국...== / ==세계...== 기준 분리
  const koreaMarker = "==한국 주요뉴스 TOP10==";
  const worldMarker = "==세계 경제 주요뉴스 TOP10==";

  const kIdx = fullText.indexOf(koreaMarker);
  const wIdx = fullText.indexOf(worldMarker);

  if (kIdx === -1 || wIdx === -1) {
    // 마커가 없으면 전체를 그냥 한 섹션으로 취급(디버그용)
    return {
      korea: fullText,
      world: "",
      ok: false,
    };
  }

  const korea = fullText.slice(kIdx + koreaMarker.length, wIdx).trim();
  const world = fullText.slice(wIdx + worldMarker.length).trim();

  return { korea, world, ok: true };
}

async function geminiOnce(prompt) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY가 .env에 없습니다.");
  }

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    // 안정적 포맷 유지를 위해 temperature 낮게
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 4096,
    },
  };

  log("Gemini request model:", GEMINI_MODEL);

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${JSON.stringify(json)}`);
  }

  const text = extractTextFromGemini(json);
  if (!text) throw new Error("Gemini 응답 텍스트가 비어있음");

  return text;
}

async function main() {
  console.log("[step12] start");

  const prompt = buildPrompt();
  log("prompt:", prompt);

  const full = await geminiOnce(prompt);
  log("gemini full text:", full);

  const { korea, world, ok } = splitSections(full);

  if (!ok) {
    console.log(
      "[step12] 섹션 마커가 예상과 다름. 그래도 전체를 한국 섹션으로 전송 시도."
    );
  }

  // ✅ step11 파서 포맷은 "### n. ..." 블록만 있으면 됨
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
