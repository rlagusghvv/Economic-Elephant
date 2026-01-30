import { fetchChosun } from "./crawler/chosun.js";
import { summarizeWithGPT } from "./summarizer/summarizeWithGPT.js";

(async () => {
  const url =
    "https://www.chosun.com/english/market-money-en/2026/01/23/AGJL4QQXYFCNFLTJCVJARHJ2LE/";

  const article = await fetchChosun(url);
  const summary = await summarizeWithGPT(article);

  console.log("\n📌 요약 결과:\n");
  console.log(summary);
})();
