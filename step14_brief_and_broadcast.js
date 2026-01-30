import "dotenv/config";
import fs from "node:fs";
import path from "node:path";

import { notify, notifyList, sendKakaoTextWithButton } from "./notify.js";
import { parseBriefing } from "./step11_send_from_briefing.js"; // 이미 너가 만든 parser

const TOKENS_PATH =
  process.env.FRIEND_TOKENS_PATH ||
  path.join(process.cwd(), "friend_tokens.json");

const LIMIT_KR = Number(process.env.LIMIT_KR || 5);
const LIMIT_WORLD = Number(process.env.LIMIT_WORLD || 5);
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 5);

const DEBUG = process.env.DEBUG_STEP14 === "1";
const log = (...a) => DEBUG && console.log("[step14]", ...a);

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

async function geminiBrief() {
  const apiKey = (process.env.GEMINI_API_KEY || "").trim();
  const model = (process.env.GEMINI_MODEL || "gemini-flash-latest").trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");

  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const nowStr = kst.toISOString().slice(0, 16).replace("T", " ");

  const prompt = `너는 "경제 코끼리" 뉴스 브리핑 작성자다.
현재 시각은 ${nowStr} KST 이다.

[목표]
1) 한국 주요 뉴스 TOP${LIMIT_KR}
2) 세계 경제 주요 뉴스 TOP${LIMIT_WORLD}

[규칙 - 매우 중요]
- 반드시 아래 출력 포맷을 100% 지켜라.
- 각 항목은 "객관 요약 3줄" + "한줄결론(중립 코멘트 1문장)"을 포함한다.
- 감정적 표현/선동/확신 단정 금지. 숫자/사실 기반으로.
- URL은 가능한 한 신뢰할 수 있는 출처의 대표 링크를 넣어라.
- 오직 아래 포맷만 출력.
“각 항목은 반드시 마지막 줄에 URL: https://...을 포함. 없으면 항목 자체를 출력하지 말 것.”

[중요 – URL 규칙]
각 기사에는 반드시 "기사 상세 페이지의 고유 URL"을 포함해야 한다.

아래 규칙을 반드시 지켜라:
1) URL은 반드시 https:// 로 시작해야 한다.
2) 메인 페이지, 카테고리 페이지, 디렉토리 URL은 절대 사용하지 말 것.
   (❌ 예: https://news.site.com/, /news/, /press/, /corporate/)
3) 기사 고유 ID, 날짜, 숫자, slug 중 최소 하나 이상이 포함된
   "기사 상세 URL"만 허용한다.
   (✅ 예: .../view.do?nttId=12345, .../articles/20260127-00123)
4) URL은 한 줄로 출력하며 공백을 포함하지 말 것.
5) 실제로 존재하는 기사 URL만 출력할 것. 추측 금지.
6) 확실한 URL을 찾을 수 없는 경우, 해당 기사는 제외하라.

출력 형식:
URL: https://...

[출력 포맷]
==한국 주요뉴스 TOP${LIMIT_KR}==
### 1. 제목
- 객관요약1
- 객관요약2
- 객관요약3
한줄결론: ...
URL: https://...

(총 ${LIMIT_KR}개)

==세계 경제 주요뉴스 TOP${LIMIT_WORLD}==
### 1. 제목
- 객관요약1
- 객관요약2
- 객관요약3
한줄결론: ...
URL: https://...

(총 ${LIMIT_WORLD}개)
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2 },
    }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok)
    throw new Error(`Gemini HTTP ${res.status}: ${JSON.stringify(json)}`);

  const text =
    json?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .join("")
      ?.trim() || "";
  if (!text) throw new Error("Gemini returned empty text");

  return text;
}

function toSendItems(briefText) {
  // parseBriefing은 ### 1. ... 기반으로 items[] 반환
  const items = parseBriefing(briefText);

  // 한국/세계 섹션 분리 없이 전부 items로 오면 그대로 사용
  // 섹션을 더 엄격히 나누고 싶으면 parseBriefing을 섹션별로 확장하면 됨.
  return items;
}

async function main() {
  console.log("[step14] start");

  // 1) 브리핑 생성
  const briefText = await geminiBrief();
  log("briefText:", briefText.slice(0, 200));
  // ✅ URL 라인이 실제로 포함되어 있는지 빠르게 검사
  const urlLineCount = (briefText.match(/^URL:\s*https?:\/\//gim) || []).length;
  console.log("[step14] URL lines found:", urlLineCount);

  // ✅ 섹션별로도 검사(원하면)
  const hasAnyUrl = urlLineCount > 0;
  if (!hasAnyUrl) {
    console.log(
      "[step14] WARNING: briefText에 URL: 라인이 없음 -> 더보기 링크 못만듦"
    );
  }

  // 2) 파싱
  const items = toSendItems(briefText);
  console.log("[step14] parsed items:", items.length);
  items.slice(0, 12).forEach((it, i) => {
    console.log(
      `[step14] item#${i + 1} rank=${it.rank} title=${String(it.title).slice(
        0,
        30
      )}... url=${it.url || "(empty)"}`
    );
  });
  console.log("[step14] parsed items:", items.length);
  if (items.length === 0) throw new Error("parsed items = 0 (포맷 깨짐)");

  // 3) 동의 유저 로드
  const users = readJsonSafe(TOKENS_PATH, []);
  if (!users.length) throw new Error("friend_tokens.json is empty");
  console.log("[step14] users:", users.length);

  // 4) 각 유저의 친구목록 → 전송
  for (const user of users) {
    const refreshToken = user.refresh_token;
    console.log("\n[user]", user.kakao_user_id, "scope:", user.scope);

    const friendsRes = await listFriends({ refreshToken });
    const elements = Array.isArray(friendsRes?.elements)
      ? friendsRes.elements
      : [];
    const receiverUuids = elements.map((f) => f.uuid).filter(Boolean);

    console.log("friends:", receiverUuids.length);
    if (!receiverUuids.length) continue;

    const chunks = chunk(receiverUuids, CHUNK_SIZE);

    // 기사 1개당 1메시지 → (각 메시지마다 친구 5명씩)
    for (const it of items) {
      const textLines = [];
      textLines.push(`📌 ${it.title}`);
      textLines.push("");
      (it.bullets || []).slice(0, 3).forEach((b) => textLines.push(`- ${b}`));
      if (it.conclusion) {
        textLines.push("");
        textLines.push(`한줄결론: ${it.conclusion}`);
      }

      const msgText = textLines.join("\n").slice(0, 950);
      const url = it.url;

      const templateObject = {
        object_type: "text",
        text: msgText.slice(0, 950),
        link: {
          web_url: it.url,
          mobile_web_url: it.url,
        },
        button_title: "더보기",
      };

      for (let i = 0; i < chunks.length; i++) {
        const uuids = chunks[i];
        const r = await sendToFriendsByUser({
          refreshToken,
          receiverUuids: uuids,
          templateObject,
        });

        const ok = Array.isArray(r?.successful_receiver_uuids)
          ? r.successful_receiver_uuids.length
          : 0;

        console.log("send ok:", ok, `(chunk ${i + 1}/${chunks.length})`);
        await sleep(250);
      }
    }
  }

  console.log("\n[step14] done");
}

main().catch((e) => {
  console.error("❌", e?.message || e);
  process.exit(1);
});
