// step15_naver_rank_gemini_send.js (ESM)
// Naver '많이 본 뉴스' -> Gemini 1회(목록 기반 요약) -> 기사 1개당 카톡 1메시지(버튼: 더보기)
// ✅ Gemini 429/500/503 재시도(백오프) 포함

import "dotenv/config";
import * as cheerio from "cheerio";
import { sendKakaoTextWithButton } from "./notify.js";

const DEBUG = process.env.DEBUG_STEP15 === "1";
const log = (...a) => DEBUG && console.log("[step15]", ...a);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

// 글자 제한 대응 기본 5
const LIMIT_KR = Number(process.env.LIMIT_KR || 5);
const LIMIT_WORLD = Number(process.env.LIMIT_WORLD || 5);

// Naver sectionId: 100 정치, 101 경제, 102 사회, 103 생활/문화, 104 세계, 105 IT/과학
const NAVER_SECTIONS_KR = [100, 101, 102, 103, 104, 105];
const SECTION_WORLD = 104;

function nowKST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} KST`;
}

function todayYYYYMMDD() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} @ ${url}`);
  return await res.text();
}

async function fetchNaverPopularHtml({ sectionId, date }) {
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
      log("fetch:", u);
      const html = await fetchText(u);
      if (html && html.length > 2000) return { url: u, html };
    } catch (e) {
      lastErr = e;
      log("fetch fail:", e.message);
    }
  }
  throw lastErr || new Error("naver popular html fetch failed");
}

