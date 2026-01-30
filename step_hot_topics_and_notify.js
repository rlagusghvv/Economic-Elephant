// step_hot_topics_and_notify.js (ESM)
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCandidatePoolKR,
  buildCandidatePoolWORLD,
} from "./sources/naverRanking.js";
import { generateHotTopics } from "./llm/hotTopics.js";
import { notifyHotTopics } from "./notify.js";

const DEBUG = process.env.DEBUG === "1";
const log = (...a) => DEBUG && console.log("[hot-topics]", ...a);

const LIMIT_KR = Number(process.env.LIMIT_KR || 5);
const LIMIT_WORLD = Number(process.env.LIMIT_WORLD || 5);
const LIMIT_POOL_K = Number(process.env.LIMIT_POOL_K || 60);
const LIMIT_POOL_W = Number(process.env.LIMIT_POOL_W || 60);
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES || 60);

function todayYYYYMMDD_KST() {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

function buildDailyLink(date) {
  const base = process.env.DAILY_BASE_URL || "https://example.com";
  const baseClean = base.replace(/\/+$/, "");
  const u = new URL(`${baseClean}/daily/${date}`);
  u.searchParams.set("ek_ts", Date.now().toString());
  return u.toString();
}

function ensureOutDir() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const outDir = path.join(__dirname, "out");
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  return outDir;
}

function validateTopicFields(topic, prefix, idx, allowedSet) {
  const issues = [];
  const idExpected = `${prefix}-${String(idx + 1).padStart(2, "0")}`;
  if (topic?.id !== idExpected) issues.push(`id ${idExpected} mismatch`);

  const titleLen = String(topic?.title || "").length;
  if (titleLen < 25 || titleLen > 40) issues.push("title length 25~40");

  const summary = Array.isArray(topic?.summary) ? topic.summary : [];
  if (summary.length < 2 || summary.length > 3)
    issues.push("summary lines 2~3");

  if (!String(topic?.why_it_matters || "").trim())
    issues.push("why_it_matters missing");

  const tags = Array.isArray(topic?.tags) ? topic.tags : [];
  if (tags.length < 2 || tags.length > 4) issues.push("tags 2~4");

  const sources = Array.isArray(topic?.sources) ? topic.sources : [];
  if (sources.length < 2 || sources.length > 3)
    issues.push("sources 2~3");
  for (const u of sources) {
    if (!allowedSet.has(u)) issues.push(`invalid source: ${u}`);
  }
  return issues;
}

function validateOutput(data, allowKR, allowWD) {
  const issues = [];
  if (!data || typeof data !== "object") {
    return { ok: false, issues: ["output not object"] };
  }

  const kr = Array.isArray(data.kr) ? data.kr : [];
  const world = Array.isArray(data.world) ? data.world : [];

  if (kr.length !== LIMIT_KR) issues.push("kr length mismatch");
  if (world.length !== LIMIT_WORLD) issues.push("world length mismatch");

  kr.forEach((t, i) =>
    issues.push(...validateTopicFields(t, "KR", i, allowKR))
  );
  world.forEach((t, i) =>
    issues.push(...validateTopicFields(t, "WD", i, allowWD))
  );

  return { ok: issues.length === 0, issues };
}

async function main() {
  const date = process.env.DATE_KST || todayYYYYMMDD_KST();
  log("date:", date);

  const krPool = await buildCandidatePoolKR({
    date,
    limitPoolK: LIMIT_POOL_K,
    debug: DEBUG,
  });
  const worldPool = await buildCandidatePoolWORLD({
    date,
    limitPoolW: LIMIT_POOL_W,
    debug: DEBUG,
  });

  if (!krPool.length) throw new Error("KR pool empty");
  if (!worldPool.length) throw new Error("WORLD pool empty");

  const krCandidates = krPool.slice(0, MAX_CANDIDATES);
  const worldCandidates = worldPool.slice(0, MAX_CANDIDATES);

  const allowKR = new Set(krCandidates.map((x) => x.url));
  const allowWD = new Set(worldCandidates.map((x) => x.url));

  let data = null;
  let lastIssues = [];

  for (let attempt = 1; attempt <= 3; attempt++) {
    const note =
      attempt > 1
        ? `이전 응답이 무효입니다. 아래 이슈를 해결하고 JSON만 출력하세요.\n- ${lastIssues.join(
            "\n- "
          )}`
        : "";

    data = await generateHotTopics({
      date,
      krCandidates,
      worldCandidates,
      limitKR: LIMIT_KR,
      limitWorld: LIMIT_WORLD,
      debug: DEBUG,
      note,
    });

    const validation = validateOutput(data, allowKR, allowWD);
    if (validation.ok) break;

    lastIssues = validation.issues.slice(0, 20);
    log("validation failed:", lastIssues.join(" | "));

    if (attempt === 3)
      throw new Error(`LLM output invalid: ${lastIssues.join("; ")}`);
  }

  const outDir = ensureOutDir();
  const outPath = path.join(outDir, `daily_topics_${date}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");
  console.log("[save] ->", outPath);

  const linkUrl = buildDailyLink(date);
  await notifyHotTopics({
    date,
    limitKR: LIMIT_KR,
    limitWorld: LIMIT_WORLD,
    linkUrl,
  });

  console.log("[done] notify sent");
}

main().catch((e) => {
  console.error("❌ step_hot_topics_and_notify failed:", e.message);
  process.exit(1);
});
