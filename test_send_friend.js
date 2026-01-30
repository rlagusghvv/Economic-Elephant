// test_send_friend.js (ESM)
import "dotenv/config";
import fs from "node:fs";
import { listFriendsByUser, sendToFriendsByUser } from "./notify.js";

const TOKENS_PATH = process.env.FRIEND_TOKENS_PATH || "./friend_tokens.json";

// 1) 토큰 파일에서 "내 토큰(관리자)" 하나를 고르자
const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
if (!tokens.length) throw new Error("friend_tokens.json 비어있음");

const me = tokens[0]; // 일단 0번(원하면 바꿔도 됨)
console.log("using kakao_user_id:", me.kakao_user_id, "scope:", me.scope);

// 2) 내 카톡 친구 목록을 가져온다 (내가 친구로 맺은 사람들)
const friends = await listFriendsByUser(me.refresh_token, 30);
console.log("friends elements:", friends?.elements?.length || 0);

// 3) 테스트로 1명에게 보낸다 (elements[0] 선택)
// friends 는 listFriends() 결과라고 가정
console.log("friends elements:", friends.elements?.length ?? 0);

// ✅ 모든 친구 uuid 수집
const receiverUuids = (friends.elements || [])
  .map((f) => f.uuid)
  .filter(Boolean);

console.log("receiverUuids:", receiverUuids.length, receiverUuids);

// ✅ 한 번에 전송 (카카오는 보통 5명 단위 제한이 있으니 아래 chunk 권장)
await sendToFriendsByUser({
  refreshToken: user.refresh_token,
  receiverUuids,
  templateObject: {
    object_type: "text",
    text: "테스트 메시지입니다",
    link: {
      web_url: "https://example.com",
      mobile_web_url: "https://example.com",
    },
    button_title: "더보기",
  },
});

console.log("target:", first.profile_nickname, first.uuid);

// 4) 메시지(버튼 포함)
const templateObject = {
  object_type: "text",
  text: `📰 경제 코끼리 테스트\n\n정상 수신 확인용 메시지입니다.`,
  link: {
    web_url: "https://app.splui.com/health",
    mobile_web_url: "https://app.splui.com/health",
  },
  button_title: "서버 확인",
};

await sendToFriendsByUser({
  refreshToken: me.refresh_token,
  receiverUuids: [first.uuid],
  templateObject,
});

console.log("✅ sent!");
