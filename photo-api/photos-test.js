// photos-test.js
//
// Refresh Token を使って Google Photos Library API にアクセスし、
// 画像の baseUrl を表示するだけの最小テスト。
// usage:
//   GOOGLE_CLIENT_ID=xxx GOOGLE_CLIENT_SECRET=yyy GOOGLE_REFRESH_TOKEN=zzz node photos-test.js

const { google } = require("googleapis");

// ======== 1. 必要な環境変数を読み込み ========
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const ALBUM_ID = process.env.PHOTOS_ALBUM_ID; // 追加

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.error("環境変数 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN を設定してください");
  process.exit(1);
}

// ======== 2. OAuth2 クライアント作成 ========
const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);

// refresh_token をセット
oAuth2Client.setCredentials({
  refresh_token: REFRESH_TOKEN,
});

// Photos Library API クライアント (googleapis には photoslibrary がないため fetch で代用)
// const photos = google.photoslibrary({ ... }); -> 廃止

// ======== 3. mediaItems を取得（一覧） ========
async function main() {
  console.log("Google Photos API にアクセス中...\n");
  if (ALBUM_ID) {
    console.log(`アルバム指定あり: ${ALBUM_ID.slice(0, 10)}...`);
  } else {
    console.log("警告: アルバムIDが指定されていません。アプリ作成データのみ取得のスコープでは、アルバム指定(search)が必須の可能性があります。");
  }

  try {
    // アクセストークンを取得
    const { token } = await oAuth2Client.getAccessToken();
    if (!token) {
      throw new Error("アクセストークンの取得に失敗しました");
    }

    let res;
    if (ALBUM_ID) {
        // アルバム指定がある場合は search を使う
        res = await fetch("https://photoslibrary.googleapis.com/v1/mediaItems:search", {
            method: "POST",
            headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                albumId: ALBUM_ID,
                pageSize: 10
            })
        });
    } else {
        // アルバム指定がない場合でも、アプリ作成データのみを取得するなら list で取れる可能性があるが
        // 念の為 search でフィルタなしを試すか、list を使うか。まずは list のままでエラーを見てみる。
        res = await fetch("https://photoslibrary.googleapis.com/v1/mediaItems?pageSize=10", {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });
    }

    if (!res.ok) {
        const text = await res.text();
        // エラー詳細を表示
        console.error(`API Error Status: ${res.status}`);
        console.error(`API Error Body: ${text}`);
        throw new Error(`API returned ${res.status}`);
    }

    const data = await res.json();
    const items = data.mediaItems || [];
    console.log(`取得した件数: ${items.length}\n`);

    items.forEach((m, i) => {
      console.log(`----- [${i + 1}] -----`);
      console.log("id:", m.id);
      console.log("filename:", m.filename);
      console.log("mimeType:", m.mimeType);
      console.log("baseUrl:", m.baseUrl);
      console.log("");
    });

    if (items.length > 0) {
      console.log("画像URLの一例（FHD指定）:");
      console.log(items[0].baseUrl + "=w1920-h1080");
    }
  } catch (err) {
    console.error("API エラー:", err.response?.data || err);
  }
}

main();
