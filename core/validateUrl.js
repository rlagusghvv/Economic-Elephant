// core/validateUrl.js (ESM)
// URL 정규화 + 간단 검증(구글 리다이렉트/q= 제거 등)

export function normalizeUrl(raw) {
  let s = String(raw || "").trim();
  if (!s) return "";

  // \r 제거
  s = s.replace(/\r/g, "").trim();

  // "https://www.google.com/url?q=..." 형태 처리
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase();

    if (
      host.includes("google.") &&
      (u.pathname === "/url" || u.pathname === "/imgres")
    ) {
      const q = u.searchParams.get("q");
      if (q && q.startsWith("http")) return stripTracking(q);
    }
  } catch {
    // URL 파싱 실패면 아래에서 걸러짐
  }

  return stripTracking(s);
}

export function stripTracking(url) {
  try {
    const u = new URL(url);
    // 흔한 tracking params 제거(원하면 더 추가)
    const drop = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "igshid",
      "ref",
    ];
    drop.forEach((k) => u.searchParams.delete(k));
    return u.toString();
  } catch {
    return url;
  }
}

export function isProbablyValidUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}
