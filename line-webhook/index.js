const express = require("express");
const { validateSignature } = require("@line/bot-sdk");
const { Firestore } = require("@google-cloud/firestore");

const app = express();

// FirestoreをカスタムDB名でも使えるように初期化（デフォルトは (default)）
const projectId = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";
const db = new Firestore({ projectId, databaseId });
console.log(`Firestore init project=${projectId} db=${databaseId}`);

// ミドルウェアを事前に作成
const rawBodyParser = express.raw({ type: "application/json" });
const jsonParser = express.json();

// /callbackエンドポイントにはraw bodyが必要（署名検証のため）
// 他のエンドポイントにはJSONパーサーを使用
app.use((req, res, next) => {
  if (req.path === "/callback" && req.method === "POST") {
    // /callback POSTリクエストにはraw bodyを使用
    rawBodyParser(req, res, next);
  } else {
    // その他のリクエストにはJSONパーサーを使用
    jsonParser(req, res, next);
  }
});

const config = {
  channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: process.env.LINE_CHANNEL_SECRET,
};

// 署名検証ミドルウェア（API Gateway経由の場合も対応）
const signatureMiddleware = (req, res, next) => {
  const signature = req.get("X-Line-Signature");
  const skipValidation = process.env.SKIP_SIGNATURE_VALIDATION === "true";
  
  // デバッグログ
  console.log("署名検証ミドルウェア実行:", {
    path: req.path,
    method: req.method,
    hasSignature: !!signature,
    bodyType: typeof req.body,
    isBuffer: Buffer.isBuffer(req.body),
    skipValidation
  });
  
  // 署名がない場合の処理
  if (!signature) {
    if (skipValidation) {
      console.warn("警告: 署名検証をスキップしています（SKIP_SIGNATURE_VALIDATION=true）");
      // bodyをJSONとしてパースし直す
      try {
        if (Buffer.isBuffer(req.body)) {
          req.body = JSON.parse(req.body.toString());
        } else if (typeof req.body === "string") {
          req.body = JSON.parse(req.body);
        }
        // すでにオブジェクトの場合はそのまま
      } catch (e) {
        console.error("JSONパースエラー:", e);
        return res.status(400).json({ error: "Invalid JSON body", details: e.message });
      }
      return next();
    } else {
      return res.status(401).json({ 
        error: "SignatureValidationFailed: no signature",
        message: "X-Line-Signature ヘッダーがありません。本番環境では署名検証が必要です。"
      });
    }
  }

  // 署名検証（LINE SDKのvalidateSignatureを使用）
  try {
    if (!config.channelSecret) {
      console.error("エラー: LINE_CHANNEL_SECRETが設定されていません");
      return res.status(500).json({ error: "Server configuration error: channelSecret not set" });
    }
    
    const body = req.body;
    if (!Buffer.isBuffer(body) && typeof body !== "string") {
      console.error("エラー: bodyがBufferまたはstringではありません:", typeof body);
      return res.status(400).json({ error: "Invalid body type for signature validation" });
    }
    
    if (!validateSignature(body, config.channelSecret, signature)) {
      console.error("署名検証失敗");
      return res.status(401).json({ error: "SignatureValidationFailed: invalid signature" });
    }
    
    // 検証成功後、bodyをJSONとしてパース
    req.body = JSON.parse(Buffer.isBuffer(body) ? body.toString() : body);
    next();
  } catch (err) {
    console.error("署名検証エラー:", err);
    return res.status(401).json({ error: "SignatureValidationFailed", details: err.message });
  }
};

app.post("/callback", signatureMiddleware, async (req, res) => {
  const events = req.body.events || [];

  await Promise.all(
    events.map(async (event) => {
      if (event.type !== "message" || event.message.type !== "text") return;

      const doc = {
        text: event.message.text,
        timestamp: event.timestamp,
        source: event.source, // groupId等も入る
      };

      // 最新メッセージを1件として保存（まずはこれ）
      await db.collection("kiosk").doc("latest").set(doc, { merge: true });
    })
  );

  res.json({ status: "ok" });
});

app.get("/healthz", (_, res) => res.status(200).send("ok"));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`listening on ${port}`));
