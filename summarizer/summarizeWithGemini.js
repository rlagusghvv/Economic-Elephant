import "dotenv/config";

const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
// 대안: "gemini-flash-latest"

export async function summarizeWithGemini(articleText) {
  const endpoint =
    `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=` +
    process.env.GEMINI_API_KEY;

  const prompt =
    "다음 경제 뉴스를 투자자 관점에서 핵심만 3줄로 요약해줘.\n" +
    "- 각 줄은 한 문장\n" +
    "- 숫자/지표/정책 변화 우선\n" +
    "- 불필요한 서론/기자/사진 설명 제거\n\n" +
    articleText.slice(0, 6000);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });

  const json = await res.json();

  if (!res.ok) {
    console.error("❌ Gemini 에러 응답:", json);
    throw new Error(`Gemini API Error: ${res.status}`);
  }

  const out = json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!out) {
    console.error("❌ Gemini 응답 구조 이상:", json);
    throw new Error("Gemini 요약 실패");
  }

  return out;
}
