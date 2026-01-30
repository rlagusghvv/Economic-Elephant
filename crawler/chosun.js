// crawler/chosun.js
import { load } from "cheerio";
import { cleanText } from "./cleanText.js";
import { fetchRenderedHtml } from "./browser.js";

export async function fetchChosun(url) {
  const html = await fetchRenderedHtml(url);
  const $ = load(html);

  const body = $("section.article-body").text() || $("article").text();

  if (!body || body.length < 300) {
    throw new Error("조선일보 본문 추출 실패");
  }

  return cleanText(body);
}