function extractArticlesFromNaverPopular(html) {
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

  const uniq = [];
  const seen = new Set();
  for (const it of items) {
    const k = `${it.title}||${it.url}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(it);
  }
  return uniq;
}

async function getKoreaTopFromNaver() {
  const date = todayYYYYMMDD();
  const pool = [];

  for (const sid of NAVER_SECTIONS_KR) {
    const { html, url } = await fetchNaverPopularHtml({ sectionId: sid, date });
    const list = extractArticlesFromNaverPopular(html);
    log("section", sid, "count:", list.length, "from", url);
    pool.push(...list.slice(0, 10));
  }

  const seenUrl = new Set();
  const uniq = [];
  for (const it of pool) {
    if (seenUrl.has(it.url)) continue;
    seenUrl.add(it.url);
    uniq.push(it);
  }

  return uniq.slice(0, LIMIT_KR);
}

async function getWorldEconTopFromNaver() {
  const date = todayYYYYMMDD();

  const { html, url } = await fetchNaverPopularHtml({
    sectionId: SECTION_WORLD,
    date,
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

  log("world list:", list.length, "filtered:", filtered.length, "from", url);

  const base = filtered.length >= LIMIT_WORLD ? filtered : list;
  return base.slice(0, LIMIT_WORLD);
}

function buildPrompt({ nowKSTStr, krItems, worldItems }) {
  const fmtList = (arr) =>
    arr.map((it, i) => `${i + 1}. ${it.title}\nURL: ${it.url}`).join("\n\n");

  return `
너는 "경제 코끼리" 뉴스 브리핑 작성자다.
현재 시각은 ${nowKSTStr} 이다.

아래에 내가 제공하는 "실제 기사 목록"만 근거로 삼아 요약하라.
절대 목록에 없는 URL을 새로 만들지 마라. (새 URL 생성 금지)
각 항목의 URL은 반드시 내가 준 URL과 완전히 동일하게 출력하라.

[출력 포맷을 100% 준수]
==한국 주요뉴스 TOP${krItems.length}==
### 1. 제목(내 목록의 제목을 그대로)
- 객관요약1
- 객관요약2
- 객관요약3
한줄결론: 중립 코멘트 1문장
URL: (내가 준 URL 그대로)

(반드시 ${krItems.length}개)

==세계 경제 주요뉴스 TOP${worldItems.length}==
### 1. 제목(내 목록의 제목을 그대로)
- 객관요약1
- 객관요약2
- 객관요약3
한줄결론: 중립 코멘트 1문장
URL: (내가 준 URL 그대로)

(반드시 ${worldItems.length}개)

[내가 제공하는 한국 기사 목록]
${fmtList(krItems)}

[내가 제공하는 세계(경제) 기사 목록]
${fmtList(worldItems)}
`.trim();
}

/** ✅ Gemini 호출 (429/500/503 재시도) */
async function callGeminiWithRetry(prompt, maxAttempts = 6) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY missing");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
      },
    };

    let res, json;
    try {
      res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      json = await res.json().catch(() => ({}));
    } catch (e) {
      // 네트워크 단절류도 재시도
      const waitMs = 1200 * Math.pow(2, attempt - 1);
      log(`gemini fetch error -> retry in ${waitMs}ms`, e.message);
      await sleep(waitMs);
      continue;
    }

    if (res.ok) {
      const text =
        json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
        "";
      return String(text).trim();
    }

    const status = res.status;
    const errStr = json?.error
      ? JSON.stringify(json.error)
      : JSON.stringify(json);

    // ✅ 429: rate limit (RetryInfo 있으면 우선)
    const retryDelaySec = Number(
      json?.error?.details
        ?.find((d) => d["@type"]?.includes("RetryInfo"))
        ?.retryDelay?.replace("s", "")
    );
    if (status === 429) {
      const waitMs = Number.isFinite(retryDelaySec)
        ? Math.max(800, retryDelaySec * 1000)
        : 1200 * Math.pow(2, attempt - 1);
      log(`Gemini 429 -> wait ${waitMs}ms (attempt ${attempt}/${maxAttempts})`);
      await sleep(waitMs);
      continue;
    }

    // ✅ 500/503: 서버 내부/일시 장애는 재시도
    if (status === 500 || status === 503) {
      const waitMs = 1500 * Math.pow(2, attempt - 1);
      log(
        `Gemini ${status} -> retry in ${waitMs}ms (attempt ${attempt}/${maxAttempts})`
      );
      await sleep(waitMs);
      continue;
    }

    // 그 외는 즉시 실패
    throw new Error(`Gemini HTTP ${status}: ${errStr}`);
  }

  throw new Error(
    `Gemini failed after ${maxAttempts} attempts (429/500/503 지속)`
  );
}

function parseBriefingBySection(text) {
  const raw = String(text || "");
  const krMatch = raw.match(/==한국 주요뉴스[^=]*==([\s\S]*?)(?==세계|\s*$)/);
  const worldMatch = raw.match(/==세계 경제 주요뉴스[^=]*==([\s\S]*)$/);

  return {
    kr: krMatch ? krMatch[1].trim() : "",
    world: worldMatch ? worldMatch[1].trim() : "",
  };
}

function parseItemsFromSection(sectionText) {
  const blocks = sectionText
    .split(/\n(?=###\s*\d+\.\s+)/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const items = [];
  for (const b of blocks) {
    const lines = b
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const head = lines[0] || "";
    const m = head.match(/^###\s*(\d+)\.\s*(.+)$/);
    if (!m) continue;

    const rank = Number(m[1]);
    const title = m[2].trim();

    const urlLine = lines.find((l) => /^URL:\s*https?:\/\//i.test(l));
    const url = urlLine ? urlLine.replace(/^URL:\s*/i, "").trim() : "";

    const bullets = lines
      .filter((l) => /^-\s+/.test(l))
      .map((l) => l.replace(/^-+\s*/, "").trim())
      .slice(0, 3);

    const oneLine = lines.find((l) => /^한줄결론\s*:/i.test(l));
    const conclusion = oneLine
      ? oneLine.replace(/^한줄결론\s*:\s*/i, "").trim()
      : "";

    items.push({ rank, title, bullets, conclusion, url });
  }

  return items.sort((a, b) => a.rank - b.rank);
}

function sanitize(s) {
  return String(s ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildKakaoText(category, it) {
  const lines = [];
  lines.push(`📰 ${category} #${it.rank}`);
  lines.push("");
  lines.push(`📌 ${sanitize(it.title)}`);
  lines.push("");
  for (const b of it.bullets || []) lines.push(`- ${sanitize(b)}`);
  if (it.conclusion) {
    lines.push("");
    lines.push(`한줄결론: ${sanitize(it.conclusion)}`);
  }
  return lines.join("\n").trim().slice(0, 900);
}

function validateUrls(items, allowedSet) {
  const ok = [];
  for (const it of items) {
    if (!it.url) continue;
    if (!allowedSet.has(it.url)) {
      log("drop url(not in list):", it.url);
      continue;
    }
    ok.push(it);
  }
  return ok;
}

async function sendItems(category, items) {
  for (const it of items) {
    const text = buildKakaoText(category, it);
    await sendKakaoTextWithButton({
      title: it.title,
      text,
      url: it.url,
      buttonTitle: "더보기",
    });
  }
}

async function main() {
  log("start", nowKST());

  const kr = await getKoreaTopFromNaver();
  const world = await getWorldEconTopFromNaver();

  if (!kr.length) throw new Error("KR items empty");
  if (!world.length) throw new Error("WORLD items empty");

  log("kr items:", kr.length);
  log("world items:", world.length);

  const prompt = buildPrompt({
    nowKSTStr: nowKST(),
    krItems: kr,
    worldItems: world,
  });
  log("prompt length:", prompt.length);

  const briefing = await callGeminiWithRetry(prompt);
  log("briefing length:", briefing.length);

  const { kr: krText, world: worldText } = parseBriefingBySection(briefing);
  const krParsed = parseItemsFromSection(krText);
  const worldParsed = parseItemsFromSection(worldText);

  const allowKR = new Set(kr.map((x) => x.url));
  const allowWorld = new Set(world.map((x) => x.url));

  const krFinal = validateUrls(krParsed, allowKR).slice(0, LIMIT_KR);
  const worldFinal = validateUrls(worldParsed, allowWorld).slice(
    0,
    LIMIT_WORLD
  );

  log("kr final:", krFinal.length, "world final:", worldFinal.length);

  await sendItems(`한국 주요뉴스 TOP${LIMIT_KR}`, krFinal);
  await sendItems(`세계 경제 주요뉴스 TOP${LIMIT_WORLD}`, worldFinal);

  log("done");
}

main().catch((e) => {
  console.error("❌ step15 failed:", e.message);
  process.exit(1);
});
