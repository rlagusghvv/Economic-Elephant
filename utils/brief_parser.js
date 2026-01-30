// utils/brief_parser.js (ESM)
// ==한국...== / ==세계...== 섹션을 안정적으로 파싱

export function parseBriefingSection(text, which, expectedCount) {
  const raw = String(text || "");

  const startTag =
    which === "KR" ? "==한국 주요뉴스 TOP" : "==세계 경제 주요뉴스 TOP";

  const startIdx = raw.indexOf(startTag);
  if (startIdx < 0) {
    return { ok: false, count: 0, items: [], reason: "section not found" };
  }

  const tail = raw.slice(startIdx);

  // 다음 섹션 시작점에서 자르기
  let section = tail;
  if (which === "KR") {
    const nextIdx = tail.indexOf("==세계 경제 주요뉴스 TOP");
    if (nextIdx > 0) section = tail.slice(0, nextIdx);
  }

  const blocks = section
    .split(/\n(?=###\s*\d+\.\s+)/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const items = [];
  for (const block of blocks) {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    const head = lines[0] || "";
    const m = head.match(/^###\s*(\d+)\.\s*(.+)$/);
    if (!m) continue;

    const rank = Number(m[1]);
    const title = m[2].trim();

    const urlLine = lines.find((l) => /^URL:\s*https?:\/\//i.test(l));
    const url = urlLine ? urlLine.replace(/^URL:\s*/i, "").trim() : "";

    const bullets = lines
      .filter((l) => /^-\s+/.test(l))
      .map((l) => l.replace(/^-+\s*/, "").trim())
      .slice(0, 3);

    const oneLine = lines.find((l) => /^한줄결론\s*:/i.test(l));
    const conclusion = oneLine
      ? oneLine.replace(/^한줄결론\s*:\s*/i, "").trim()
      : "";

    if (!title || !url || bullets.length < 1) continue;

    items.push({ rank, title, bullets, conclusion, url });
  }

  const sorted = items.sort((a, b) => a.rank - b.rank);
  const ok = sorted.length >= expectedCount;

  return {
    ok,
    count: sorted.length,
    items: sorted.slice(0, expectedCount),
    reason: ok ? "" : "not enough items (output truncated or format broken)",
  };
}
