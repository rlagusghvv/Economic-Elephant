// step11_summarize_and_send.js (ESM)
// 구글뉴스RSS → 원문URL resolve → 본문 추출 → Gemini 3줄 요약 → 카톡 전송(신문사별 따로 + 경제TOP10 한번에)

import Parser from "rss-parser";
import * as cheerio from "cheerio"; // ✅ ESM: default import 금지
import { notify, notifyList } from "./notify.js";
import { summarizeWithGemini } from "./summarizer/summarizeWithGemini.js";

const DEBUG = process.env.DEBUG_STEP11 === "1";
const parser = new Parser({ timeout: 15000 });

// 출력 개수
const LIMIT_PAPER = 5; // 3대신문 각각 5개
const LIMIT_THEME = 10; // 경제 TOP 10

// 네가 원한 테마 키워드
const THEME_KEYWORDS = ["주식", "환율", "금 가격", "은 가격", "지수", "선물"];

// ✅ 카카오 메세지 길이 제한 대비(너 notify.js에서 분할전송하니까 여기선 적당히만)
const MAX_BODY_CHARS_FOR_SUMMARY = 6000; // Gemini에 넣을 본문 최대 길이(너무 길면 비용/속도/실패↑)

// ------------------ util ------------------
function log(...args) {
  if (DEBUG) console.log(`[step11 ${new Date().toISOString()}]`, ...args);
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
function todayKST() {
  // 메시지 헤더용 (KST 기준 날짜)
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function cleanUrl(u) {
  if (!u) return "";
  return u.trim();
}

function isGoogleNewsRssLink(link) {
  return /^https:\/\/news\.google\.com\/rss\/articles\//.test(link || "");
}

// “기사 아닌 것” 필터 (title/link 기반 + 도메인 기반)
function isValidArticle({ title, link }) {
  if (!title || !link) return false;

  const t = title.trim();
  const u = link.trim();

  const blockTitle = [
    "Cartoon",
    "Bamboo",
    "Gifts",
    "Topclass",
    "구독",
    "회원",
    "PDF",
    "광고",
    "이벤트",
    "쇼핑",
    "프로모션",
    "기자",
    "포토",
    "사진",
    "영상",
    "칼럼", // 원하면 빼도 됨
  ];

  const blockLink = [
    "sports.",
    "/sports/",
    "cartoon",
    "games",
    "magazine",
    "shopping",
    "membership",
    "pdf",
    "members.",
    "opinion", // 원하면 빼도 됨
  ];

  if (blockTitle.some((w) => t.includes(w))) return false;
  if (blockLink.some((w) => u.includes(w))) return false;

  return true;
}

// ------------------ Google News RSS ------------------
async function fetchGoogleNewsRss(query) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(
    query
  )}&hl=ko&gl=KR&ceid=KR:ko`;

  log("RSS:", url);
  const feed = await parser.parseURL(url);

  const items = (feed.items || [])
    .map((it) => ({
      title: (it.title || "").trim(),
      link: cleanUrl(it.link || ""),
      source: it.creator || it["dc:creator"] || "",
      pubDate: it.pubDate || "",
    }))
    .filter(isValidArticle);

  return items;
}

// ------------------ 1) 구글뉴스 링크 → 원문 링크 resolve ------------------
async function resolveGoogleNewsToOriginal(url) {
  // 1) 리다이렉트로 바로 원문이 나오면 그걸 사용
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
        "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
      },
    });

    // 어떤 환경에서는 res.url에 최종 URL이 들어옴
    const finalUrl = res.url || url;
    log("resolve(redirect) finalUrl:", finalUrl);

    if (finalUrl && !finalUrl.includes("news.google.com")) {
      return finalUrl;
    }

    // 2) HTML에서 원문 링크를 뽑는다
    const html = await res.text();

    // (a) url= 파라미터 패턴 (가끔 나옴)
    const urlParam = html.match(/url=(https?:\/\/[^"&\s]+)/i);
    if (urlParam?.[1]) {
      const decoded = decodeURIComponent(urlParam[1]);
      if (decoded.startsWith("http") && !decoded.includes("news.google.com")) {
        log("resolve(urlParam) ->", decoded);
        return decoded;
      }
    }

    // (b) HTML 안에 원문 링크가 그대로 박혀있는 경우가 많음 → “google 아닌 https 링크” 중 하나 고르기
    const candidates = Array.from(html.matchAll(/https?:\/\/[^\s"'<>]+/g))
      .map((m) => m[0])
      .map((u) => u.replace(/\\u0026/g, "&"))
      .map((u) => u.replace(/&amp;/g, "&"));

    // google/linkedin 등 잡다한 걸 제외하고 “기사로 보이는” 걸 우선
    const filtered = candidates.filter((u) => {
      if (!u.startsWith("http")) return false;
      if (u.includes("news.google.com")) return false;
      if (u.includes("accounts.google")) return false;
      if (u.includes("policies.google")) return false;
      if (u.includes("support.google")) return false;
      return true;
    });

    if (filtered.length) {
      log("resolve(htmlCandidates) count:", filtered.length);
      // 가장 먼저 나오는 걸 쓰되, 너무 이상하면 추가 필터링 가능
      return filtered[0];
    }
  } catch (e) {
    log("resolve error:", e.message);
  }

  // 최후: 그냥 원래 링크 반환(요약 실패로 이어질 수 있음)
  return url;
}

// ------------------ 2) 원문 HTML fetch ------------------
async function fetchHtml(url) {
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.8",
    },
  });

  const text = await res.text();
  return { status: res.status, finalUrl: res.url || url, html: text };
}

// ------------------ 3) 본문 추출 (범용) ------------------
function extractArticleText(html) {
  const $ = cheerio.load(html);

  // 불필요 요소 제거
  $("script, style, noscript, iframe, header, footer, nav, aside").remove();

  // 후보 셀렉터(대부분의 언론사에서 어느 정도 먹힘)
  const selectors = [
    "article",
    '[role="main"] article',
    ".article_view",
    ".article-body",
    ".articleBody",
    ".article-body-content",
    ".news_body",
    ".news_body_area",
    "#articleBody",
    "#article_body",
    "#articeBody", // 오타 케이스
    "#article-view-content-div",
    ".view_cont",
    ".read_body",
    ".content",
    ".story",
    ".post-content",
    "main",
  ];

  let best = "";

  for (const sel of selectors) {
    const txt = $(sel).text().replace(/\s+/g, " ").trim();
    if (txt.length > best.length) best = txt;
  }

  // 그래도 비면 body 전체에서 길이 큰 텍스트
  if (!best || best.length < 300) {
    const bodyTxt = $("body").text().replace(/\s+/g, " ").trim();
    if (bodyTxt.length > best.length) best = bodyTxt;
  }

  // 너무 길면 앞부분만(요약엔 충분)
  if (best.length > MAX_BODY_CHARS_FOR_SUMMARY) {
    best = best.slice(0, MAX_BODY_CHARS_FOR_SUMMARY);
  }

  return best;
}

// ------------------ 4) 3줄 요약 (Gemini) ------------------
async function summarize3Lines(text) {
  // Gemini 호출이 실패할 수도 있으니 안전장치
  if (!text || text.length < 200) return null;

  try {
    const summary = await summarizeWithGemini(text);
    // summarizeWithGemini가 이미 3줄로 나오도록 만든 상태라면 그대로 사용
    return (summary || "").trim() || null;
  } catch (e) {
    log("Gemini summarize failed:", e.message);
    return null;
  }
}

// ------------------ 5) “제목 + <더보기> 링크” 메시지 포맷 ------------------
function formatItemLine(i, title, link, summary) {
  // 카톡에서 “텍스트 일부만 하이퍼링크”는 기본 텍스트 메시지로는 불가에 가깝고,
  // 링크가 포함된 라인이 자동 링크가 되는 방식이라, 구조를 이렇게 권장:
  // - 제목
  // - 요약 3줄
  // - <더보기> (다음 줄에 링크)
  const safeTitle = (title || "").replace(/\s+/g, " ").trim();

  let line = `${i + 1}) ${safeTitle}\n`;
  if (summary) {
    line += `${summary}\n`;
  } else {
    line += `⚠️ 요약 실패(본문 추출/모델 실패)\n`;
  }
  line += `<더보기>\n${link}\n`;
  return line;
}

function buildMessage(header, items) {
  let msg = `🗞️ ${header}\n\n`;
  for (const it of items) {
    msg += it.block + "\n";
  }
  return msg.trim();
}

// ------------------ 6) 핵심 파이프라인: (RSS item) → resolve → fetch → extract → summarize ------------------
async function processOneItem(it, idx, tag) {
  const title = it.title;
  const rssLink = it.link;

  log(`[${tag}] item#${idx + 1} title=`, title);
  log(`[${tag}] rssLink=`, rssLink);

  // 1) google rss 링크면 원문으로 resolve
  let origin = rssLink;
  if (isGoogleNewsRssLink(rssLink)) {
    origin = await resolveGoogleNewsToOriginal(rssLink);
  }

  log(`[${tag}] origin=`, origin);

  // 2) HTML fetch
  const { status, finalUrl, html } = await fetchHtml(origin);
  log(`[${tag}] fetch status=`, status, "finalUrl=", finalUrl);

  // 3) 본문 추출
  const bodyText = extractArticleText(html);
  log(`[${tag}] bodyText length=`, bodyText?.length || 0);

  // 4) 요약
  const summary = await summarize3Lines(bodyText);
  log(`[${tag}] summary ok=`, !!summary);

  const block = formatItemLine(idx, title, finalUrl || origin, summary);
  return { title, link: finalUrl || origin, summary, block };
}

