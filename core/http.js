// core/http.js (ESM)
// fetch 공통 래퍼: 타임아웃/UA/간단 리트라이

import { sleep } from "./sleep.js";

export async function fetchText(
  url,
  { timeoutMs = 10000, retries = 1, retryDelayMs = 800, headers = {} } = {}
) {
  let lastErr = null;

  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          "User-Agent":
            headers["User-Agent"] ||
            "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
          ...headers,
        },
      });

      const text = await res.text();
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status}`);
        e.status = res.status;
        e.body = text.slice(0, 500);
        throw e;
      }
      return text;
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        await sleep(retryDelayMs * Math.pow(2, i));
        continue;
      }
      throw lastErr;
    } finally {
      clearTimeout(t);
    }
  }
}
