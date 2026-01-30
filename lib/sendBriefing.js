import { sendKakaoTextWithButton } from "../notify.js";
import { sanitizeText, looksGarbled, normalizeUrl } from "./text.js";

export async function sendItemsAsKakao({ category, items, limit = 5 }) {
  const sliced = items.slice(0, limit);

  for (const it of sliced) {
    let title = sanitizeText(it.title);
    const url = normalizeUrl(it.url);

    const bullets = Array.isArray(it.bullets) ? it.bullets : [];
    const conclusion = sanitizeText(it.conclusion || "");

    // 제목 깨짐 방지
    if (looksGarbled(title)) {
      const fallback = sanitizeText(bullets[0] || conclusion);
      title = fallback ? fallback.slice(0, 50) : "제목 미상";
    }

    const lines = [];
    lines.push(`🗞️ ${category} #${it.rank}`);
    lines.push("");
    lines.push(`📌 ${title}`);
    lines.push("");
    for (const b of bullets.slice(0, 3)) lines.push(`- ${sanitizeText(b)}`);
    if (conclusion) {
      lines.push("");
      lines.push(`한줄결론: ${conclusion}`);
    }

    const text = lines.join("\n").slice(0, 950);

    await sendKakaoTextWithButton({
      title, // notify.js에서 title 필수 체크용
      text, // 본문
      url,
      buttonTitle: "더보기",
    });
  }
}
