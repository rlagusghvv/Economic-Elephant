// step15_main.js (ESM)
import "dotenv/config";
import { sendKakaoTextWithButton } from "./notify.js";
import { buildBriefPrompt } from "./gemini/prompts.js";
import { callGeminiWithRetry } from "./gemini/client.js";
import {
  splitBriefingSections,
  parseItemsFromSection,
  validateUrls,
} from "./utils/briefParse.js";
import {
  getKoreaTopFromNaver,
  getWorldEconTopFromNaver,
} from "./sources/naverRanking.js";

const DEBUG = process.env.DEBUG_STEP15 === "1";
const log = (...a) => DEBUG && console.log("[step15]", ...a);

const LIMIT_KR = Number(process.env.LIMIT_KR || 5);
const LIMIT_WORLD = Number(process.env.LIMIT_WORLD || 5);

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";

function sanitize(s) {
  return String(s ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPrompt({ krItems, worldItems }) {
  const fmtList = (arr) =>
    arr.map((it, i) => `${i + 1}. ${it.title}\nURL: ${it.url}`).join("\n\n");

  // ✅ buildBriefPrompt 재사용 + 후보목록을 맨 끝에 붙임
  return (
    buildBriefPrompt({
      limitKR: krItems.length,
      limitWorld: worldItems.length,
      includeComment: true,
    }) +
    "\n\n[기사 후보 목록]\n" +
    "\n[한국 후보]\n" +
    fmtList(krItems) +
    "\n\n[세계경제 후보]\n" +
    fmtList(worldItems)
  ).trim();
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

async function sendItems(category, items) {
  for (const it of items) {
    const text = buildKakaoText(category, it);
    console.log("[send] it.url =", it.url);
    await sendKakaoTextWithButton({
      title: it.title,
      text,
      url: it.url,
      buttonTitle: "더보기",
    });
  }
}

async function main() {
  log("start");

  const krItems = await getKoreaTopFromNaver({ limit: LIMIT_KR, debug: DEBUG });
  const worldItems = await getWorldEconTopFromNaver({
    limit: LIMIT_WORLD,
    debug: DEBUG,
  });

  if (!krItems.length) throw new Error("KR items empty");
  if (!worldItems.length) throw new Error("WORLD items empty");

  const prompt = buildPrompt({ krItems, worldItems });
  log("prompt length:", prompt.length);

  const briefing = await callGeminiWithRetry({
    apiKey: GEMINI_API_KEY,
    model: GEMINI_MODEL,
    prompt,
    debug: DEBUG,
  });

  log("briefing length:", briefing.length);

  const { kr, world } = splitBriefingSections(briefing);
  const krParsed = parseItemsFromSection(kr);
  const worldParsed = parseItemsFromSection(world);

  const krRecovered = recoverUrlsByTitle(krParsed, krItems, DEBUG);
  const worldRecovered = recoverUrlsByTitle(worldParsed, worldItems, DEBUG);

  const allowKR = new Set(krItems.map((x) => x.url));
  const allowWorld = new Set(worldItems.map((x) => x.url));

  function recoverUrlsByTitle(items, candidates, debug = false) {
    const titleToUrl = new Map(
      candidates.map((c) => [String(c.title).trim(), String(c.url).trim()])
    );

    return items.map((it) => {
      const t = String(it.title || "").trim();
      const correct = titleToUrl.get(t);

      // URL이 비었거나, "https://n.news.naver.com" 같은 뭉툭한 값이면 복구
      if (correct && (!it.url || it.url === "https://n.news.naver.com")) {
        if (debug) console.log("[recover] url fixed:", t, "=>", correct);
        return { ...it, url: correct };
      }
      return it;
    });
  }

  const krFinal = validateUrls(krRecovered, allowKR, DEBUG).slice(0, LIMIT_KR);
  const worldFinal = validateUrls(worldRecovered, allowWorld, DEBUG).slice(
    0,
    LIMIT_WORLD
  );

  log("kr final:", krFinal.length, "world final:", worldFinal.length);

  await sendItems(`한국 주요뉴스 TOP${LIMIT_KR}`, krFinal);
  await sendItems(`세계 경제 주요뉴스 TOP${LIMIT_WORLD}`, worldFinal);

  log("done");
}

main().catch((e) => {
  console.error("❌ step15_main failed:", e.message);
  process.exit(1);
});
