// url_guard.js (ESM)
// Gemini가 준 URL을 "정리 + 검증" 해서 안전한 기사 링크만 통과시키는 모듈

const DEBUG = process.env.DEBUG_URL === "1";
const log = (...a) => DEBUG && console.log("[url]", ...a);

// (선택) 허용 도메인. 비워두면 전체 허용.
// 예: ["daum.net","news.naver.com","chosun.com","joins.com","donga.com","reuters.com","bloomberg.com"]
const ALLOW_DOMAINS = (process.env.ALLOW_DOMAINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function safeDecode(s) {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

// 1) 구글 리다이렉트(google.com/url?q=...)를 원 링크로 복원
export function unwrapGoogleRedirect(inputUrl) {
  const u = String(inputUrl || "").trim();
  if (!u) return "";

  try {
    const parsed = new URL(u);

    // google.com/url?q=... 형태
    if (
      (parsed.hostname === "www.google.com" ||
        parsed.hostname === "google.com") &&
      parsed.pathname === "/url" &&
      parsed.searchParams.get("q")
    ) {
      const real = parsed.searchParams.get("q");
      return safeDecode(real).trim();
    }

    // 뉴스구글 RSS가 때때로 이런 파라미터를 쓰기도 함
    const q = parsed.searchParams.get("url");
    if (q && parsed.hostname.includes("google")) {
      return safeDecode(q).trim();
    }

    return u;
  } catch {
    return u;
  }
}

// 2) 트래킹 파라미터 제거(너무 빡세게 지우면 일부 사이트 깨질 수 있어 "기본만")
export function stripTrackingParams(inputUrl) {
  try {
    const u = new URL(inputUrl);
    const drop = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "igshid",
      "mc_cid",
      "mc_eid",
      "ref",
      "referrer",
      "trackingCode",
    ];
    for (const k of drop) u.searchParams.delete(k);
    return u.toString();
  } catch {
    return inputUrl;
  }
}

// 3) 도메인 allowlist 체크(옵션)
function isAllowedDomain(url) {
  if (!ALLOW_DOMAINS.length) return true;
  try {
    const u = new URL(url);
    return ALLOW_DOMAINS.some(
      (d) => u.hostname === d || u.hostname.endsWith("." + d)
    );
  } catch {
    return false;
  }
}

// 4) 실제 요청으로 유효성 확인 (최종 리다이렉트 따라감)
export async function validateUrlLive(inputUrl, timeoutMs = 8000) {
  let url = unwrapGoogleRedirect(inputUrl);
  url = stripTrackingParams(url);

  // 프로토콜 제한
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, reason: "not_http", url: "" };
  }

  if (!isAllowedDomain(url)) {
    return { ok: false, reason: "domain_blocked", url };
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    // HEAD가 막히는 사이트가 있어 GET으로 fallback
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
    }).catch(() => null);

    if (!res || !res.ok) {
      res = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: ctrl.signal,
        headers: { "User-Agent": "econ-kokkiri/1.0" },
      });
    }

    const finalUrl = res.url || url;
    const ct = (res.headers.get("content-type") || "").toLowerCase();

    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}`, url: finalUrl };
    }
    if (!ct.includes("text/html")) {
      return { ok: false, reason: `not_html:${ct}`, url: finalUrl };
    }
    if (!isAllowedDomain(finalUrl)) {
      return { ok: false, reason: "final_domain_blocked", url: finalUrl };
    }

    return { ok: true, reason: "ok", url: finalUrl };
  } catch (e) {
    return {
      ok: false,
      reason: "fetch_fail",
      url,
      error: String(e?.message || e),
    };
  } finally {
    clearTimeout(t);
  }
}

// 5) 기사 목록에 적용: 유효한 URL만 남기기
export async function sanitizeAndFilterItems(items, limit = 10) {
  const out = [];
  for (const it of items || []) {
    const rawUrl = it?.url || it?.link || "";
    const chk = await validateUrlLive(rawUrl);
    log("check", rawUrl, "=>", chk.ok, chk.reason, chk.url);

    if (!chk.ok) continue;

    out.push({
      ...it,
      url: chk.url, // ✅ 최종 검증된 URL로 교체
      _url_reason: chk.reason,
    });

    if (out.length >= limit) break;
  }
  return out;
}
