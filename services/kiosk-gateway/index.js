const express = require("express");
const { Firestore, Timestamp } = require("@google-cloud/firestore");

const app = express();
const firestore = new Firestore({
  projectId: process.env.FIRESTORE_PROJECT_ID,
  databaseId: process.env.FIRESTORE_DATABASE_ID || "(default)",
});

const PORT = process.env.PORT || 8080;
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 2000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.HEARTBEAT_INTERVAL_MS || 20000);
const RECENT_LIMIT = Number(process.env.RECENT_LIMIT || 20);

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

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.listen(PORT, () => {
  console.log(JSON.stringify({ severity: "INFO", message: `kiosk-gateway listening on ${PORT}` }));
});
