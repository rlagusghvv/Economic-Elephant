export function parseBriefing(text) {
  const raw = String(text ?? "").trim();
  if (!raw) return [];

  const blocks = raw
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

    items.push({ rank, title, bullets, conclusion, url });
  }

  return items
    .sort((a, b) => a.rank - b.rank)
    .filter((it) => it.title && it.url);
}
