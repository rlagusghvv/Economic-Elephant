// step18_screenshot_brief_and_send.js (ESM)
// Naver 랭킹에서 KR/WORLD URL 수집 -> 스샷(clipHeight) -> Gemini Vision 2회(KR/WORLD) -> 파싱 -> 카톡 전송
// 실행: DEBUG_STEP18=1 LIMIT_KR=5 LIMIT_WORLD=5 node step18_screenshot_brief_and_send.js

import "dotenv/config";
import * as cheerio from "cheerio";
import { screenshotArticles } from "./crawler/screenshotArticle.js";
import { geminiVisionBrief, buildVisionPrompt } from "./gemini/visionBrief.js";
import { sendKakaoTextWithButton } from "./notify.js";

const FRIEND_UUIDS = process.env.KAKAO_FRIEND_UUIDS
  ? JSON.parse(process.env.KAKAO_FRIEND_UUIDS)
  : null;

const DEBUG = process.env.DEBUG_STEP18 === "1";
const log = (...a) => DEBUG && console.log("[step18]", ...a);

const LIMIT_KR = Number(process.env.LIMIT_KR || 5);
const LIMIT_WORLD = Number(process.env.LIMIT_WORLD || 5);

const CLIP_HEIGHT = Number(process.env.CLIP_HEIGHT || 800);

// ✅ 출력 끊김 방지: 줄수/토큰 제어
const SUMMARY_LINES = Number(process.env.SUMMARY_LINES || 2);
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 2200);

function envNumber(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) ? v : fallback;
}

function hasAnyKw(title, kws) {
  const t = (title || "").toLowerCase();
  return kws.some((k) => t.includes(k));
}

function filterWorldCandidates(list) {
  return list.filter((it) => {
    const t = (it.title || "").toLowerCase();
    const okInclude = hasAnyKw(t, WORLD_INCLUDE_KW);
    const bad = hasAnyKw(t, WORLD_EXCLUDE_KW);
    return okInclude && !bad;
  });
}

const WAIT_BETWEEN_CALLS_MS = envNumber("WAIT_BETWEEN_CALLS_MS", 35000);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

const LIMIT_PER_SECTION_FETCH = Number(
  process.env.NAVER_POOL_PER_SECTION || 10
);

// Naver sectionId: 100 정치, 101 경제, 102 사회, 103 생활/문화, 104 세계, 105 IT/과학
const NAVER_SECTIONS_KR = [100, 102, 103, 105];
const SECTION_WORLD = [101, 104];

// WORLD 후보를 위한 include / exclude 키워드
const WORLD_INCLUDE_KW = [
  // 해외/국제
  "해외",
  "글로벌",
  "국제",
  "월가",
  "뉴욕",
  "미중",
  "중동",
  "eu",
  "유럽",
  "영국",
  "독일",
  "프랑스",
  "일본",
  "중국",
  // 거시/시장
  "금리",
  "환율",
  "달러",
  "유로",
  "엔",
  "위안",
  "인플레",
  "물가",
  "cpi",
  "ppi",
  "증시",
  "주가",
  "나스닥",
  "s&p",
  "다우",
  "채권",
  "국채",
  "유가",
  "원유",
  "wti",
  "brent",
  "원자재",
  "금",
  "은",
  "비트코인",
  "가상자산",
  // 기관
  "연준",
  "fed",
  "fomc",
  "ecb",
  "boj",
  "pbo",
  "imf",
  "oecd",
  // 무역/정책
  "관세",
  "무역",
  "수출",
  "수입",
  "제재",
  "공급망",
].map((s) => s.toLowerCase());

const WORLD_EXCLUDE_KW = [
  "대통령",
  "국회",
  "여야",
  "검찰",
  "경찰",
  "선거",
  "탄핵",
  "징계",
  "살인",
  "폭행",
  "사망",
  "화재",
  "산불",
  "사고",
  "참사",
  "실종",
  "연예",
  "배우",
  "가수",
  "드라마",
  "결혼",
  "이혼",
  "상간",
  "스캔들",
].map((s) => s.toLowerCase());

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

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

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.6",
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
      log("naver fetch:", u);
      const html = await fetchText(u);
      if (html && html.length > 2000) return { url: u, html };
    } catch (e) {
      lastErr = e;
      log("naver fetch fail:", e.message);
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

    // ✅ 핵심: n.news.naver.com/article/... 형태로 정규화
    // (예전엔 https://n.news.naver.com 같은 루트만 잡히는 경우가 있어 방어)
    if (link === "https://n.news.naver.com") return;

    const bad = ["subscribe", "membership", "promo", "event"];
    if (bad.some((w) => link.includes(w))) return;

    items.push({ title, url: link });
  });

  // 중복 제거(url)
  const uniq = [];
  const seen = new Set();
  for (const it of items) {
    if (!it.url.includes("/article/")) continue;
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    uniq.push(it);
  }

  return uniq;
}

