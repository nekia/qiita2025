const crypto = require("crypto");
const express = require("express");
const { Firestore, Timestamp } = require("@google-cloud/firestore");

const app = express();
const PORT = Number(process.env.PORT || 8080);

const FIRESTORE_COLLECTION_EVENTS = "sb_events";
const FIRESTORE_COLLECTION_STATS = "sb_stats";
const FIRESTORE_COLLECTION_STATE = "sb_state";
const GLOBAL_STATE_DOC_ID = "global";

const LOOKBACK_DAYS = Number(process.env.LEARNING_LOOKBACK_DAYS || 30);
const ANOMALY_EXPECTED_THRESHOLD = Number(process.env.ANOMALY_EXPECTED_THRESHOLD || 0.7);
const ANOMALY_INACTIVE_HOURS = Number(process.env.ANOMALY_INACTIVE_HOURS || 2);

const SWITCHBOT_WEBHOOK_SECRET = process.env.SWITCHBOT_WEBHOOK_SECRET || "";
const SWITCHBOT_WEBHOOK_TOKEN = process.env.SWITCHBOT_WEBHOOK_TOKEN || "";
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const LINE_GROUP_ID = process.env.LINE_GROUP_ID || "";
const TZ = process.env.TIMEZONE || "Asia/Tokyo";
const SWITCHBOT_MAX_EVENT_AGE_SECONDS = Number(process.env.SWITCHBOT_MAX_EVENT_AGE_SECONDS || 600);
const SWITCHBOT_MAX_FUTURE_SKEW_SECONDS = Number(process.env.SWITCHBOT_MAX_FUTURE_SKEW_SECONDS || 30);
const ALLOWED_DEVICE_MACS = (process.env.SWITCHBOT_ALLOWED_DEVICE_MACS || "")
  .split(",")
  .map((v) => v.trim().toUpperCase())
  .filter(Boolean);
const ALLOWED_DEVICE_TYPES = (process.env.SWITCHBOT_ALLOWED_DEVICE_TYPES || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

let firestoreClient = null;
function firestore() {
  if (!firestoreClient) {
    firestoreClient = new Firestore({
      projectId: process.env.FIRESTORE_PROJECT_ID || undefined,
      databaseId: process.env.FIRESTORE_DATABASE_ID || "(default)",
    });
  }
  return firestoreClient;
}

app.use(
  express.json({
    type: "application/json",
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    },
  })
);

function nowInTz() {
  // Keep all scheduling decisions in one timezone to avoid drift.
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dayOfWeek: weekdayMap[map.weekday] ?? 0,
    hour: Number(map.hour),
    isoLocal: `${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}`,
  };
}

function parseEventTimestamp(payload) {
  const candidates = [
    payload?.eventTime,
    payload?.timeOfSample,
    payload?.timestamp,
    payload?.context?.timeOfSample,
    payload?.context?.time,
  ];

  for (const value of candidates) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return new Date();
}

function normalizeEpochMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  // SwitchBot samples are usually epoch ms; keep a safety fallback for seconds.
  return n < 1e12 ? n * 1000 : n;
}

function extractSampleTimestampMs(payload) {
  return (
    normalizeEpochMs(payload?.timeOfSample) ||
    normalizeEpochMs(payload?.context?.timeOfSample) ||
    normalizeEpochMs(payload?.timestamp)
  );
}

function validateReplayWindow(payload) {
  const sampleMs = extractSampleTimestampMs(payload);
  if (!sampleMs) {
    return { ok: false, reason: "missing_time_of_sample" };
  }

  const nowMs = Date.now();
  const ageMs = nowMs - sampleMs;
  const maxAgeMs = SWITCHBOT_MAX_EVENT_AGE_SECONDS * 1000;
  const maxFutureSkewMs = SWITCHBOT_MAX_FUTURE_SKEW_SECONDS * 1000;

  if (ageMs > maxAgeMs) {
    return { ok: false, reason: "event_too_old", age_ms: ageMs };
  }
  if (ageMs < -maxFutureSkewMs) {
    return { ok: false, reason: "event_from_future", age_ms: ageMs };
  }
  return { ok: true };
}

function computeIdempotencyKey(rawBody) {
  return crypto.createHash("sha256").update(rawBody || "").digest("hex");
}

function verifySwitchBotSignature(rawBody, receivedSign) {
  if (!SWITCHBOT_WEBHOOK_SECRET) {
    throw new Error("SWITCHBOT_WEBHOOK_SECRET is not configured");
  }
  if (!receivedSign) return false;

  const digest = crypto
    .createHmac("sha256", SWITCHBOT_WEBHOOK_SECRET)
    .update(rawBody || "")
    .digest("base64");

  const expected = Buffer.from(digest.trim());
  const actual = Buffer.from(String(receivedSign).trim());
  if (expected.length !== actual.length) return false;
  return crypto.timingSafeEqual(expected, actual);
}

