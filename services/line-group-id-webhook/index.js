const express = require("express");
const { validateSignature } = require("@line/bot-sdk");

const app = express();

const PORT = Number(process.env.PORT || 8080);
const LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || "";
const SKIP_SIGNATURE_VALIDATION = process.env.SKIP_SIGNATURE_VALIDATION === "true";

function parseRawJsonBody(req) {
  const raw = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
  if (!raw) return {};
  return JSON.parse(raw);
}

function signatureMiddleware(req, res, next) {
  const signature = req.get("X-Line-Signature");

  if (!signature && !SKIP_SIGNATURE_VALIDATION) {
    return res.status(401).json({ error: "missing_signature" });
  }

  if (!SKIP_SIGNATURE_VALIDATION) {
    if (!LINE_CHANNEL_SECRET) {
      return res.status(500).json({ error: "missing_line_channel_secret" });
    }
    const isValid = validateSignature(req.body, LINE_CHANNEL_SECRET, signature);
    if (!isValid) {
      return res.status(401).json({ error: "invalid_signature" });
    }
  }

  try {
    req.lineBody = parseRawJsonBody(req);
    return next();
  } catch (error) {
    return res.status(400).json({ error: "invalid_json", details: error.message });
  }
}

app.get("/healthz", (_req, res) => {
  res.status(200).send("ok");
});

function logEvent(event) {
  const source = event?.source || {};
  const payload = {
    severity: "INFO",
    message: "line webhook received",
    event_type: event?.type || null,
    source_type: source?.type || null,
    group_id: source?.groupId || null,
    room_id: source?.roomId || null,
    user_id: source?.userId || null,
    timestamp: event?.timestamp || null,
    webhook_event_id: event?.webhookEventId || null,
  };
  console.log(JSON.stringify(payload));
}

function handleCallback(req, res) {
  const events = Array.isArray(req.lineBody?.events) ? req.lineBody.events : [];
  for (const event of events) logEvent(event);
  return res.status(200).json({ status: "ok", event_count: events.length });
}

app.post("/callback", express.raw({ type: "application/json" }), signatureMiddleware, handleCallback);
app.post("/webhook/line", express.raw({ type: "application/json" }), signatureMiddleware, handleCallback);

app.listen(PORT, () => {
  console.log(
    JSON.stringify({
      severity: "INFO",
      message: "line-group-id-webhook started",
      port: PORT,
      skip_signature_validation: SKIP_SIGNATURE_VALIDATION,
    })
  );
});