async function getKoreaTopFromNaver(limit) {
  const date = todayYYYYMMDD();
  const pool = [];

  for (const sid of NAVER_SECTIONS_KR) {
    const { html, url } = await fetchNaverPopularHtml({ sectionId: sid, date });
    const list = extractArticlesFromNaverPopular(html);
    log("section", sid, "count:", list.length, "from", url);
    pool.push(...list.slice(0, LIMIT_PER_SECTION_FETCH));
  }

  const seenUrl = new Set();
  const uniq = [];
  for (const it of pool) {
    if (seenUrl.has(it.url)) continue;
    seenUrl.add(it.url);
    uniq.push(it);
  }

  return uniq.slice(0, limit);
}
// ✅ WORLD 후보: 네이버 '경제(101)' 랭킹에서 "해외/환율/증시/거시" 키워드로 필터링
// ✅ WORLD 후보: 104(세계) 우선 + 101(경제) 보충 + negative filter + KR 중복 제거
async function getWorldTopFromNaver(limitWorld, excludeUrlSet = new Set()) {
  const date = todayYYYYMMDD();

  // 1) 104 세계 랭킹
  const { html: html104, url: url104 } = await fetchNaverPopularHtml({
    sectionId: 104,
    date,
  });
  const list104 = extractArticlesFromNaverPopular(html104);
  log("world104 list:", list104.length, "from", url104);

  const filtered104 = filterWorldCandidates(list104);
  log("world104 filtered:", filtered104.length);

  const picked = [];
  const seen = new Set();

  const pushUniq = (arr) => {
    for (const it of arr) {
      if (!it?.url || seen.has(it.url)) continue;
      if (excludeUrlSet.has(it.url)) continue; // ✅ KR과 겹치면 제거
      seen.add(it.url);
      picked.push(it);
      if (picked.length >= limitWorld) break;
    }
  };

  pushUniq(filtered104);

  // 2) 부족하면 101 경제에서 보충
  if (picked.length < limitWorld) {
    const { html: html101, url: url101 } = await fetchNaverPopularHtml({
      sectionId: 101,
      date,
    });
    const list101 = extractArticlesFromNaverPopular(html101);
    log("econ101 list:", list101.length, "from", url101);

    const filtered101 = filterWorldCandidates(list101);
    log("econ101 filtered(world supplement):", filtered101.length);

    pushUniq(filtered101);
  }

  // 3) 그래도 부족하면 104에서 include 없이(단, exclude는 유지)로 추가
  if (picked.length < limitWorld) {
    const soft104 = list104.filter(
      (it) => !hasAnyKw((it.title || "").toLowerCase(), WORLD_EXCLUDE_KW)
    );
    log("world104 soft-fill:", soft104.length);
    pushUniq(soft104);
  }

  return picked.slice(0, limitWorld);
}
/**
 * Gemini Vision 출력 파싱
 * - "ID: KR-01 | 제목" 형태에서 ID와 제목을 뽑고
 * - URL은 모델 출력 URL을 쓰되, 최종 검증은 allowedSet으로 한다.
 */
