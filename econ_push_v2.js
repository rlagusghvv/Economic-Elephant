import "dotenv/config";
import Parser from "rss-parser";
import * as cheerio from "cheerio";
import fs from "node:fs";
import path from "node:path";
import { notify } from "./notify.js";

/**
 * econ_push_v2.js
 * 1) 조선/중앙/동아 주요 헤드라인(RSS)
 * 2) 네이버금융 '많이 본 뉴스'(조회수 랭킹)에서 테마(주식/환율/금/은/지수/선물)만 필터
 * 3) 중복 방지(state_econ.json)
 */

const STATE_PATH = path.resolve("./state_econ.json");

// ===== (1) 3대지 메인/주요 RSS =====
// 조선: rssplus 안내는 있지만, 실제 RSS는 여러 형태가 있어. 가장 범용적으로 쓰이는 공개 RSS를 우선 넣어둠.
// 중앙: joinsmsn RSS가 안정적으로 돌 때가 많음(전체/주요/경제 등)
// 동아: rss.donga.com에서 분야별 제공
const MAJOR_FEEDS = [
  {
    name: "조선일보(영문)",
    url: "https://english.chosun.com/site/data/rss/rss.xml",
  }, // 조선 RSS 안내에 노출  [oai_citation:2‡rssplus.chosun.com](https://rssplus.chosun.com/?utm_source=chatgpt.com)
  // 중앙(주요/경제)
  {
    name: "중앙일보 주요",
    url: "http://rss.joinsmsn.com/joins_homenews_list.xml",
  }, // 목록 출처  [oai_citation:3‡Gist](https://gist.github.com/koorukuroo/330a644fcc3c9ffdc7b6d537efd939c3?utm_source=chatgpt.com)
  {
    name: "중앙일보 경제",
    url: "http://rss.joinsmsn.com/joins_money_list.xml",
  }, // 목록 출처  [oai_citation:4‡Gist](https://gist.github.com/koorukuroo/330a644fcc3c9ffdc7b6d537efd939c3?utm_source=chatgpt.com)
  // 동아(전체/경제 등은 rss.donga.com에서 선택 가능)
  { name: "동아일보 경제", url: "http://rss.donga.com/economy.xml" }, // 동아 RSS 안내/목록  [oai_citation:5‡rss.donga.com](https://rss.donga.com/?utm_source=chatgpt.com)
];

// ===== (2) 네이버 금융 ‘많이 본 뉴스’(조회수 랭킹) =====
const NAVER_FINANCE_RANK_URL =
  "https://finance.naver.com/news/news_list.naver?mode=RANK";

// 테마 키워드: 여기에 걸리면 “테마 뉴스”로 분류
const THEME_KEYWORDS = [
  "주식",
  "증시",
  "코스피",
  "코스닥",
  "나스닥",
  "S&P",
  "다우",
  "환율",
  "달러",
  "엔화",
  "유로",
  "금",
  "은",
  "원자재",
  "지수",
  "선물",
  "옵션",
  "채권",
  "금리",
  "ETF",
  "ETN",
  "파생",
  "선물시장",
];

const TOP_MAJOR = 5; // 3대지(또는 major feeds)에서 몇 개까지
const TOP_THEME = 8; // “많이 본 뉴스” 테마에서 몇 개까지
const MAX_CHARS = 950; // 카톡 길이 안전장치

function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { sent: {} };
  return JSON.parse(fs.readFileSync(STATE_PATH, "utf-8"));
}
function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}
function keyOf(item) {
  return item.guid || item.id || item.link || item.title;
}
function clip(str, max) {
  return str.length > max ? str.slice(0, max - 3) + "..." : str;
}
function hasThemeKeyword(title) {
  const t = (title || "").toLowerCase();
  return THEME_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}

