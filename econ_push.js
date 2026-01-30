import "dotenv/config";
import Parser from "rss-parser";
import fs from "node:fs";
import path from "node:path";
import { notify } from "./notify.js";

/**
 * econ_push.js
 * - 여러 RSS에서 최신 경제뉴스를 가져옴
 * - 이미 보낸 뉴스는 state_econ.json에 기록해서 중복 발송 방지
 * - TOP N개를 카카오톡 "나에게"로 전송
 */

// 1) RSS 목록 (원하면 더 추가 가능)
const FEEDS = [
  { name: "연합뉴스 경제", url: "https://www.yna.co.kr/rss/economy.xml" },
  { name: "매일경제", url: "https://www.mk.co.kr/rss/30000001/" },
  { name: "한국경제", url: "https://rss.hankyung.com/new/news_economy.xml" },
];

// 2) 설정
const TOP_N = 5; // 매일 몇 개 보낼지
const MAX_CHARS = 950; // 카톡 텍스트가 너무 길어지면 잘라냄(안전장치)

// 3) 상태 파일(중복 방지)
const STATE_PATH = path.resolve("./state_econ.json");

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { sent: {} };
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
}
function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}
function keyOf(item) {
  // RSS마다 guid가 없을 수도 있어서 link/title로 fallback
  return item.guid || item.id || item.link || item.title;
}
function clip(str, max) {
  return str.length > max ? str.slice(0, max - 3) + "..." : str;
}

async function main() {
  const parser = new Parser();
  const state = loadState();

  const fresh = [];

  for (const feed of FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      const items = parsed.items || [];

      for (const it of items) {
        const k = keyOf(it);
        if (!k) continue;
        if (state.sent[k]) continue; // 이미 보낸 뉴스는 스킵

        fresh.push({
          source: feed.name,
          title: (it.title || "").trim(),
          link: (it.link || "").trim(),
          key: k,
          date: it.isoDate || it.pubDate || "",
        });
      }
    } catch (e) {
      // 특정 RSS가 실패해도 전체는 계속 진행
    }
  }

  // 최신순 느낌으로 정렬(날짜가 없는 항목은 뒤로)
  fresh.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

  const top = fresh.slice(0, TOP_N);

  if (top.length === 0) {
    await notify("📌 오늘 새로 올라온 경제 뉴스가 아직 없어요.");
    return;
  }

  // 메시지 구성
  const lines = top.map((x, i) => {
    const t = x.title.replace(/\s+/g, " ").trim();
    return `${i + 1}) [${x.source}] ${t}\n${x.link}`;
  });

  const today = new Date().toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
  });
  const msg = clip(
    `📈 ${today} 경제 뉴스 TOP ${top.length}\n\n${lines.join("\n\n")}`,
    MAX_CHARS
  );

  await notify(msg);

  // 보낸 것 기록 (중복 방지)
  for (const x of top) state.sent[x.key] = Date.now();
  saveState(state);
}

main()
  .then(() => console.log("econ_push done"))
  .catch(async (e) => {
    // 실패도 카톡으로 알려주면 운영이 편함
    try {
      await notify(`⚠️ 경제뉴스 자동푸시 실패: ${e.message}`);
    } catch {}
    console.error(e);
    process.exit(1);
  });
