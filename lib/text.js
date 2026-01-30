export function sanitizeText(s) {
  return String(s ?? "")
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\uFFFD/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function looksGarbled(title) {
  const s = sanitizeText(title);
  if (!s) return true;
  const ok = s.match(/[가-힣A-Za-z0-9\s\.\,\-\(\)\[\]'"“”‘’:%]/g)?.length ?? 0;
  const ratio = ok / Math.max(1, s.length);
  return ratio < 0.7;
}

export function normalizeUrl(url) {
  let u = String(url || "").trim();
  if (!u) return "";
  u = u.replace(/\s+/g, "");
  if (!/^https?:\/\//i.test(u)) u = "https://" + u;
  if (!/^https?:\/\//i.test(u)) return "";
  return u;
}