function parseBriefItems(raw, categoryLabel, limit, idToUrl) {
  const text = String(raw || "");

  const blocks = text
    .split(/\n(?=###\s*\d+\.\s+)/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const items = [];
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const head = lines[0] || "";
    const m = head.match(/^###\s*(\d+)\.\s*ID:\s*([A-Z]+-\d+)\s*\|\s*(.+)$/);
    if (!m) continue;

    const rank = Number(m[1]);
    const id = m[2].trim();
    const title = m[3].trim();

    const bullets = lines
      .filter((l) => /^-\s+/.test(l))
      .map((l) => l.replace(/^-+\s*/, "").trim())
      .slice(0, SUMMARY_LINES);

    const oneLine = lines.find((l) => /^한줄결론\s*:/i.test(l));
    const conclusion = oneLine
      ? oneLine.replace(/^한줄결론\s*:\s*/i, "").trim()
      : "";

    // ✅ URL은 모델이 뭘 쓰든 믿지 않는다.
    const url = idToUrl?.get(id) || "";

    items.push({ rank, id, title, bullets, conclusion, url });
  }

  items.sort((a, b) => a.rank - b.rank);

  return {
    ok: items.length >= limit,
    count: items.length,
    items: items.slice(0, limit),
  };
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function sanitize(s) {
  return String(s ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function sendItems(category, items, allowedSet) {
  for (const it of items) {
    if (!it?.url) {
      log("skip: empty url", it);
      continue;
    }
    if (!allowedSet.has(it.url)) {
      log("drop url(not allowed):", it.url);
      continue;
    }

    const text = buildKakaoText(category, it);

    await sendKakaoTextWithButton({
      title: it.title,
      text,
      url: it.url,
      buttonTitle: "더보기",
    });

    await sleep(300);
  }
}

function withIds(prefix, list) {
  return list.map((it, idx) => ({
    id: `${prefix}-${String(idx + 1).padStart(2, "0")}`,
    url: it.url,
    title: it.title,
  }));
}

async function main() {
  console.log("[step18] start");
  log("now:", nowKST());

  // 1) 후보 URL 수집
  const krList = await getKoreaTopFromNaver(LIMIT_KR);
  const exclude = new Set(krList.map((x) => x.url)); // ✅ KR URL 제외셋
  const worldList = await getWorldTopFromNaver(LIMIT_WORLD);

  if (!krList.length) throw new Error("KR list empty");
  if (!worldList.length) throw new Error("WORLD list empty");

  const krItems = withIds("KR", krList);
  const krIdToUrl = new Map(krItems.map((x) => [x.id, x.url]));
  const worldItems = withIds("WD", worldList); // WORLD ID prefix는 WD로
  const worldIdToUrl = new Map(worldItems.map((x) => [x.id, x.url]));

  log(
    "kr urls:",
    krItems.map((x) => x.url)
  );
  log(
    "world urls:",
    worldItems.map((x) => x.url)
  );

  // 2) 스크린샷
  console.log("[step18] screenshot KR...");
  const krShots = await screenshotArticles({
    items: krItems,
    outDir: "tmp_shots_kr",
    clipHeight: CLIP_HEIGHT,
    debug: DEBUG,
  });

  console.log("[step18] screenshot WORLD...");
  const worldShots = await screenshotArticles({
    items: worldItems,
    outDir: "tmp_shots_world",
    clipHeight: CLIP_HEIGHT,
    debug: DEBUG,
  });

  if (krShots.length < LIMIT_KR)
    log("KR shots 부족:", krShots.length, "/", LIMIT_KR);
  if (worldShots.length < LIMIT_WORLD)
    log("WORLD shots 부족:", worldShots.length, "/", LIMIT_WORLD);

  // 3) Gemini Vision call #1 (KR)
  console.log("[step18] gemini call #1 (KR) ...");
  const krPrompt = buildVisionPrompt({
    categoryName: "한국 주요뉴스",
    limit: LIMIT_KR,
    summaryLines: SUMMARY_LINES,
    includeComment: true,
    idPrefix: "KR", // ✅
  });

  const krRaw = await geminiVisionBrief({
    apiKey: GEMINI_API_KEY,
    model: GEMINI_MODEL,
    promptText: krPrompt,
    shots: krShots,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    debug: DEBUG,
  });

  if (DEBUG) {
    console.log("\n----- KR raw -----\n");
    console.log(krRaw);
    console.log("\n----- /KR raw -----\n");
  }

  // 4) KR 파싱 + 전송
  const krParsed = parseBriefItems(krRaw, "한국 주요뉴스", LIMIT_KR, krIdToUrl);
  console.log(
    `[step18] KR parsed: ${krParsed.count}/${LIMIT_KR} ok=${krParsed.ok}`
  );

  const allowKR = new Set(krItems.map((x) => x.url));
  await sendItems(`한국 주요뉴스 TOP${LIMIT_KR}`, krParsed.items, allowKR);

  // 5) WORLD 호출 전 대기 (429 완화)
  console.log(`[step18] wait before WORLD: ${WAIT_BETWEEN_CALLS_MS}ms`);
  await sleep(WAIT_BETWEEN_CALLS_MS);

  // 6) Gemini Vision call #2 (WORLD)
  console.log("[step18] gemini call #2 (WORLD) ...");
  const worldPrompt = buildVisionPrompt({
    categoryName: "세계 경제 주요뉴스",
    limit: LIMIT_WORLD,
    summaryLines: SUMMARY_LINES,
    includeComment: true,
    idPrefix: "WD", // ✅ WORLD는 WD로
  });

  const worldRaw = await geminiVisionBrief({
    apiKey: GEMINI_API_KEY,
    model: GEMINI_MODEL,
    promptText: worldPrompt,
    shots: worldShots,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: 0.2,
    debug: DEBUG,
  });

  if (DEBUG) {
    console.log("\n----- WORLD raw -----\n");
    console.log(worldRaw);
    console.log("\n----- /WORLD raw -----\n");
  }

  // 7) WORLD 파싱 + 전송
  const worldParsed = parseBriefItems(
    worldRaw,
    "세계 경제 주요뉴스",
    LIMIT_WORLD,
    worldIdToUrl
  );
  console.log(
    `[step18] WORLD parsed: ${worldParsed.count}/${LIMIT_WORLD} ok=${worldParsed.ok}`
  );

  const allowWorld = new Set(worldItems.map((x) => x.url));
  await sendItems(
    `세계 경제 주요뉴스 TOP${LIMIT_WORLD}`,
    worldParsed.items,
    allowWorld
  );

  console.log("[step18] done");
}

main().catch((e) => {
  console.error("❌ step18 fail:", e.message);
  process.exit(1);
});
