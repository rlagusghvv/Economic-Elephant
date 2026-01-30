// step10_collect_links.js
import fs from "fs";
import path from "path";
import { fetchGoogleNews } from "./news/googleNewsRss.js";

const OUT = "out";
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);

const LIMIT_PAPER = 5; // 3대신문 각각 1개
const LIMIT_ECON = 10; // 경제 Top 10

async function main() {
  const today = new Date().toISOString().slice(0, 10);

  // ✅ 3대 신문 "전체 메인" 느낌으로: economy 제한하지 않고 site만
  const chosun = await fetchGoogleNews("site:chosun.com", 30);
  const joins = await fetchGoogleNews("site:joins.com", 30);
  const donga = await fetchGoogleNews("site:donga.com", 30);

  // ✅ 경제 TOP 10 (테마/키워드 혼합)
  const econQuery =
    "(주식 OR 환율 OR 금 OR 은 OR 코스피 OR 코스닥 OR 나스닥 OR S&P OR 선물 OR 채권 OR 유가)";

  const econ = await fetchGoogleNews(econQuery, 30);

  const payload = {
    date: today,
    papers: {
      chosun: chosun.slice(0, LIMIT_PAPER),
      joins: joins.slice(0, LIMIT_PAPER),
      donga: donga.slice(0, LIMIT_PAPER),
    },
    econTop: econ.slice(0, LIMIT_ECON),
  };

  const outPath = path.join(OUT, "step10_links.json");
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), "utf-8");

  console.log("✅ 링크 수집 완료:", outPath);
  console.log(
    "조선:",
    payload.papers.chosun.length,
    "중앙:",
    payload.papers.joins.length,
    "동아:",
    payload.papers.donga.length,
    "경제TOP:",
    payload.econTop.length
  );
}

main().catch((e) => {
  console.error("❌ 링크 수집 실패:", e);
  process.exit(1);
});