// ------------------ 7) 신문사 TOP 5 ------------------
async function runPaper(name, query) {
  try {
    const items = await fetchGoogleNewsRss(query);
    const sliced = items.slice(0, LIMIT_PAPER);

    const processed = [];
    for (let i = 0; i < sliced.length; i++) {
      try {
        const p = await processOneItem(sliced[i], i, name);
        processed.push(p);
        await sleep(800); // 과호출 방지
      } catch (e) {
        log(`[${name}] item fail:`, e.message);
        processed.push({
          block: `${i + 1}) ${sliced[i].title}\n⚠️ 처리 실패: ${
            e.message
          }\n<더보기>\n${sliced[i].link}\n`,
        });
      }
    }

    const header = `${todayKST()} | ${name} TOP ${LIMIT_PAPER}`;
    const msg = buildMessage(header, processed);
    await notify(msg);
  } catch (e) {
    await notify(`⚠️ ${name} 뉴스 전체 실패\n원인: ${e.message}`);
  }
}

// ------------------ 8) 경제 테마 TOP 10 (전체 뉴스사) ------------------
async function runThemeTop10() {
  try {
    let all = [];
    for (const k of THEME_KEYWORDS) {
      const items = await fetchGoogleNewsRss(k);
      all.push(...items);
      await sleep(300);
    }

    // 제목 기준 중복 제거
    const uniq = Array.from(new Map(all.map((i) => [i.title, i])).values());

    // 상위 10개
    const sliced = uniq.slice(0, LIMIT_THEME);

    const processed = [];
    for (let i = 0; i < sliced.length; i++) {
      try {
        const p = await processOneItem(sliced[i], i, "경제TOP10");
        processed.push(p);
        await sleep(800);
      } catch (e) {
        log(`[경제TOP10] item fail:`, e.message);
        processed.push({
          block: `${i + 1}) ${sliced[i].title}\n⚠️ 처리 실패: ${
            e.message
          }\n<더보기>\n${sliced[i].link}\n`,
        });
      }
    }

    const header = `${todayKST()} | 경제 테마 TOP ${LIMIT_THEME}`;
    const msg = buildMessage(header, processed);

    // 경제 TOP10은 한 번에(너가 원한 구조)
    await notify(msg);
  } catch (e) {
    await notify(`⚠️ 경제 테마 TOP10 전체 실패\n원인: ${e.message}`);
  }
}

// ------------------ 실행 ------------------
(async () => {
  // ⚠️ 혹시 notify.js에서 refresh rate limit(KOE237)이 다시 터지면,
  // step11이 요약 중간에 끊길 수 있음 → notify.js 캐시버전 필수.

  // 3대신문은 각자 따로 전송
  await runPaper("조선일보", "site:chosun.com");
  await sleep(1200);

  await runPaper("중앙일보", "site:joongang.co.kr OR site:joins.com");
  await sleep(1200);

  await runPaper("동아일보", "site:donga.com");
  await sleep(1200);

  // 경제 TOP10은 한 번에
  await runThemeTop10();
})();
