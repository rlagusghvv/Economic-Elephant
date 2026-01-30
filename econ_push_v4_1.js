// econ_push_v4_1.js (ESM)
import "dotenv/config";
import Parser from "rss-parser";
import { notify, notifyList } from "./notify.js";
import { chromium } from "playwright";

// 너가 이미 Gemini 요약 성공시킨 코드가 있다고 했으니 그 파일명을 그대로 쓰는 걸 권장.
// 여기서는 summarizeWithGemini(text) 함수가 있다고 가정.
// (네 프로젝트에 이미 있는 summarizer/summarizeWithGemini.js를 그대로 쓰면 됨)
import { summarizeWithGemini } from "./summarizer/summarizeWithGemini.js";

const parser = new Parser({ timeout: 20000 });

const LIMIT_PAPER = 5;
const LIMIT_THEME = 10;

// -------------------- 공통 필터(예외 최소화) --------------------
function normalize(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function isBlockedTitle(title) {
  const t = normalize(title).toLowerCase();
  const blocks = [
    "cartoon",
    "bamboo",
    "gifts",
    "topclass",
    "pdf",
    "membership",
    "구독",
    "회원",
    "광고",
    "이벤트",
    "쇼핑",
    "프로모션",
    "특가",
    "쿠폰",
    "sportsdonga",
    "스포츠동아",
    "포토",
    "photo",
    "영상",
    "video",
  ];
  return blocks.some((w) => t.includes(w.toLowerCase()));
}

function isBlockedLink(link) {
  const u = (link || "").toLowerCase();
  const blocks = [
    "sports.",
    "cartoon",
    "/games",
    "/magazine",
    "/shopping",
    "membership",
    "pdf_viewer",
    "bemil.chosun.com",
    "boutique.chosun.com",
    "allthatgolf.chosun.com",
    "topclass.chosun.com",
  ];
  return blocks.some((w) => u.includes(w));
}

function isValidArticle({ title, link }) {
  if (!title || !link) return false;
  if (isBlockedTitle(title)) return false;
  if (isBlockedLink(link)) return false;
  return true;
}

// -------------------- Google News RSS --------------------
function buildGoogleRssUrl(query) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=ko&gl=KR&ceid=KR:ko`;
}

/**
 * ✅ 핵심: Google RSS item은 it.link가 news.google.com 중계 링크인 경우가 많다.
 * rss-parser의 item.content / item["content:encoded"] 안에 원문 링크(<a href="...">)가 들어있는 편이라
 * 거기서 원문을 뽑아낸다.
 */
function extractPublisherUrlFromItem(item) {
  const raw = item["content:encoded"] || item.content || "";
  // 원문 링크 후보: content 안의 첫 번째 href
  const m = raw.match(/href="(https?:\/\/[^"]+)"/i);
  if (m?.[1]) return m[1];

  // fallback: 그냥 item.link
  return item.link;
}

async function fetchGoogleNews(query, limit) {
  const feed = await parser.parseURL(buildGoogleRssUrl(query));

  const items = (feed.items || [])
    .map((it) => {
      const title = normalize(it.title);
      const link = extractPublisherUrlFromItem(it);
      return { title, link };
    })
    .filter(isValidArticle);

  // 중복 제거(title 기준)
  const uniq = Array.from(new Map(items.map((x) => [x.title, x])).values());
  return uniq.slice(0, limit);
}

// -------------------- 원문 본문 크롤링(Playwright) --------------------
async function fetchRenderedHtml(url, timeoutMs = 25000) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
  });

  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // paywall/로딩 대비 약간 대기
    await page.waitForTimeout(800);
    const html = await page.content();
    return html;
  } finally {
    await page.close();
    await browser.close();
  }
}

// -------------------- 본문 추출(최소 휴리스틱) --------------------
// cheeio default import 이슈 피하려고: npm 기준 ESM에서는 보통 아래처럼 사용
import * as cheerio from "cheerio";

// 사이트별로 “본문 영역”이 자주 바뀌니까, 일단은 “범용 본문 후보”를 여러 개 두고 가장 긴 텍스트를 채택.
function extractMainText(html) {
  const $ = cheerio.load(html);

  const candidates = [
    "article",
    "main article",
    "div.article-body",
    "div#articleBody",
    "div[itemprop='articleBody']",
    "section[itemprop='articleBody']",
    "div.story-news article",
    "div#content",
  ];

  let best = "";
  for (const sel of candidates) {
    const t = normalize($(sel).text());
    if (t.length > best.length) best = t;
  }

  // 너무 짧으면 전체에서 문장만 뽑는 fallback
  if (best.length < 400) {
    const body = normalize($("body").text());
    best = body;
  }

  // 광고/메뉴 잡음 줄이기: 너무 긴 경우 앞부분만 사용(요약용)
  return best.slice(0, 6000);
}

async function fetchArticleText(url) {
  const html = await fetchRenderedHtml(url);
  const text = extractMainText(html);
  if (!text || text.length < 300) throw new Error("본문 추출 실패(너무 짧음)");
  return text;
}

// -------------------- 메시지 포맷(링크 직접 노출 최소화) --------------------
function formatOneItem(i, title, summary, url) {
  // ✅ “더보기”를 ‘클릭’하면 링크로 이동: 카톡은 제목 텍스트에 하이퍼링크를 거는 기능이 “텍스트 메시지”엔 없음.
  // 그래서 구조는 이렇게 가는 게 제일 깔끔함:
  // 1) 제목/요약만 보임
  // 2) 바로 아래 줄에 <더보기> + 링크 1줄
  return [
    `${i}) ${title}`,
    summary ? `- ${summary}` : `- (요약 실패)`,
    `<더보기> ${url}`,
    "",
  ].join("\n");
}

function buildSectionMessage(sectionTitle, items) {
  if (!items.length)
    return `⚠️ ${sectionTitle}\n가져올 수 있는 기사가 없습니다.`;

  let msg = `📰 ${sectionTitle}\n\n`;
  for (const line of items) msg += line + "\n";
  return msg.trim();
}

// -------------------- 섹션 실행(3대신문 / 경제TOP) --------------------
async function buildSummarizedLines(items, supportedDomains) {
  const lines = [];

  for (let idx = 0; idx < items.length; idx++) {
    const it = items[idx];
    const url = it.link;

    try {
      // ✅ 지원 도메인 필터(요약 불가 URL은 아예 제외하거나 “요약 실패”로 표기)
      const ok = supportedDomains.some((d) => url.includes(d));
      if (!ok) {
        lines.push(
          formatOneItem(
            idx + 1,
            it.title,
            "지원하지 않는 언론사/URL (요약 생략)",
            url
          )
        );
        continue;
      }

      const articleText = await fetchArticleText(url);
      const summary = await summarizeWithGemini(articleText); // 3줄 요약
      lines.push(formatOneItem(idx + 1, it.title, summary, url));
    } catch (e) {
      lines.push(
        formatOneItem(idx + 1, it.title, `요약 실패: ${e.message}`, url)
      );
    }
  }

  return lines;
}

async function runPaper(name, query, supportedDomains) {
  const date = new Date().toISOString().slice(0, 10);
  const sectionTitle = `${date} | ${name} TOP ${LIMIT_PAPER}`;

  try {
    const items = await fetchGoogleNews(query, LIMIT_PAPER);
    const lines = await buildSummarizedLines(items, supportedDomains);
    await notify(buildSectionMessage(sectionTitle, lines));
  } catch (e) {
    await notify(`⚠️ ${sectionTitle}\n가져오기 실패: ${e.message}`);
  }
}

async function runEconomyTop10() {
  const date = new Date().toISOString().slice(0, 10);
  const sectionTitle = `${date} | 경제 테마 TOP ${LIMIT_THEME}`;

  // “모든 뉴스사”를 넓게 가져오되, 노이즈를 줄이려면 “금/은/환율/지수/선물/코스피/나스닥/원달러” 같이 확장 추천
  const keywords = [
    "주식",
    "환율",
    "원달러",
    "금 가격",
    "은 가격",
    "코스피",
    "나스닥",
    "지수",
    "선물",
    "국채금리",
  ];

  try {
    let all = [];
    for (const k of keywords) {
      const items = await fetchGoogleNews(k, 20); // 넉넉히 모아서
      all.push(...items);
    }

    // 중복 제거(title)
    const uniq = Array.from(new Map(all.map((x) => [x.title, x])).values())
      .filter(isValidArticle)
      .slice(0, LIMIT_THEME);

    // 경제TOP은 “지원 도메인 제한”을 걸면 수가 줄어서, 일단은 요약은 ‘가능한 것만’ 시도하고 나머지는 생략표기
    const supportedDomains = [
      "chosun.com",
      "joins.com",
      "donga.com",
      // 여기에 네가 크롤러를 추가해갈 도메인을 계속 늘리면 됨
    ];

    const lines = await buildSummarizedLines(uniq, supportedDomains);
    await notify(buildSectionMessage(sectionTitle, lines));
  } catch (e) {
    await notify(`⚠️ ${sectionTitle}\n실패: ${e.message}`);
  }
}

// -------------------- 실행: 3대신문은 “각각 따로”, 경제TOP도 “따로” --------------------
(async () => {
  // ✅ 3대신문: 구글RSS 검색 쿼리(경제/전체 중 선택 가능)
  // 너는 “3대지는 경제 말고 전체”를 원했었는데,
  // 지금은 “요약까지” 붙이니까 일단 경제 섹션으로 안정화하는 게 더 쉽다.
  // 전체로 하고 싶으면 query를 site:... 로만 두면 됨.
  await runPaper("조선일보", "site:chosun.com", ["chosun.com"]);
  await runPaper("중앙일보", "site:joins.com", ["joins.com"]);
  await runPaper("동아일보", "site:donga.com", ["donga.com"]);

  await runEconomyTop10();
})();
