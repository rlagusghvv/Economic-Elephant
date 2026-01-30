// gemini/textIssueBrief.js (ESM)
// 텍스트 이슈 5개를 "구조화(JSON)"로 받기 + google_search grounding 사용
import "dotenv/config";

export const ISSUE_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          bullets: {
            type: "array",
            items: { type: "string" },
          },
          one_line: { type: "string" },
        },
        required: ["title", "bullets", "one_line"],
      },
    },
  },
  required: ["issues"],
};

function pickJsonText(respJson) {
  const c = respJson?.candidates?.[0];
  const parts = c?.content?.parts || [];
  const text = parts
    .map((p) => p.text)
    .filter(Boolean)
    .join("");
  return text || "";
}

// ✅ “파란 링크”의 실체: groundingMetadata.groundingChunks
export function extractGroundingUrls(respJson, maxUrls = 30) {
  const md = respJson?.candidates?.[0]?.groundingMetadata;
  const chunks = md?.groundingChunks || [];
  const urls = [];

  for (const ch of chunks) {
    const u =
      ch?.web?.uri ||
      ch?.web?.url ||
      ch?.retrievedContext?.uri ||
      ch?.retrievedContext?.url ||
      "";
    if (!u) continue;
    if (!/^https?:\/\//i.test(u)) continue;
    urls.push(u);
    if (urls.length >= maxUrls) break;
  }
  return Array.from(new Set(urls)); // 중복 제거
}

// ✅ 프롬프트: URL/매체명 생성 금지 + JSON 강제
export function buildIssuePrompt({ nowKST }) {
  return `너는 경제 코끼리 에디터다.
기준시각: ${nowKST}

지금 시각 기준으로 한국/글로벌 "경제 이슈" 5개를 선정해 브리핑을 작성하라.

규칙(매우 중요):
- 반드시 5개 이슈를 JSON 배열 issues에 넣어라. (issues.length = 5)
- 각 이슈는 반드시:
  - title: 문자열 1개
  - bullets: 문자열 3개 (정확히 3개)
  - one_line: 문자열 1개
- bullets의 각 항목은 한 문장으로 짧게.
- 본문에 URL을 절대 쓰지 마라.
- 특정 매체명/출처명을 나열하지 마라. (출처 링크는 시스템이 따로 붙인다)
- 한국 이슈와 글로벌 이슈가 섞이지 않게: 최소 2개는 글로벌(미국/중국/유럽/환율/원유/연준/FOMC/IMF/글로벌 기업)로 구성해라.
- 출력은 반드시 JSON만. 설명/서문/마크다운 금지.

JSON 출력 예시(형식만 참고):
{"issues":[{"title":"...","bullets":["...","...","..."],"one_line":"..."}, ... ]}`;
}

export async function geminiIssueBrief({
  apiKey,
  model = "gemini-1.5-flash",
  promptText,
  maxOutputTokens = 2200,
  temperature = 0.2,
  debug = false,
}) {
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],

    // ✅ 핵심 1) 구글검색 grounding 켜기 (출처 링크를 메타데이터로 받기)
    tools: [{ google_search: {} }],

    // ✅ 핵심 2) JSON 구조화 출력
    generationConfig: {
      temperature,
      maxOutputTokens,
      responseMimeType: "application/json",
      responseSchema: ISSUE_SCHEMA,
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json().catch(() => ({}));
  if (debug) console.log("[gemini] status:", res.status);

  if (!res.ok) {
    throw new Error(`gemini failed: ${res.status} ${JSON.stringify(json)}`);
  }

  const jsonText = pickJsonText(json);
  if (!jsonText) throw new Error("gemini returned empty text");

  let data;
  try {
    data = JSON.parse(jsonText);
  } catch (e) {
    throw new Error("gemini json parse failed: " + (e?.message || e));
  }

  const groundingUrls = extractGroundingUrls(json, 30);
  return { data, groundingUrls, rawJson: json };
}
