// gemini/issueBrief.js (ESM)
// 경제 이슈 5개를 "구조화(JSON)"로 받기 + google_search grounding 사용

export const ISSUE_SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          bullets: {
            type: "array",
            minItems: 3,
            maxItems: 3,
            items: { type: "string" },
          },
          one_line: { type: "string" },
          // 이슈별로 "근거 링크 인덱스"를 참조하게 만들 수도 있지만
          // MVP는 groundingChunks에서 그냥 상위 N개를 쓰는 게 더 단단함.
          // source_refs: { type: "array", items: { type: "integer" } }
        },
        required: ["title", "bullets", "one_line"],
        additionalProperties: false,
      },
    },
  },
  required: ["issues"],
  additionalProperties: false,
};

function pickJsonText(respJson) {
  // Gemini REST 응답에서 텍스트(JSON string)를 뽑는 유틸
  const c = respJson?.candidates?.[0];
  const parts = c?.content?.parts || [];
  const text = parts
    .map((p) => p.text)
    .filter(Boolean)
    .join("");
  return text || "";
}

export function extractGroundingUrls(respJson, maxUrls = 10) {
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

  // 중복 제거
  return Array.from(new Set(urls));
}

/**
 * @param {Object} params
 * @param {string} params.apiKey
 * @param {string} params.model
 * @param {string} params.promptText
 * @param {number} params.maxOutputTokens
 * @param {number} params.temperature
 * @param {boolean} params.debug
 * @returns {Promise<{ data: any, rawJson: any, groundingUrls: string[] }>}
 */
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
    contents: [
      {
        role: "user",
        parts: [{ text: promptText }],
      },
    ],
    // ✅ 핵심 1) 구글검색 grounding
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
  if (debug) {
    console.log("[gemini] status:", res.status);
    // console.log(JSON.stringify(json, null, 2));
  }
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

  return { data, rawJson: json, groundingUrls };
}
