// llm/hotTopics.js (ESM)
import "dotenv/config";
import { callGeminiText } from "../gemini/callGemini.js";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function buildPrompt({
  date,
  limitKR,
  limitWorld,
  note,
  allowedDomains,
} = {}) {
  const extra = note ? `\n[RETRY NOTE]\n${note}\n` : "";
  const domainLine = Array.isArray(allowedDomains) && allowedDomains.length
    ? `\n사용 가능한 도메인: ${allowedDomains.join(", ")}\n`
    : "";

  return `
너는 경제 뉴스 편집자다. 지금 시간 기준 "오늘의 경제 핫토픽"을
KR ${limitKR}개, WORLD ${limitWorld}개로 만들어라.

반드시 JSON만 출력하라. 코드펜스/설명/텍스트 금지.

JSON 스키마:
{
  "date": "${date}",
  "kr": [
    {
      "id": "KR-01",
      "title": "한글 25~40자",
      "summary": ["한 문장", "한 문장", "한 문장"],
      "sources": ["URL","URL","URL"],
      "tags": ["키워드","키워드"]
    }
  ],
  "world": [
    {
      "id": "WD-01",
      "title": "한글 25~40자",
      "summary": ["한 문장", "한 문장", "한 문장"],
      "sources": ["URL","URL"],
      "tags": ["키워드","키워드"]
    }
  ]
}

규칙:
- id는 KR-01..KR-0${limitKR}, WD-01..WD-0${limitWorld}
- summary는 정확히 3줄, 각 줄 1문장
- sources는 1~3개, 실제 기사/칼럼/공식자료 링크만 사용
- tags는 2~4개
- KR/WORLD는 지역을 혼동하지 말 것
${domainLine}
링크는 반드시 실제로 존재하는 URL이어야 하며, 임의 생성 금지.
${extra}
`.trim();
}

function extractJson(text) {
  const s = String(text || "").trim();
  if (!s) return "";
  if (s.startsWith("{") && s.endsWith("}")) return s;
  const first = s.indexOf("{");
  const last = s.lastIndexOf("}");
  if (first >= 0 && last > first) return s.slice(first, last + 1);
  return "";
}

function isRateLimitError(err) {
  const msg = String(err?.message || "");
  return msg.includes("429") || msg.toLowerCase().includes("rate");
}

export async function generateHotTopics({
  date,
  limitKR = 5,
  limitWorld = 5,
  debug = false,
  maxAttempts = 3,
  note = "",
  allowedDomains = [],
} = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt = buildPrompt({
      date,
      limitKR,
      limitWorld,
      note,
      allowedDomains,
    });

    if (debug) {
      console.log("[hotTopics] attempt:", attempt);
      console.log("[hotTopics] prompt length:", prompt.length);
    }

    try {
      const { text } = await callGeminiText({
        promptText: prompt,
        model: process.env.GEMINI_MODEL || "gemini-flash-latest",
        apiKey: process.env.GEMINI_API_KEY,
        temperature: Number(process.env.TEMPERATURE || 0.2),
        maxOutputTokens: Number(process.env.MAX_OUTPUT_TOKENS || 2400),
        debug,
      });

      const jsonStr = extractJson(text);
      if (!jsonStr) throw new Error("no json in response");

      const parsed = JSON.parse(jsonStr);
      return parsed;
    } catch (err) {
      const waitMs = 1200 * Math.pow(2, attempt - 1);
      if (debug) console.log("[hotTopics] error:", err.message);

      if (isRateLimitError(err)) {
        if (debug) console.log("[hotTopics] rate limit -> wait", waitMs);
        await sleep(waitMs);
        continue;
      }

      if (attempt < maxAttempts) {
        await sleep(Math.min(3000, waitMs));
        continue;
      }
      throw err;
    }
  }

  throw new Error("generateHotTopics failed");
}
