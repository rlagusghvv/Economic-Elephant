// kakao/tokenCache.js (ESM)
// access_token 캐시(파일) + refresh_token으로 갱신 + KOE237 백오프

import fs from "node:fs";
import path from "node:path";
import { sleep } from "../core/sleep.js";
import { makeLogger } from "../core/logger.js";

const log = makeLogger("[kakao.token]", "DEBUG_NOTIFY");

function nowMs() {
  return Date.now();
}

function getCachePath() {
  return (
    process.env.KAKAO_TOKEN_CACHE_PATH ||
    path.join(process.cwd(), ".kakao_token_cache.json")
  );
}

function readCache() {
  try {
    const p = getCachePath();
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
}

function writeCache(obj) {
  try {
    fs.writeFileSync(getCachePath(), JSON.stringify(obj, null, 2), "utf-8");
  } catch (e) {
    log("cache write fail:", e?.message);
  }
}

async function refreshAccessTokenWithRetry(maxRetry = 4) {
  let last = null;

  for (let i = 0; i <= maxRetry; i++) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.KAKAO_REST_KEY,
      refresh_token: process.env.KAKAO_REFRESH_TOKEN,
    });

    if (process.env.KAKAO_CLIENT_SECRET) {
      body.append("client_secret", process.env.KAKAO_CLIENT_SECRET);
    }

    log("refresh try", i + 1);

    const res = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body,
    });

    const json = await res.json().catch(() => ({}));
    const errCode = json?.error_code || json?.error;

    if (res.ok && json.access_token) {
      const expiresInSec = Number(json.expires_in || 0);
      const expiresAt = nowMs() + Math.max(0, expiresInSec - 60) * 1000; // 60초 여유
      writeCache({
        access_token: json.access_token,
        expires_at: expiresAt,
        refreshed_at: nowMs(),
      });
      log("refresh ok expiresInSec=", expiresInSec);
      return json.access_token;
    }

    last = json;

    // KOE237: token request rate limit exceeded -> 기다렸다 재시도
    if (errCode === "KOE237") {
      const waitMs = 1500 * Math.pow(2, i);
      log("KOE237 wait", waitMs, "ms");
      await sleep(waitMs);
      continue;
    }

    throw new Error("토큰 갱신 실패: " + JSON.stringify(json));
  }

  throw new Error("토큰 갱신 실패(KOE237 지속): " + JSON.stringify(last));
}

export async function getAccessToken() {
  const cache = readCache();
  if (cache?.access_token && cache?.expires_at && cache.expires_at > nowMs()) {
    log("use cached token");
    return cache.access_token;
  }
  return await refreshAccessTokenWithRetry();
}
