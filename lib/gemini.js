import { makeLogger } from "./log.js";

const log = makeLogger("[gemini]", "DEBUG_STEP12");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function geminiGenerateText({ prompt, model }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 없음");

  const useModel = model || process.env.GEMINI_MODEL || "gemini-flash-latest";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${useModel}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
  };

  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => ({}));

    if (res.ok) {
      const text =
        json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
        "";
      return text.trim();
    }

    // 429 처리
    if (res.status === 429) {
      const retrySec =
        Number(
          json?.error?.details
            ?.find((d) => d["@type"]?.includes("RetryInfo"))
            ?.retryDelay?.replace("s", "")
        ) || 30;
      const waitMs = Math.min(60000, retrySec * 1000);
      log(`429 -> wait ${waitMs}ms (attempt ${attempt}/6)`);
      await sleep(waitMs);
      continue;
    }

    throw new Error(`Gemini HTTP ${res.status}: ${JSON.stringify(json)}`);
  }

  throw new Error("Gemini 429 지속(재시도 초과)");
}
