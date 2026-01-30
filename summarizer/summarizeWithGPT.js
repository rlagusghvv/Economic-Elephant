// summarizer/summarizeWithGPT.js
import "dotenv/config";

export async function summarizeWithGPT(articleText) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "너는 경제 뉴스 전문 요약가다. 투자자 관점에서 핵심만 3줄로 요약해라.",
        },
        {
          role: "user",
          content: articleText.slice(0, 6000),
        },
      ],
    }),
  });

  const json = await res.json();

  // 🔥 여기서 모든 걸 본다
  if (!res.ok) {
    console.error("❌ OpenAI API 에러 응답:", json);
    throw new Error(`OpenAI API Error: ${res.status}`);
  }

  if (!json.choices || !json.choices[0]) {
    console.error("❌ 예상치 못한 응답 구조:", json);
    throw new Error("GPT 응답 구조 오류");
  }

  return json.choices[0].message.content.trim();
}
