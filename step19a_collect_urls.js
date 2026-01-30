// step19a_collect_urls.js (ESM)
import "dotenv/config";
import { geminiCollectUrls } from "./gemini/collectUrlsPrompt.js";

const DEBUG = process.env.DEBUG_STEP19A === "1";
const ISSUE_LIMIT = Number(process.env.ISSUE_LIMIT || 5);
const SOURCE_URLS_PER_ISSUE = Number(process.env.SOURCE_URLS_PER_ISSUE || 3);

function uniq(arr) {
  return [...new Set((arr || []).filter(Boolean))];
}

function extractGroundingUrls(groundingMetadata) {
  const chunks = groundingMetadata?.groundingChunks || [];
  const urls = chunks.map((c) => c?.web?.uri).filter(Boolean);
  return uniq(urls);
}

function parseTitleMedia(rawText) {
  const text = String(rawText || "").trim();
  if (!text) return [];

  const blocks = text
    .split(/\n(?=\d+\))/)
    .map((s) => s.trim())
    .filter(Boolean);

  const items = [];
  for (const b of blocks) {
    const title = b.match(/제목\s*:\s*(.+)/)?.[1]?.trim();
    const media = b.match(/매체\s*:\s*(.+)/)?.[1]?.trim();
    if (title) items.push({ title, media: media || "" });
  }
  return items.slice(0, ISSUE_LIMIT);
}

function attachSourcesToIssues(items, allUrls, perIssue = 3) {
  const urls = [...allUrls];
  return items.map((it, idx) => {
    const start = idx * perIssue;
    const sources = urls.slice(start, start + perIssue);
    return { ...it, sources };
  });
}

export async function collectIssueUrls() {
  const res = await geminiCollectUrls({ debug: DEBUG });
  const rawText = res?.text || "";
  const groundingMetadata = res?.groundingMetadata || null;

  const allUrls = extractGroundingUrls(groundingMetadata);

  if (DEBUG) {
    console.log("----- RAW COLLECT (TEXT) -----");
    console.log(rawText);
    console.log("----- /RAW COLLECT (TEXT) -----");
    console.log("----- GROUNDING URLS -----");
    console.log(allUrls);
    console.log("----- /GROUNDING URLS -----");
  }

  if (!allUrls.length) {
    throw new Error(
      "출처 URL 0개: tools(google_search) 호출이 실제로 안 된 상태",
    );
  }

  let items = parseTitleMedia(rawText);

  // ✅ 텍스트가 비거나 파싱 실패해도, URL 기반으로 임시 이슈 5개 구성
  if (!items.length) {
    items = Array.from({ length: Math.min(ISSUE_LIMIT, allUrls.length) }).map(
      (_, i) => ({
        title: `이슈 ${i + 1}`,
        media: "",
      }),
    );
  }

  const issues = attachSourcesToIssues(items, allUrls, SOURCE_URLS_PER_ISSUE);

  // sources 비면 앞에서 채우기
  for (const it of issues) {
    if (!it.sources?.length)
      it.sources = allUrls.slice(0, SOURCE_URLS_PER_ISSUE);
  }

  return issues;
}

async function main() {
  const issues = await collectIssueUrls();
  console.log("[step19a] issues:", JSON.stringify(issues, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error("❌ step19a fail:", e.message);
    process.exit(1);
  });
}
