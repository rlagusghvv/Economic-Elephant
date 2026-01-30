// step19_issue_brief_and_send.js (ESM)
// 실행: DEBUG_STEP19=1 node step19_issue_brief_and_send.js
// 옵션: MAX_OUTPUT_TOKENS=2200 TEMPERATURE=0.2

import "dotenv/config";
import { geminiIssueBrief, buildIssuePrompt } from "./gemini/textIssueBrief.js";
import { sendKakaoTextWithButton } from "./notify.js";

const DEBUG = process.env.DEBUG_STEP19 === "1";
const log = (...a) => DEBUG && console.log("[step19]", ...a);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const MAX_OUTPUT_TOKENS = Number(process.env.MAX_OUTPUT_TOKENS || 2200);
const TEMPERATURE = Number(process.env.TEMPERATURE || 0.2);

const ARCHIVE_URL = process.env.ARCHIVE_URL;
const ARCHIVE_BUTTON_TITLE =
  process.env.ARCHIVE_BUTTON_TITLE || "경제코끼리 아카이브";
const SOURCE_LINKS_IN_TEXT = Number(process.env.SOURCE_LINKS_IN_TEXT || 3);

if (!ARCHIVE_URL) {
  throw new Error("ARCHIVE_URL missing (.env에 ARCHIVE_URL 넣어줘)");
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

function chunkUrls(urls, start, n) {
  if (!Array.isArray(urls) || urls.length === 0) return [];
  const picked = [];
  for (let i = 0; i < urls.length && picked.length < n; i++) {
    const u = urls[(start + i) % urls.length];
    if (!u) continue;
    picked.push(u);
  }
  return picked;
}

function sanitize(s) {
  return String(s ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildKakaoIssueText({ issue, nowStr, sourceUrls }) {
  const lines = [];
  lines.push(`🐘 경제코끼리 이슈 브리핑`);
  lines.push(`${nowStr}`);
  lines.push("");
  lines.push(`📌 ${sanitize(issue.title)}`);
  lines.push("");

  for (const b of issue.bullets || []) lines.push(`- ${sanitize(b)}`);

  if (issue.one_line) {
    lines.push("");
    lines.push(`한줄 핵심: ${sanitize(issue.one_line)}`);
  }

  if (sourceUrls?.length) {
    lines.push("");
    lines.push("출처");
    for (const u of sourceUrls.slice(0, SOURCE_LINKS_IN_TEXT)) {
      lines.push(`- ${u}`);
    }
  }

  return lines.join("\n").slice(0, 950);
}

async function main() {
  console.log("[step19] start");
  const nowStr = nowKST();

  const prompt = buildIssuePrompt({ nowKST: nowStr });
  log("prompt length:", prompt.length);

  const { data, groundingUrls } = await geminiIssueBrief({
    apiKey: GEMINI_API_KEY,
    model: GEMINI_MODEL,
    promptText: prompt,
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    temperature: TEMPERATURE,
    debug: DEBUG,
  });

  if (DEBUG) {
    console.log("\n----- PARSED(JSON) -----\n");
    console.log(JSON.stringify(data, null, 2));
    console.log("\n----- /PARSED(JSON) -----\n");
    console.log("[step19] groundingUrls:", groundingUrls?.length || 0);
  }

  const issues = (data?.issues || []).slice(0, 5);
  console.log(`[step19] parsed issues: ${issues.length}/5`);
  if (issues.length < 5) throw new Error("issues < 5 (schema violation)");

  // ✅ 이슈별로 출처 링크 2~3개만 분산해서 붙이기(중복 완화)
  let offset = 0;

  for (const issue of issues) {
    const sourceUrls = chunkUrls(groundingUrls, offset, SOURCE_LINKS_IN_TEXT);
    offset += SOURCE_LINKS_IN_TEXT;

    const text = buildKakaoIssueText({ issue, nowStr, sourceUrls });

    await sendKakaoTextWithButton({
      title: sanitize(issue.title),
      text,
      url: ARCHIVE_URL, // ✅ 버튼은 항상 아카이브
      buttonTitle: ARCHIVE_BUTTON_TITLE, // ✅ 버튼 문구 고정
    });
  }

  console.log("[step19] done");
}

main().catch((e) => {
  console.error("❌ step19 fail:", e.message);
  process.exit(1);
});
