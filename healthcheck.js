import "dotenv/config";

const PORT = Number(process.env.PORT || 3000);
const url = `http://127.0.0.1:${PORT}/health`;

async function main() {
  try {
    const res = await fetch(url, { method: "GET" });
    const text = await res.text();
    if (!res.ok) {
      console.error(`❌ healthcheck fail: HTTP ${res.status}`);
      console.error(text);
      process.exit(1);
    }
    console.log("✅ healthcheck ok");
    console.log(text);
  } catch (e) {
    console.error("❌ healthcheck error:", e.message);
    process.exit(1);
  }
}

main();
