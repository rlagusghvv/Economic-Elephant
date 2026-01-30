// gemini/visionBrief.js (ESM)
// ✅ 이미지(스크린샷)들을 Gemini Vision에 넣고
// “ID 매핑된 브리핑 포맷”으로 생성한다.
// - maxOutputTokens 제어
// - 요약 줄수(summaryLines) 제어
// - 429 retryDelay 기반 재시도 + 백오프

import fs from "node:fs";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(debug, ...a) {
  if (debug) console.log("[vision]", ...a);
}

function toBase64Png(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.toString("base64");
}

function nowKSTString() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getFullYear();
  const mm = String(kst.getMonth() + 1).padStart(2, "0");
  const dd = String(kst.getDate()).padStart(2, "0");
  const hh = String(kst.getHours()).padStart(2, "0");
  const mi = String(kst.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} KST`;
}

export function buildVisionPrompt({
  categoryName = "한국 주요뉴스",
  limit = 5,
  summaryLines = 2,
  includeComment = true,
  idPrefix = "KR", // ✅ 추가
} = {}) {
  const nowKST = nowKSTString();
  return `
  너는 "경제 코끼리" 뉴스 브리핑 작성자다.
  현재 시각은 ${nowKST} 이다.
  
  아래에 제공된 이미지(기사 스크린샷)만 근거로 삼아 작성하라.
  절대 새로운 사실/링크를 만들어내지 마라.
  
  [목표]
  - ${categoryName} TOP${limit}
  
  [규칙 - 매우 중요]
  - 제목은 반드시 기사 제목을 똑같이 사용하라.
  - 출력 포맷을 100% 지켜라. (형식이 깨지면 전송이 실패한다)
  - 각 항목은 스크린샷에서 확인 가능한 내용만 요약한다.
  - 각 항목은 "객관요약 ${summaryLines}줄"${
    includeComment ? ' + "한줄결론(중립 코멘트 1문장)"' : ""
  } 포함.
  - 감정적 표현/선동/확신 단정 금지.
  - URL은 반드시 내가 제공한 URL만 그대로 사용한다. (변형/축약/추가 생성 금지)
  - URL을 모르면 만들지 말고, 반드시 [ID-URL 매핑]의 URL을 복사해서 써라.
  - 불필요한 서론/마크다운/코드블록 금지.
  
  [출력 포맷]
  ==${categoryName} TOP${limit}==
  ### 1. ID: ${idPrefix}-01 | 제목
  - 객관요약1
  - 객관요약2
  ${summaryLines >= 3 ? "- 객관요약3" : ""}
  ${includeComment ? "한줄결론: ..." : ""}
  URL: (반드시 [ID-URL 매핑]의 URL을 그대로)
  
  (반드시 ${limit}개. 부족하면 이미지들 중 다른 기사로 채워라)
  `.trim();
}

function parseRetryDelayMs(json) {
  const details = json?.error?.details || [];
  const retryInfo = details.find((d) =>
    String(d["@type"] || "").includes("RetryInfo")
  );
  const delay = String(retryInfo?.retryDelay || "").trim(); // e.g. "41s"
  if (!delay.endsWith("s")) return null;
  const sec = Number(delay.replace("s", ""));
  if (!Number.isFinite(sec)) return null;
  return Math.max(800, sec * 1000);
}

/**
 * @param {Object} params
 * @param {string} params.apiKey
 * @param {string} params.model
 * @param {string} params.promptText
 * @param {Array<{id,url,title,filePath}>} params.shots
 * @param {number} params.maxOutputTokens
 * @param {number} params.temperature
 * @param {boolean} params.debug
 */
export async function geminiVisionBrief({
  apiKey,
  model = "gemini-flash-latest",
  promptText,
  shots,
  maxOutputTokens = 2000,
  temperature = 0.2,
  debug = false,
} = {}) {
  if (!apiKey) throw new Error("GEMINI_API_KEY 없음");
  if (!promptText) throw new Error("promptText 없음");
  if (!Array.isArray(shots) || shots.length === 0)
    throw new Error("shots 없음");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  // ✅ parts: 텍스트 + 이미지들
  const parts = [{ text: promptText }];

  // ID/URL 매핑을 prompt에 추가로 넣어 (모델이 URL을 헷갈리지 않게)
  const mapLines = shots.map((s) => `- ID: ${s.id} | URL: ${s.url}`).join("\n");

  parts.push({
    text: `\n[ID-URL 매핑(절대 변경 금지)]\n${mapLines}\n`,
  });

  for (const s of shots) {
    const b64 = toBase64Png(s.filePath);
    parts.push({
      inlineData: { mimeType: "image/png", data: b64 },
    });
  }

  const body = {
    contents: [{ role: "user", parts }],
    generationConfig: {
      temperature,
      maxOutputTokens,
    },
  };

  // 재시도: 429/500/503
  const maxAttempts = 6;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));
    log(debug, "status:", res.status, "keys:", Object.keys(json || {}));

    if (res.ok) {
      const parts = json?.candidates?.[0]?.content?.parts || [];
      const text =
        parts
          .map((p) => p.text)
          .filter(Boolean)
          .join("") || "";

      if (!text && debug) {
        console.log(
          "[vision] empty text, candidate:",
          JSON.stringify(json?.candidates?.[0], null, 2)
        );
      }
      return String(text).trim();
    }

    if (res.status === 429) {
      const waitMs =
        parseRetryDelayMs(json) ?? Math.min(60000, 1200 * attempt * attempt);
      log(debug, `429 -> wait ${waitMs}ms (attempt ${attempt}/${maxAttempts})`);
      await sleep(waitMs);
      continue;
    }

    if (res.status === 500 || res.status === 503) {
      const waitMs = Math.min(20000, 1500 * Math.pow(2, attempt - 1));
      log(
        debug,
        `${res.status} -> retry in ${waitMs}ms (attempt ${attempt}/${maxAttempts})`
      );
      await sleep(waitMs);
      continue;
    }

    throw new Error(`Gemini HTTP ${res.status}: ${JSON.stringify(json)}`);
  }

  throw new Error("Gemini 재시도 초과(429/5xx 지속)");
}
