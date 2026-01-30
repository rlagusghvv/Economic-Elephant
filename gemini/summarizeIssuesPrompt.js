// gemini/summarizeIssuesPrompt.js
import { callGemini } from "./callGemini.js";

export async function geminiSummarizeIssues({ issues }) {
  const prompt = `
아래는 실제 경제 기사 목록이다.
각 항목을 아래 형식으로 요약하라.

형식:
<제목>

요약 1
요약 2
요약 3

한줄 핵심

기사 목록:
${issues.map((i, idx) => `${idx + 1}. ${i.title} (${i.media})`).join("\n")}
`;

  return await callGemini({
    prompt,
    temperature: 0.2,
    maxOutputTokens: 2200,
  });
}
