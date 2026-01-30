// utils/briefParse.js (ESM)

export function splitBriefingSections(text) {
  const raw = String(text || "");
  const krMatch = raw.match(/==한국 주요뉴스[^=]*==([\s\S]*?)(?==세계|\s*$)/);
  const worldMatch = raw.match(/==세계 경제 주요뉴스[^=]*==([\s\S]*)$/);

  return {
    kr: krMatch ? krMatch[1].trim() : "",
    world: worldMatch ? worldMatch[1].trim() : "",
  };
}

export function parseItemsFromSection(sectionText) {
  const blocks = String(sectionText || "")
    .split(/\n(?=###\s*\d+\.\s+)/g)
    .map((s) => s.trim())
    .filter(Boolean);

  const items = [];
  for (const b of blocks) {
    const lines = b
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

    if (!title || !url) continue;
    items.push({ rank, title, bullets, conclusion, url });
  }

  return items.sort((a, b) => a.rank - b.rank);
}

export function validateUrls(items, allowedSet, debug = false) {
  const ok = [];
  for (const it of items) {
    if (!it.url) continue;
    if (!allowedSet.has(it.url)) {
      if (debug) console.log("[parse] drop url(not in list):", it.url);
      continue;
    }
    ok.push(it);
  }
  return ok;
}
