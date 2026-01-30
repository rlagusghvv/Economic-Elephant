// step11_summarize_and_send_v3.js
// ✅ 목표(안정판):
// 1) "전체뉴스 인기순 10"  (Google News TOP stories RSS 활용)
// 2) "경제뉴스 인기순 10"  (Google News: 주식/환율/금/은/지수/선물 등 키워드 + 중복제거)
// 3) 각 기사: 원문 링크 resolve(가능한 경우) -> 본문 텍스트 크롤링 -> 3줄 요약(Gemini) -> 카톡 전송
// 4) notifyList 안 씀. notify(text)만 씀.
// 실행:
//   DEBUG_STEP11=1 node step11_summarize_and_send_v3.js

import "dotenv/config";
import Parser from "rss-parser";
import { notify } from "./notify.js";
import { summarizeWithGemini } from "./summarizer/summarizeWithGemini.js";

// ✅ 네가 이미 쓰고 있던 “브라우저 렌더링 + 본문 추출” 함수가 있다면 이 import로 맞춰줘.
// 없으면, 아래 fallback(og:description + p)만으로도 어느 정도 동작하지만 품질은 떨어짐.
// 권장: 너가 만들었던 crawler/browser.js + 사이트별 crawler를 fetchArticleText로 묶어두기.
import { fetchArticleText } from "./crawler/fetchArticleText.js";

const DEBUG = process.env.DEBUG_STEP11 === "1";

const LIMIT_ALL = 10;
const LIMIT_ECON = 10;

const parser = new Parser({ timeout: 15000 });

// 구글뉴스 RSS (한국)
const GOOGLE_NEWS_TOP = "https://news.google.com/rss?hl=ko&gl=KR&ceid=KR:ko";
function googleNewsSearchRss(q) {
  return `https://news.google.com/rss/search?q=${encodeURIComponent(
    q
  )}&hl=ko&gl=KR&ceid=KR:ko`;
}

function log(...args) {
  if (DEBUG) console.log("[step11]", new Date().toISOString(), ...args);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function todayLabelKST() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// -----------------------------
// 1) RSS 가져오기
// -----------------------------
async function fetchRss(url) {
  log("rss fetch:", url);
  const feed = await parser.parseURL(url);
  const items =
    feed.items?.map((it) => ({
      title: (it.title || "").trim(),
      link: (it.link || "").trim(),
      isoDate: it.isoDate || it.pubDate || "",
      source: feed.title || "RSS",
    })) || [];
  return items.filter((x) => x.title && x.link);
}

// -----------------------------
// 2) 기사 후보 필터(잡것 제거)
// -----------------------------
function isValidTitle(title) {
  if (!title) return false;

  // 구글뉴스 RSS 제목은 "제목 - 언론사" 형태가 많음
  // 너무 광고/이벤트성 제거
  const badWords = [
    "광고",
    "이벤트",
    "프로모션",
    "쿠폰",
    "쇼핑",
    "구독",
    "회원",
    "PDF",
    "Topclass",
    "Cartoon",
  ];
  if (badWords.some((w) => title.includes(w))) return false;

  // 너무 짧거나 너무 길면 제외
  if (title.length < 8) return false;
  if (title.length > 120) return false;

  return true;
}

function normalizeLink(link) {
  return link.replace(/\?.*$/, "");
}

// -----------------------------
// 3) Google News 링크 → 원문 링크 resolve (가능하면)
// -----------------------------
// 구글뉴스 RSS는 종종 news.google.com/articles/... 형태.
// 이건 바로 원문 링크를 얻기 어렵고 리다이렉트가 섞임.
// 그래서:
// - news.google.com 링크면 일단 그대로 fetchArticleText가 처리하게 두거나
// - 혹은 HEAD/GET 따라가서 최종 URL 얻기 시도
async function resolveFinalUrl(url) {
  try {
    // 단순히 fetch하면 리다이렉트를 따라갈 수 있음
    const res = await fetch(url, { redirect: "follow" });
    return res.url || url;
  } catch {
    return url;
  }
}

// -----------------------------
// 4) 요약(제미나이) + fallback
// -----------------------------
function local3LineFallback(text) {
  const clean = (text || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  if (!clean) return ["(요약 실패: 본문 없음)"];

  const sentences = clean
    .split(/(?<=[.!?。]|다\.)\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 25);

  return (sentences.length ? sentences : [clean.slice(0, 120) + "..."]).slice(
    0,
    3
  );
}

async function summarize3Lines(text) {
  if (!text || text.length < 250) return local3LineFallback(text);

  // 비용/쿼터/에러 방지: 앞부분만 요약
  const clipped = text.slice(0, 3500);

  try {
    const out = await summarizeWithGemini(clipped);
    const lines = String(out)
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 3);

    return lines.length ? lines : local3LineFallback(text);
  } catch (e) {
    const msg = e?.message || "";
    // 429면 잠깐 대기 후 fallback
    if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
      const m = msg.match(/retry in\s+([0-9.]+)s/i);
      const waitMs = m ? Math.ceil(Number(m[1]) * 1000) + 1000 : 45000;
      log("gemini 429 -> wait", waitMs, "ms then fallback");
      await sleep(waitMs);
    }
    return local3LineFallback(text);
  }
}

