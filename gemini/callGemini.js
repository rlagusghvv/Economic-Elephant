// gemini/callGemini.js (ESM)
import "dotenv/config";

export async function callGeminiText({
  apiKey = process.env.GEMINI_API_KEY,
  model = process.env.GEMINI_MODEL || "gemini-flash-latest",
  promptText,
  maxOutputTokens = Number(process.env.MAX_OUTPUT_TOKENS || 2200),
  temperature = Number(process.env.TEMPERATURE || 0.2),
  tools = null, // ✅ 추가
  debug = false,
} = {}) {
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");
  if (!promptText) throw new Error("promptText required");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [{ text: promptText }],
      },
    ],
    generationConfig: {
      temperature,
      maxOutputTokens,
    },
    ...(tools ? { tools } : {}), // ✅ tools를 실제로 요청에 포함
  };

  if (debug) {
    console.log("[gemini] model:", model);
    console.log("[gemini] prompt length:", String(promptText).length);
    console.log("[gemini] tools:", tools ? JSON.stringify(tools) : "(none)");
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const json = await res.json().catch(() => ({}));

  if (debug) {
    console.log("[gemini] status:", res.status);
    console.log("[gemini] response keys:", Object.keys(json || {}));
    console.log(
      "[gemini] candidate keys:",
      Object.keys(json?.candidates?.[0] || {}),
    );
  }

  if (!res.ok) {
    throw new Error(`gemini failed: ${res.status} ${JSON.stringify(json)}`);
  }

  const text =
    json?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .filter(Boolean)
      .join("") || "";

  const groundingMetadata = json?.candidates?.[0]?.groundingMetadata || null;

  return { text: text.trim(), groundingMetadata, raw: json };
}
