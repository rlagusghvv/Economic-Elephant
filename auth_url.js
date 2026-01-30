import "dotenv/config";

const REST = process.env.KAKAO_REST_KEY;
const REDIRECT = process.env.KAKAO_REDIRECT_URI;

if (!REST || !REDIRECT) {
  console.log("❌ .env에 KAKAO_REST_KEY, KAKAO_REDIRECT_URI가 필요해");
  process.exit(1);
}

const scope = "talk_message,friends"; // ✅ friends 추가
const url =
  `https://kauth.kakao.com/oauth/authorize` +
  `?client_id=${encodeURIComponent(REST)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT)}` +
  `&response_type=code` +
  `&scope=${encodeURIComponent(scope)}` +
  `&prompt=consent`; // ✅ 중요: 다시 동의 받기

console.log("\n아래 URL을 브라우저에 붙여넣고 로그인/동의하세요.\n");
console.log(url);
console.log("\n동의 후 redirect_uri로 이동하면서 code=XXXX 가 붙습니다.\n");
