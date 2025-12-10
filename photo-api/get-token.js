// get-token.js
//
// ローカルPCで一度だけ実行して、Google Photos 用の
// refresh_token を取得するスクリプト。
// 実行手順:
//   1. GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET を環境変数にセット
//   2. node get-token.js
//   3. 表示された URL をブラウザで開く → 同意 → 表示された "code" を貼り付け

const { google } = require("googleapis");
const readline = require("readline");

// ★ 事前に環境変数で設定しておく
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// デスクトップアプリ想定の「ローカル用」リダイレクトURI
// OAuth クライアント作成時に、"http://localhost:3000/oauth2callback" を登録しておくのが楽
const REDIRECT_URI = "http://localhost:3000/oauth2callback";

// Photos のスコープ
// 2025/3/31以降、photoslibrary.readonly などの広範なスコープは廃止されました。
// 代わりに、自分のアプリで作ったデータのみアクセス可能なスコープなどを使用します。
// ただし、これだと既存のアルバム（アプリ以外で作ったもの）は見えなくなる可能性があります。
// アプリ専用のアルバムを作成して管理する運用に変える必要があります。
const SCOPES = [
  "https://www.googleapis.com/auth/photoslibrary.appendonly",
  "https://www.googleapis.com/auth/photoslibrary.readonly.appcreateddata",
  "https://www.googleapis.com/auth/photoslibrary.edit.appcreateddata"
];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET を環境変数に設定してください");
  process.exit(1);
}

const oAuth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

// 認可URLを作成してコンソールに表示
const authUrl = oAuth2Client.generateAuthUrl({
  access_type: "offline",
  scope: SCOPES,
  prompt: "consent", // refresh_token を確実にもらうため
});

console.log("このURLをブラウザで開いて、表示されたコードをここに貼り付けてください:\n");
console.log(authUrl);
console.log("\n");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
rl.question("ブラウザで認可後に表示されたコードを入力: ", async (code) => {
  rl.close();
  try {
    const { tokens } = await oAuth2Client.getToken(code.trim());
    console.log("\n=== 取得したトークン ===");
    console.log(JSON.stringify(tokens, null, 2));
    console.log("\nこの中の refresh_token を Cloud Run の環境変数 GOOGLE_REFRESH_TOKEN に設定してください。");
  } catch (err) {
    console.error("トークン取得に失敗しました:", err);
  }
});
