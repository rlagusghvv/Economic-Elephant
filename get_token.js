import "dotenv/config";

/**
 * 사용법:
 * node get_token.js 발급받은_CODE
 */

const code = process.argv[2];

if (!code) {
  console.log("❌ 사용법: node get_token.js CODE값");
  process.exit(1);
}

const REST_KEY = process.env.KAKAO_REST_KEY;
const REDIRECT_URI = process.env.KAKAO_REDIRECT_URI;

if (!REST_KEY || !REDIRECT_URI) {
  console.log(
    "❌ .env에 KAKAO_REST_API_KEY 또는 KAKAO_REDIRECT_URI가 없습니다."
  );
  process.exit(1);
}

async function getToken() {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: REST_KEY,
    redirect_uri: REDIRECT_URI,
    code,
  });

  const res = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body,
  });

  const data = await res.json();

  if (data.error) {
    console.log("\n❌ 토큰 발급 실패");
    console.log(data);
    console.log("\n🔍 체크리스트");
    console.log("1) REST API 키가 맞는지");
    console.log("2) redirect_uri가 카카오 콘솔에 등록된 값과 완전히 같은지");
    console.log("3) code를 새로 발급받았는지 (1회용)");
    process.exit(1);
  }

  console.log("\n✅ 토큰 발급 성공!\n");
  console.log(data);

  if (data.refresh_token) {
    console.log("\n📌 아래 줄을 .env에 추가하세요:\n");
    console.log(`KAKAO_REFRESH_TOKEN=${data.refresh_token}\n`);
  } else {
    console.log("⚠️ refresh_token이 없습니다. (동의 항목 확인 필요)");
  }
}

getToken().catch((err) => {
  console.error("❌ 실행 중 에러:", err.message);
});
