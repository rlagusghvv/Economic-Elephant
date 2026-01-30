// step13_broadcast_memo.js (ESM)
// friend_tokens.json 안의 모든 refresh_token으로
// 각 사용자(친구) 계정에 "나에게 보내기(메모)" 메시지를 전송한다.

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

const DEBUG = process.env.DEBUG_BROADCAST === "1";
const TOKENS_PATH = path.join(process.cwd(), "friend_tokens.json");

// 너무 빠르게 토큰 갱신을 때리면 KOE237(레이트리밋) 나올 수 있어서 딜레이
const DELAY_MS = Number(process.env.BROADCAST_DELAY_MS || 1200);

const CLIENT_ID = process.env.KAKAO_REST_KEY;
const CLIENT_SECRET = process.env.KAKAO_CLIENT_SECRET || "";

function log(...args) {
  if (DEBUG) console.log("[broadcast]", ...args);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function loadFriendTokens() {
  if (!fs.existsSync(TOKENS_PATH)) {
    throw new Error(`friend_tokens.json not found: ${TOKENS_PATH}`);
  }
  const raw = fs.readFileSync(TOKENS_PATH, "utf-8");
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr) || arr.length === 0) {
    throw new Error("friend_tokens.json is empty");
  }
  return arr;
}

async function refreshAccessToken(refreshToken, maxRetry = 5) {
  let last = null;

  for (let i = 0; i <= maxRetry; i++) {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    });
    if (CLIENT_SECRET) body.append("client_secret", CLIENT_SECRET);

    const res = await fetch("https://kauth.kakao.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body,
    });

    const json = await res.json().catch(() => ({}));
    if (res.ok && json.access_token) return json.access_token;

    last = json;
    const errCode = json?.error_code || json?.error;

    // KOE237: 토큰 요청 레이트리밋 -> 기다렸다 재시도
    if (errCode === "KOE237") {
      const waitMs = 1500 * Math.pow(2, i); // 1.5s, 3s, 6s, 12s...
      log("KOE237 wait", waitMs, "ms");
      await sleep(waitMs);
      continue;
    }

    throw new Error("token refresh failed: " + JSON.stringify(json));
  }

  throw new Error(
    "token refresh failed (KOE237 persists): " + JSON.stringify(last)
  );
}

async function sendMemo(accessToken, { text, url, buttonTitle = "더보기" }) {
  // 카카오 "기본 텍스트 템플릿" (버튼 링크 포함 가능)
  const templateObject = {
    object_type: "text",
    text: String(text || "").slice(0, 950), // 너무 길면 실패 가능 -> 안전 컷
    link: {
      web_url: url || "https://news.daum.net/",
      mobile_web_url: url || "https://news.daum.net/",
    },
    button_title: buttonTitle,
  };

  const body = new URLSearchParams({
    template_object: JSON.stringify(templateObject),
  });

  const res = await fetch(
    "https://kapi.kakao.com/v2/api/talk/memo/default/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body,
    }
  );

  const json = await res.json().catch(() => ({}));
  if (json.result_code !== 0) {
    throw new Error("memo send failed: " + JSON.stringify(json));
  }
  return json;
}

async function main() {
  if (!CLIENT_ID) throw new Error("ENV missing: KAKAO_REST_KEY");

  const friends = loadFriendTokens();
  console.log(`targets: ${friends.length}`);

  // 메시지: CLI 인자 우선, 없으면 기본
  const input = process.argv.slice(2).join(" ").trim();
  const text =
    input ||
    `🗞️ 경제 코끼리 테스트\n- 이 메시지는 "친구 계정의 나에게 보내기"로 도착합니다.\n- 다음 단계에서 뉴스 브리핑을 자동으로 넣습니다.`;
  const url = "https://news.daum.net/";

  for (let idx = 0; idx < friends.length; idx++) {
    const f = friends[idx];
    const who = f.kakao_user_id ?? `#${idx + 1}`;

    try {
      console.log(`[${idx + 1}/${friends.length}] send -> ${who}`);
      const accessToken = await refreshAccessToken(f.refresh_token);
      await sendMemo(accessToken, { text, url, buttonTitle: "더보기" });
      console.log(`  ✅ ok`);
    } catch (e) {
      console.log(`  ❌ fail: ${e?.message || e}`);
    }

    await sleep(DELAY_MS);
  }

  console.log("done.");
}

main().catch((e) => {
  console.error("fatal:", e?.message || e);
  process.exit(1);
});
