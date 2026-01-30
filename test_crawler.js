import { fetchChosun } from "./crawler/chosun.js";

(async () => {
  const url =
    "https://www.chosun.com/english/market-money-en/2026/01/23/AGJL4QQXYFCNFLTJCVJARHJ2LE/";

  const text = await fetchChosun(url);
  console.log(text.slice(0, 1000));
})();
