// sources/naverRanking.js (ESM)
import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

async function fetchText(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return await res.text();
}

function todayYYYYMMDD() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

// 네이버 섹션 랭킹 HTML 가져오기(여러 URL 후보)
export async function fetchNaverPopularHtml({
  sectionId,
  date,
  debug = false,
}) {
  const qs = new URLSearchParams({
    rankingType: "popular_day",
    sectionId: String(sectionId),
    date,
  });

  const candidates = [
    `https://news.naver.com/main/ranking/popularDay.naver?${qs}`,
    `https://news.naver.com/main/ranking/popularDay.nhn?${qs}`,
    `https://news.naver.com/main/ranking/popularDay.naver?mid=etc&${qs}`,
    `https://news.naver.com/main/ranking/popularDay.nhn?mid=etc&${qs}`,
  ];

  let lastErr = null;
  for (const u of candidates) {
    try {
      if (debug) console.log("[naver] fetch:", u);
      const html = await fetchText(u);
      if (html && html.length > 2000) return { url: u, html };
    } catch (e) {
      lastErr = e;
      if (debug) console.log("[naver] fetch fail:", e.message);
    }
  }
  throw lastErr || new Error("naver popular html fetch failed");
}

export function extractArticlesFromNaverPopular(html) {
  const $ = cheerio.load(html);
  const items = [];

  $(".rankingnews_box .rankingnews_list li").each((_, li) => {
    const a = $(li).find("a").first();
    const title = a.find(".list_title").text().trim() || a.text().trim();
    let link = a.attr("href") || "";
    if (link && link.startsWith("/")) link = "https://news.naver.com" + link;

    if (!title || !link) return;
    if (!/^https?:\/\//i.test(link)) return;

    const bad = ["subscribe", "membership", "promo", "event"];
    if (bad.some((w) => link.includes(w))) return;

    items.push({ title, url: link });
  });

  // url 기준 dedupe
  const seen = new Set();
  const uniq = [];
  for (const it of items) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    uniq.push(it);
  }
  return uniq;
}

export async function getKoreaTopFromNaver({
  limit = 5,
  sectionIds = [100, 101, 102, 103, 104, 105],
  debug = false,
} = {}) {
  const date = todayYYYYMMDD();
  const pool = [];

  for (const sid of sectionIds) {
    const { html, url } = await fetchNaverPopularHtml({
      sectionId: sid,
      date,
      debug,
    });
    const list = extractArticlesFromNaverPopular(html);
    if (debug)
      console.log("[naver] section", sid, "count:", list.length, "from", url);
    pool.push(...list.slice(0, 10));
  }

  // url dedupe 후 상위 limit
  const seenUrl = new Set();
  const uniq = [];
  for (const it of pool) {
    if (seenUrl.has(it.url)) continue;
    seenUrl.add(it.url);
    uniq.push(it);
  }

  return uniq.slice(0, limit);
}

export async function getWorldEconTopFromNaver({
  limit = 5,
  debug = false,
} = {}) {
  const date = todayYYYYMMDD();
  const SECTION_WORLD = 104;

  const { html, url } = await fetchNaverPopularHtml({
    sectionId: SECTION_WORLD,
    date,
    debug,
  });
  const list = extractArticlesFromNaverPopular(html);

  const econKw = [
    "금리",
    "환율",
    "달러",
    "유가",
    "원유",
    "물가",
    "인플레",
    "증시",
    "주가",
    "채권",
    "경기",
    "성장",
    "침체",
    "연준",
    "fed",
    "ecb",
    "boj",
    "중앙은행",
    "관세",
    "무역",
    "반도체",
    "원자재",
    "금값",
    "금",
    "은",
  ];

  const filtered = list.filter((it) => {
    const t = (it.title || "").toLowerCase();
    return econKw.some((k) => t.includes(k.toLowerCase()));
  });

  if (debug)
    console.log(
      "[naver] world list:",
      list.length,
      "filtered:",
      filtered.length,
      "from",
      url
    );

  const base = filtered.length >= limit ? filtered : list;
  return base.slice(0, limit);
}