function timingSafeEqualString(expected, actual) {
  const a = Buffer.from(String(expected || ""));
  const b = Buffer.from(String(actual || ""));
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function authorizeWebhookRequest(req) {
  const signature = req.get("X-Sign") || req.get("sign");
  if (signature) {
    return {
      ok: verifySwitchBotSignature(req.rawBody, signature),
      method: "signature",
      hasXSign: Boolean(req.get("X-Sign")),
      hasSign: Boolean(req.get("sign")),
    };
  }

  // Some SwitchBot webhook deliveries do not include signature headers.
  // In that case we can require a pre-shared token in webhook URL query.
  const queryToken = req.query?.token;
  if (SWITCHBOT_WEBHOOK_TOKEN) {
    return {
      ok: timingSafeEqualString(SWITCHBOT_WEBHOOK_TOKEN, queryToken),
      method: "query_token",
      hasXSign: false,
      hasSign: false,
    };
  }

  return {
    ok: false,
    method: "missing_auth",
    hasXSign: false,
    hasSign: false,
  };
}

function extractEventType(payload) {
  return payload?.eventType || payload?.event || payload?.context?.detectionState || "motion";
}

function extractDeviceId(payload) {
  return payload?.deviceMac || payload?.deviceId || payload?.context?.deviceMac || "unknown-device";
}

function extractDeviceType(payload) {
  return payload?.deviceType || payload?.context?.deviceType || "";
}

function isAllowedEvent(payload) {
  const macRaw = extractDeviceId(payload);
  const deviceMac = String(macRaw || "").toUpperCase();
  const deviceType = extractDeviceType(payload);

  const macAllowed = ALLOWED_DEVICE_MACS.length === 0 || ALLOWED_DEVICE_MACS.includes(deviceMac);
  const typeAllowed = ALLOWED_DEVICE_TYPES.length === 0 || ALLOWED_DEVICE_TYPES.includes(deviceType);

  return {
    allowed: macAllowed && typeAllowed,
    deviceMac,
    deviceType,
    reason: {
      macAllowed,
      typeAllowed,
    },
  };
}

async function callLinePush(messageText) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !LINE_GROUP_ID) {
    throw new Error("LINE settings are incomplete");
  }

  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    attempt += 1;
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LINE_CHANNEL_ACCESS_TOKEN}`,
      },
      body: JSON.stringify({
        to: LINE_GROUP_ID,
        messages: [{ type: "text", text: messageText }],
      }),
    });

    if (response.ok) return;
    if (response.status !== 429 || attempt >= maxAttempts) {
      const body = await response.text();
      throw new Error(`LINE push failed: ${response.status} ${body}`);
    }

    const retryAfterSec = Number(response.headers.get("retry-after") || "1");
    const waitMs = Number.isFinite(retryAfterSec) ? retryAfterSec * 1000 : 1000;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}

async function updateStateOnDetection(lastDetectedAt) {
  const stateRef = firestore().collection(FIRESTORE_COLLECTION_STATE).doc(GLOBAL_STATE_DOC_ID);
  await stateRef.set(
    {
      last_detected_at: Timestamp.fromDate(lastDetectedAt),
      current_mode: "NORMAL",
    },
    { merge: true }
  );
}

app.get("/healthz", (_req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/webhook/switchbot", async (req, res) => {
  try {
    const auth = authorizeWebhookRequest(req);
    if (!auth.ok) {
      console.warn(
        JSON.stringify({
          severity: "WARNING",
          message: "switchbot webhook authorization failed",
          auth_method: auth.method,
          has_x_sign: auth.hasXSign,
          has_sign: auth.hasSign,
          has_query_token: Boolean(req.query?.token),
          raw_body_length: (req.rawBody || "").length,
        })
      );
      return res.status(401).json({ error: "unauthorized webhook request" });
    }

    const payload = req.body || {};
    const replayCheck = validateReplayWindow(payload);
    if (!replayCheck.ok) {
      console.warn(
        JSON.stringify({
          severity: "WARNING",
          message: "switchbot webhook replay-window check failed",
          reason: replayCheck.reason,
          age_ms: replayCheck.age_ms,
        })
      );
      return res.status(401).json({ error: "stale or invalid event timestamp" });
    }

    const filterResult = isAllowedEvent(payload);
    if (!filterResult.allowed) {
      return res.status(202).json({
        status: "filtered_ignored",
        device_mac: filterResult.deviceMac,
        device_type: filterResult.deviceType,
        reason: filterResult.reason,
      });
    }

    const eventTimestamp = parseEventTimestamp(payload);
    const eventType = extractEventType(payload);
    const deviceId = extractDeviceId(payload);
    const idempotencyKey = computeIdempotencyKey(req.rawBody);

    const eventRef = firestore().collection(FIRESTORE_COLLECTION_EVENTS).doc(idempotencyKey);
    const stateRef = firestore().collection(FIRESTORE_COLLECTION_STATE).doc(GLOBAL_STATE_DOC_ID);

    const alreadyProcessed = await firestore().runTransaction(async (tx) => {
      const snap = await tx.get(eventRef);
      if (snap.exists) return true;

      tx.set(eventRef, {
        device_id: deviceId,
        timestamp: Timestamp.fromDate(eventTimestamp),
        event_type: eventType,
      });
      tx.set(
        stateRef,
        {
          last_detected_at: Timestamp.fromDate(eventTimestamp),
          current_mode: "NORMAL",
        },
        { merge: true }
      );
      return false;
    });

    if (alreadyProcessed) {
      return res.status(202).json({ status: "duplicate_ignored" });
    }
    return res.status(202).json({ status: "accepted" });
  } catch (error) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        message: "webhook processing failed",
        error: error.message,
      })
    );
    return res.status(500).json({ error: "internal error" });
  }
});

app.post("/jobs/learn", async (_req, res) => {
  try {
    const now = new Date();
    const from = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
    const snapshot = await firestore()
      .collection(FIRESTORE_COLLECTION_EVENTS)
      .where("timestamp", ">=", Timestamp.fromDate(from))
      .get();

    const dayKeys = [];
    for (let i = 0; i < LOOKBACK_DAYS; i += 1) {
      const d = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
      dayKeys.push(`${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`);
    }

    const dayMeta = new Map();
    for (const key of dayKeys) {
      const [year, month, date] = key.split("-").map(Number);
      const d = new Date(year, month - 1, date);
      dayMeta.set(key, { weekday: d.getDay(), activeHours: new Set() });
    }

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const ts = data.timestamp?.toDate?.();
      if (!ts) return;
      const key = `${ts.getFullYear()}-${ts.getMonth() + 1}-${ts.getDate()}`;
      if (!dayMeta.has(key)) return;
      dayMeta.get(key).activeHours.add(ts.getHours());
    });

    const weekdays = Array.from({ length: 7 }, () => ({ days: 0, hourHits: new Array(24).fill(0) }));
    dayMeta.forEach((meta) => {
      weekdays[meta.weekday].days += 1;
      meta.activeHours.forEach((hour) => {
        weekdays[meta.weekday].hourHits[hour] += 1;
      });
    });

    const batch = firestore().batch();
    for (let weekday = 0; weekday < 7; weekday += 1) {
      const totalDays = weekdays[weekday].days;
      const hourlyProbability = weekdays[weekday].hourHits.map((hits) => {
        if (totalDays === 0) return 0;
        return Number((hits / totalDays).toFixed(4));
      });

      const ref = firestore().collection(FIRESTORE_COLLECTION_STATS).doc(String(weekday));
      batch.set(
        ref,
        {
          hourly_probability: hourlyProbability,
        },
        { merge: true }
      );
    }
    await batch.commit();
    return res.status(200).json({ status: "ok", scanned_events: snapshot.size });
  } catch (error) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        message: "learning job failed",
        error: error.message,
      })
    );
    return res.status(500).json({ error: "learning failed" });
  }
});

app.post("/jobs/detect", async (_req, res) => {
  try {
    const { dayOfWeek, hour, isoLocal } = nowInTz();
    const stateRef = firestore().collection(FIRESTORE_COLLECTION_STATE).doc(GLOBAL_STATE_DOC_ID);
    const statsRef = firestore().collection(FIRESTORE_COLLECTION_STATS).doc(String(dayOfWeek));

    const [stateSnap, statsSnap] = await Promise.all([stateRef.get(), statsRef.get()]);
    const state = stateSnap.exists ? stateSnap.data() : {};
    const stats = statsSnap.exists ? statsSnap.data() : {};

    const expected = Number(stats?.hourly_probability?.[hour] || 0);
    const lastDetectedAt = state?.last_detected_at?.toDate?.() || null;
    const inactiveMs = lastDetectedAt ? Date.now() - lastDetectedAt.getTime() : Number.MAX_SAFE_INTEGER;
    const isInactiveLongEnough = inactiveMs >= ANOMALY_INACTIVE_HOURS * 60 * 60 * 1000;
    const shouldAlert = expected >= ANOMALY_EXPECTED_THRESHOLD && isInactiveLongEnough;
    const currentMode = state?.current_mode || "NORMAL";

    if (shouldAlert && currentMode !== "ALERT") {
      const inactiveHours = (inactiveMs / (60 * 60 * 1000)).toFixed(1);
      await callLinePush(
        `見守りアラート: 期待活動時間帯(${hour}時台, p=${expected})に ${inactiveHours} 時間検知がありません。(${isoLocal} ${TZ})`
      );
      await stateRef.set(
        {
          current_mode: "ALERT",
        },
        { merge: true }
      );
    } else if (!shouldAlert && currentMode !== "NORMAL") {
      await stateRef.set(
        {
          current_mode: "NORMAL",
        },
        { merge: true }
      );
    }

    return res.status(200).json({
      status: "ok",
      should_alert: shouldAlert,
      expected,
      current_mode_before: currentMode,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        message: "detection job failed",
        error: error.message,
      })
    );
    return res.status(500).json({ error: "detection failed" });
  }
});

// Manual endpoint for debugging state transitions in lower environments.
app.post("/jobs/mark-detected", async (_req, res) => {
  try {
    await updateStateOnDetection(new Date());
    return res.status(200).json({ status: "ok" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(JSON.stringify({ severity: "INFO", message: `monitoring-mother listening on ${PORT}` }));
});
