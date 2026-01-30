// crawler/fetchArticle.js
import { fetchChosun } from "./chosun.js";
import { fetchJoongang } from "./joongang.js";
import { fetchDonga } from "./donga.js";

export async function fetchArticle(url) {
  if (url.includes("chosun.com")) return fetchChosun(url);
  if (url.includes("joins.com")) return fetchJoongang(url);
  if (url.includes("donga.com")) return fetchDonga(url);

  throw new Error("지원하지 않는 언론사 URL");
}
