// step13_broadcast_friends.js (ESM)
// friend_tokens.json(동의한 유저들) -> 각 유저의 친구목록 조회 -> 친구들에게 메시지 전송
// - 여러 명에게 보내려면 receiver_uuids를 배열로 넣어야 함
// - 카카오는 보통 5명 단위 제한이 있어서 chunk 전송 권장

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { listFriends, sendToFriendsByUser } from "./notify.js";

const DEBUG = process.env.DEBUG_BROADCAST === "1";
const log = (...a) => DEBUG && console.log("[broadcast]", ...a);

const TOKENS_PATH =
  process.env.FRIEND_TOKENS_PATH ||
  path.join(process.cwd(), "friend_tokens.json");

// ✅ 기본 전송 대상 수(친구가 많아도 안전하게 5명씩)
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 5);

// ✅ 각 유저(동의자)당 전송 최대 친구 수 (테스트용)
// 0 또는 음수면 제한 없음
const MAX_PER_USER = Number(process.env.MAX_PER_USER || 0);

// ✅ 특정 친구 이름만 보내고 싶으면 (부분일치)
// 예) TARGET_NAME=가람
const TARGET_NAME = (process.env.TARGET_NAME || "").trim();

// ✅ 메시지 본문
const MESSAGE_TEXT =
  (process.env.MESSAGE_TEXT || "").trim() ||
  `✅ 경제코끼리 테스트 메시지
- 버튼 눌러서 링크 확인
- (테스트 중)`;

// ✅ 버튼 링크
const BUTTON_URL =
  (process.env.BUTTON_URL || "").trim() || "https://app.splui.com/health";

const BUTTON_TITLE = (process.env.BUTTON_TITLE || "더보기").trim();

// ================= utils =================
function readJsonSafe(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    return fallback;
  }
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeFriendsResponse(friendsRes) {
  // 카카오 friends API 응답 형태가 대체로 { elements: [...] }
  const elements = friendsRes?.elements || friendsRes?.friends || [];
  return Array.isArray(elements) ? elements : [];
}

function filterByName(elements, targetName) {
  if (!targetName) return elements;

  const t = targetName.toLowerCase();
  return elements.filter((f) => {
    const name = String(f?.profile_nickname || f?.nickname || f?.name || "");
    return name.toLowerCase().includes(t);
  });
}

function pickUuid(elements) {
  return elements
    .map((f) => f?.uuid)
    .filter((u) => typeof u === "string" && u.trim());
}

function buildTemplateObject() {
  // ✅ 친구 전송도 default template 구조를 그대로 사용
  return {
    object_type: "text",
    text: MESSAGE_TEXT.slice(0, 950), // 카톡 텍스트 제한 대비
    link: {
      web_url: BUTTON_URL,
      mobile_web_url: BUTTON_URL,
    },
    button_title: BUTTON_TITLE,
  };
}

// ================= main =================
async function main() {
  const users = readJsonSafe(TOKENS_PATH, []);

  if (!Array.isArray(users) || users.length === 0) {
    console.log("❌ friend_tokens.json 비어있음:", TOKENS_PATH);
    process.exit(1);
  }

  console.log("targets(users):", users.length);
  log("tokens path:", TOKENS_PATH);

  const templateObject = buildTemplateObject();

  let totalSent = 0;

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    const userId = user?.kakao_user_id;
    const refreshToken = user?.refresh_token;
    const scope = String(user?.scope || "");

    console.log(
      `\n[${i + 1}/${users.length}] user_id=${userId} scope=${scope}`
    );

    if (!refreshToken) {
      console.log("  ❌ skip: refresh_token 없음");
      continue;
    }

    // scope 체크(참고용)
    if (!scope.includes("talk_message")) {
      console.log("  ⚠️ warn: talk_message scope 없음(전송 실패 가능)");
    }
    if (!scope.includes("friends")) {
      console.log("  ⚠️ warn: friends scope 없음(친구목록 조회 실패 가능)");
    }

    // 1) 친구 목록 조회
    let friendsRes;
    try {
      friendsRes = await listFriends({ refreshToken });
    } catch (e) {
      console.log("  ❌ listFriends fail:", e?.message || e);
      continue;
    }

    const elements0 = normalizeFriendsResponse(friendsRes);
    console.log("  friends elements:", elements0.length);

    // 디버그: 친구 이름/uuid 몇개만
    if (DEBUG) {
      console.log(
        "  sample:",
        elements0.slice(0, 5).map((f) => ({
          nickname: f?.profile_nickname,
          uuid: f?.uuid,
        }))
      );
    }

    // 2) 이름 필터(옵션)
    const elements = filterByName(elements0, TARGET_NAME);
    if (TARGET_NAME) {
      console.log(`  filter name="${TARGET_NAME}" ->`, elements.length);
    }

    // 3) uuid 수집
    let receiverUuids = pickUuid(elements);

    if (MAX_PER_USER > 0) receiverUuids = receiverUuids.slice(0, MAX_PER_USER);

    if (receiverUuids.length === 0) {
      console.log("  ❌ skip: 전송할 receiver uuid 없음");
      continue;
    }

    console.log("  receivers:", receiverUuids.length);

    // 4) 5명씩 끊어서 전송
    const chunks = chunk(receiverUuids, CHUNK_SIZE);

    for (let ci = 0; ci < chunks.length; ci++) {
      const uuids = chunks[ci];
      console.log(`  - send chunk ${ci + 1}/${chunks.length}: ${uuids.length}`);

      try {
        const r = await sendToFriendsByUser({
          refreshToken,
          receiverUuids: uuids,
          templateObject,
        });

        // ✅ 성공 판정: successful_receiver_uuids 있으면 성공
        const okCount = Array.isArray(r?.successful_receiver_uuids)
          ? r.successful_receiver_uuids.length
          : 0;

        console.log("    ✅ ok:", okCount);
        totalSent += okCount;
      } catch (e) {
        console.log("    ❌ send fail:", e?.message || e);
      }

      // 너무 빠르게 쏘면 제한 걸릴 수 있으니 살짝 텀
      await sleep(300);
    }
  }

  console.log("\n✅ done. totalSent:", totalSent);
}

main().catch((e) => {
  console.error("❌ fatal:", e?.message || e);
  process.exit(1);
});
