// crawler/fetchArticleText.js (ESM)
// ✅ 어떤 기사 URL이 와도: { title, text } 형태로 최대한 본문 텍스트를 뽑아주는 "통합 크롤러"
//
// 원리(아주 쉽게):
// 1) URL의 HTML을 fetch로 가져온다
// 2) cheerio로 HTML을 "문서처럼" 읽는다
// 3) 본문이 있을 법한 영역(article/section/특정 id 등)에서 텍스트를 모은다
// 4) 너무 짧으면(유료벽/차단/구조 다름) -> 다른 후보 영역으로 재시도
//
// 사용 예:
//   import { fetchArticleText } from "./crawler/fetchArticleText.js";
//   const { title, text } = await fetchArticleText("https://...");

import { load } from "cheerio";

// -----------------------------
// 공통 유틸
// -----------------------------
function cleanText(s) {
  return (s || "")
    .replace(/\u00a0/g, " ") // &nbsp;
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripJunk($) {
  // 메뉴/광고/스크립트/스타일/푸터 같은 거 제거
  $("script, style, noscript, iframe").remove();
  $("header, footer, nav, aside").remove();

  // 광고/추천 영역으로 자주 쓰는 클래스/아이디 제거(너무 과하면 본문도 날아가서 최소만)
  $(
    '[class*="ad"],[id*="ad"],[class*="banner"],[id*="banner"],[class*="recommend"],[id*="recommend"]'
  ).remove();
}

function pickTitle($) {
  // 가장 흔한 우선순위로 제목 추출
  const og = $('meta[property="og:title"]').attr("content")?.trim();
  if (og) return og;

  const h1 = $("h1").first().text().trim();
  if (h1) return h1;

  const tit = $("title").text().trim();
  if (tit) return tit;

  return "";
}

function getTextFromSelector($, selector) {
  const el = $(selector).first();
  if (!el || !el.length) return "";
  return cleanText(el.text());
}

function collectParagraphs($, rootSel) {
  const root = $(rootSel).first();
  if (!root || !root.length) return "";

  const parts = [];
  root.find("p").each((_, p) => {
    const t = cleanText($(p).text());
    if (t.length >= 30) parts.push(t);
  });

  // p가 거의 없으면 그냥 전체 텍스트도 한 번
  if (parts.length < 3) {
    const t = cleanText(root.text());
    return t;
  }

  return parts.join("\n");
}

// -----------------------------
// fetch (타임아웃/UA)
// -----------------------------
async function fetchHtml(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    const html = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { html, finalUrl: res.url || url };
  } finally {
    clearTimeout(t);
  }
}

// -----------------------------
// 도메인별 "쉬운 본문" 규칙들
// -----------------------------
function extractDaum($) {
  // 다음 뉴스 본문은 #harmonyContainer가 매우 자주 쓰임
  // (정책/구조에 따라 달라질 수 있어 후보를 여러 개 둠)
  const candidates = [
    "#harmonyContainer",
    "article",
    "section",
    ".article_view",
  ];

  for (const sel of candidates) {
    const t = collectParagraphs($, sel) || getTextFromSelector($, sel);
    if (t && t.length >= 300) return t;
  }

  return "";
}

function extractNate($) {
  // 네이트는 article/section 기반이면 잘 나오는 경우가 많음
  const candidates = ["article", ".articleCont", "#articleCont", "section"];

  for (const sel of candidates) {
    const t = collectParagraphs($, sel) || getTextFromSelector($, sel);
    if (t && t.length >= 300) return t;
  }

  return "";
}

function extractChosun($) {
  // 조선은 구조가 자주 바뀌므로 광범위하게 탐색
  const candidates = [
    "article",
    "#article-body",
    ".article-body",
    ".article__body",
    "section",
  ];

  for (const sel of candidates) {
    const t = collectParagraphs($, sel) || getTextFromSelector($, sel);
    if (t && t.length >= 300) return t;
  }

  return "";
}

function extractJoongang($) {
  // 중앙(joins)은 연결/차단/구조가 자주 바뀌어서 fallback 중심
  const candidates = ["article", ".article_body", ".article-body", "section"];

  for (const sel of candidates) {
    const t = collectParagraphs($, sel) || getTextFromSelector($, sel);
    if (t && t.length >= 300) return t;
  }

  return "";
}

function extractDonga($) {
  const candidates = ["article", "#content", ".article_txt", "section"];

  for (const sel of candidates) {
    const t = collectParagraphs($, sel) || getTextFromSelector($, sel);
    if (t && t.length >= 300) return t;
  }

  return "";
}

// -----------------------------
// 완전 일반형(최후의 보루)
// -----------------------------
function extractGeneric($) {
  // 1) og:description
  const ogDesc = $('meta[property="og:description"]').attr("content")?.trim();

  // 2) article/section/body에서 p들 모으기
  const candidates = ["article", "section", "main", "body"];

  for (const sel of candidates) {
    const t = collectParagraphs($, sel);
    if (t && t.length >= 300) return t;
  }

  // 3) 그래도 없으면 ogDesc라도
  if (ogDesc && ogDesc.length >= 60) return ogDesc;

  return "";
}

// -----------------------------
// 메인 함수
// -----------------------------
export async function fetchArticleText(url) {
  if (!url || !url.startsWith("http")) {
    throw new Error("URL이 올바르지 않음");
  }

  // 1) HTML 가져오기
  const { html, finalUrl } = await fetchHtml(url, 20000);

  // 2) 파싱
  const $ = load(html);
  stripJunk($);

  // 3) 제목
  const title = pickTitle($);

  // 4) 도메인별 본문 추출
  const host = new URL(finalUrl).hostname;

  let text = "";
  if (host.includes("daum.net")) text = extractDaum($);
  else if (host.includes("nate.com")) text = extractNate($);
  else if (host.includes("chosun.com")) text = extractChosun($);
  else if (host.includes("joins.com")) text = extractJoongang($);
  else if (host.includes("donga.com")) text = extractDonga($);

  // 5) 그래도 짧으면 일반형 fallback
  if (!text || text.length < 250) {
    const generic = extractGeneric($);
    if (generic && generic.length > (text?.length || 0)) text = generic;
  }

  text = cleanText(text);

  // 6) 마지막 안전장치: 너무 길면 요약 비용/실패↑ → 적당히 컷
  if (text.length > 12000) text = text.slice(0, 12000);

  return { title, text, url: finalUrl };
}
