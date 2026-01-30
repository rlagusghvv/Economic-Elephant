import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { load } from "cheerio";

/* =========================
   Config
========================= */
const DEBUG = process.env.DEBUG_STEP11 === "1";

const LIMIT_ALL = 10; // 전체 TOP10
const LIMIT_ECON = 10; // 경제 TOP10

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";

const KAKAO_REST_KEY = process.env.KAKAO_REST_KEY;
const KAKAO_REFRESH_TOKEN = process.env.KAKAO_REFRESH_TOKEN;
const KAKAO_CLIENT_SECRET = process.env.KAKAO_CLIENT_SECRET || "";

// Kakao access_token 캐시(갱신 rate-limit KOE237 방지)
const CACHE_DIR = path.resolve(".cache");
const KAKAO_TOKEN_CACHE_PATH = path.join(CACHE_DIR, "kakao_token.json");

/* =========================
   Utils
========================= */
function log(...args) {
  if (DEBUG) console.log("[step11]", new Date().toISOString(), ...args);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function todayYYYYMMDD() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${dd}`;
}

function uniqBy(arr, keyFn) {
  const m = new Map();
  for (const x of arr) {
    const k = keyFn(x);
    if (!m.has(k)) m.set(k, x);
  }
  return [...m.values()];
}

async function fetchText(url, { timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  const res = await fetch(url, {
    signal: ctrl.signal,
    headers: {
      "User-Agent": UA,
      "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.7",
      // ✅ 깨짐/압축 이슈 줄이기
      "Accept-Encoding": "identity",
    },
  }).finally(() => clearTimeout(t));

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${url}`);
  }

  // ✅ 텍스트 깨짐 방지: arrayBuffer -> TextDecoder
  const buf = await res.arrayBuffer();
  return new TextDecoder("utf-8").decode(buf);
}

/* =========================
   1) Daum Top Fetch (fixed source)
   - 전체: https://news.daum.net/
   - 경제: https://news.daum.net/economic
   - 기사 링크: https://v.daum.net/v/....
========================= */
function isValidTitle(title) {
  if (!title) return false;
  const t = title.trim().replace(/\s+/g, " ");
  if (t.length < 8) return false;
  if (/Google News/i.test(t)) return false;
  return true;
}

async function fetchDaumTop({ section = "home", limit = 10 }) {
  const url =
    section === "economic"
      ? "https://news.daum.net/economic"
      : "https://news.daum.net/";

  log("fetch ranking:", url);
  const html = await fetchText(url, { timeoutMs: 20000 });
  const $ = load(html);

  const items = [];
  $('a[href^="https://v.daum.net/v/"]').each((_, a) => {
    const link = $(a).attr("href");
    const title = $(a).text()?.replace(/\s+/g, " ").trim();
    if (!link) return;
    if (!isValidTitle(title)) return;
    items.push({ title, link });
  });

  const unique = uniqBy(items, (x) => x.link).slice(0, limit);

  log(`section=${section} candidates=${items.length} top=${unique.length}`);
  if (DEBUG) log("sample:", unique.slice(0, 3));

  if (unique.length < Math.min(5, limit)) {
    throw new Error(
      `다음(${section})에서 기사 후보가 부족함: ${unique.length}`
    );
  }

  return unique;
}

/* =========================
   2) Article Text Extract (v.daum.net)
   - 최대한 안정적으로 본문 텍스트만 뽑기
========================= */
function cleanText(s) {
  return (s || "")
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractDaumArticleText(html) {
  const $ = load(html);

  const ogTitle =
    $('meta[property="og:title"]').attr("content") || $("title").text() || "";

  // Daum 기사 본문은 보통 아래쪽에 잡힘 (변형 대비해 여러 후보)
  const candidates = [
    "div.article_view",
    "section#article",
    "div#article",
    "article",
    "div#kakaoContent",
  ];

  let container = null;
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el && el.length) {
      const txt = el.text();
      if (txt && txt.trim().length > 200) {
        container = el;
        break;
      }
    }
  }

  // 최후 fallback: p를 전부 긁되 너무 짧은 건 제외
  let text = "";
  if (container) {
    // 불필요 요소 제거
    container.find("script, style, noscript, figure, iframe").remove();

    const ps = container
      .find("p")
      .toArray()
      .map((p) => $(p).text().trim())
      .filter((t) => t.length >= 30);

    text = ps.length ? ps.join("\n") : container.text();
  } else {
    const ps = $("p")
      .toArray()
      .map((p) => $(p).text().trim())
      .filter((t) => t.length >= 30);
    text = ps.join("\n");
  }

  text = cleanText(text);

  // 본문이 너무 짧으면 실패 처리
  if (text.length < 200) {
    return { title: cleanText(ogTitle), text: "" };
  }

  // 너무 길면 요약용으로 컷
  const MAX = 4500;
  if (text.length > MAX) text = text.slice(0, MAX) + "...";

  return { title: cleanText(ogTitle), text };
}

