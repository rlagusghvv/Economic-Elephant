// test_gemini_brief.js (ESM)
import "dotenv/config";
import { briefWithGemini } from "./gemini/brief.js";
import { sendBriefingAsKakao } from "./step11_send_from_briefing.js"; // 네가 만든 브리핑→카톡 분배

const DEBUG = process.env.DEBUG_STEP12 === "1";
const log = (...a) => DEBUG && console.log("[test]", ...a);

(async () => {
  log("start");
  const briefing = await briefWithGemini({
    limitKR: Number(process.env.LIMIT_KR || 5),
    limitWorld: Number(process.env.LIMIT_WORLD || 5),
  });

  log("brief len:", briefing.length);

  // 한국/세계 섹션을 분리해서 보내고 싶으면 step11에서 category만 다르게 두 번 호출하면 됨
  await sendBriefingAsKakao({
    category: "Gemini 브리핑",
    briefingText: briefing,
  });
})();