async function fetchRssTop() {
  const parser = new Parser();
  const state = loadState();

  const items = [];
  for (const feed of MAJOR_FEEDS) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const it of parsed.items || []) {
        const k = keyOf(it);
        if (!k) continue;
        if (state.sent[k]) continue;

        items.push({
          bucket: "MAJOR",
          source: feed.name,
          title: (it.title || "").replace(/\s+/g, " ").trim(),
          link: (it.link || "").trim(),
          date: it.isoDate || it.pubDate || "",
          key: k,
        });
      }
    } catch {
      // 특정 RSS가 막혀도 전체는 계속
    }
  }

  items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  return items.slice(0, TOP_MAJOR);
}

async function fetchNaverFinanceThemeTop() {
  const res = await fetch(NAVER_FINANCE_RANK_URL, {
    headers: {
      // 간단한 UA를 줘야 막힘이 줄어드는 경우가 있음
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
    },
  });
  const html = await res.text();
  const $ = cheerio.load(html);

  // 네이버 페이지 구조가 바뀌어도 최대한 살아남게:
  // - 모든 a 태그 중 뉴스 링크처럼 보이는 걸 수집
  const candidates = [];
  $("a").each((_, el) => {
    const title = $(el).text().replace(/\s+/g, " ").trim();
    const href = $(el).attr("href") || "";
    if (!title || title.length < 6) return;

    // 뉴스 링크로 자주 나오는 패턴들(상황에 따라 바뀔 수 있음)
    const isNewsLink =
      href.includes("read.naver") ||
      href.includes("news_read") ||
      href.includes("article") ||
      href.includes("news.naver.com");

    if (!isNewsLink) return;

    const link = href.startsWith("http")
      ? href
      : `https://finance.naver.com${href.startsWith("/") ? "" : "/"}${href}`;

    candidates.push({ title, link });
  });

  // 랭킹 페이지는 기본이 “많이 본 순”이라, 수집 순서(상단부터)가 곧 조회수 순에 가깝다.
  // 여기서 테마 키워드로 필터하고, 중복 제거한 뒤 Top N만 사용.
  const seen = new Set();
  const themed = [];

  for (const c of candidates) {
    const key = c.link + "|" + c.title;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!hasThemeKeyword(c.title)) continue;
    themed.push(c);
    if (themed.length >= TOP_THEME) break;
  }

  return themed.map((x, idx) => ({
    bucket: "THEME",
    source: "네이버금융(많이 본 뉴스)",
    title: x.title,
    link: x.link,
    date: "",
    key: `NAVER_RANK_${idx}_${x.link}`,
  }));
}

async function main() {
  const state = loadState();

  const major = await fetchRssTop();
  const theme = await fetchNaverFinanceThemeTop();

  if (major.length === 0 && theme.length === 0) {
    await notify("📌 오늘 보낼 뉴스가 아직 없어요.");
    return;
  }

  const today = new Date().toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
  });

  const majorText = major.length
    ? major
        .map((x, i) => `${i + 1}) [${x.source}] ${x.title}\n${x.link}`)
        .join("\n\n")
    : "(수집 실패 또는 신규 항목 없음)";

  const themeText = theme.length
    ? theme.map((x, i) => `${i + 1}) ${x.title}\n${x.link}`).join("\n\n")
    : "(랭킹 페이지 파싱 실패 또는 키워드 매칭 없음)";

  const msg = clip(
    `📰 ${today} 뉴스 브리핑\n\n` +
      `✅ 3대지 메인/주요 (상위 ${major.length})\n${majorText}\n\n` +
      `🔥 테마(주식·환율·금/은·지수·선물) 많이 본 뉴스 (상위 ${theme.length})\n${themeText}`,
    MAX_CHARS
  );

  await notify(msg);

  // 중복 방지 기록(major만 기록해도 되고, 둘 다 기록해도 됨)
  for (const x of [...major, ...theme]) state.sent[x.key] = Date.now();
  saveState(state);
}

main().catch(async (e) => {
  try {
    await notify(`⚠️ 뉴스 자동푸시 실패: ${e.message}`);
  } catch {}
  console.error(e);
  process.exit(1);
});
