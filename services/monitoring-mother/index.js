const crypto = require("crypto");
const express = require("express");
const { Firestore, Timestamp } = require("@google-cloud/firestore");

const app = express();
const PORT = Number(process.env.PORT || 8080);

const FIRESTORE_COLLECTION_EVENTS = "sb_events";
const FIRESTORE_COLLECTION_STATS = "sb_stats";
const FIRESTORE_COLLECTION_STATE = "sb_state";

const LOOKBACK_DAYS = Number(process.env.LEARNING_LOOKBACK_DAYS || 30);
const ANOMALY_EXPECTED_THRESHOLD = Number(process.env.ANOMALY_EXPECTED_THRESHOLD || 0.7);
const ANOMALY_INACTIVE_HOURS = Number(process.env.ANOMALY_INACTIVE_HOURS || 2);

const SWITCHBOT_WEBHOOK_SECRET = process.env.SWITCHBOT_WEBHOOK_SECRET || "";
const SWITCHBOT_WEBHOOK_TOKEN = process.env.SWITCHBOT_WEBHOOK_TOKEN || "";
const LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || "";
const LINE_GROUP_ID = process.env.LINE_GROUP_ID || "";
const LINE_GROUP_ID_MAP_RAW = process.env.LINE_GROUP_ID_MAP || "";
const SWITCHBOT_SITE_MAP_RAW = process.env.SWITCHBOT_SITE_MAP || "";
const SITE_LABEL_MAP_RAW = process.env.SITE_LABEL_MAP || "MOTHER_HOME:高輪,WIFE_MOTHER_HOME:東郷";
const TZ = process.env.TIMEZONE || "Asia/Tokyo";
const LOG_WEBHOOK_PAYLOAD = process.env.LOG_WEBHOOK_PAYLOAD === "true";
const DAILY_SUMMARY_LOOKBACK_HOURS = Number(process.env.DAILY_SUMMARY_LOOKBACK_HOURS || 48);
const ENABLE_TEST_ENDPOINTS = process.env.ENABLE_TEST_ENDPOINTS === "true";
const SWITCHBOT_MAX_EVENT_AGE_SECONDS = Number(process.env.SWITCHBOT_MAX_EVENT_AGE_SECONDS || 600);
const SWITCHBOT_MAX_FUTURE_SKEW_SECONDS = Number(process.env.SWITCHBOT_MAX_FUTURE_SKEW_SECONDS || 30);
const STORE_NOT_DETECTED_EVENTS = process.env.STORE_NOT_DETECTED_EVENTS === "true";
const ALLOWED_DEVICE_MACS = (process.env.SWITCHBOT_ALLOWED_DEVICE_MACS || "")
  .split(",")
  .map((v) => v.trim().toUpperCase())
  .filter(Boolean);
const ALLOWED_DEVICE_TYPES = (process.env.SWITCHBOT_ALLOWED_DEVICE_TYPES || "")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

function parseKeyValueMap(raw) {
  const map = {};
  String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach((entry) => {
      const idx = entry.indexOf(":");
      if (idx <= 0) return;
      const key = entry.slice(0, idx).trim().toUpperCase();
      const value = entry.slice(idx + 1).trim();
      if (key && value) map[key] = value;
    });
  return map;
}

const LINE_GROUP_ID_MAP = parseKeyValueMap(LINE_GROUP_ID_MAP_RAW);
const SWITCHBOT_SITE_MAP = parseKeyValueMap(SWITCHBOT_SITE_MAP_RAW);
const SITE_LABEL_MAP = parseKeyValueMap(SITE_LABEL_MAP_RAW);

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

function getTzDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
    dateKey: `${map.year}-${map.month}-${map.day}`,
    timeText: `${map.hour}:${map.minute}`,
  };
}

function parseEventTimestamp(payload) {
  const normalizedSampleMs = extractSampleTimestampMs(payload);
  if (normalizedSampleMs) {
    return new Date(normalizedSampleMs);
  }

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

function toDocSafeKey(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 120);
}

function resolveSiteKey(deviceId) {
  const normalized = String(deviceId || "").toUpperCase();
  const mapped = SWITCHBOT_SITE_MAP[normalized];
  return toDocSafeKey(mapped || normalized || "unknown-site");
}

