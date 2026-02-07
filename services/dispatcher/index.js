const express = require("express");
const { Firestore, FieldValue, Timestamp } = require("@google-cloud/firestore");
const { GoogleGenAI } = require("@google/genai");

const app = express();
const firestore = new Firestore({
  projectId: process.env.FIRESTORE_PROJECT_ID,
  databaseId: process.env.FIRESTORE_DATABASE_ID || "(default)",
});

// Initialize Gemini AI client
const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

app.use(express.json({ type: "application/json" }));

const PORT = process.env.PORT || 8080;

/**
 * Decode and validate Pub/Sub push message.
 * Returns { eventId, deviceId, type, payload, occurredAt, line }
 */
function parsePubSubPush(body) {
  if (!body?.message?.data) {
    const err = new Error("missing message.data");
    err.status = 400;
    throw err;
  }

  let decoded;
  try {
    const json = Buffer.from(body.message.data, "base64").toString("utf8");
    decoded = JSON.parse(json);
  } catch (e) {
    const err = new Error("invalid base64 JSON");
    err.status = 400;
    throw err;
  }


  const eventId = decoded.eventId;
  const deviceId = decoded.deviceId;
  const type = decoded.type;
  const occurredAt = decoded.occurredAt;
  const payload = decoded.payload || {};

  if (!eventId || !deviceId || !type) {
    const err = new Error("eventId, deviceId, type are required");
    err.status = 400;
    throw err;
  }

  const hasImage = Boolean(payload.imageUrl || payload?.image?.url);
  if (!payload.text && !hasImage) {
    payload.text = "(no text)";
  }

  const line = {};
  if (payload.groupId) line.groupId = payload.groupId;
  if (payload.roomId) line.roomId = payload.roomId;
  if (payload.userId) line.userId = payload.userId;
  if (payload.messageId) line.messageId = payload.messageId;
  if (payload.quoteToken) line.quoteToken = payload.quoteToken;
  if (payload.routeId) line.routeId = payload.routeId;
  if (payload.sourceType) line.sourceType = payload.sourceType;
  if (payload.senderName) line.senderName = payload.senderName;

  return { eventId, deviceId, type, payload, occurredAt, line };
}

function toTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
}

/**
 * Generate binary choice response using Gemini API
 * @param {string} message - The input message
 * @returns {Promise<{choice1: string, choice2: string, reasoning: string}>}
 */
async function generateBinaryChoice(message) {
  try {
    const prompt = `以下のメッセージに対して、適切な2択の回答を生成してください。
メッセージ: "${message}"

以下のJSON形式で回答してください:
{
  "choice1": "選択肢1の内容",
  "choice2": "選択肢2の内容",
  "reasoning": "この2択を提案する理由"
}

2択は互いに対照的で、明確な違いがあるようにしてください。`;

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: prompt,
    });

    const text = response.text.trim();
    
    // Extract JSON from markdown code block if present
    const jsonMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/) || text.match(/\{[\s\S]*\}/);
    const jsonText = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;
    
    const parsed = JSON.parse(jsonText);
    
    return {
      choice1: parsed.choice1 || "選択肢1",
      choice2: parsed.choice2 || "選択肢2",
      reasoning: parsed.reasoning || "理由なし",
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        message: "Gemini API call failed",
        error: err.message,
      })
    );
    // Return default choices if API fails
    return {
      choice1: "はい",
      choice2: "いいえ",
      reasoning: "API呼び出しに失敗したため、デフォルトの選択肢を返します",
    };
  }
}

app.post("/pubsub/push", async (req, res) => {
  let parsed;
  try {
    parsed = parsePubSubPush(req.body);
  } catch (err) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        message: err.message,
        requestId: req.get("X-Cloud-Trace-Context") || undefined,
      })
    );
    return res.status(err.status || 400).json({ error: err.message });
  }

  const { eventId, deviceId, type, payload, occurredAt, line } = parsed;
  const docRef = firestore.doc(`devices/${deviceId}/events/${eventId}`);

  const isImageMessage =
    payload.messageType === "image" || payload.imageUrl || payload?.image?.url;

  // Generate binary choice using Gemini API (skip for image-only messages)
  const binaryChoice = isImageMessage ? null : await generateBinaryChoice(payload.text);

  const doc = {
    eventId,
    deviceId,
    type,
    status: "new",
    payload,
    source: "line",
    line,
    occurredAt: toTimestamp(occurredAt),
    createdAt: FieldValue.serverTimestamp(),
  };
  if (binaryChoice) {
    doc.gemini = {
      choice1: binaryChoice.choice1,
      choice2: binaryChoice.choice2,
      reasoning: binaryChoice.reasoning,
      generatedAt: FieldValue.serverTimestamp(),
    };
  }

  try {
    await docRef.set(doc, { merge: true });
    console.log(
      JSON.stringify({
        severity: "INFO",
        message: binaryChoice ? "event saved with Gemini choices" : "event saved",
        eventId,
        deviceId,
        choice1: binaryChoice?.choice1,
        choice2: binaryChoice?.choice2,
      })
    );
    return res.status(204).send();
  } catch (err) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        message: "firestore write failed",
        error: err.message,
        eventId,
        deviceId,
      })
    );
    return res.status(500).json({ error: "failed to write firestore" });
  }
});

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.listen(PORT, () => {
  console.log(JSON.stringify({ severity: "INFO", message: `dispatcher listening on ${PORT}` }));
});
