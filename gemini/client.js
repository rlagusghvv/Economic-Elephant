// gemini/client.js (ESM)

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function callGeminiWithRetry({
  apiKey,
  model,
  prompt,
  debug = false,
  maxAttempts = 6,
} = {}) {
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");
  if (!model) throw new Error("GEMINI_MODEL missing");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
      },
    };

    let res, json;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      json = await res.json().catch(() => ({}));
    } catch (e) {
      const waitMs = 1200 * Math.pow(2, attempt - 1);
      if (debug)
        console.log(`[gemini] fetch error -> retry ${waitMs}ms`, e.message);
      await sleep(waitMs);
      continue;
    }

    if (debug) {
      console.log("[gemini] status:", res.status);
      console.log("[gemini] keys:", Object.keys(json || {}));
    }

    if (res.ok) {
      const text =
        json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
        "";
      const out = String(text).trim();

      // ✅ “출력이 너무 짧으면 실패로 간주” (지금 네 193자 문제가 여기서 걸리게 함)
      if (out.length < 800) {
        if (debug)
          console.log("[gemini] output too short:", out.length, "\n", out);
        throw new Error(
          "Gemini 출력이 너무 짧음(포맷/토큰/중간끊김). 후보/limit 줄이거나 재시도 필요"
        );
      }
      return out;
    }

    // 429 / 500 / 503 재시도
    if (res.status === 429 || res.status === 500 || res.status === 503) {
      const retryDelaySec = Number(
        json?.error?.details
          ?.find((d) => d["@type"]?.includes("RetryInfo"))
          ?.retryDelay?.replace("s", "")
      );
      const waitMs = Number.isFinite(retryDelaySec)
        ? Math.max(800, retryDelaySec * 1000)
        : 1200 * Math.pow(2, attempt - 1);

      if (debug)
        console.log(
          `[gemini] ${res.status} -> wait ${waitMs}ms (attempt ${attempt}/${maxAttempts})`
        );
      await sleep(waitMs);
      continue;
    }

    throw new Error(`Gemini HTTP ${res.status}: ${JSON.stringify(json)}`);
  }

  throw new Error(`Gemini failed after ${maxAttempts} attempts`);
}