function buildStateDocId(siteKey) {
  return `site__${toDocSafeKey(siteKey)}`;
}

function buildStatsDocId(siteKey, weekday) {
  return `${toDocSafeKey(siteKey)}__${weekday}`;
}

function resolveLineTarget(siteKey, deviceId) {
  const siteUpper = String(siteKey || "").toUpperCase();
  const deviceUpper = String(deviceId || "").toUpperCase();
  return LINE_GROUP_ID_MAP[siteUpper] || LINE_GROUP_ID_MAP[deviceUpper] || LINE_GROUP_ID || "";
}

function resolveEventSiteId(eventData) {
  if (eventData?.site_id) return toDocSafeKey(eventData.site_id);
  return resolveSiteKey(eventData?.device_id);
}

function resolveSiteLabel(siteKey) {
  const key = String(siteKey || "").toUpperCase();
  return SITE_LABEL_MAP[key] || siteKey;
}

function formatLocalDateTimeNoTz(date) {
  if (!date) return "不明";
  const p = getTzDateParts(date);
  return `${p.month}/${p.day} ${p.timeText}`;
}

function buildWebhookEventSummary(payload) {
  const context = payload?.context || {};
  return {
    event_type: payload?.eventType || null,
    event_version: payload?.eventVersion || null,
    device_type: extractDeviceType(payload) || null,
    device_mac: extractDeviceId(payload) || null,
    detection_state: context?.detectionState || null,
    open_state: context?.openState || null,
    power_state: context?.powerState || null,
    time_of_sample: context?.timeOfSample || payload?.timeOfSample || null,
  };
}

