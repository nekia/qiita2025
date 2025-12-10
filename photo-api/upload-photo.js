// upload-photo.js
// API経由で写真をアップロードし、アプリ作成アルバムに追加する
// usage:
//   GOOGLE_CLIENT_ID=... GOOGLE_REFRESH_TOKEN=... PHOTOS_ALBUM_ID=... node upload-photo.js ./test.jpg

const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REFRESH_TOKEN = process.env.GOOGLE_REFRESH_TOKEN;
const ALBUM_ID = process.env.PHOTOS_ALBUM_ID;
const FILE_PATH = process.argv[2];

if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN || !ALBUM_ID || !FILE_PATH) {
  console.error("Usage: node upload-photo.js <path-to-image>");
  console.error("Ensures env vars: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, PHOTOS_ALBUM_ID");
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
oAuth2Client.setCredentials({ refresh_token: REFRESH_TOKEN });

async function main() {
  try {
    const { token } = await oAuth2Client.getAccessToken();
    if (!token) throw new Error("AccessToken取得失敗");

    // 1. Upload bytes
    console.log(`Uploading ${FILE_PATH}...`);
    const fileData = fs.readFileSync(FILE_PATH);
    const uploadRes = await fetch("https://photoslibrary.googleapis.com/v1/uploads", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-type": "application/octet-stream",
        "X-Goog-Upload-Content-Type": "image/jpeg",
        "X-Goog-Upload-Protocol": "raw",
      },
      body: fileData,
    });
    
    if (!uploadRes.ok) throw new Error(`Upload failed: ${await uploadRes.text()}`);
    const uploadToken = await uploadRes.text();
    console.log("Upload token:", uploadToken);

    // 2. Create Media Item
    console.log("Creating media item...");
    const createRes = await fetch("https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-type": "application/json",
      },
      body: JSON.stringify({
        albumId: ALBUM_ID,
        newMediaItems: [{
          description: "Uploaded via API",
          simpleMediaItem: {
            fileName: path.basename(FILE_PATH),
            uploadToken: uploadToken
          }
        }]
      })
    });

    if (!createRes.ok) throw new Error(`Create failed: ${await createRes.text()}`);
    const result = await createRes.json();
    console.log("Result:", JSON.stringify(result, null, 2));

  } catch (err) {
    console.error(err);
  }
}

main();
