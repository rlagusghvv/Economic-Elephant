// notify.js (ESM)
// ✅ export: notify / notifyList / sendKakaoTextWithButton / listFriends

import "dotenv/config";
import fs from "node:fs";
import {
  sendDefaultTemplate,
  listFriends,
  sendDefaultTemplateToFriends,
} from "./kakao/send.js";

const FRIEND_SEND = process.env.FRIEND_SEND === "1";
const FRIEND_MAX = Number(process.env.FRIEND_MAX || 3);
const FRIEND_UUIDS_PATH =
  process.env.FRIEND_UUIDS_PATH || "./friend_uuids.json";

// 친구 uuid 목록은 "한 번 뽑아 저장해두는 방식"이 제일 안정적
// friend_uuids.json 예시: ["uuid1","uuid2","uuid3"]
function loadFriendUuids() {
  if (!fs.existsSync(FRIEND_UUIDS_PATH)) return [];
  const arr = JSON.parse(fs.readFileSync(FRIEND_UUIDS_PATH, "utf-8"));
  if (!Array.isArray(arr)) return [];
  return arr.filter(Boolean).slice(0, FRIEND_MAX);
}

function splitMessage(text, chunkSize = 800) {
  const chunks = [];
  let s = String(text || "").trim();

  while (s.length > chunkSize) {
    let cut = s.lastIndexOf("\n", chunkSize);
    if (cut < 200) cut = chunkSize;
    chunks.push(s.slice(0, cut).trim());
    s = s.slice(cut).trim();
  }
  if (s) chunks.push(s);
  return chunks;
}

async function sendTemplate(templateObject) {
  // ✅ 친구에게 보내기
  if (FRIEND_SEND) {
    let receiverUuids = loadFriendUuids();

    // 파일이 없으면 "내 친구목록 조회해서 상위 N명"으로 자동 채움(최초 1회만)
    if (!receiverUuids.length) {
      const friends = await listFriends({ offset: 0, limit: 30 });
      receiverUuids = (friends.elements || [])
        .map((f) => f.uuid)
        .filter(Boolean)
        .slice(0, FRIEND_MAX);

      if (!receiverUuids.length) {
        throw new Error("친구 uuid를 못 가져옴 (friends scope 확인 필요)");
      }

      // 다음부터 안정적으로 보내려고 파일로 저장
      fs.writeFileSync(
        FRIEND_UUIDS_PATH,
        JSON.stringify(receiverUuids, null, 2)
      );
      console.log("[notify] saved friend uuids ->", FRIEND_UUIDS_PATH);
    }

    // ✅ 5명 단위 chunk 전송
    for (let i = 0; i < receiverUuids.length; i += 5) {
      const chunk = receiverUuids.slice(i, i + 5);
      await sendDefaultTemplateToFriends({
        receiverUuids: chunk,
        templateObject,
      });
    }
    return;
  }

  // ✅ 기본: 나에게 보내기
  return await sendDefaultTemplate(templateObject);
}

/** 텍스트 여러 번 나눠 보내기 */
export async function notify(text) {
  const chunks = splitMessage(text, 800);

  for (let i = 0; i < chunks.length; i++) {
    const prefix = chunks.length > 1 ? `(${i + 1}/${chunks.length}) ` : "";
    const templateObject = {
      object_type: "text",
      text: prefix + chunks[i],
      link: {
        web_url: "https://example.com",
        mobile_web_url: "https://example.com",
      },
      button_title: "확인",
    };
    await sendTemplate(templateObject);
  }
}

/** 기사 1개 = 카톡 1메시지 + 버튼(더보기) */
export async function sendKakaoTextWithButton({
  title = "경제 코끼리",
  text,
  url,
  buttonTitle = "더보기",
}) {
  if (!url) throw new Error("sendKakaoTextWithButton: url is required");
  if (!text) throw new Error("sendKakaoTextWithButton: text is required");

  if (url.includes("ngrok-free.app")) {
    throw new Error(
      "sendKakaoTextWithButton: url is ngrok (wrong link): " + url
    );
  }

  const u = new URL(url);
  u.searchParams.set("ek_ts", Date.now().toString());
  const finalUrl = u.toString();

  const templateObject = {
    object_type: "text",
    text: String(text).slice(0, 950),
    link: { web_url: finalUrl, mobile_web_url: finalUrl },
    button_title: buttonTitle,
  };

  console.log("[kakao] finalUrl =", finalUrl);
  return await sendTemplate(templateObject);
}

/** 핫토픽 알림 1건 보내기 (기본) */
export async function notifyHotTopics({
  date,
  limitKR = 5,
  limitWorld = 5,
  linkUrl,
  buttonTitle = "앱에서 보기",
} = {}) {
  if (!linkUrl) throw new Error("notifyHotTopics: linkUrl required");

  const text = [
    "🐘 경제코끼리 | 오늘의 경제 핫토픽이 도착했어요.",
    `KR ${limitKR} · WORLD ${limitWorld}`,
    "",
    "앱에서 보기 →",
  ].join("\n");

  return await sendKakaoTextWithButton({
    title: `경제코끼리 ${date || ""}`.trim(),
    text,
    url: linkUrl,
    buttonTitle,
  });
}

/** 리스트 템플릿 */
export async function notifyList({
  headerTitle,
  headerUrl,
  items,
  buttonTitle = "더보기",
  buttonUrl,
}) {
  const safeItems = (items || []).slice(0, 5);
  const contents = safeItems.map((it) => ({
    title: String(it.title || "").slice(0, 50),
    description: String(it.desc || "").slice(0, 200),
    link: { web_url: it.url, mobile_web_url: it.url },
  }));

  const firstUrl = headerUrl || safeItems?.[0]?.url || "https://news.daum.net/";

  const templateObject = {
    object_type: "list",
    header_title: headerTitle || "뉴스",
    header_link: { web_url: firstUrl, mobile_web_url: firstUrl },
    contents,
    button_title: buttonTitle,
    button_link: {
      web_url: buttonUrl || firstUrl,
      mobile_web_url: buttonUrl || firstUrl,
    },
  };

  return await sendTemplate(templateObject);
}

// 그대로 export
export { listFriends };
