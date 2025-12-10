// photosClient.js
//
// Google Photos Library API からメディア一覧を取ってきて
// フロント向けの {url, title, owner} 配列に変換するモジュール。

const { google } = require("googleapis");

// 環境変数から取得
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;

// 任意: 特定アルバムだけを対象にする場合
const PHOTOS_ALBUM_ID = process.env.PHOTOS_ALBUM_ID || null;

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
  console.warn(
    "[photosClient] GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / GOOGLE_REFRESH_TOKEN が設定されていません。"
  );
}
if (!PHOTOS_ALBUM_ID) {
    console.warn("[photosClient] PHOTOS_ALBUM_ID が設定されていません。アプリ作成データのみ取得のスコープではアルバムID指定が必須です。");
}

// OAuth2 クライアント生成
const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET
);

// リフレッシュトークンをセット
oAuth2Client.setCredentials({
  refresh_token: REFRESH_TOKEN,
});

/**
 * Google Photos から写真一覧を取得する（REST API を直接使用）
 * とりあえず pageSize だけ指定したシンプルな実装。
 * - アルバム ID 指定があれば mediaItems.search
 * - なければ mediaItems.list
 */
async function fetchPhotoItems({ pageSize = 25 } = {}) {
  try {
    // アクセストークンを取得
    const { token } = await oAuth2Client.getAccessToken();
    
    if (!token) {
      throw new Error("Failed to refresh access token");
    }

    const baseUrl = "https://photoslibrary.googleapis.com/v1";
    
    // アルバムIDがあれば search
    if (PHOTOS_ALBUM_ID) {
      const response = await fetch(`${baseUrl}/mediaItems:search`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          albumId: PHOTOS_ALBUM_ID,
          pageSize: pageSize.toString(), // 文字列にするのが安全
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Photos API error: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const data = await response.json();
      return data.mediaItems || [];
    } else {
      // ライブラリ全体から取得
      const response = await fetch(`${baseUrl}/mediaItems?pageSize=${pageSize}`, {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${token}`,
        },
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Photos API error: ${response.status} ${response.statusText} - ${errorText}`);
      }
      
      const data = await response.json();
      return data.mediaItems || [];
    }
  } catch (err) {
    console.error("Error in fetchPhotoItems:", err);
    return [];
  }
}

/**
 * フロントエンド向けに整形した写真リストを返す
 */
async function listPhotosForFrontend() {
  const items = await fetchPhotoItems({ pageSize: 30 });

  // Cloud Run → フロントへ返す用のシンプルな形に変換
  return items
    .filter((m) => m && m.baseUrl)
    .map((m) => {
      // FHD 相当のサイズ指定 (w1920-h1080)
      const url = `${m.baseUrl}=w1920-h1080`;

      return {
        url,
        title: m.filename || "",
        owner: (m.mediaMetadata && m.mediaMetadata.creationTime) 
          ? `とった日: ${m.mediaMetadata.creationTime}`
          : "Google フォト",
      };
    });
}

module.exports = {
  listPhotosForFrontend,
};
