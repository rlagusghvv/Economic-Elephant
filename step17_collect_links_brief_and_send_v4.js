// step17_collect_links_brief_and_send_v4.js (ESM)
// Naver/Daum HTML에서 후보 링크 수집 -> Gemini 1회 호출 -> 포맷 브리핑 생성 -> 파싱 -> 기사 1개당 카톡 1메시지(버튼 더보기)
// 실행: DEBUG_STEP17=1 node step17_collect_links_brief_and_send_v4.js

import "dotenv/config";
import { load } from "cheerio";
import { sendKakaoTextWithButton } from "./notify.js";
import { buildBriefPrompt } from "./gemini/prompts.js";

// ---------------- ENV ----------------
const DEBUG = process.env.DEBUG_STEP17 === "1";
const LIMIT_KR = Number(process.env.LIMIT_KR || 5);
const LIMIT_WORLD = Number(process.env.LIMIT_WORLD || 5);
const CANDIDATES_KR = Number(process.env.CANDIDATES_KR || 30);
const CANDIDATES_WORLD = Number(process.env.CANDIDATES_WORLD || 30);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

const log = (...a) => DEBUG && console.log("[step17]", ...a);

// ---------------- utils ----------------
function todayKST() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function norm(s) {
  return String(s || "")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqByTitle(items) {
  const m = new Map();
  for (const it of items) {
    const key = norm(it.title);
    if (!key) continue;
    if (!m.has(key)) m.set(key, { title: key, url: it.url });
  }
  return [...m.values()];
}

function buildCandidatesBlock(title, items) {
  const lines = [];
  lines.push(`[${title}]`);
  for (let i = 0; i < items.length; i++) {
    lines.push(`${i + 1}) ${items[i].title}`);
    lines.push(`URL: ${items[i].url}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

function extractAllowedUrlSet(candidatesKR, candidatesWorld) {
  const set = new Set();
  for (const x of [...candidatesKR, ...candidatesWorld]) set.add(x.url);
  return set;
}

// ---------------- fetch html (UA 중요) ----------------
async function fetchHtml(url) {
  log("fetch:", url);
  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      // 모바일/데스크탑 섞어서 막히는 경우가 있어서 UA 강제
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36",
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.6",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return await res.text();
}

// ---------------- Naver/Daum candidates ----------------
// ✅ 네이버: 많이 본 뉴스(일간 랭킹)
// (네이버 구조가 바뀌면 selector만 수정하면 됨)
async function fetchNaverPopularCandidates(limit) {
  const url = "https://news.naver.com/main/ranking/popularDay.naver";
  const html = await fetchHtml(url);
  const $ = load(html);

  const out = [];
  // 흔히 a[href*="read.naver"] 형태로 기사 링크가 있음
  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const title = norm($(el).text());
    if (!title) return;
    if (!href.includes("read.naver")) return;

    // 상대경로 처리
    const full = href.startsWith("http")
      ? href
      : `https://news.naver.com${href}`;

    // 너무 짧은 텍스트(메뉴/버튼) 제거
    if (title.length < 8) return;

    out.push({ title, url: full });
  });

  const cleaned = uniqByTitle(out)
    .filter((x) => x.url.includes("read.naver"))
    .slice(0, limit);

  log("naver popular picked:", cleaned.length);
  return cleaned;
}

// ✅ 다음: 주요뉴스(홈)에서 기사 링크 긁기
async function fetchDaumMainCandidates(limit) {
  const url = "https://news.daum.net/";
  const html = await fetchHtml(url);
  const $ = load(html);

  const out = [];
  $("a").each((_, el) => {
    const href = $(el).attr("href") || "";
    const title = norm($(el).text());

    if (!href.startsWith("http")) return;
    if (!href.includes("v.daum.net") && !href.includes("news.daum.net")) return;
    if (!title) return;
    if (title.length < 8) return;

    out.push({ title, url: href });
  });

  const cleaned = uniqByTitle(out).slice(0, limit);
  log("daum main picked:", cleaned.length);
  return cleaned;
}

// ✅ 세계경제 후보: HTML 우선 시도 → 부족/실패 시 RSS fallback
async function fetchWorldCandidates(limit) {
  const q = encodeURIComponent(
    "global economy OR stock market OR inflation OR central bank OR oil price OR exchange rate"
  );

  // 1) Google News HTML
  const url = `https://news.google.com/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  try {
    const html = await fetchHtml(url);
    const $ = load(html);

    const out = [];
    $("a").each((_, el) => {
      const href = $(el).attr("href") || "";
      const title = norm($(el).text());
      if (!title) return;
      if (!href.startsWith("./articles/")) return;

      const full = `https://news.google.com${href.slice(1)}`;
      out.push({ title, url: full });
    });

    const cleaned = uniqByTitle(out).slice(0, limit);
    log("world googleNews HTML picked:", cleaned.length);
    if (cleaned.length >= Math.min(10, limit)) return cleaned;
  } catch (e) {
    log("world HTML failed -> fallback:", e.message);
  }

  // 2) RSS fallback
  const rssUrl = `https://news.google.com/rss/search?q=${q}&hl=en-US&gl=US&ceid=US:en`;
  const rssXml = await fetchHtml(rssUrl);
  const $rss = load(rssXml, { xmlMode: true });

  const out2 = [];
  $rss("item").each((_, el) => {
    const title = norm($rss(el).find("title").text());
    const link = norm($rss(el).find("link").text());
    if (title && link) out2.push({ title, url: link });
  });

  const cleaned2 = uniqByTitle(out2).slice(0, limit);
  log("world RSS fallback picked:", cleaned2.length);
  return cleaned2;
}

