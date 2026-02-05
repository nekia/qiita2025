const express = require("express");
const { Firestore, FieldValue, Timestamp } = require("@google-cloud/firestore");
const { Client } = require("@line/bot-sdk");

const app = express();
app.use(express.json());
const firestore = new Firestore({
  projectId: process.env.FIRESTORE_PROJECT_ID,
  databaseId: process.env.FIRESTORE_DATABASE_ID || "(default)",
});

const PORT = process.env.PORT || 8080;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 2000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 20000);
const RECENT_LIMIT = Number(process.env.RECENT_LIMIT || 20);

// LINE Bot SDK Client (遅延初期化)
let lineClient = null;
function getLineClient() {
  if (!lineClient) {
    const channelAccessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const channelSecret = process.env.LINE_CHANNEL_SECRET;
    if (!channelAccessToken) {
      throw new Error("LINE_CHANNEL_ACCESS_TOKEN environment variable is not set");
    }
    lineClient = new Client({
      channelAccessToken,
      channelSecret,
    });
  }
  return lineClient;
}

function parseSince(value, headerLastEventId) {
  const candidate = value || headerLastEventId;
  if (!candidate) return null;
  // Accept epoch millis or ISO8601
  if (!Number.isNaN(Number(candidate))) {
    const date = new Date(Number(candidate));
    return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
  }
  const date = new Date(candidate);
  return Number.isNaN(date.getTime()) ? null : Timestamp.fromDate(date);
}

function toMillis(ts) {
  if (!ts) return null;
  if (ts instanceof Timestamp) return ts.toMillis();
  if (ts.toDate) return ts.toDate().getTime();
  return null;
}

