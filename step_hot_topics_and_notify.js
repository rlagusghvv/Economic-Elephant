// step_hot_topics_and_notify.js (ESM)
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateHotTopics } from "./llm/hotTopics.js";
import { notifyHotTopics } from "./notify.js";

const DEBUG = process.env.DEBUG === "1";
const log = (...a) => DEBUG && console.log("[hot-topics]", ...a);

const LIMIT_KR = Number(process.env.LIMIT_KR || 5);
const LIMIT_WORLD = Number(process.env.LIMIT_WORLD || 5);
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || 3);
const ENFORCE_DOMAIN_WHITELIST =
  process.env.ENFORCE_DOMAIN_WHITELIST !== "0";

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

const DOMAIN_WHITELIST = [
  // KR
  "news.naver.com",
  "n.news.naver.com",
  "m.news.naver.com",
  "mk.co.kr",
  "hankyung.com",
  "sedaily.com",
  "yonhapnewstv.co.kr",
  "yna.co.kr",
  "biz.chosun.com",
  "dt.co.kr",
  // WORLD
  "reuters.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "cnbc.com",
  "marketwatch.com",
  "investing.com",
  "economist.com",
  "imf.org",
  "worldbank.org",
  "oecd.org",
  "fred.stlouisfed.org",
  "bea.gov",
  "bls.gov",
  "sec.gov",
  "ecb.europa.eu",
  "federalreserve.gov",
];

function isValidHttpUrl(s) {
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function hostnameOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function isAllowedDomain(url) {
  if (!ENFORCE_DOMAIN_WHITELIST) return true;
  const host = hostnameOf(url);
  return DOMAIN_WHITELIST.some(
    (d) => host === d || host.endsWith(`.${d}`)
  );
}

function validateTopicFields(topic, prefix, idx) {
  const issues = [];
  const idExpected = `${prefix}-${String(idx + 1).padStart(2, "0")}`;
  if (topic?.id !== idExpected) issues.push(`id ${idExpected} mismatch`);

  const titleLen = String(topic?.title || "").length;
  if (titleLen < 25 || titleLen > 40) issues.push("title length 25~40");

  const summary = Array.isArray(topic?.summary) ? topic.summary : [];
  if (summary.length !== 3) issues.push("summary lines must be 3");

  const tags = Array.isArray(topic?.tags) ? topic.tags : [];
  if (tags.length < 2 || tags.length > 4) issues.push("tags 2~4");

  const sources = Array.isArray(topic?.sources) ? topic.sources : [];
  if (sources.length < 1 || sources.length > 3)
    issues.push("sources 1~3");
  for (const u of sources) {
    if (!isValidHttpUrl(u)) issues.push(`invalid url: ${u}`);
    if (!isAllowedDomain(u)) issues.push(`domain not allowed: ${u}`);
  }
  return issues;
}

function validateOutput(data, limitKR, limitWorld) {
  const issues = [];
  if (!data || typeof data !== "object") {
    return { ok: false, issues: ["output not object"] };
  }

  const kr = Array.isArray(data.kr) ? data.kr : [];
  const world = Array.isArray(data.world) ? data.world : [];

  if (kr.length !== limitKR) issues.push("kr length mismatch");
  if (world.length !== limitWorld) issues.push("world length mismatch");

  kr.forEach((t, i) => issues.push(...validateTopicFields(t, "KR", i)));
  world.forEach((t, i) => issues.push(...validateTopicFields(t, "WD", i)));

  return { ok: issues.length === 0, issues };
}

async function main() {
  const date = process.env.DATE_KST || todayYYYYMMDD_KST();
  log("date:", date);

  let data = null;
  let lastIssues = [];

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const note =
      attempt > 1
        ? `이전 응답이 무효입니다. 아래 이슈를 해결하고 JSON만 출력하세요.\n- ${lastIssues.join(
            "\n- "
          )}`
        : "";

    data = await generateHotTopics({
      date,
      limitKR: LIMIT_KR,
      limitWorld: LIMIT_WORLD,
      debug: DEBUG,
      note,
      allowedDomains: DOMAIN_WHITELIST,
    });

    const validation = validateOutput(data, LIMIT_KR, LIMIT_WORLD);
    if (validation.ok) break;

    lastIssues = validation.issues.slice(0, 20);
    log("validation failed:", lastIssues.join(" | "));

    if (attempt === MAX_ATTEMPTS)
      throw new Error(`LLM output invalid: ${lastIssues.join("; ")}`);
  }

  const outDir = ensureOutDir();
  const outPath = path.join(outDir, `daily_topics_${date}.json`);
  fs.writeFileSync(outPath, JSON.stringify(data, null, 2), "utf-8");
  console.log("[save] ->", outPath);
  const latestPath = path.join(outDir, "latest.json");
  fs.writeFileSync(latestPath, JSON.stringify(data, null, 2), "utf-8");
  console.log("[save] ->", latestPath);

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
