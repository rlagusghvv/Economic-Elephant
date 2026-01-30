// econ_push_v3.js (ESM)
import "dotenv/config";
import Parser from "rss-parser";
import * as cheerio from "cheerio";
import iconv from "iconv-lite";
import { notify } from "./notify.js"; // 네가 만든 재사용용 notify.js 사용

const parser = new Parser({
  timeout: 15000,
  headers: { "User-Agent": "Mozilla/5.0" },
});

// ✅ 3대지: "전체/주요"로 고정
const MAJOR_FEEDS = [
  { name: "조선일보", url: "http://myhome.chosun.com/rss/www_section_rss.xml" },
  { name: "중앙일보", url: "http://rss.joinsmsn.com/joins_homenews_list.xml" },
  { name: "동아일보", url: "https://rss.donga.com/total.xml" },
];

// ✅ 테마 키워드(원하는 만큼 추가 가능)
const THEME_KEYWORDS = [
  "주식",
  "증시",
  "코스피",
  "코스닥",
  "나스닥",
  "다우",
  "S&P",
  "환율",
  "달러",
  "원화",
  "엔화",
  "유로",
  "금",
  "은",
  "원자재",
  "지수",
  "선물",
  "국채",
  "금리",
  "비트코인",
  "가상자산",
  "코인",
];

// 네이버 금융 "많이 본 뉴스(랭킹)" — 기본
const NAVER_FIN_RANK_URL =
  "https://finance.naver.com/news/news_list.naver?mode=RANK";

// ---------- 유틸 ----------
function pickTop(items, n = 5) {
  return (items || [])
    .slice(0, n)
    .map((it) => ({
      title: (it.title || "").trim(),
      link: (it.link || "").trim(),
    }))
    .filter((x) => x.title && x.link);
}

function containsTheme(title) {
  const t = (title || "").toLowerCase();
  return THEME_KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}

// EUC-KR 가능성 있는 페이지를 안전하게 읽기
async function fetchHtml(url, encoding = "utf-8") {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0" },
  });
  const ab = await res.arrayBuffer();
  const buf = Buffer.from(ab);

  // 네이버 금융은 EUC-KR/CP949가 종종 섞여서, 기본은 euc-kr로 시도 → 실패하면 utf-8
  if (encoding === "euc-kr") return iconv.decode(buf, "euc-kr");
  return iconv.decode(buf, "utf-8");
}

// ---------- 3대지 ----------
async function fetchMajorNews() {
  const out = [];
  for (const feed of MAJOR_FEEDS) {
    try {
      const data = await parser.parseURL(feed.url);
      const top = pickTop(data.items, 5);
      out.push({ name: feed.name, top });
    } catch (e) {
      out.push({ name: feed.name, top: [], error: String(e?.message || e) });
    }
  }
  return out;
}

// ---------- 테마 많이 본 뉴스 ----------
async function fetchThemeRankNews() {
  // 핵심: 인코딩 문제 방지 위해 euc-kr로 먼저 읽기
  const html = await fetchHtml(NAVER_FIN_RANK_URL, "euc-kr");
  const $ = cheerio.load(html);

  // 페이지 구조가 바뀌어도 버티게: 여러 후보 셀렉터로 링크 긁기
  const candidates = [];

  // 후보 1) 기사 리스트 영역에서 a 태그
  $("a").each((_, a) => {
    const title = $(a).text().replace(/\s+/g, " ").trim();
    const href = $(a).attr("href") || "";
    if (!title) return;

    // 네이버 금융 뉴스 링크 패턴(대략)
    if (
      href.includes("news_read.naver") ||
      href.includes("/news/") ||
      href.includes("read.naver")
    ) {
      candidates.push({ title, href });
    }
  });

  // href 정규화 + 테마 필터
  const normalized = candidates
    .map((x) => {
      let link = x.href.trim();
      if (link.startsWith("/")) link = "https://finance.naver.com" + link;
      if (link.startsWith("news_read.naver"))
        link = "https://finance.naver.com/" + link;
      return { title: x.title, link };
    })
    .filter((x) => x.link.startsWith("http"))
    .filter((x) => containsTheme(x.title));

  // 중복 제거(같은 링크)
  const seen = new Set();
  const uniq = [];
  for (const x of normalized) {
    if (seen.has(x.link)) continue;
    seen.add(x.link);
    uniq.push(x);
  }

  // 랭킹 페이지 자체가 “많이 본 순” 정렬이라 상위 n개만 쓰면 됨
  return uniq.slice(0, 10);
}

// ---------- 메시지 포맷 ----------
function formatMessage(majorBlocks, themeTop) {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");

  let msg = `🗞️ ${y}.${m}.${d}. 뉴스 브리핑\n\n✅ 3대지 메인/주요 (각 5개)\n`;

  for (const b of majorBlocks) {
    msg += `\n[${b.name}]\n`;
    if (!b.top.length) {
      msg += `- (가져오기 실패)\n`;
      if (b.error) msg += `  원인: ${b.error}\n`;
      continue;
    }
    b.top.forEach((it, i) => {
      msg += `${i + 1}) ${it.title}\n${it.link}\n`;
    });
  }

  msg += `\n🔥 테마(주식·환율·금·은·지수·선물) 많이 본 뉴스 (상위 ${themeTop.length})\n`;
  if (!themeTop.length) {
    msg += `(랭킹 페이지 파싱 실패 또는 인코딩/셀렉터 이슈)\n`;
  } else {
    themeTop.forEach((it, i) => {
      msg += `${i + 1}) ${it.title}\n${it.link}\n`;
    });
  }
  return msg.trim();
}

// ---------- 실행 ----------
async function main() {
  const major = await fetchMajorNews();
  const theme = await fetchThemeRankNews();

  const text = formatMessage(major, theme);

  // 콘솔 확인용
  console.log(text);

  // 카카오톡 푸시
  await notify(text);
}

main().catch((e) => {
  console.error("❌ 실행 에러:", e?.message || e);
  process.exit(1);
});