function writeEvent(res, doc) {
  const data = doc.data();
  const rawReply = data.reply || data.replyState || null;
  const reply =
    rawReply && typeof rawReply === "object"
      ? {
          ...rawReply,
          repliedAt: toMillis(rawReply.repliedAt) || rawReply.repliedAt || null,
        }
      : rawReply;
  const event = {
    id: doc.id,
    deviceId: data.deviceId,
    type: data.type,
    payload: data.payload,
    status: data.status,
    createdAt: toMillis(data.createdAt),
    occurredAt: toMillis(data.occurredAt),
    source: data.source,
    line: data.line,
    gemini: data.gemini,
    reply,
  };
  res.write(`event: kiosk_event\n`);
  res.write(`id: ${doc.id}\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

async function initialSend(res, deviceId, sinceTs) {
  const eventsRef = firestore.collection(`devices/${deviceId}/events`);
  let latestTs = sinceTs;

  if (sinceTs) {
    const snapshot = await eventsRef
      .where("createdAt", ">", sinceTs)
      .orderBy("createdAt", "asc")
      .get();
    snapshot.forEach((doc) => {
      writeEvent(res, doc);
      latestTs = doc.get("createdAt") || latestTs;
    });
    return latestTs;
  }

  const snapshot = await eventsRef.orderBy("createdAt", "desc").limit(RECENT_LIMIT).get();
  const docs = snapshot.docs.reverse(); // oldest first
  docs.forEach((doc) => {
    writeEvent(res, doc);
    latestTs = doc.get("createdAt") || latestTs;
  });
  return latestTs;
}

app.get("/sse", async (req, res) => {
  const deviceId = req.query.deviceId;
  const sinceParam = req.query.since;
  if (!deviceId) {
    return res.status(400).json({ error: "deviceId is required" });
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  let latestTs = parseSince(sinceParam, req.get("Last-Event-ID"));
  try {
    latestTs = await initialSend(res, deviceId, latestTs);
  } catch (err) {
    console.error(JSON.stringify({ severity: "ERROR", message: "initial fetch failed", error: err.message, deviceId }));
    res.write(`event: error\ndata: ${JSON.stringify({ message: "initial fetch failed" })}\n\n`);
  }

  const eventsRef = firestore.collection(`devices/${deviceId}/events`);
  const poller = setInterval(async () => {
    try {
      let query;
      if (latestTs) {
        query = eventsRef.where("createdAt", ">", latestTs).orderBy("createdAt", "asc");
      } else {
        query = eventsRef.orderBy("createdAt", "asc").limit(RECENT_LIMIT);
      }
      const snapshot = await query.get();
      snapshot.forEach((doc) => {
        writeEvent(res, doc);
        latestTs = doc.get("createdAt") || latestTs;
      });
    } catch (err) {
      console.error(JSON.stringify({ severity: "ERROR", message: "poll failed", error: err.message, deviceId }));
    }
  }, POLL_INTERVAL_MS);

  const heartbeater = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, HEARTBEAT_INTERVAL_MS);

  req.on("close", () => {
    clearInterval(poller);
    clearInterval(heartbeater);
  });
});

app.post("/line/reply", async (req, res) => {
  try {
    // リクエストボディ全体をログに出力（デバッグ用）
    console.log(JSON.stringify({
      severity: "DEBUG",
      message: "LINE reply request body",
      body: req.body,
      bodyKeys: Object.keys(req.body || {}),
    }));
    
    const { deviceId, text, line } = req.body;
    
    if (!text) {
      console.error(JSON.stringify({
        severity: "ERROR",
        message: "Validation failed: text is required",
        body: req.body,
      }));
      return res.status(400).json({ error: "text is required" });
    }
    
    if (!line || !line.routeId) {
      console.error(JSON.stringify({
        severity: "ERROR",
        message: "Validation failed: line.routeId is required",
        body: req.body,
        line: line,
      }));
      return res.status(400).json({ error: "line.routeId is required" });
    }

    const { routeId, quoteToken, messageId, sourceType } = line;
    
    console.log(JSON.stringify({
      severity: "INFO",
      message: "LINE reply request",
      deviceId,
      routeId,
      hasQuoteToken: !!quoteToken,
      messageId,
      sourceType,
      textLength: text.length,
      textPreview: text.substring(0, 50), // 最初の50文字のみ
    }));

    // LINE Clientを取得（必要に応じて初期化）
    const client = getLineClient();

    // quoteToken は replyToken ではない（引用表示用）。送信するメッセージに付与する。
    const to = routeId; // routeIdはgroupId, roomId, userIdのいずれか
    const message = quoteToken
      ? { type: "text", text, quoteToken }
      : { type: "text", text };

    await client.pushMessage(to, message);
    console.log(JSON.stringify({
      severity: "INFO",
      message: "LINE reply sent via pushMessage",
      to,
      usedQuoteToken: !!quoteToken,
    }));

    // Firestoreに回答結果を保存（kiosk起動時の既読判定用）
    if (deviceId && messageId) {
      const replyRef = firestore.doc(`devices/${deviceId}/events/${messageId}`);
      const replyPayload = {
        choiceText: text,
        repliedAt: FieldValue.serverTimestamp(),
        source: "kiosk",
      };
      await replyRef.set(
        {
          status: "replied",
          reply: replyPayload,
          repliedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      console.log(JSON.stringify({
        severity: "INFO",
        message: "reply saved to firestore",
        deviceId,
        messageId,
      }));
    } else {
      console.warn(JSON.stringify({
        severity: "WARN",
        message: "skip reply save (missing deviceId or messageId)",
        deviceId,
        messageId,
      }));
    }

    return res.status(200).json({ status: "ok", message: "reply sent" });
  } catch (err) {
    // LINE APIのエラーレスポンスを取得
    let lineApiError = null;
    let statusCode = 500;
    
    // エラーオブジェクトの構造を確認（デバッグ用）
    const errKeys = Object.keys(err);
    const errStructure = {
      hasResponse: !!err.response,
      hasOriginalError: !!err.originalError,
      hasStatusCode: !!err.statusCode,
      hasStatus: !!err.status,
      keys: errKeys,
    };
    
    // HTTPErrorの場合、responseオブジェクトから詳細を取得
    // LINE Bot SDKはaxiosのエラーをラップしている可能性がある
    if (err.response) {
      statusCode = err.response.status || err.statusCode || 500;
      lineApiError = {
        status: err.response.status,
        statusText: err.response.statusText,
        headers: err.response.headers,
        data: err.response.data, // LINE APIのエラーメッセージがここにある
      };
    } else if (err.originalError && err.originalError.response) {
      // originalErrorにresponseがある場合
      statusCode = err.originalError.response.status || err.statusCode || 500;
      lineApiError = {
        status: err.originalError.response.status,
        statusText: err.originalError.response.statusText,
        headers: err.originalError.response.headers,
        data: err.originalError.response.data,
      };
    } else if (err.statusCode) {
      statusCode = err.statusCode;
    } else if (err.status) {
      statusCode = err.status;
    }
    
    // エラーオブジェクトの基本情報
    const errorDetails = {
      message: err.message,
      name: err.name,
      constructor: err.constructor?.name,
      statusCode: statusCode,
    };
    
    // LINE APIのエラーレスポンスがある場合は追加
    if (lineApiError) {
      errorDetails.lineApiError = lineApiError;
    }
    
    // その他のエラープロパティを取得
    const errorKeys = Object.keys(err);
    errorKeys.forEach(key => {
      if (key !== 'response' && key !== 'config' && key !== 'request') {
        try {
          const value = err[key];
          if (typeof value !== 'object' || value === null) {
            errorDetails[key] = value;
          }
        } catch (e) {
          // 無視
        }
      }
    });
    
    console.error(JSON.stringify({
      severity: "ERROR",
      message: "LINE reply failed",
      deviceId: req.body?.deviceId,
      routeId: req.body?.line?.routeId,
      hasQuoteToken: !!req.body?.line?.quoteToken,
      quoteToken: req.body?.line?.quoteToken ? req.body.line.quoteToken.substring(0, 20) + "..." : null,
      sourceType: req.body?.line?.sourceType,
      textLength: req.body?.text?.length,
      errorStructure: errStructure,
      errorDetails: errorDetails,
      stack: err.stack,
    }));
    
    // quoteToken が無効等で 400 の場合、quoteToken無し + 元メッセージ情報を本文に付けて送る（ユーザーが文脈を追える）
    const fallbackQuoteToken = req.body?.line?.quoteToken;
    const fallbackRouteId = req.body?.line?.routeId;
    const fallbackSourceText = req.body?.line?.sourceText;
    const fallbackSourceSenderName = req.body?.line?.senderName;
    const fallbackSourceCreatedAt = req.body?.line?.createdAt;

    if (statusCode === 400 && fallbackQuoteToken && fallbackRouteId) {
      console.log(JSON.stringify({
        severity: "INFO",
        message: "Attempting fallback to pushMessage without quoteToken",
        to: fallbackRouteId,
      }));
      
      try {
        const client = getLineClient();
        const { text } = req.body;

        const sourceLines = [];
        if (fallbackSourceSenderName) sourceLines.push(`送信者: ${fallbackSourceSenderName}`);
        if (fallbackSourceCreatedAt) sourceLines.push(`時刻: ${fallbackSourceCreatedAt}`);
        if (fallbackSourceText) sourceLines.push(`元メッセージ: ${fallbackSourceText}`);

        const fallbackText =
          sourceLines.length > 0
            ? `${text}\n\n---\n（引用に失敗したため、元メッセージ情報を付与）\n${sourceLines.join("\n")}`
            : text;

        await client.pushMessage(fallbackRouteId, { type: "text", text: fallbackText });
        console.log(JSON.stringify({
          severity: "INFO",
          message: "LINE reply sent via pushMessage (fallback)",
          routeId: fallbackRouteId,
        }));
        return res.status(200).json({ status: "ok", message: "reply sent via pushMessage" });
      } catch (fallbackErr) {
        console.error(JSON.stringify({
          severity: "ERROR",
          message: "Fallback to pushMessage also failed",
          error: fallbackErr.message,
          statusCode: fallbackErr.response?.status || fallbackErr.statusCode,
        }));
        // フォールバックも失敗した場合は、元のエラーを返す
      }
    }
    
    // エラーの種類に応じて適切なHTTPステータスコードを返す
    const httpStatusCode = statusCode >= 400 && statusCode < 600 ? statusCode : 500;
    
    return res.status(httpStatusCode).json({ 
      error: "failed to send LINE reply", 
      details: err.message,
      lineApiError: lineApiError?.data,
      statusCode: statusCode,
    });
  }
});

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.listen(PORT, () => {
  console.log(JSON.stringify({ severity: "INFO", message: `kiosk-gateway listening on ${PORT}` }));
});