/* =========================
   3) Gemini Summarize (3 lines)
========================= */
async function geminiSummarize3Lines(articleText) {
  if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY가 .env에 없음");

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    GEMINI_MODEL
  )}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const prompt = `
  너는 경제/시사 뉴스 요약가다.
  아래 기사 본문을 한국어로 "3줄"로만 요약해라.
  - 각 줄은 한 문장
  - 수치/지표(%, 원, 달러, 금리, 지수)가 있으면 최대한 포함
  - 불필요한 서론/감정/의견 금지
  - 출력 형식은 정확히 3줄(불릿/번호 없이 줄바꿈만)
  
  [기사 본문]
  ${articleText}
  `.trim();

  let lastErr = null;

  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 220,
          },
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        // ✅ 429: retryDelay가 있으면 그만큼 기다리기
        if (res.status === 429) {
          const retrySec =
            Number(
              json?.error?.details
                ?.find?.((d) => d?.["@type"]?.includes("RetryInfo"))
                ?.retryDelay?.replace?.("s", "")
            ) ||
            Number(json?.error?.details?.[0]?.retryDelay?.replace?.("s", "")) ||
            0;

          const waitMs =
            retrySec > 0 ? Math.ceil(retrySec * 1000) + 500 : attempt * 5000; // 없으면 점점 길게(5s,10s,15s...)

          log(`Gemini 429 -> wait ${waitMs}ms (attempt ${attempt}/6)`);
          await sleep(waitMs);
          continue;
        }

        throw new Error(
          `Gemini HTTP ${res.status}: ${JSON.stringify(json).slice(0, 400)}`
        );
      }

      const out =
        json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ||
        "";
      const summary = cleanText(out);

      const lines = summary
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length >= 3) return lines.slice(0, 3).join("\n");
      if (lines.length === 2) return lines.join("\n") + "\n(요약 부족)";
      if (lines.length === 1) return lines[0] + "\n(요약 부족)\n(요약 부족)";
      return "요약 실패\n요약 실패\n요약 실패";
    } catch (e) {
      lastErr = e;
      const wait = attempt * 3000;
      log(`Gemini error -> retry ${attempt}/6 in ${wait}ms`, e.message);
      await sleep(wait);
    }
  }

  throw lastErr || new Error("Gemini 요약 실패");
}

/* =========================
   4) Kakao Send (button + token cache)
   - 기사 1개당 1메시지
   - "더보기" 버튼: 기사 링크
========================= */
function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
}

function readTokenCache() {
  try {
    if (!fs.existsSync(KAKAO_TOKEN_CACHE_PATH)) return null;
    const raw = fs.readFileSync(KAKAO_TOKEN_CACHE_PATH, "utf-8");
    const obj = JSON.parse(raw);
    if (!obj?.access_token || !obj?.expires_at) return null;
    return obj;
  } catch {
    return null;
  }
}

function writeTokenCache(access_token, expires_in_sec) {
  ensureCacheDir();
  // 만료 60초 여유
  const expires_at =
    Date.now() + Number(expires_in_sec || 3600) * 1000 - 60_000;
  fs.writeFileSync(
    KAKAO_TOKEN_CACHE_PATH,
    JSON.stringify({ access_token, expires_at }, null, 2),
    "utf-8"
  );
}

async function refreshAccessToken() {
  // 캐시가 살아있으면 재사용
  const cached = readTokenCache();
  if (cached && cached.expires_at > Date.now()) {
    log("kakao token cache hit");
    return cached.access_token;
  }

  log("kakao token refresh start");
  if (!KAKAO_REST_KEY || !KAKAO_REFRESH_TOKEN) {
    throw new Error("KAKAO_REST_KEY / KAKAO_REFRESH_TOKEN이 .env에 없음");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: KAKAO_REST_KEY,
    refresh_token: KAKAO_REFRESH_TOKEN,
  });

  if (KAKAO_CLIENT_SECRET) body.append("client_secret", KAKAO_CLIENT_SECRET);

  const res = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      "Accept-Encoding": "identity",
    },
    body,
  });

  const json = await res.json();

  if (!json.access_token) {
    // KOE237: 토큰 요청 rate limit exceeded
    const msg = JSON.stringify(json);
    throw new Error("토큰 갱신 실패: " + msg);
  }

  writeTokenCache(json.access_token, json.expires_in || 3600);
  log("kakao token refresh ok");
  return json.access_token;
}

