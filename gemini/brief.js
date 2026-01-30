// gemini/brief.js (ESM)
// “프롬프트 생성 -> Gemini 호출 -> 텍스트 반환” 단일 진입점

import { generateText } from "./client.js";
import { buildBriefPrompt } from "./prompts.js";

export async function briefWithGemini({
  limitKR = Number(process.env.LIMIT_KR || 5),
  limitWorld = Number(process.env.LIMIT_WORLD || 5),
} = {}) {
  const prompt = buildBriefPrompt({
    limitKR,
    limitWorld,
    includeComment: true,
  });

  const text = await generateText(prompt);
  return text;
}
