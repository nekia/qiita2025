const express = require("express");
const { validateSignature, Client } = require("@line/bot-sdk");
const { Firestore } = require("@google-cloud/firestore");
const { PubSub } = require("@google-cloud/pubsub");

const app = express();

// FirestoreをカスタムDB名でも使えるように初期化（デフォルトは (default)）
const projectId = process.env.GCP_PROJECT || process.env.GOOGLE_CLOUD_PROJECT;
const databaseId = process.env.FIRESTORE_DATABASE_ID || "(default)";
const db = new Firestore({ projectId, databaseId });
console.log(`Firestore init project=${projectId} db=${databaseId}`);

const pubsubTopic = process.env.PUBSUB_TOPIC || "kiosk-events";
const pubsub = new PubSub({ projectId });
const PUBLISH_ALL_MESSAGES = process.env.PUBLISH_ALL_MESSAGES === "true";

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
const lineClient = new Client({
  channelAccessToken: config.channelAccessToken,
  channelSecret: config.channelSecret,
});

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
      if (!event.message || event.type !== "message" || event.message.type !== "text") return;

      // 送信者の表示名取得（可能な場合のみ）
      const source = event.source || {};
      const getDisplayName = async () => {
        if (!source.userId) return null;
        try {
          if (source.type === "group" && source.groupId) {
            const prof = await lineClient.getGroupMemberProfile(
              source.groupId,
              source.userId
            );
            return prof.displayName;
          }
          if (source.type === "room" && source.roomId) {
            const prof = await lineClient.getRoomMemberProfile(
              source.roomId,
              source.userId
            );
            return prof.displayName;
          }
          const prof = await lineClient.getProfile(source.userId);
          return prof.displayName;
        } catch (e) {
          console.warn("displayName fetch failed", e.message);
          return null;
        }
      };

      const mentionees =
        event.message?.mention?.mentionees?.map((m) => ({
          userId: m.userId,
          type: m.type,
          index: m.index,
          length: m.length,
          isSelf: m.isSelf || false,
        })) || [];

      const isGroupOrRoom = source.type === "group" || source.type === "room";
      const selfMentioned = mentionees.some((m) => m.isSelf === true);
      const shouldPublish = PUBLISH_ALL_MESSAGES
        ? true
        : isGroupOrRoom
          ? selfMentioned
          : source.type === "user";

      const displayName = await getDisplayName();

      const routeId =
        source.groupId || source.roomId || source.userId || null;

      const doc = {
        text: event.message.text,
        timestamp: event.timestamp,
        timestampIso: new Date(event.timestamp).toISOString(),
        source,
        displayName,
        userId: source.userId || null,
        mentionees,
        messageId: event.message.id,
        quoteToken: event.message.quoteToken || null,
        routeId,
        sourceType: source.type || null,
      };

      // 最新メッセージを更新
      await db.collection("kiosk").doc("latest").set(doc, { merge: true });
      // 全メッセージを蓄積（自動IDで追加）
      await db.collection("kiosk").doc("messages").collection("items").add(doc);

      console.log(
        JSON.stringify({
          severity: "INFO",
          message: "publish decision",
          sourceType: source.type || null,
          isGroupOrRoom,
          selfMentioned,
          publishAll: PUBLISH_ALL_MESSAGES,
          shouldPublish,
        })
      );

      // Botがメンションされた場合のみ Pub/Sub publish（PUBLISH_ALL_MESSAGES=true なら常に publish）
      if (shouldPublish) {
        const payload = {
          eventId: event.message.id, // idempotency key
          deviceId: process.env.DEVICE_ID || "home-parents-1",
          type: "line_message",
          occurredAt: new Date(event.timestamp).toISOString(),
          payload: {
            text: event.message.text,
            senderName: displayName || null,
            messageId: event.message.id,
            quoteToken: event.message.quoteToken || null,
            groupId: source.groupId || null,
            roomId: source.roomId || null,
            userId: source.userId || null,
            routeId,
            sourceType: source.type || null,
          },
        };
        try {
          await pubsub.topic(pubsubTopic).publishMessage({
            json: payload,
          });
          console.log(
            JSON.stringify({
              severity: "INFO",
              message: "published to pubsub",
              topic: pubsubTopic,
              eventId: payload.eventId,
            })
          );
        } catch (err) {
          console.error(
            JSON.stringify({
              severity: "ERROR",
              message: "pubsub publish failed",
              error: err.message,
              eventId: payload.eventId,
            })
          );
        }
      }
    })
  );

  res.json({ status: "ok" });
});

app.get("/healthz", (_, res) => res.status(200).send("ok"));

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`listening on ${port}`));
