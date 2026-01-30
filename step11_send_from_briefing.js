// step11_send_from_briefing.js (ESM)
// "모델이 준 브리핑 텍스트"를 기사 단위로 쪼개서
// 기사 1개 = 카톡 1메시지(버튼: 더보기)로 전송

import "dotenv/config";
import { sendKakaoTextWithButton } from "./notify.js";

const DEBUG = process.env.DEBUG_BRIEF === "1";
const log = (...a) => DEBUG && console.log("[brief]", ...a);

/* ---------------- 유틸: 안전 문자열 뽑기 ---------------- */
function pickFirstString(obj, keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function normalizeItem(raw) {
  const title = pickFirstString(raw, [
    "title",
    "headline",
    "name",
    "newsTitle",
    "articleTitle",
    "subject",
    "text",
  ]);

  const url = pickFirstString(raw, [
    "url",
    "link",
    "href",
    "articleUrl",
    "newsUrl",
    "originalUrl",
  ]);

  const summary = pickFirstString(raw, [
    "summary",
    "desc",
    "description",
    "abstract",
    "brief",
    "content",
  ]);

  return { title, url, summary, _raw: raw };
}

function sanitize(s) {
  return String(s ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/* ---------------- ✅ 메시지 조립(전역 함수) ---------------- */
function buildTextFromParsed({ category, item }) {
  const lines = [];
  lines.push(`🗞️ ${sanitize(category)} #${item.rank}`);
  lines.push("");
  lines.push(`📌 ${sanitize(item.title)}`);
  lines.push("");

  const bullets = Array.isArray(item.bullets) ? item.bullets : [];
  for (const b of bullets.slice(0, 3)) {
    lines.push(`- ${sanitize(b)}`);
  }

  const conclusion = sanitize(item.conclusion || "");
  if (conclusion) {
    lines.push("");
    lines.push(`한줄결론: ${conclusion}`);
  }

  // 카톡 텍스트 너무 길어지면 안정적으로 컷
  return lines.join("\n").slice(0, 900).trim();
}

/**
 * 포맷(강제):
 * ### 1. 제목
 * - 요약1
 * - 요약2
 * - 요약3
 * 한줄결론: ...
 * URL: https://...
 */
export function parseBriefing(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return [];

  const blocks = raw
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

  return items
    .sort((a, b) => a.rank - b.rank)
    .filter((it) => it.title && it.url);
}

/**
 * category: "전체뉴스 TOP10" / "경제뉴스 TOP10" 등
 * briefingText: 모델이 준 텍스트(위 포맷)
 */
export async function sendBriefingAsKakao({ category, briefingText }) {
  console.log("[brief] sendBriefingAsKakao called");

  const items = parseBriefing(briefingText);
  log("parsed items:", items.length);

  for (const it of items) {
    const norm = normalizeItem(it);

    if (DEBUG) {
      console.log("[brief] raw keys:", Object.keys(it || {}));
      console.log("[brief] normalized:", norm);
    }

    if (!norm.title || !norm.url) {
      console.log("[brief] skip (no title/url)");
      continue;
    }

    const text = buildTextFromParsed({ category, item: it });

    console.log("[brief] sending:", norm.title);

    console.log("[brief] norm.url =", norm.url);

    await sendKakaoTextWithButton({
      title: text, // ✅ 본문 전체를 title로 전달(현재 notify.js 구현 기준)
      url: norm.url,
      buttonTitle: "더보기",
    });

    // 카카오 API 과부하/레이트리밋 방지(너무 빠르게 연속 전송하면 실패할 수 있음)
    await sleep(350);
  }
}

/* ---------------- 실행 예시(테스트) ---------------- */
if (import.meta.url === `file://${process.argv[1]}`) {
  const sample = `
### 1. 샘플 기사 제목
- 요약 한 줄
- 요약 두 줄
- 요약 세 줄
한줄결론: 핵심만 한 문장
URL: https://news.daum.net/

### 2. 두번째 기사
- A
- B
- C
한줄결론: D
URL: https://news.daum.net/
`.trim();

  await sendBriefingAsKakao({
    category: "전체뉴스 TOP10",
    briefingText: sample,
  });
}
