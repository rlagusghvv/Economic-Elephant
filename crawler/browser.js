// crawler/browser.js
import { chromium } from "playwright";

export async function fetchRenderedHtml(url) {
  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
    locale: "ko-KR",
  });

  // ✅ 광고/트래커 때문에 networkidle은 금지
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

  // ✅ 화면이 실제로 렌더링될 시간을 조금 준다
  await page.waitForTimeout(1500);

  const html = await page.content();
  await browser.close();

  return html;
}
