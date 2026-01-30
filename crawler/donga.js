// crawler/donga.js
import { load } from "cheerio";
import { cleanText } from "./cleanText.js";
import { fetchHtml } from "./fetchHtml.js";

export async function fetchDonga(url) {
  const html = await fetchHtml(url);
  const $ = load(html);

  const body =
    $("div.article_txt").text() ||
    $("#article_txt").text() ||
    $("article").text();

  if (!body || body.length < 200) {
    throw new Error("동아일보 본문 추출 실패");
  }

  return cleanText(body);
}
