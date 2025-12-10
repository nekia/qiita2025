// get-albums.js
//
// ユーザーのアルバム一覧を取得して、タイトルとアルバムIDを表示するスクリプト。
// ここで取得した ID を環境変数 PHOTOS_ALBUM_ID に設定することで、
// そのアルバム内の写真だけを表示できるようになります。
//
// usage:
//   GOOGLE_CLIENT_ID=... GOOGLE_REFRESH_TOKEN=... node get-albums.js

const { google } = require("googleapis");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error("エラー: 環境変数 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN を設定してください");
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
oAuth2Client.setCredentials({
  refresh_token: REFRESH_TOKEN,
});

async function main() {
  console.log("アルバム一覧を取得中...\n");

  try {
    const { token } = await oAuth2Client.getAccessToken();
    if (!token) throw new Error("アクセストークンの取得に失敗");

    // アルバム一覧 API
    const res = await fetch("https://photoslibrary.googleapis.com/v1/albums?pageSize=50", {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`API returned ${res.status}: ${text}`);
    }

    const data = await res.json();
    const albums = data.albums || [];

    if (albums.length === 0) {
      console.log("アルバムが見つかりませんでした。");
    } else {
      console.log(`=== アルバム一覧 (${albums.length}件) ===`);
      albums.forEach((album) => {
        console.log(`Title: ${album.title}`);
        console.log(`ID:    ${album.id}`);
        console.log(`Items: ${album.mediaItemsCount || 0}枚`);
        console.log("------------------------------------------------");
      });
      console.log("\n対象にしたいアルバムの ID をコピーして、環境変数 PHOTOS_ALBUM_ID に設定してください。");
    }

  } catch (err) {
    console.error("エラー:", err);
  }
}

main();
