// upload-photo.js
// API経由で写真をアップロードし、アプリ作成アルバムに追加する
// usage:
//   node upload-photo.js
//   (.envファイルから環境変数を読み込みます)
//   imagesフォルダ配下の画像を全てアップロードします

require("dotenv").config();

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const ALBUM_ID = process.env.PHOTOS_ALBUM_ID;
const IMAGES_DIR = path.join(__dirname, ".", "images");

// 画像ファイルの拡張子
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"];

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !ALBUM_ID) {
  console.error("Usage: node upload-photo.js");
  console.error("Ensures .env file with: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, PHOTOS_ALBUM_ID");
  process.exit(1);
}

// imagesフォルダの存在確認
if (!fs.existsSync(IMAGES_DIR)) {
  console.error(`Error: images folder not found at ${IMAGES_DIR}`);
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

// imagesフォルダ内の画像ファイルを取得
function getImageFiles(dir) {
  const files = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // 再帰的にサブディレクトリも検索
        files.push(...getImageFiles(fullPath));
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (IMAGE_EXTENSIONS.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err);
  }
  return files;
}

// 画像ファイルのMIMEタイプを取得
function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp"
  };
  return mimeTypes[ext] || "image/jpeg";
}

// 単一の画像ファイルをアップロード
async function uploadImage(token, filePath) {
  try {
    // 1. Upload bytes
    console.log(`Uploading ${filePath}...`);
    const fileData = fs.readFileSync(filePath);
    const mimeType = getMimeType(filePath);
    
    const uploadRes = await fetch("https://photoslibrary.googleapis.com/v1/uploads", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-type": "application/octet-stream",
        "X-Goog-Upload-Content-Type": mimeType,
        "X-Goog-Upload-Protocol": "raw",
      },
      body: fileData,
    });
    
    if (!uploadRes.ok) {
      const errorText = await uploadRes.text();
      throw new Error(`Upload failed: ${errorText}`);
    }
    const uploadToken = await uploadRes.text();

    // 2. Create Media Item
    console.log(`Creating media item for ${path.basename(filePath)}...`);
    const createRes = await fetch("https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-type": "application/json",
      },
      body: JSON.stringify({
        albumId: ALBUM_ID,
        newMediaItems: [{
          description: `Uploaded via API: ${path.basename(filePath)}`,
          simpleMediaItem: {
            fileName: path.basename(filePath),
            uploadToken: uploadToken
          }
        }]
      })
    });

    if (!createRes.ok) {
      const errorText = await createRes.text();
      throw new Error(`Create failed: ${errorText}`);
    }
    const result = await createRes.json();
    console.log(`✓ Successfully uploaded ${path.basename(filePath)}`);
    return result;
  } catch (err) {
    console.error(`✗ Failed to upload ${filePath}:`, err.message);
    throw err;
  }
}

async function main() {
  try {
    const { token } = await oAuth2Client.getAccessToken();
    if (!token) throw new Error("AccessToken取得失敗");

    // imagesフォルダ内の画像ファイルを取得
    console.log(`Scanning ${IMAGES_DIR} for images...`);
    const imageFiles = getImageFiles(IMAGES_DIR);
    
    if (imageFiles.length === 0) {
      console.log("No image files found in images folder.");
      return;
    }

    console.log(`Found ${imageFiles.length} image file(s). Starting upload...\n`);

    // 各画像ファイルを順次アップロード
    let successCount = 0;
    let failCount = 0;
    
    for (let i = 0; i < imageFiles.length; i++) {
      const filePath = imageFiles[i];
      try {
        await uploadImage(token, filePath);
        successCount++;
      } catch (err) {
        failCount++;
        // エラーが発生しても次のファイルのアップロードを続行
      }
      
      // レート制限を避けるため、少し待機（最後のファイル以外）
      if (i < imageFiles.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    console.log(`\n=== Upload Summary ===`);
    console.log(`Total: ${imageFiles.length} files`);
    console.log(`Success: ${successCount} files`);
    console.log(`Failed: ${failCount} files`);

  } catch (err) {
    console.error("Fatal error:", err);
    process.exit(1);
  }
}

main();
