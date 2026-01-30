import "dotenv/config";
import * as cheerio from "cheerio";
import Parser from "rss-parser";
import { notify } from "./notify.js";

const parser = new Parser();

/* =========================
   공통 유틸
========================= */

function cleanText(t = "") {
  return t.replace(/\s+/g, " ").trim();
}

async function fetchHtml(url, encoding = "utf-8") {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept-Language": "ko-KR,ko;q=0.9",
    },
  });
  const buf = await res.arrayBuffer();
  return new TextDecoder(encoding).decode(buf);
}

async function fetchWithRetry(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Accept: "application/rss+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
}

async function sendLongMessage(title, items) {
  let msg = `🗞 ${title}\n\n`;
  for (let i = 0; i < items.length; i++) {
    const block = `${i + 1}) ${items[i].title}\n${items[i].link}\n\n`;
    if ((msg + block).length > 900) {
      await sendToMeText(msg);
      msg = `🗞 ${title} (계속)\n\n`;
    }
    msg += block;
  }
  if (msg.trim()) await sendToMeText(msg);
}

/* =========================
   1️⃣ 조선일보
========================= */

async function fetchChosunTop() {
  const html = await fetchHtml("https://news.chosun.com/");
  const $ = cheerio.load(html);

  const results = [];
  const seen = new Set();

  $("a[href]").each((_, a) => {
    const title = cleanText($(a).text());
    let link = $(a).attr("href");

    if (!title || title.length < 15) return;
    if (!link) return;

    if (link.startsWith("/")) link = "https://news.chosun.com" + link;

    if (
      !/news\.chosun\.com/.test(link) ||
      /members\.|topclass\.|boutique\.|pdf|subscription/i.test(link)
    )
      return;

    if (seen.has(link)) return;
    seen.add(link);

    results.push({ title, link });
    if (results.length >= 5) return false;
  });

  return results;
}

/* =========================
   2️⃣ 중앙일보 (RSS 안정화)
========================= */

async function fetchJoongangTop() {
  const rss = "https://rss.joins.com/joins_news_list.xml";

  const xml = await fetchWithRetry(rss, 3);
  const data = await parser.parseString(xml);

  return (data.items || []).slice(0, 5).map((it) => ({
    title: cleanText(it.title),
    link: it.link,
  }));
}

/* =========================
   3️⃣ 동아일보
========================= */

async function fetchDongaTop() {
  const html = await fetchHtml("https://www.donga.com/");
  const $ = cheerio.load(html);

  const results = [];
  const seen = new Set();

  $("a[href]").each((_, a) => {
    const title = cleanText($(a).text());
    let link = $(a).attr("href");

    if (!title || title.length < 15) return;
    if (!link) return;

    if (link.startsWith("/")) link = "https://www.donga.com" + link;

    if (!/donga\.com\/news/.test(link)) return;

    if (seen.has(link)) return;
    seen.add(link);

    results.push({ title, link });
    if (results.length >= 5) return false;
  });

  return results;
}

/* =========================
   🔥 경제 테마 뉴스 TOP 10
========================= */

async function fetchEconThemes() {
  const keywords = ["주식", "환율", "금", "은", "지수", "선물", "증시", "달러"];

  const results = [];
  const seen = new Set();

  for (const kw of keywords) {
    const rss = `https://news.google.com/rss/search?q=${encodeURIComponent(
      kw + " 경제"
    )}&hl=ko&gl=KR&ceid=KR:ko`;

    try {
      const data = await parser.parseURL(rss);
      for (const it of data.items || []) {
        if (results.length >= 10) break;
        if (seen.has(it.link)) continue;
        seen.add(it.link);

        results.push({
          title: cleanText(it.title),
          link: it.link,
        });
      }
    } catch {}
    if (results.length >= 10) break;
  }

  return results;
}

/* =========================
   🚀 실행
========================= */

(async () => {
  const today = new Date().toISOString().slice(0, 10);

  try {
    await sendLongMessage(
      `${today} | 조선일보 주요뉴스 (상위 5)`,
      await fetchChosunTop()
    );
  } catch {
    await notify("⚠️ 조선일보 뉴스 가져오기 실패");
  }

  try {
    await sendLongMessage(
      `${today} | 중앙일보 주요뉴스 (상위 5)`,
      await fetchJoongangTop()
    );
  } catch {
    await notify("⚠️ 중앙일보 뉴스 가져오기 실패");
  }

  try {
    await sendLongMessage(
      `${today} | 동아일보 주요뉴스 (상위 5)`,
      await fetchDongaTop()
    );
  } catch {
    await notify("⚠️ 동아일보 뉴스 가져오기 실패");
  }

  try {
    await sendLongMessage(
      `${today} | 🔥 경제 테마 뉴스 TOP 10`,
      await fetchEconThemes()
    );
  } catch {
    await notify("⚠️ 경제 테마 뉴스 가져오기 실패");
  }
})();