// -----------------------------
// 5) 기사 1개 처리: resolve -> 본문 -> 요약
// -----------------------------
async function processOne(item, idx) {
  const rawTitle = item.title;
  const rawLink = normalizeLink(item.link);

  // 구글뉴스 링크일 수 있으니 최종 URL 시도
  const finalUrl = await resolveFinalUrl(rawLink);

  log(`article[${idx}]`, "finalUrl=", finalUrl);

  let article;
  try {
    // ✅ 네 crawler가 안정적으로 본문을 뽑는다고 가정
    // return { title, text }
    article = await fetchArticleText(finalUrl);
  } catch (e) {
    // fetchArticleText가 실패하면 최소 정보라도
    log("fetchArticleText fail:", e.message);
    article = { title: rawTitle, text: "" };
  }

  const title = (article.title || rawTitle || "").trim();
  const text = (article.text || "").trim();

  const lines = await summarize3Lines(text);

  return {
    title,
    link: finalUrl,
    summaryLines: lines,
  };
}

// -----------------------------
// 6) 메시지 구성 (notify용 텍스트)
// -----------------------------
function buildMessage(sectionTitle, items) {
  let msg = `📰 ${sectionTitle}\n\n`;

  if (!items.length) {
    msg += `⚠️ 가져올 기사가 없습니다.`;
    return msg;
  }

  items.forEach((it, i) => {
    msg += `${i + 1}) ${it.title}\n`;
    for (const ln of it.summaryLines) msg += `- ${ln}\n`;
    msg += `<더보기> ${it.link}\n\n`;
  });

  return msg.trim();
}

// -----------------------------
// 7) 실행: 전체/경제 각각 TOP10 만들기
// -----------------------------
async function runAllTop10() {
  const feedItems = await fetchRss(GOOGLE_NEWS_TOP);
  const filtered = feedItems
    .filter((x) => isValidTitle(x.title))
    .map((x) => ({ ...x, link: normalizeLink(x.link) }));

  // 중복 제거(링크 기준)
  const uniq = [];
  const seen = new Set();
  for (const it of filtered) {
    if (seen.has(it.link)) continue;
    seen.add(it.link);
    uniq.push(it);
  }

  const top = uniq.slice(0, LIMIT_ALL);
  log("ALL candidates:", uniq.length, "top10:", top.length);
  return top;
}

async function runEconTop10() {
  // 경제는 "조회수 순"을 RSS에서 직접 알 수 없어서,
  // 키워드별로 뽑아서 중복 제거 후 TOP10 구성(안정적 + 크롤링 성공률 우선)
  const keywords = [
    "주식",
    "환율",
    "금 가격",
    "은 가격",
    "지수",
    "선물",
    "코스피",
    "코스닥",
    "달러",
    "금리",
  ];

  let all = [];
  for (const k of keywords) {
    const url = googleNewsSearchRss(k);
    const items = await fetchRss(url);
    all.push(...items);
    await sleep(400);
  }

  const filtered = all
    .filter((x) => isValidTitle(x.title))
    .map((x) => ({ ...x, link: normalizeLink(x.link) }));

  // 중복 제거(링크 기준)
  const uniq = [];
  const seen = new Set();
  for (const it of filtered) {
    if (seen.has(it.link)) continue;
    seen.add(it.link);
    uniq.push(it);
  }

  const top = uniq.slice(0, LIMIT_ECON);
  log("ECON candidates:", uniq.length, "top10:", top.length);
  return top;
}

// -----------------------------
// MAIN
// -----------------------------
async function main() {
  log("STEP11 start");

  const date = todayLabelKST();

  // 1) TOP10 목록 만들기
  const allTop = await runAllTop10();
  const econTop = await runEconTop10();

  if (allTop.length < 5) {
    throw new Error("전체뉴스 TOP 후보가 너무 적음(네트워크/차단 가능)");
  }
  if (econTop.length < 5) {
    throw new Error("경제뉴스 TOP 후보가 너무 적음(네트워크/차단 가능)");
  }

  // 2) 기사 처리(요약) — 과호흡 방지: 순차 처리 + 텀
  const allDone = [];
  for (let i = 0; i < allTop.length; i++) {
    allDone.push(await processOne(allTop[i], i + 1));
    await sleep(900);
  }

  const econDone = [];
  for (let i = 0; i < econTop.length; i++) {
    econDone.push(await processOne(econTop[i], i + 1));
    await sleep(900);
  }

  // 3) 카톡 전송(섹션별 따로)
  const msgAll = buildMessage(`${date} | 전체뉴스 TOP ${LIMIT_ALL}`, allDone);
  const msgEcon = buildMessage(
    `${date} | 경제뉴스 TOP ${LIMIT_ECON}`,
    econDone
  );

  await notify(msgAll);
  await sleep(1200);
  await notify(msgEcon);

  log("STEP11 done");
}

main().catch(async (e) => {
  console.error("❌ step11 전체 실패:", e.message);
  try {
    await notify(`❌ step11 실패\n원인: ${e.message}`);
  } catch {}
  process.exit(1);
});
