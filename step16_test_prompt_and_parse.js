// step16_test_prompt_and_parse.js (ESM)
// "후보 링크 목록"을 붙인 프롬프트 형태 테스트 + 파싱 검증

import "dotenv/config";
import { buildBriefPrompt } from "./gemini/prompts.js";
import { parseBriefingSection } from "./utils/brief_parser.js";

const LIMIT_KR = Number(process.env.LIMIT_KR || 5);
const LIMIT_WORLD = Number(process.env.LIMIT_WORLD || 5);

function buildCandidatesBlock(title, items) {
  const lines = [];
  lines.push(`\n[${title}]`);
  items.forEach((it, i) => {
    lines.push(`${i + 1}) ${it.title}`);
    lines.push(`URL: ${it.url}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}

(async () => {
  const candidatesKR = [
    { title: "샘플 국내 기사 1", url: "https://news.daum.net/" },
    { title: "샘플 국내 기사 2", url: "https://news.daum.net/" },
    { title: "샘플 국내 기사 3", url: "https://news.daum.net/" },
    { title: "샘플 국내 기사 4", url: "https://news.daum.net/" },
    { title: "샘플 국내 기사 5", url: "https://news.daum.net/" },
  ];

  const candidatesWorld = [
    { title: "샘플 세계경제 1", url: "https://news.daum.net/" },
    { title: "샘플 세계경제 2", url: "https://news.daum.net/" },
    { title: "샘플 세계경제 3", url: "https://news.daum.net/" },
    { title: "샘플 세계경제 4", url: "https://news.daum.net/" },
    { title: "샘플 세계경제 5", url: "https://news.daum.net/" },
  ];

  const prompt =
    buildBriefPrompt({ limitKR: LIMIT_KR, limitWorld: LIMIT_WORLD }) +
    "\n\n" +
    buildCandidatesBlock("한국 후보", candidatesKR) +
    "\n\n" +
    buildCandidatesBlock("세계경제 후보", candidatesWorld);

  console.log("----- PROMPT PREVIEW -----\n");
  console.log(prompt.slice(0, 1200) + "\n...\n");

  // 아래는 "모델 출력"이 들어왔다는 가정으로 파서만 테스트하는 영역
  // 실제 step17에서 Gemini 호출 결과를 여기 파서에 넣게 될거야.
  const fakeOutput = `
==한국 주요뉴스 TOP5==
### 1. 샘플 국내 기사 1
- 요약1
- 요약2
- 요약3
한줄결론: 코멘트
URL: https://news.daum.net/

### 2. 샘플 국내 기사 2
- 요약1
- 요약2
- 요약3
한줄결론: 코멘트
URL: https://news.daum.net/

### 3. 샘플 국내 기사 3
- 요약1
- 요약2
- 요약3
한줄결론: 코멘트
URL: https://news.daum.net/

### 4. 샘플 국내 기사 4
- 요약1
- 요약2
- 요약3
한줄결론: 코멘트
URL: https://news.daum.net/

### 5. 샘플 국내 기사 5
- 요약1
- 요약2
- 요약3
한줄결론: 코멘트
URL: https://news.daum.net/

==세계 경제 주요뉴스 TOP5==
### 1. 샘플 세계경제 1
- 요약1
- 요약2
- 요약3
한줄결론: 코멘트
URL: https://news.daum.net/

### 2. 샘플 세계경제 2
- 요약1
- 요약2
- 요약3
한줄결론: 코멘트
URL: https://news.daum.net/

### 3. 샘플 세계경제 3
- 요약1
- 요약2
- 요약3
한줄결론: 코멘트
URL: https://news.daum.net/

### 4. 샘플 세계경제 4
- 요약1
- 요약2
- 요약3
한줄결론: 코멘트
URL: https://news.daum.net/

### 5. 샘플 세계경제 5
- 요약1
- 요약2
- 요약3
한줄결론: 코멘트
URL: https://news.daum.net/
`.trim();

  const kr = parseBriefingSection(fakeOutput, "KR", LIMIT_KR);
  const world = parseBriefingSection(fakeOutput, "WORLD", LIMIT_WORLD);

  console.log("\n[KR parse]", kr.ok, kr.count, "/", LIMIT_KR);
  console.log("[WORLD parse]", world.ok, world.count, "/", LIMIT_WORLD);
})();