// ---------------- Gemini call (raw 비는 문제 디버그 강화) ----------------
async function geminiGenerateText(prompt) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY가 .env에 없음");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 3000,
    },
  };

  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const json = await res.json().catch(() => ({}));

    if (DEBUG) {
      log("gemini status:", res.status);
      log("gemini json keys:", Object.keys(json || {}));
      if (!res.ok)
        log("gemini error json:", JSON.stringify(json).slice(0, 800));
    }

    if (res.ok) {
      const parts = json?.candidates?.[0]?.content?.parts;
      const text = Array.isArray(parts)
        ? parts.map((p) => p?.text || "").join("")
        : "";

      if (!text.trim()) {
        log(
          "Gemini ok but empty text. full json(head):",
          JSON.stringify(json).slice(0, 1200)
        );
        throw new Error(
          "Gemini 응답 텍스트가 비어있음(포맷/차단/구조변경 가능). DEBUG_STEP17=1로 json 확인"
        );
      }
      return text;
    }

    if (res.status === 429) {
      const waitMs = 1200 * attempt * attempt;
      log(`Gemini 429 -> wait ${waitMs}ms (attempt ${attempt}/6)`);
      await sleep(waitMs);
      continue;
    }

    throw new Error(`Gemini HTTP ${res.status}: ${JSON.stringify(json)}`);
  }

  throw new Error("Gemini 429 지속: 잠시 후 재시도 필요");
}

