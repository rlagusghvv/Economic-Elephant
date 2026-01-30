// step19b_summarize_and_send.js (ESM)
import "dotenv/config";
import { collectIssueUrls } from "./step19a_collect_urls.js";
import { geminiSummarizeIssues } from "./gemini/summarizeIssuesPrompt.js";
import { sendKakaoTextWithButton } from "./notify.js";

const ARCHIVE_URL = process.env.ARCHIVE_URL;
const BUTTON_TITLE = process.env.ARCHIVE_BUTTON_TITLE || "경제코끼리 아카이브";
const SOURCE_LINKS_IN_TEXT = Number(process.env.SOURCE_LINKS_IN_TEXT || 3);

if (!ARCHIVE_URL) throw new Error("ARCHIVE_URL missing");

function safeLine(s) {
  return String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildText({ summary, issueMeta }) {
  const lines = [];
  lines.push("🐘 경제코끼리 이슈 브리핑");
  lines.push("");
  lines.push(`📌 ${safeLine(summary.title || issueMeta.title)}`);
  lines.push("");

  const arr = Array.isArray(summary.summary) ? summary.summary : [];
  for (let i = 0; i < 3; i++) {
    if (arr[i]) lines.push(`- ${safeLine(arr[i])}`);
  }

  if (summary.oneLine) {
    lines.push("");
    lines.push(`한줄 핵심: ${safeLine(summary.oneLine)}`);
  }

  lines.push("");
  lines.push("출처");
  // 매체명 + 링크 2~3개
  if (issueMeta.media) lines.push(`- ${safeLine(issueMeta.media)}`);
  for (const u of (issueMeta.sources || []).slice(0, SOURCE_LINKS_IN_TEXT)) {
    lines.push(`- ${u}`);
  }

  return lines.join("\n").slice(0, 950);
}

export async function runIssueBrief() {
  const issues = await collectIssueUrls(); // [{title, media, sources:[...]}]

  const summaries = await geminiSummarizeIssues({ issues });
  // summarizeIssuesPrompt는 "issues"의 title/media/sources를 보고 요약만 만들어야 함(링크 생성 금지)

  const count = Math.min(summaries.length, issues.length);

  for (let i = 0; i < count; i++) {
    const text = buildText({ summary: summaries[i], issueMeta: issues[i] });

    await sendKakaoTextWithButton({
      text,
      url: ARCHIVE_URL, // ✅ 버튼은 항상 아카이브
      buttonTitle: BUTTON_TITLE, // ✅ "경제코끼리 아카이브"
    });
  }
}
