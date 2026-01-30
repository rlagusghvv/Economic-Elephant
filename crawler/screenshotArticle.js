// crawler/screenshotArticle.js (ESM)
// Playwright로 네이버 기사 "상단부터 Npx" 스크린샷을 찍는다.
// ✅ 제목/언론사/시간/리드가 같이 들어오게 y=0 기준 clip
// ✅ clipHeight=0이면 fullPage
// ✅ selector 기반 element clip은 제거(제목 누락 방지)

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function log(debug, ...a) {
  if (debug) console.log("[shot]", ...a);
}

async function safeWait(page, selector, ms = 8000) {
  try {
    await page.waitForSelector(selector, { timeout: ms });
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {Object} params
 * @param {Array<{id:string, url:string, title?:string}>} params.items
 * @param {string} params.outDir
 * @param {number} params.clipHeight  - 0이면 fullPage, 그 외는 y=0 기준 상단 clip
 * @param {boolean} params.debug
 * @returns {Promise<Array<{id, url, title, filePath}>>}
 */
export async function screenshotArticles({
  items,
  outDir = path.join(process.cwd(), "tmp_shots"),
  clipHeight = 900,
  debug = false,
} = {}) {
  if (!Array.isArray(items) || items.length === 0) return [];

  ensureDir(outDir);

  const browser = await chromium.launch({ headless: true });

  const page = await browser.newPage({
    viewport: { width: 1200, height: 1800 },
  });

  await page.setExtraHTTPHeaders({
    "Accept-Language": "ko-KR,ko;q=0.9,en;q=0.6",
  });

  const results = [];

  for (const it of items) {
    const id = it.id;
    const url = it.url;
    const title = it.title || "";

    try {
      log(debug, "goto:", url);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

      // 항상 top으로
      await page.evaluate(() => window.scrollTo(0, 0));

      // 본문/헤더 로딩 대기(둘 중 하나라도)
      const okBody = await safeWait(page, "#dic_area", 12000);
      const okTitle =
        (await safeWait(page, "#title_area", 3000)) ||
        (await safeWait(page, ".media_end_head_headline", 3000));

      log(debug, "waited:", { okTitle, okBody });

      // 광고/고정헤더 때문에 가려지면 스샷 품질 떨어져서 숨김(선택)
      await page
        .addStyleTag({
          content: `
          header, .FloatingTop, .floating_button, ._floating_banner, .u_skip,
          .btn_floating, .media_end_head_top, .media_end_head_go_trans {
            display:none !important;
          }
        `,
        })
        .catch(() => {});

      const filePath = path.join(outDir, `${id}.png`);

      if (!clipHeight || clipHeight <= 0) {
        // fullPage는 토큰/용량 커짐(필요할 때만)
        await page.screenshot({ path: filePath, fullPage: true });
        log(debug, "shot fullPage:", id);
      } else {
        // ✅ 핵심: y=0 상단 기준으로 clip (제목 포함)
        const vh = page.viewportSize()?.height ?? 1800;
        const vw = page.viewportSize()?.width ?? 1200;

        const h = Math.max(400, Math.min(Number(clipHeight), 2400));
        const clip = { x: 0, y: 0, width: vw, height: Math.min(h, vh + 600) };

        await page.screenshot({ path: filePath, clip });
        log(debug, "shot clip:", id, clip);
      }

      results.push({ id, url, title, filePath });

      // 과속 방지
      await sleep(350);
    } catch (e) {
      log(debug, "fail:", id, e?.message || e);
    }
  }

  await browser.close();
  return results;
}
