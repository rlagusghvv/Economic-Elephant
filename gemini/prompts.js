// gemini/prompts.js (ESM)
// 후보 링크 목록을 "강제"해서 링크 할루시네이션 방지 + 출력 길이 제어

function nowKSTString() {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getFullYear();
  const mm = String(kst.getMonth() + 1).padStart(2, "0");
  const dd = String(kst.getDate()).padStart(2, "0");
  const hh = String(kst.getHours()).padStart(2, "0");
  const mi = String(kst.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}:${mi} KST`;
}

/**
 * ✅ 브리핑 프롬프트(후보 링크 목록 강제)
 * - "너는 웹을 탐색하지 않는다" + "후보목록에서만 선택"을 강하게 고정
 * - WORLD 잘림 방지: 과도한 수사를 금지하고 bullet을 짧게 강제
 */
export function buildBriefPrompt({
  limitKR = 5,
  limitWorld = 5,
  includeComment = true,
} = {}) {
  const nowKST = nowKSTString();

  return `
너는 "경제 코끼리" 뉴스 브리핑 작성자다.
현재 시각은 ${nowKST} 이다.

아래 요구사항을 정확히 지켜서 브리핑을 작성하라.

[목표]
1) 한국 주요 뉴스 TOP${limitKR}
2) 세계 경제 주요 뉴스 TOP${limitWorld}

  [규칙 - 매우 중요]
  - 실제 뉴스 기사만을 참고해라.
  - 반드시 아래 출력 포맷을 100% 지켜라. (형식이 깨지면 전송이 실패한다)
  - 각 항목은 "객관 요약 3줄" + "한줄결론(중립 코멘트 1문장)"을 포함한다.
  - 각 항목은 반드시 "URL: https://..." 라인을 포함해야 한다. (URL 라인이 없으면 그 항목은 무효)
  - 감정적 표현/선동/확신 단정 금지. 숫자/사실 기반으로.
  - 불필요한 서론/설명/코드블록/마크다운 추가 금지.
  - 오직 아래 포맷만 출력.
  - URL은 반드시 "https://n.news.naver.com/article/..." 처럼 article 경로까지 포함된 '완전한 URL'이어야 한다.
- URL 줄에는 도메인만 쓰지 마라(예: https://n.news.naver.com 금지). 반드시 후보 URL 전체를 그대로 복사해라.

  [출력 끊김 방지]
  - TOP${limitKR}과 TOP${limitWorld}를 모두 출력할 때까지 멈추지 마라.
  - 응답이 길면 요약 문장을 더 짧게 해서라도 "개수"와 "URL 라인"을 반드시 지켜라.

[출력 포맷]  (절대 깨지면 안됨)
==한국 주요뉴스 TOP${limitKR}==
### 1. 제목
- 객관요약1
- 객관요약2
- 객관요약3
${includeComment ? "한줄결론: ..." : ""}
URL: https://...

(반드시 ${limitKR}개)

==세계 경제 주요뉴스 TOP${limitWorld}==
### 1. 제목
- 객관요약1
- 객관요약2
- 객관요약3
${includeComment ? "한줄결론: ..." : ""}
URL: https://...

(반드시 ${limitWorld}개)

[기사 후보 목록]
`.trim();
}