async function sendKakaoTextWithButton({ text, link, buttonTitle = "더보기" }) {
  const accessToken = await refreshAccessToken();

  // 카톡 "기본 템플릿(text)" + 버튼 1개
  const templateObject = {
    object_type: "text",
    text,
    link: {
      web_url: link,
      mobile_web_url: link,
    },
    button_title: buttonTitle,
  };

  const body = new URLSearchParams({
    template_object: JSON.stringify(templateObject),
  });

  const res = await fetch(
    "https://kapi.kakao.com/v2/api/talk/memo/default/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
        "Accept-Encoding": "identity",
      },
      body,
    }
  );

  const json = await res.json();

  if (json.result_code !== 0) {
    throw new Error("카톡 전송 실패: " + JSON.stringify(json));
  }

  return json;
}

/* =========================
   5) Orchestrator
========================= */
function buildArticleMessage({ label, idx, title, summary3 }) {
  // ✅ 링크는 메시지 본문에 노출하지 않음 (버튼으로만)
  const head = `📰 ${todayYYYYMMDD()} | ${label}\n(${idx}) ${title}\n\n`;
  return head + summary3;
}

async function processList({ label, items }) {
  log(`processList: ${label} count=${items.length}`);

  // 헤더 메시지(선택): 원하면 주석 해제
  // await sendKakaoTextWithButton({
  //   text: `🗞️ ${todayYYYYMMDD()} | ${label} 시작 (${items.length}개)`,
  //   link: "https://news.daum.net/",
  //   buttonTitle: "열기",
  // });

  for (let i = 0; i < items.length; i++) {
    const { title: fallbackTitle, link } = items[i];
    try {
      log(`article fetch ${i + 1}/${items.length}: ${link}`);

      const html = await fetchText(link, { timeoutMs: 20000 });
      const { title, text } = extractDaumArticleText(html);

      const finalTitle = title || fallbackTitle || "(제목 없음)";
      if (!text) throw new Error("본문 추출 실패(짧거나 구조 변경)");

      const summary3 = await geminiSummarize3Lines(text);

      const msg = buildArticleMessage({
        label,
        idx: i + 1,
        title: finalTitle,
        summary3,
      });

      await sendKakaoTextWithButton({
        text: msg,
        link,
        buttonTitle: "더보기",
      });

      // 과호출/연속요청 완화
      await sleep(600);
    } catch (e) {
      const errMsg = `⚠️ ${todayYYYYMMDD()} | ${label}\n(${i + 1}) ${
        fallbackTitle || ""
      }\n요약 실패: ${e.message}`;
      log("item fail:", e.message);

      // 실패도 1메시지로 보내서 원인 확인 가능하게
      try {
        await sendKakaoTextWithButton({
          text: errMsg,
          link,
          buttonTitle: "원문",
        });
      } catch (e2) {
        log("send fail:", e2.message);
      }

      await sleep(800);
    }
  }
}

async function main() {
  log("STEP11 start");

  // 1) 다음에서 TOP 수집 (소스 고정)
  const allTop = await fetchDaumTop({ section: "home", limit: LIMIT_ALL });
  const econTop = await fetchDaumTop({
    section: "economic",
    limit: LIMIT_ECON,
  });

  // 2) 각 리스트 처리 (기사 1개당 1메시지)
  await processList({ label: "전체뉴스 TOP10", items: allTop });
  await processList({ label: "경제뉴스 TOP10", items: econTop });

  log("STEP11 done");
}

/* =========================
   Run
========================= */
main().catch(async (e) => {
  console.error("❌ step11 전체 실패:", e.message);
  // 가능하면 마지막 에러도 카톡으로 남기기
  try {
    await sendKakaoTextWithButton({
      text: `❌ step11 전체 실패\n${e.message}`,
      link: "https://news.daum.net/",
      buttonTitle: "다음",
    });
  } catch {}
  process.exit(1);
});
