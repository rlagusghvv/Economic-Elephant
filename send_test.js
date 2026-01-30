import "dotenv/config";

async function refreshAccessToken() {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.KAKAO_REST_KEY,
    refresh_token: process.env.KAKAO_REFRESH_TOKEN,
  });

  if (process.env.KAKAO_CLIENT_SECRET) {
    body.append("client_secret", process.env.KAKAO_CLIENT_SECRET);
  }

  const res = await fetch("https://kauth.kakao.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
    },
    body,
  });

  const json = await res.json();
  if (!json.access_token) {
    throw new Error("토큰 갱신 실패: " + JSON.stringify(json));
  }
  return json.access_token;
}

async function sendToMeText(text) {
  const accessToken = await refreshAccessToken();

  const templateObject = {
    object_type: "text",
    text,
    link: {
      web_url: "https://example.com",
      mobile_web_url: "https://example.com",
    },
    button_title: "확인",
  };

  const body = new URLSearchParams({
    template_object: JSON.stringify(templateObject),
  });

  const res = await fetch(
    "https://kapi.kakao.com/v2/api/talk/memo/default/send",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
      },
      body,
    }
  );

  const json = await res.json();
  if (json.result_code !== 0) {
    throw new Error("메시지 전송 실패: " + JSON.stringify(json));
  }
  return json;
}

const msg = process.argv.slice(2).join(" ") || "✅ 카카오톡 푸시 테스트 성공!";

sendToMeText(msg)
  .then((r) => console.log("✅ 전송 성공:", r))
  .catch((e) => {
    console.error("❌ 에러:", e.message);
    process.exit(1);
  });
