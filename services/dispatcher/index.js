const express = require("express");
const { Firestore, FieldValue, Timestamp } = require("@google-cloud/firestore");

const app = express();
const firestore = new Firestore({
  projectId: process.env.FIRESTORE_PROJECT_ID,
  databaseId: process.env.FIRESTORE_DATABASE_ID || "(default)",
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

  if (!payload.text) {
    payload.text = "(no text)";
  }

  const line = {};
  if (payload.groupId) line.groupId = payload.groupId;
  if (payload.messageId) line.messageId = payload.messageId;
  if (payload.senderName) line.senderName = payload.senderName;

  return { eventId, deviceId, type, payload, occurredAt, line };
}

function toTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  if (isNaN(date.getTime())) return null;
  return Timestamp.fromDate(date);
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

  try {
    await docRef.set(doc, { merge: true });
    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "event saved",
        eventId,
        deviceId,
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
