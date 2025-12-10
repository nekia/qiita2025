// create-album.js
//
// 新しい運用: API経由でこのアプリ専用のアルバムを作成する。
// usage:
//   GOOGLE_CLIENT_ID=... GOOGLE_REFRESH_TOKEN=... node create-album.js "My App Album"

const { google } = require("googleapis");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const ALBUM_TITLE = process.argv[2] || "Qiita 2025 Demo Album";

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error("エラー: 環境変数 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN を設定してください");
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
oAuth2Client.setCredentials({
  refresh_token: REFRESH_TOKEN,
});

async function main() {
  console.log(`アルバム "${ALBUM_TITLE}" を作成中...\n`);

  try {
    const { token } = await oAuth2Client.getAccessToken();
    if (!token) throw new Error("アクセストークンの取得に失敗");

    // アルバム作成 API
    const res = await fetch("https://photoslibrary.googleapis.com/v1/albums", {
      method: "POST",
      headers: { 
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        album: {
          title: ALBUM_TITLE
        }
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API returned ${res.status}: ${text}`);
    }

    const data = await res.json();
    console.log("=== アルバム作成成功 ===");
    console.log(`Title: ${data.title}`);
    console.log(`ID:    ${data.id}`);
    console.log(`ProductUrl: ${data.productUrl}`);
    console.log("\nこの ID を環境変数 PHOTOS_ALBUM_ID に設定してください。");
    console.log("また、productUrl を開いて、手動で写真を追加してみてください（アプリ作成アルバムなら読み取れるはずです）。");

  } catch (err) {
    console.error("エラー:", err);
  }
}

main();
