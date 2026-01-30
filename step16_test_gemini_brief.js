// step16_test_gemini_brief.js (ESM)
// 목적: (1) 후보목록을 붙인 프롬프트로 Gemini 1회 호출
//      (2) 응답이 “정해진 포맷”인지 파싱으로 검증
//      (3) 옵션: step11_send_from_briefing.js로 카톡 전송까지

import "dotenv/config";
import { buildBriefPrompt } from "./gemini/prompts.js";
import {
  parseBriefing,
  sendBriefingAsKakao,
} from "./step11_send_from_briefing.js";

const DEBUG = process.env.DEBUG_STEP16 === "1";
const log = (...a) => DEBUG && console.log("[step16]", ...a);

const LIMIT_KR = Number(process.env.LIMIT_KR || 5);
const LIMIT_WORLD = Number(process.env.LIMIT_WORLD || 5);

// ✅ SEND_KAKAO=1 이면 카톡 전송까지 수행
const SEND_KAKAO = process.env.SEND_KAKAO === "1";

// Gemini 설정
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

if (!GEMINI_API_KEY) {
  console.error("❌ GEMINI_API_KEY 가 없습니다. .env에 설정하세요.");
  process.exit(1);
}

// ------------------------------------------------------
// 1) 후보목록(테스트용 샘플)
//    실제로는 step15에서 만든 후보목록을 여기에 주입하면 됨.
//    형식은 단순 텍스트로 “제목 | URL” 추천.
// ------------------------------------------------------
const KR_CANDIDATES = [
  { title: "테스트(국내) 1: 기준금리 동결", url: "https://news.daum.net/" },
  { title: "테스트(국내) 2: 부동산 정책 이슈", url: "https://news.daum.net/" },
  { title: "테스트(국내) 3: 환율 변동", url: "https://news.daum.net/" },
  { title: "테스트(국내) 4: 반도체 수출", url: "https://news.daum.net/" },
  { title: "테스트(국내) 5: 물가 동향", url: "https://news.daum.net/" },
  { title: "테스트(국내) 6: 증시 수급", url: "https://news.daum.net/" },
];

const WORLD_CANDIDATES = [
  { title: "테스트(세계) 1: 미국 증시 변동", url: "https://news.daum.net/" },
  { title: "테스트(세계) 2: 중국 경기부양", url: "https://news.daum.net/" },
  { title: "테스트(세계) 3: 유가 변동", url: "https://news.daum.net/" },
  { title: "테스트(세계) 4: ECB 통화정책", url: "https://news.daum.net/" },
  { title: "테스트(세계) 5: 엔비디아 실적", url: "https://news.daum.net/" },
  { title: "테스트(세계) 6: 달러 강세", url: "https://news.daum.net/" },
];

function buildCandidatesText() {
  const kr = KR_CANDIDATES.map(
    (x, i) => `KR${String(i + 1).padStart(2, "0")} | ${x.title} | ${x.url}`
  ).join("\n");

  const world = WORLD_CANDIDATES.map(
    (x, i) => `W${String(i + 1).padStart(2, "0")} | ${x.title} | ${x.url}`
  ).join("\n");

  return `
[기사 후보 목록]
(아래 목록에 있는 제목/URL만 사용 가능)

[KR 후보]
${kr}

[WORLD 후보]
${world}
`.trim();
}

// ------------------------------------------------------
// 2) Gemini 호출
// ------------------------------------------------------
async function geminiGenerateText({ prompt }) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 4096,
    },
  };

  log("request model:", GEMINI_MODEL);
  log("endpoint:", endpoint);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Gemini HTTP ${res.status}: ${JSON.stringify(json)}`);
  }

  const text =
    json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";

  if (!text.trim()) throw new Error("Gemini 응답 텍스트가 비었습니다.");
  return text.trim();
}

// ------------------------------------------------------
// 3) 포맷 검증/파싱
// ------------------------------------------------------
function validateCounts(items, expected) {
  // parseBriefing()은 "### n. 제목" 블록을 모두 추출
  // step11_send_from_briefing.js는 category별로 따로 보내는 구조이므로,
  // 여기서는 간단히 “총 아이템 개수”만 체크하거나,
  // 응답 텍스트를 섹션별로 분리해서 각각 parse 가능.
  if (items.length < expected) {
    console.log(
      `⚠️ 파싱된 항목 수가 부족함: ${items.length}/${expected} (포맷 깨졌거나 후보 부족)`
    );
  } else {
    console.log(`✅ 파싱 OK: ${items.length}개`);
  }
}

function splitBySection(text) {
  // ==한국...== / ==세계...== 를 기준으로 분리
  const krMatch = text.match(/==한국[\s\S]*?==/);
  const worldMatch = text.match(/==세계[\s\S]*?==/);

  // 섹션 헤더 위치 찾아서 슬라이스
  const idxKR = text.indexOf("==한국");
  const idxW = text.indexOf("==세계");

  if (idxKR === -1 || idxW === -1) {
    return { kr: text, world: "" };
  }

  const kr = text.slice(idxKR, idxW).trim();
  const world = text.slice(idxW).trim();
  return { kr, world };
}

// ------------------------------------------------------
// main
// ------------------------------------------------------
(async () => {
  console.log("=== step16 start ===");

  const basePrompt = buildBriefPrompt({
    limitKR: LIMIT_KR,
    limitWorld: LIMIT_WORLD,
    includeComment: true,
    categoryKRLabel: "한국 주요뉴스",
    categoryWorldLabel: "세계 경제 주요뉴스",
  });

  const candidatesText = buildCandidatesText();

  const finalPrompt = `${basePrompt}\n\n${candidatesText}`;
  log("prompt:\n" + finalPrompt);

  const briefing = await geminiGenerateText({ prompt: finalPrompt });

  console.log("\n----- Gemini raw output -----\n");
  console.log(briefing);
  console.log("\n----- /raw -----\n");

  // 섹션별 파싱 검증
  const { kr, world } = splitBySection(briefing);

  console.log("\n[KR section parse]");
  const krItems = parseBriefing(kr);
  validateCounts(krItems, LIMIT_KR);
  log("KR parsed sample:", krItems.slice(0, 1));

  console.log("\n[WORLD section parse]");
  const wItems = parseBriefing(world);
  validateCounts(wItems, LIMIT_WORLD);
  log("WORLD parsed sample:", wItems.slice(0, 1));

  if (SEND_KAKAO) {
    console.log("\n=== SEND_KAKAO=1 : 카톡 전송 시작 ===");

    // step11_send_from_briefing.js는 “한 섹션 텍스트”를 넣어도 동작함
    await sendBriefingAsKakao({
      category: `한국 주요뉴스 TOP${LIMIT_KR}`,
      briefingText: kr,
    });

    await sendBriefingAsKakao({
      category: `세계 경제 주요뉴스 TOP${LIMIT_WORLD}`,
      briefingText: world,
    });

    console.log("=== 카톡 전송 완료 ===");
  } else {
    console.log("\n(SEND_KAKAO=1이면 카톡 전송까지 실행합니다)");
  }

  console.log("=== step16 done ===");
})().catch((e) => {
  console.error("❌ step16 failed:", e?.message || e);
  if (DEBUG) console.error(e);
  process.exit(1);
});
