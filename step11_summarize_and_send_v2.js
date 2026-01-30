// step11_summarize_and_send_v2.js
// ✅ 목표: 다음 랭킹(많이 본)에서 "전체 TOP10" + "경제 TOP10" 수집
//     → 기사 본문 추출 → 3줄 요약(Gemini 우선, 막히면 로컬요약) → 카톡 전송
//
// ✅ 디버그 장치 최대: 각 단계별 로그 + 실패 이유 출력
//
// 사용:
//   node step11_summarize_and_send_v2.js
//
// 옵션:
//   DEBUG_STEP11=1 node step11_summarize_and_send_v2.js

import "dotenv/config";
import * as cheerio from "cheerio";
import { notify } from "./notify.js";

// (네가 이미 쓰는 Gemini 요약 함수가 있으면 그걸 그대로 사용)
// 파일/함수명이 다르면 여기만 맞춰주면 됨.
import { summarizeWithGemini } from "./summarizer/summarizeWithGemini.js";

const DEBUG = process.env.DEBUG_STEP11 === "1";

const LIMIT_ALL = 10;
const LIMIT_ECON = 10;

// Gemini 429 대비: 기사 요약 호출 동시성 1 + 재시도
const GEMINI_MAX_RETRY = 3;

function log(...args) {
  if (DEBUG) console.log(`[step11 ${new Date().toISOString()}]`, ...args);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 오늘 날짜를 KST 기준 YYYYMMDD로 */
function todayKST_YYYYMMDD() {
  // KST = UTC+9
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  const d = String(now.getUTCDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

/** fetch 텍스트(타임아웃/헤더 포함) */
async function fetchText(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        // 랭킹/기사 페이지가 UA에 민감한 경우가 있어서 최소한의 UA 부여
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    const html = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return html;
  } finally {
    clearTimeout(t);
  }
}

/** 다음 랭킹 HTML에서 기사 목록 추출 */
function parseDaumRanking(html) {
  const $ = cheerio.load(html);

  // 랭킹 페이지의 링크는 보통 a태그로 제목이 들어감
  // 구조가 조금 바뀌어도 버티도록 후보를 넓게 잡음
  const items = [];

  // 1) 가장 흔한 패턴: 랭킹 카드 내 a 링크
  $("a").each((_, a) => {
    const href = $(a).attr("href") || "";
    const title = $(a).text().trim();

    // 기사 링크만 남기기(너무 공격적이면 누락되니 완만하게)
    // 다음 기사: https://news.v.daum.net/v/....
    // 또는 외부 언론사 기사 링크가 섞일 수 있음
    const isArticleLike =
      href.startsWith("https://news.v.daum.net/") ||
      href.includes("/v/") ||
      href.includes("/article/") ||
      href.includes("news/") ||
      href.includes("chosun.com") ||
      href.includes("joins.com") ||
      href.includes("donga.com");

    if (!title || title.length < 10) return;
    if (!href.startsWith("http")) return;
    if (!isArticleLike) return;

    items.push({ title, link: href });
  });

  // 중복 제거(링크 기준)
  const uniq = [];
  const seen = new Set();
  for (const it of items) {
    const key = it.link.replace(/\?.*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    uniq.push({ ...it, link: key });
  }

  return uniq;
}

/** 경제용 랭킹 URL 후보들: 먼저 성공하는 걸 자동 채택 */
function buildRankingUrls(regDate) {
  return {
    all: [
      `https://news.daum.net/ranking/popular?regDate=${regDate}`, // 기본
      `https://news.daum.net/ranking/popular`, // regDate 미지원인 경우 대비
    ],
    economy: [
      // 환경에 따라 다를 수 있어 후보를 여러 개 둠
      `https://news.daum.net/ranking/popular/economy?regDate=${regDate}`,
      `https://news.daum.net/ranking/popular/economy`,
      `https://news.daum.net/ranking/popular?regDate=${regDate}&tab=economy`,
      `https://news.daum.net/ranking/popular?regDate=${regDate}&category=economy`,
    ],
  };
}

/** 여러 URL 중 "기사 n개 이상" 나오는 첫 URL을 선택 */
async function fetchRankingFirstWorking(urls, minCount = 5) {
  let lastErr = null;

  for (const url of urls) {
    try {
      log("ranking fetch try:", url);
      const html = await fetchText(url, 15000);
      const items = parseDaumRanking(html);
      log("ranking parsed:", url, "count=", items.length);

      if (items.length >= minCount) return { url, items };
      lastErr = new Error(`parsed count too small: ${items.length}`);
    } catch (e) {
      lastErr = e;
      log("ranking fetch fail:", url, e.message);
    }
  }

  throw lastErr || new Error("ranking fetch failed");
}

/** 다음(daum) 기사면 본문 추출이 매우 쉬움 */
function extractDaumArticleText(html) {
  const $ = cheerio.load(html);

  const title =
    $("h3.tit_view").first().text().trim() ||
    $("h1").first().text().trim() ||
    "";

  // 다음 기사 본문 컨테이너: #harmonyContainer (자주 쓰임)  [oai_citation:1‡YSY의 데이터분석 블로그](https://ysyblog.tistory.com/47?utm_source=chatgpt.com)
  let text = $("#harmonyContainer").text().trim();

  // 백업: 기사 영역 후보(바뀌는 경우 대비)
  if (!text || text.length < 200) {
    text =
      $("section").text().trim() ||
      $("article").text().trim() ||
      $("body").text().trim();
  }

  // 너무 길면 요약 API에 과부하/비용 → 적당히 자르기
  text = normalizeText(text).slice(0, 8000);

  return { title, text };
}

/** 일반 기사(외부 도메인)용 간단 추출: og:description + p 합치기 */
function extractGenericArticleText(html) {
  const $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr("content")?.trim() ||
    $("title").text().trim() ||
    $("h1").first().text().trim() ||
    "";

  const ogDesc = $('meta[property="og:description"]').attr("content")?.trim();

  // p 태그를 많이 긁으면 광고/메뉴가 섞이기 쉬워서 "길이 조건"을 둠
  const ps = [];
  $("p").each((_, p) => {
    const t = $(p).text().trim();
    if (t.length >= 40) ps.push(t);
  });

  let text = [ogDesc, ...ps].filter(Boolean).join("\n");
  text = normalizeText(text).slice(0, 8000);

  return { title, text };
}

/** 텍스트 정리 */
function normalizeText(s) {
  return (s || "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/** 로컬 요약(완전 무료 fallback): 문장 3개 뽑기 */
function local3LineSummary(text) {
  const clean = normalizeText(text);
  if (!clean) return ["(요약 실패: 본문 없음)"];

  // 아주 단순: 문장 분리 후 길이 있는 문장 3개
  const sentences = clean
    .split(/(?<=[.!?。]|다\.)\s+|\n+/)
    .map((x) => x.trim())
    .filter((x) => x.length >= 30);

  if (!sentences.length) return [clean.slice(0, 120) + "..."];

  return sentences.slice(0, 3);
}

/** Gemini 요약(429 포함) 재시도 + fallback */
async function summarize3LinesSmart(text) {
  // 본문이 너무 짧으면 Gemini 안 부르고 로컬
  if (!text || text.length < 200) return local3LineSummary(text);

  for (let attempt = 1; attempt <= GEMINI_MAX_RETRY; attempt++) {
    try {
      log(`gemini summarize attempt ${attempt}/${GEMINI_MAX_RETRY}`);
      const summary = await summarizeWithGemini(text);

      // summarizeWithGemini가 "문장 3개 문자열"을 준다고 가정
      // 반환이 배열이면 그대로, 문자열이면 줄바꿈 기준 분해
      if (Array.isArray(summary)) {
        return summary.slice(0, 3);
      }
      const lines = String(summary)
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 3);

      return lines.length ? lines : local3LineSummary(text);
    } catch (e) {
      const msg = e?.message || "";
      log("gemini fail:", msg);

      // 429가 섞여있으면 잠깐 기다렸다 재시도(에러 메시지에 seconds가 들어오는 경우가 많음)
      if (msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED")) {
        // 메시지에 "retry in XXs" 형태가 있으면 뽑아서 대기
        const m = msg.match(/retry in\s+([0-9.]+)s/i);
        const waitMs = m ? Math.ceil(Number(m[1]) * 1000) + 1000 : 45000;
        log("gemini 429 backoff ms:", waitMs);
        await sleep(waitMs);
        continue;
      }

      // 그 외 오류면 즉시 로컬 요약으로 fallback
      return local3LineSummary(text);
    }
  }

  return local3LineSummary(text);
}

/** 기사 1개 처리: 본문 추출 → 3줄 요약 */
async function processOneArticle(item) {
  const url = item.link;

  // 1) HTML 가져오기
  let html;
  try {
    html = await fetchText(url, 20000);
  } catch (e) {
    return {
      ...item,
      ok: false,
      reason: `fetch fail: ${e.message}`,
      summaryLines: ["(요약 실패: 원문 fetch 실패)"],
    };
  }

  // 2) 본문 추출
  let extracted;
  try {
    if (url.startsWith("https://news.v.daum.net/")) {
      extracted = extractDaumArticleText(html);
    } else {
      extracted = extractGenericArticleText(html);
    }
  } catch (e) {
    return {
      ...item,
      ok: false,
      reason: `extract fail: ${e.message}`,
      summaryLines: ["(요약 실패: 본문 추출 실패)"],
    };
  }

  const articleTitle = extracted.title || item.title;
  const text = extracted.text;

  log("extract len:", url, text?.length || 0);

  // 3) 3줄 요약
  const summaryLines = await summarize3LinesSmart(text);

  return {
    title: articleTitle,
    link: url,
    ok: true,
    summaryLines,
    textLen: text?.length || 0,
  };
}

/** 메시지 만들기 */
function buildKakaoMessage(sectionTitle, articles) {
  let msg = `📰 ${sectionTitle}\n\n`;

  if (!articles.length) {
    msg += `⚠️ 가져올 기사가 없습니다.\n`;
    return msg;
  }

  articles.forEach((a, i) => {
    msg += `${i + 1}) ${a.title}\n`;
    const lines = (a.summaryLines || []).slice(0, 3);
    for (const ln of lines) {
      msg += `- ${ln}\n`;
    }

    // ✅ 텍스트 메시지는 링크를 "숨길 수 없음"
    // 그래서 최소한 보기 좋게 <더보기> 라벨로 붙여둠
    msg += `<더보기> ${a.link}\n\n`;
  });

  return msg.trim();
}

/** 메인 */
async function main() {
  const regDate = todayKST_YYYYMMDD();
  log("regDate:", regDate);

  const rankingUrls = buildRankingUrls(regDate);

  // 1) 전체 TOP10
  const allRanking = await fetchRankingFirstWorking(rankingUrls.all, 8);
  const allTop = allRanking.items.slice(0, LIMIT_ALL);

  // 2) 경제 TOP10 (후보 URL 중 되는 걸 자동 선택)
  let econTop = [];
  try {
    const econRanking = await fetchRankingFirstWorking(rankingUrls.economy, 5);
    econTop = econRanking.items.slice(0, LIMIT_ECON);
    log("economy ranking used:", econRanking.url);
  } catch (e) {
    // 경제 전용이 안 먹히면 fallback: 전체에서 "경제" 키워드 포함만 뽑기(응급)
    log("economy ranking all failed → fallback filter from all:", e.message);
    econTop = allRanking.items
      .filter((x) => /경제|주식|환율|금리|증시|코스피|코스닥|달러|원\/달러|유가|선물/i.test(x.title))
      .slice(0, LIMIT_ECON);
  }

  log("allTop:", allTop.length, "econTop:", econTop.length);

  // 3) 중복 제거(같은 링크가 겹치면 요약 1번만 하려고)
  const seen = new Set();
  const uniqAll = allTop.filter((x) => {
    if (seen.has(x.link)) return false;
    seen.add(x.link);
    return true;
  });

  // econ은 all과 겹쳐도 OK인데, 요약은 캐시 재사용하고 싶으면
  // 지금은 단순화 위해 별도 처리(원하면 Map 캐시 붙여줄게)
  const uniqEcon = econTop;

  // 4) 기사 처리(요약) - Gemini 쿼터 때문에 동시성 1로 "순차" 진행
  const allDone = [];
  for (const it of uniqAll) {
    log("process ALL:", it.link);
    const out = await processOneArticle(it);
    allDone.push(out);
    await sleep(300); // 과도한 요청 방지
  }

  const econDone = [];
  for (const it of uniqEcon) {
    log("process ECON:", it.link);
    const out = await processOneArticle(it);
    econDone.push(out);
    await sleep(300);
  }

  // 5) 카톡 전송(섹션별 따로)
  const dateLabel = `${regDate.slice(0, 4)}-${regDate.slice(4, 6)}-${regDate.slice(6, 8)}`;

  const msgAll = buildKakaoMessage(`${dateLabel} | 전체 인기 TOP ${LIMIT_ALL}`, allDone);
  const msgEcon = buildKakaoMessage(`${dateLabel} | 경제 인기 TOP ${LIMIT_ECON}`, econDone);

  await notify(msgAll);
  await sleep(1200); // 메시지 간격
  await notify(msgEcon);

  console.log("✅ step11 완료: 전체/경제 TOP 요약 전송 끝");
}

main().catch(async (e) => {
  console.error("❌ step11 전체 실패:", e);
  try {
    await notify(`❌ step11 실패\n원인: ${e?.message || e}`);
  } catch {}
  process.exit(1);
});