function isNotDetectedEvent(payload) {
  const detectionState = String(payload?.context?.detectionState || payload?.detectionState || "").toUpperCase();
  return detectionState === "NOT_DETECTED";
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

async function callLinePush(messageText, targetId = LINE_GROUP_ID) {
  return callLinePushMessages([{ type: "text", text: messageText }], targetId);
}

async function callLinePushMessages(messages, targetId = LINE_GROUP_ID) {
  if (!LINE_CHANNEL_ACCESS_TOKEN || !targetId) {
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
        to: targetId,
        messages,
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

function buildHourlyChartUrl(hourlyCounts, prevDayHourlyCounts, titleDateKey) {
  const labels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}h`);
  const chartConfig = {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "センサー検出回数",
          data: hourlyCounts,
          backgroundColor: "rgba(54, 162, 235, 0.75)",
          borderColor: "rgba(54, 162, 235, 1)",
          borderWidth: 1,
        },
        {
          label: "前日",
          type: "line",
          data: prevDayHourlyCounts,
          borderColor: "rgba(120, 120, 120, 0.95)",
          backgroundColor: "rgba(120, 120, 120, 0.15)",
          borderWidth: 3,
          pointRadius: 2,
          tension: 0.2,
          fill: false,
        },
      ],
    },
    options: {
      plugins: {
        title: {
          display: true,
          text: `日次センサー検出サマリ (${titleDateKey})`,
          font: {
            size: 26,
          },
        },
        legend: {
          display: true,
          labels: {
            font: {
              size: 18,
            },
          },
        },
      },
      scales: {
        x: {
          ticks: {
            font: {
              size: 16,
            },
          },
          title: {
            display: true,
            text: "時刻",
            font: {
              size: 18,
            },
          },
        },
        y: {
          beginAtZero: true,
          ticks: {
            precision: 0,
            font: {
              size: 16,
            },
          },
          title: {
            display: true,
            text: "検出回数",
            font: {
              size: 18,
            },
          },
        },
      },
    },
  };
  return `https://quickchart.io/chart?width=1100&height=620&format=png&backgroundColor=white&c=${encodeURIComponent(JSON.stringify(chartConfig))}`;
}

function summarizeDailyActivity(dayEvents, targetDateKey, siteKey) {
  const hourlyCounts = new Array(24).fill(0);
  const points = [];

  dayEvents.forEach((event) => {
    if (resolveEventSiteId(event) !== siteKey) return;
    const ts = event.timestamp?.toDate?.();
    if (!ts) return;
    const p = getTzDateParts(ts);
    if (p.dateKey !== targetDateKey) return;
    const hour = Number(p.hour);
    hourlyCounts[hour] += 1;
    points.push({ ts, hour, timeText: p.timeText });
  });

  points.sort((a, b) => a.ts.getTime() - b.ts.getTime());
  const totalDetections = hourlyCounts.reduce((sum, v) => sum + v, 0);

  const morning = points.find((p) => p.hour >= 4 && p.hour <= 11);
  const nightCandidates = points.filter((p) => p.hour >= 20 || p.hour <= 3);
  const bedtime = nightCandidates.length ? nightCandidates[nightCandidates.length - 1] : null;

  return {
    hourlyCounts,
    totalDetections,
    wakeupTime: morning?.timeText || "N/A",
    bedtimeTime: bedtime?.timeText || "N/A",
  };
}

function getPreviousDateKeyFromTzDateKey(dateKey) {
  const [year, month, day] = String(dateKey).split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const prev = new Date(dt.getTime() - 24 * 60 * 60 * 1000);
  return getTzDateParts(prev).dateKey;
}

async function listTargetSites() {
  const stateSnap = await firestore().collection(FIRESTORE_COLLECTION_STATE).get();
  const stateSites = stateSnap.docs
    .map((d) => d.data()?.site_id || d.id?.replace(/^site__/, ""))
    .filter(Boolean);
  if (stateSites.length > 0) return Array.from(new Set(stateSites.map((s) => toDocSafeKey(s))));

  const from = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const eventsSnap = await firestore()
    .collection(FIRESTORE_COLLECTION_EVENTS)
    .where("timestamp", ">=", Timestamp.fromDate(from))
    .get();
  const eventSites = eventsSnap.docs.map((d) => resolveEventSiteId(d.data())).filter(Boolean);
  return Array.from(new Set(eventSites));
}

async function updateStateOnDetection(siteKey, lastDetectedAt) {
  const stateRef = firestore().collection(FIRESTORE_COLLECTION_STATE).doc(buildStateDocId(siteKey));
  await stateRef.set(
    {
      site_id: siteKey,
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
    const payload = req.body || {};
    const eventSummary = buildWebhookEventSummary(payload);
    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "switchbot webhook received",
        has_x_sign: Boolean(req.get("X-Sign")),
        has_sign: Boolean(req.get("sign")),
        has_query_token: Boolean(req.query?.token),
        raw_body_length: (req.rawBody || "").length,
        event: eventSummary,
      })
    );
    if (LOG_WEBHOOK_PAYLOAD) {
      console.log(
        JSON.stringify({
          severity: "INFO",
          message: "switchbot webhook payload",
          payload,
        })
      );
    }

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
      console.log(
        JSON.stringify({
          severity: "INFO",
          message: "switchbot webhook filtered",
          event: eventSummary,
          reason: filterResult.reason,
        })
      );
      return res.status(202).json({
        status: "filtered_ignored",
        device_mac: filterResult.deviceMac,
        device_type: filterResult.deviceType,
        reason: filterResult.reason,
      });
    }

    if (!STORE_NOT_DETECTED_EVENTS && isNotDetectedEvent(payload)) {
      console.log(
        JSON.stringify({
          severity: "INFO",
          message: "switchbot webhook not_detected ignored",
          event: eventSummary,
        })
      );
      return res.status(202).json({ status: "not_detected_ignored" });
    }

    const eventTimestamp = parseEventTimestamp(payload);
    const eventType = extractEventType(payload);
    const deviceId = extractDeviceId(payload);
    const siteKey = resolveSiteKey(deviceId);
    const idempotencyKey = computeIdempotencyKey(req.rawBody);

    const eventRef = firestore().collection(FIRESTORE_COLLECTION_EVENTS).doc(idempotencyKey);
    const stateRef = firestore().collection(FIRESTORE_COLLECTION_STATE).doc(buildStateDocId(siteKey));

    const alreadyProcessed = await firestore().runTransaction(async (tx) => {
      const snap = await tx.get(eventRef);
      if (snap.exists) return true;

      tx.set(eventRef, {
        device_id: deviceId,
        site_id: siteKey,
        timestamp: Timestamp.fromDate(eventTimestamp),
        event_type: eventType,
      });
      tx.set(
        stateRef,
        {
          site_id: siteKey,
          device_id: deviceId,
          last_detected_at: Timestamp.fromDate(eventTimestamp),
          current_mode: "NORMAL",
        },
        { merge: true }
      );
      return false;
    });

    if (alreadyProcessed) {
      console.log(
        JSON.stringify({
          severity: "INFO",
          message: "switchbot webhook duplicate ignored",
          event: eventSummary,
          idempotency_key: idempotencyKey,
        })
      );
      return res.status(202).json({ status: "duplicate_ignored" });
    }
    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "switchbot webhook accepted and stored",
        event: eventSummary,
        idempotency_key: idempotencyKey,
      })
    );
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
    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "learning job started",
        lookback_days: LOOKBACK_DAYS,
        from_iso: from.toISOString(),
        now_iso: now.toISOString(),
      })
    );
    const snapshot = await firestore()
      .collection(FIRESTORE_COLLECTION_EVENTS)
      .where("timestamp", ">=", Timestamp.fromDate(from))
      .get();
    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "learning job scanned events",
        scanned_events: snapshot.size,
      })
    );

    const dayKeys = [];
    for (let i = 0; i < LOOKBACK_DAYS; i += 1) {
      const d = new Date(from.getTime() + i * 24 * 60 * 60 * 1000);
      dayKeys.push(getTzDateParts(d).dateKey);
    }

    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const siteDayMeta = new Map(); // site -> Map(dateKey, { weekday, activeHours })
    const ensureSiteMeta = (siteId) => {
      if (!siteDayMeta.has(siteId)) {
        const m = new Map();
        for (const key of dayKeys) {
          const [year, month, day] = key.split("-").map(Number);
          const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
          const wkText = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short" }).format(date);
          m.set(key, { weekday: weekdayMap[wkText], activeHours: new Set() });
        }
        siteDayMeta.set(siteId, m);
      }
      return siteDayMeta.get(siteId);
    };

    snapshot.docs.forEach((doc) => {
      const data = doc.data();
      const ts = data.timestamp?.toDate?.();
      if (!ts) return;
      const siteId = resolveEventSiteId(data);
      const dateKey = getTzDateParts(ts).dateKey;
      const hour = Number(getTzDateParts(ts).hour);
      const siteMeta = ensureSiteMeta(siteId);
      if (!siteMeta.has(dateKey)) return;
      siteMeta.get(dateKey).activeHours.add(hour);
    });

    const batch = firestore().batch();
    const siteSummaries = [];
    for (const [siteId, dayMeta] of siteDayMeta.entries()) {
      const weekdays = Array.from({ length: 7 }, () => ({ days: 0, hourHits: new Array(24).fill(0) }));
      dayMeta.forEach((meta) => {
        weekdays[meta.weekday].days += 1;
        meta.activeHours.forEach((hour) => {
          weekdays[meta.weekday].hourHits[hour] += 1;
        });
      });

      for (let weekday = 0; weekday < 7; weekday += 1) {
        const totalDays = weekdays[weekday].days;
        const hourlyProbability = weekdays[weekday].hourHits.map((hits) => {
          if (totalDays === 0) return 0;
          return Number((hits / totalDays).toFixed(4));
        });

        const ref = firestore().collection(FIRESTORE_COLLECTION_STATS).doc(buildStatsDocId(siteId, weekday));
        batch.set(
          ref,
          {
            site_id: siteId,
            day_of_week: weekday,
            hourly_probability: hourlyProbability,
          },
          { merge: true }
        );
        siteSummaries.push({
          site_id: siteId,
          weekday,
          total_days: totalDays,
          active_hours_count: weekdays[weekday].hourHits.filter((h) => h > 0).length,
          total_hour_hits: weekdays[weekday].hourHits.reduce((sum, h) => sum + h, 0),
        });
      }
    }

    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "learning job site summary",
        site_summary_count: siteSummaries.length,
        site_summaries: siteSummaries,
      })
    );

    await batch.commit();
    return res.status(200).json({
      status: "ok",
      scanned_events: snapshot.size,
      site_summary_count: siteSummaries.length,
      site_summaries: siteSummaries,
    });
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
    const { dayOfWeek, hour } = nowInTz();
    const siteKeys = await listTargetSites();
    const results = [];

    for (const siteKey of siteKeys) {
      const stateRef = firestore().collection(FIRESTORE_COLLECTION_STATE).doc(buildStateDocId(siteKey));
      const statsRef = firestore().collection(FIRESTORE_COLLECTION_STATS).doc(buildStatsDocId(siteKey, dayOfWeek));
      const [stateSnap, statsSnap] = await Promise.all([stateRef.get(), statsRef.get()]);
      const state = stateSnap.exists ? stateSnap.data() : {};
      const stats = statsSnap.exists ? statsSnap.data() : {};

      const expected = Number(stats?.hourly_probability?.[hour] || 0);
      const lastDetectedAt = state?.last_detected_at?.toDate?.() || null;
      const inactiveMs = lastDetectedAt ? Date.now() - lastDetectedAt.getTime() : Number.MAX_SAFE_INTEGER;
      const isInactiveLongEnough = inactiveMs >= ANOMALY_INACTIVE_HOURS * 60 * 60 * 1000;
      const shouldAlert = expected >= ANOMALY_EXPECTED_THRESHOLD && isInactiveLongEnough;
      const currentMode = state?.current_mode || "NORMAL";
      const lineTarget = resolveLineTarget(siteKey, state?.device_id);

      if (shouldAlert && currentMode !== "ALERT") {
        const inactiveHours = (inactiveMs / (60 * 60 * 1000)).toFixed(1);
        const siteLabel = resolveSiteLabel(siteKey);
        const lastDetectedText = formatLocalDateTimeNoTz(lastDetectedAt);
        await callLinePush(
          `${siteLabel}：${lastDetectedText}から${inactiveHours}時間以上動きが検知されていません`,
          lineTarget
        );
        await stateRef.set(
          {
            site_id: siteKey,
            current_mode: "ALERT",
          },
          { merge: true }
        );
      } else if (!shouldAlert && currentMode !== "NORMAL") {
        await stateRef.set(
          {
            site_id: siteKey,
            current_mode: "NORMAL",
          },
          { merge: true }
        );
      }

      results.push({
        site_id: siteKey,
        should_alert: shouldAlert,
        expected,
        current_mode_before: currentMode,
      });
    }

    return res.status(200).json({
      status: "ok",
      sites_checked: siteKeys.length,
      results,
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

app.post("/jobs/daily-summary", async (_req, res) => {
  try {
    const now = new Date();
    const targetDateKey = getTzDateParts(now).dateKey;
    const from = new Date(now.getTime() - DAILY_SUMMARY_LOOKBACK_HOURS * 60 * 60 * 1000);

    const snapshot = await firestore()
      .collection(FIRESTORE_COLLECTION_EVENTS)
      .where("timestamp", ">=", Timestamp.fromDate(from))
      .get();

    const events = snapshot.docs.map((d) => d.data());
    const siteKeys = Array.from(new Set(events.map((e) => resolveEventSiteId(e)).filter(Boolean)));
    const sent = [];

    for (const siteKey of siteKeys) {
      const daySummary = summarizeDailyActivity(events, targetDateKey, siteKey);
      const prevDateKey = getPreviousDateKeyFromTzDateKey(targetDateKey);
      const prevDaySummary = summarizeDailyActivity(events, prevDateKey, siteKey);
      const chartUrl = buildHourlyChartUrl(daySummary.hourlyCounts, prevDaySummary.hourlyCounts, `${targetDateKey} ${siteKey}`);
      const text = [
        `日次見守りサマリ (${siteKey})`,
        `日付: ${targetDateKey} (${TZ})`,
        `検知件数: ${daySummary.totalDetections}`,
        `前日検知件数: ${prevDaySummary.totalDetections}`,
        `起床推定: ${daySummary.wakeupTime}`,
        `就寝推定: ${daySummary.bedtimeTime}`,
      ].join("\n");

      const lineTarget = resolveLineTarget(siteKey);
      await callLinePushMessages(
        [
          { type: "text", text },
          {
            type: "image",
            originalContentUrl: chartUrl,
            previewImageUrl: chartUrl,
          },
        ],
        lineTarget
      );
      sent.push({
        site_id: siteKey,
        detections: daySummary.totalDetections,
        wakeup_time: daySummary.wakeupTime,
        bedtime_time: daySummary.bedtimeTime,
        chart_url: chartUrl,
      });
    }

    console.log(
      JSON.stringify({
        severity: "INFO",
        message: "daily summary sent",
        target_date: targetDateKey,
        sent_count: sent.length,
      })
    );

    return res.status(200).json({
      status: "ok",
      target_date: targetDateKey,
      sent_count: sent.length,
      sent,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        message: "daily summary job failed",
        error: error.message,
      })
    );
    return res.status(500).json({ error: "daily summary failed" });
  }
});

// Manual endpoint for debugging state transitions in lower environments.
app.post("/jobs/mark-detected", async (_req, res) => {
  try {
    const siteKey = toDocSafeKey(_req.query?.site_id || "manual");
    await updateStateOnDetection(siteKey, new Date());
    return res.status(200).json({ status: "ok" });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/test/seed-anomaly", async (req, res) => {
  if (!ENABLE_TEST_ENDPOINTS) {
    return res.status(404).json({ error: "not found" });
  }
  try {
    const now = new Date();
    const nowTz = nowInTz();
    const siteId = toDocSafeKey(req.body?.site_id || req.query?.site_id);
    if (!siteId) {
      return res.status(400).json({ error: "site_id is required" });
    }
    const weekday = Number.isFinite(Number(req.body?.weekday)) ? Number(req.body.weekday) : nowTz.dayOfWeek;
    const hour = Number.isFinite(Number(req.body?.hour)) ? Number(req.body.hour) : nowTz.hour;
    const expected = Number.isFinite(Number(req.body?.expected)) ? Number(req.body.expected) : 1;
    const inactiveHours = Number.isFinite(Number(req.body?.inactive_hours))
      ? Number(req.body.inactive_hours)
      : ANOMALY_INACTIVE_HOURS + 1;

    const statsRef = firestore().collection(FIRESTORE_COLLECTION_STATS).doc(buildStatsDocId(siteId, weekday));
    const stateRef = firestore().collection(FIRESTORE_COLLECTION_STATE).doc(buildStateDocId(siteId));

    const statsSnap = await statsRef.get();
    const current = statsSnap.exists ? statsSnap.data()?.hourly_probability : null;
    const hourly = Array.isArray(current) && current.length === 24 ? [...current] : new Array(24).fill(0);
    hourly[hour] = expected;

    await Promise.all([
      statsRef.set(
        {
          site_id: siteId,
          day_of_week: weekday,
          hourly_probability: hourly,
        },
        { merge: true }
      ),
      stateRef.set(
        {
          site_id: siteId,
          current_mode: "NORMAL",
          last_detected_at: Timestamp.fromDate(new Date(now.getTime() - inactiveHours * 60 * 60 * 1000)),
        },
        { merge: true }
      ),
    ]);

    return res.status(200).json({
      status: "ok",
      site_id: siteId,
      weekday,
      hour,
      expected,
      inactive_hours: inactiveHours,
      next_step: "POST /jobs/detect",
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/test/reset-site", async (req, res) => {
  if (!ENABLE_TEST_ENDPOINTS) {
    return res.status(404).json({ error: "not found" });
  }
  try {
    const siteId = toDocSafeKey(req.body?.site_id || req.query?.site_id);
    if (!siteId) {
      return res.status(400).json({ error: "site_id is required" });
    }
    const stateRef = firestore().collection(FIRESTORE_COLLECTION_STATE).doc(buildStateDocId(siteId));
    await stateRef.set(
      {
        site_id: siteId,
        current_mode: "NORMAL",
        last_detected_at: Timestamp.fromDate(new Date()),
      },
      { merge: true }
    );
    return res.status(200).json({ status: "ok", site_id: siteId });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(JSON.stringify({ severity: "INFO", message: `monitoring-mother listening on ${PORT}` }));
});
