// kakao/send.js (ESM)
// 카톡 "나에게 보내기" + 친구목록 + 친구에게 보내기
// ✅ tokenCache.js의 getAccessToken()을 그대로 재사용 (refresh 직접 처리 X)

import "dotenv/config";
import { getAccessToken } from "./tokenCache.js";

export async function sendDefaultTemplate(templateObject) {
  const accessToken = await getAccessToken();

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
  if (!res.ok || json.result_code !== 0) {
    throw new Error("카톡(나에게) 전송 실패: " + JSON.stringify(json));
  }
  return json;
}

/** 친구목록 조회: scope=friends 필요 */
export async function listFriends({ offset = 0, limit = 30 } = {}) {
  const accessToken = await getAccessToken();

  const url = new URL("https://kapi.kakao.com/v1/api/talk/friends");
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("order", "asc");

  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("친구목록 조회 실패: " + JSON.stringify(json));
  return json;
}

/**
 * 친구에게 보내기 (기본 템플릿)
 * ✅ accessToken은 tokenCache에서 받아서 사용
 * receiverUuids는 보통 5명 단위로 chunk해서 호출 권장 (notify.js에서 처리)
 */
export async function sendDefaultTemplateToFriends({
  receiverUuids,
  templateObject,
}) {
  if (!Array.isArray(receiverUuids) || receiverUuids.length === 0) {
    throw new Error("receiverUuids required");
  }
  if (!templateObject) throw new Error("templateObject required");

  const accessToken = await getAccessToken();

  const res = await fetch(
    "https://kapi.kakao.com/v1/api/talk/friends/message/default/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body: new URLSearchParams({
        receiver_uuids: JSON.stringify(receiverUuids),
        template_object: JSON.stringify(templateObject),
      }),
    }
  );

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("친구 전송 실패: " + JSON.stringify(json));
  return json;
}
