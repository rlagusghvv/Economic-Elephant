// news/googleNewsRss.js
import Parser from "rss-parser";

const parser = new Parser({ timeout: 15000 });

// Google News RSS (한국)
function buildGoogleNewsRssUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=ko&gl=KR&ceid=KR:ko`;
}

// 구글뉴스 RSS의 link는 종종 news.google.com 리다이렉트일 수 있음.
// 1차로 그대로 쓰고, 나중에 실제 기사 크롤링 단계에서 최종 URL로 따라가도 됨.
export async function fetchGoogleNews(query, limit = 10) {
  const url = buildGoogleNewsRssUrl(query);
  const feed = await parser.parseURL(url);

  const items = (feed.items || [])
    .map((it) => ({
      title: (it.title || "").trim(),
      link: (it.link || "").trim(),
      pubDate: it.pubDate || "",
      source: it.creator || it["dc:creator"] || "",
    }))
    .filter((x) => x.title && x.link);

  // 중복 제거 (title 기준)
  const uniq = Array.from(new Map(items.map((x) => [x.title, x])).values());

  return uniq.slice(0, limit);
}
