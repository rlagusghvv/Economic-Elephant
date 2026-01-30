// gemini/collectUrlsPrompt.js (ESM)
import { callGeminiText } from "./callGemini.js";

export async function geminiCollectUrls({ debug = false } = {}) {
  const promptText = `
오늘 기준 "한국 + 글로벌 경제"에서 핫한 이슈 5개를 찾아라.

규칙:
- 반드시 google_search를 사용해서 '실제 기사'를 확인
- 요약/의견 금지 (제목/매체만)
- URL을 텍스트로 쓰지 마 (URL은 메타데이터로 받는다)
- 서로 다른 주제 5개로 구성

출력 형식(반드시 그대로):
1)
제목: ...
매체: ...

2)
제목: ...
매체: ...

(5개)
`.trim();

  // ✅ tools는 이렇게
  const res = await callGeminiText({
    promptText,
    tools: [{ google_search: {} }],
    temperature: 0,
    maxOutputTokens: 1200,
    debug,
  });

  return res; // { text, groundingMetadata, raw }
}
