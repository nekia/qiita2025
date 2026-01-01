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
 * ページネーションに対応して、全ページを取得する。
 * - アルバム ID 指定があれば mediaItems.search
 * - なければ mediaItems.list
 */
async function fetchPhotoItems({ pageSize = 25, maxItems = null } = {}) {
  try {
    // アクセストークンを取得
    const { token } = await oAuth2Client.getAccessToken();
    
    if (!token) {
      throw new Error("Failed to refresh access token");
    }

    const baseUrl = "https://photoslibrary.googleapis.com/v1";
    const allItems = [];
    let nextPageToken = null;
    let pageCount = 0;
    
    do {
      // アルバムIDがあれば search
      if (PHOTOS_ALBUM_ID) {
        // pageSizeは数値として送信（最大100）
        const effectivePageSize = Math.min(pageSize, 100);
        const requestBody = {
          albumId: PHOTOS_ALBUM_ID,
          pageSize: effectivePageSize,
        };
        
        if (nextPageToken) {
          requestBody.pageToken = nextPageToken;
        }
        
        const response = await fetch(`${baseUrl}/mediaItems:search`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(requestBody),
        });
        
        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Photos API error: ${response.status} ${response.statusText} - ${errorText}`);
        }
        
        const data = await response.json();
        // mediaItemsが存在しない場合は空配列として扱う（APIがプロパティを省略する場合がある）
        const items = Array.isArray(data.mediaItems) ? data.mediaItems : [];
        
        // デバッグ: レスポンス構造を確認（全ページ）
        console.log(`[photosClient] Page ${pageCount + 1} response:`, {
          requestPageSize: effectivePageSize,
          hasMediaItems: !!data.mediaItems,
          mediaItemsLength: items.length,
          hasNextPageToken: !!data.nextPageToken,
          responseKeys: Object.keys(data),
          // 最初のページのみ、実際のリクエストボディとレスポンスを確認
          ...(pageCount === 0 ? {
            requestBody: JSON.stringify(requestBody),
            fullResponse: JSON.stringify(data, null, 2).substring(0, 1000),
          } : {}),
        });
        
        if (items.length > 0) {
          allItems.push(...items);
          console.log(`[photosClient] Page ${pageCount + 1}: Added ${items.length} items (total: ${allItems.length})`);
        } else {
          console.log(`[photosClient] Page ${pageCount + 1}: No items in response (items.length: ${items.length})`);
        }
        
        nextPageToken = data.nextPageToken || null;
        pageCount++;
        
        // maxItemsが指定されている場合は制限をチェック
        if (maxItems && allItems.length >= maxItems) {
          break;
        }
      } else {
        // ライブラリ全体から取得
        let url = `${baseUrl}/mediaItems?pageSize=${pageSize}`;
        if (nextPageToken) {
          url += `&pageToken=${encodeURIComponent(nextPageToken)}`;
        }
        
        const response = await fetch(url, {
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
        // mediaItemsが存在しない場合は空配列として扱う（APIがプロパティを省略する場合がある）
        const items = Array.isArray(data.mediaItems) ? data.mediaItems : [];
        
        // デバッグ: レスポンス構造を確認（各ページ）
        if (pageCount < 2) { // 最初の2ページのみ詳細ログ
          console.log(`[photosClient] Page ${pageCount + 1} response (list):`, {
            hasMediaItems: !!data.mediaItems,
            mediaItemsLength: items.length,
            hasNextPageToken: !!data.nextPageToken,
            responseKeys: Object.keys(data),
          });
        }
        
        if (items.length > 0) {
          allItems.push(...items);
          if (pageCount < 2) {
            console.log(`[photosClient] Page ${pageCount + 1}: Added ${items.length} items (total: ${allItems.length})`);
          }
        }
        
        nextPageToken = data.nextPageToken || null;
        pageCount++;
        
        // maxItemsが指定されている場合は制限をチェック
        if (maxItems && allItems.length >= maxItems) {
          break;
        }
      }
    } while (nextPageToken && (!maxItems || allItems.length < maxItems));
    
    console.log(`[photosClient] Fetched ${allItems.length} items across ${pageCount} page(s)`);
    
    return allItems;
  } catch (err) {
    console.error("Error in fetchPhotoItems:", err);
    return [];
  }
}

/**
 * フロントエンド向けに整形した写真リストを返す
 */
async function listPhotosForFrontend() {
  // pageSizeを100に設定して効率的に取得（APIの最大値）
  const items = await fetchPhotoItems({ pageSize: 100 });
  
  // デバッグ: 取得したアイテム数を確認
  console.log("[photosClient] Fetched items count:", items.length);

  // Cloud Run → フロントへ返す用のシンプルな形に変換
  const filtered = items
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
  
  // デバッグ: フィルタリング後の数を確認
  console.log("[photosClient] Filtered items count:", filtered.length);
  
  return filtered;
}

module.exports = {
  listPhotosForFrontend,
};