// ---------------- 브리핑 파서 (KR/WORLD 섹션 각각) ----------------
function parseBriefingSection(raw, which, expectedCount) {
  const start = which === "KR" ? "==한국 주요뉴스" : "==세계 경제 주요뉴스";
  const end = which === "KR" ? "==세계 경제 주요뉴스" : null;

  const sIdx = raw.indexOf(start);
  if (sIdx < 0) return { ok: false, count: 0, items: [] };

  const eIdx = end ? raw.indexOf(end) : -1;
  const slice = end && eIdx > sIdx ? raw.slice(sIdx, eIdx) : raw.slice(sIdx);

  const blocks = slice
    .split(/\n(?=###\s*\d+\.\s+)/g)
    .map((x) => x.trim())
    .filter((x) => x.startsWith("###"));

  const items = [];
  for (const block of blocks) {
    const lines = block
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

    if (!title || !url) continue;
    items.push({ rank, title, bullets, conclusion, url });
  }

  items.sort((a, b) => a.rank - b.rank);
  return { ok: items.length >= expectedCount, count: items.length, items };
}

function buildKakaoBody(category, item) {
  const lines = [];
  lines.push(`🗞️ ${todayKST()} | ${category} #${item.rank}`);
  lines.push("");
  lines.push(`📌 ${item.title}`);
  lines.push("");
  for (const b of item.bullets || []) lines.push(`- ${b}`);
  if (item.conclusion) {
    lines.push("");
    lines.push(`한줄결론: ${item.conclusion}`);
  }
  return lines.join("\n").slice(0, 950);
}

async function sendItems(category, items) {
  for (const it of items) {
    const text = buildKakaoBody(category, it);
    await sendKakaoTextWithButton({
      title: "경제 코끼리",
      text,
      url: it.url,
      buttonTitle: "더보기",
    });
    await sleep(350);
  }
}

// ---------------- main ----------------
(async () => {
  console.log("[step17] start");

  // 1) 후보 수집 (네이버+다음 합쳐서 KR 후보 구성)
  const naver = await fetchNaverPopularCandidates(Math.ceil(CANDIDATES_KR / 2));
  const daum = await fetchDaumMainCandidates(Math.floor(CANDIDATES_KR / 2));
  const candidatesKR = uniqByTitle([...naver, ...daum]).slice(0, CANDIDATES_KR);

  const candidatesWorld = await fetchWorldCandidates(CANDIDATES_WORLD);

  log("candidatesKR:", candidatesKR.length);
  log("candidatesWorld:", candidatesWorld.length);

  // 2) 프롬프트 생성 + 후보목록 부착
  const prompt =
    buildBriefPrompt({
      limitKR: LIMIT_KR,
      limitWorld: LIMIT_WORLD,
      includeComment: true,
    }) +
    "\n\n[기사 후보 목록]\n" +
    buildCandidatesBlock("한국 후보", candidatesKR) +
    "\n\n" +
    buildCandidatesBlock("세계경제 후보", candidatesWorld);

  if (DEBUG) log("prompt length:", prompt.length);

  // 3) Gemini 1회 호출
  const raw = await geminiGenerateText(prompt);

  console.log("[step17] raw length:", raw?.length ?? 0);
  console.log("[step17] raw head(400):\n", String(raw || "").slice(0, 400));

  if (DEBUG) {
    console.log("\n----- Gemini raw output -----\n");
    console.log(raw);
    console.log("\n----- /raw -----\n");
  }

  // 4) 파싱
  const kr = parseBriefingSection(raw, "KR", LIMIT_KR);
  const world = parseBriefingSection(raw, "WORLD", LIMIT_WORLD);

  console.log(`[step17] KR parsed: ${kr.count}/${LIMIT_KR} ok=${kr.ok}`);
  console.log(
    `[step17] WORLD parsed: ${world.count}/${LIMIT_WORLD} ok=${world.ok}`
  );

  // 5) URL 검증(후보목록 밖 링크 제거) = 할루시네이션 방지
  const allowed = extractAllowedUrlSet(candidatesKR, candidatesWorld);

  const krSafe = kr.items.filter((x) => allowed.has(x.url)).slice(0, LIMIT_KR);
  const worldSafe = world.items
    .filter((x) => allowed.has(x.url))
    .slice(0, LIMIT_WORLD);

  console.log(`[step17] KR safe: ${krSafe.length}/${LIMIT_KR}`);
  console.log(`[step17] WORLD safe: ${worldSafe.length}/${LIMIT_WORLD}`);

  // 6) 카톡 전송
  await sendItems("한국 주요뉴스", krSafe);
  await sendItems("세계 경제", worldSafe);

  console.log("[step17] done");
})().catch((e) => {
  console.error("❌ step17 fail:", e.message);
  process.exit(1);
});
