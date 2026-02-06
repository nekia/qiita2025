const express = require("express");
const http = require("http");
const https = require("https");
const { spawn } = require("child_process");
const { URL } = require("url");
const path = require("path");
const fs = require("fs/promises");
const { JWT } = require("google-auth-library");
const cors = require("cors");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ type: "application/json" }));
const PORT = process.env.PORT || 8080;
const TARGET_BASE = process.env.TARGET_BASE ||
 "https://<kiosk-gateway-url>";
const BEARER = process.env.PROXY_BEARER_TOKEN;
const KIOSK_SA_KEY_PATH = process.env.KIOSK_SA_KEY_PATH; // pi-kiosk-sa key (JSON)
const PHOTO_DIR = process.env.PHOTO_DIR || path.join(__dirname, "..", "..", "photos");
const PHOTO_BASE_PATH = "/local-photos";
const TOKEN_TTL_MS = Number(process.env.TOKEN_TTL_MS || 50 * 60 * 1000); // 50 minutes
const TOKEN_MARGIN_MS = Number(process.env.TOKEN_MARGIN_MS || 60 * 1000); // 1 minute
const TAPE_LIGHT_SCRIPT =
  process.env.SWITCHBOT_TAPE_LIGHT_SCRIPT ||
  path.join(__dirname, "..", "..", "switchbot_tape_light.sh");
const TAPE_LIGHT_DEVICE_ID = process.env.SWITCHBOT_TAPE_LIGHT_DEVICE_ID;
const TAPE_LIGHT_SHELL = process.env.SWITCHBOT_TAPE_LIGHT_SHELL || "bash";
const TAPE_LIGHT_BLINK_COUNT = Number(process.env.SWITCHBOT_TAPE_LIGHT_BLINK_COUNT || 3);
const TAPE_LIGHT_BLINK_INTERVAL_MS = Number(process.env.SWITCHBOT_TAPE_LIGHT_BLINK_INTERVAL_MS || 400);
const TAPE_LIGHT_COOLDOWN_MS = Number(process.env.SWITCHBOT_TAPE_LIGHT_COOLDOWN_MS || 3000);
const HISTORY_UNREAD_CUTOFF_MS = Number(process.env.HISTORY_UNREAD_CUTOFF_MS || 5 * 60 * 1000);

function safeUrl(base, path) {
  try {
    return new URL(path, base);
  } catch (err) {
    return null;
  }
}

const tokenCache = new Map(); // key: `${keyPath}::${audience}` => { token, exp }
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);
const unreadEventIds = new Set();
let blinkLoopRunning = false;
let tapeLightWarned = false;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseSinceToMs(value) {
  if (!value) return null;
  const num = Number(value);
  if (!Number.isNaN(num)) return num;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function isUnreadEvent(event) {
  if (!event) return false;
  if (event.status) return event.status !== "replied";
  return !event.reply;
}

function isNewEvent(event) {
  return event?.type === "line_message";
}

function ensureTapeLightConfigured() {
  if (TAPE_LIGHT_DEVICE_ID) return true;
  if (!tapeLightWarned) {
    console.warn(
      JSON.stringify({
        severity: "WARN",
        message: "tape light is disabled (SWITCHBOT_TAPE_LIGHT_DEVICE_ID not set)",
      })
    );
    tapeLightWarned = true;
  }
  return false;
}

async function runTapeLightBlink(reason, eventId) {
  if (!ensureTapeLightConfigured()) return;
  const args = [
    TAPE_LIGHT_SCRIPT,
    "blink",
    TAPE_LIGHT_DEVICE_ID,
    String(TAPE_LIGHT_BLINK_COUNT),
    String(TAPE_LIGHT_BLINK_INTERVAL_MS),
  ];

  await new Promise((resolve) => {
    const child = spawn(TAPE_LIGHT_SHELL, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (err) => {
      console.error(
        JSON.stringify({
          severity: "ERROR",
          message: "tape light blink failed to start",
          reason,
          eventId,
          error: err.message,
        })
      );
      resolve();
    });

    child.on("close", (code) => {
      if (code !== 0) {
        console.error(
          JSON.stringify({
            severity: "ERROR",
            message: "tape light blink failed",
            reason,
            eventId,
            exitCode: code,
            stdout: stdout.trim() || undefined,
            stderr: stderr.trim() || undefined,
          })
        );
      }
      resolve();
    });
  });
}

function enqueueTapeLightBlink(reason) {
  if (!ensureTapeLightConfigured()) return;
  if (blinkLoopRunning) return;
  blinkLoopRunning = true;
  (async () => {
    try {
      while (unreadEventIds.size > 0) {
        await runTapeLightBlink(reason);
        if (unreadEventIds.size === 0) break;
        await delay(TAPE_LIGHT_COOLDOWN_MS);
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          severity: "ERROR",
          message: "tape light blink loop failed",
          reason,
          error: err.message,
        })
      );
    } finally {
      blinkLoopRunning = false;
    }
  })();
}

function addUnreadEvent(eventId) {
  if (eventId) {
    unreadEventIds.add(eventId);
  } else {
    unreadEventIds.add(`unknown-${Date.now()}`);
  }
  enqueueTapeLightBlink("unread_message");
}

function resolveUnreadEvent(eventId) {
  if (!eventId) return;
  unreadEventIds.delete(eventId);
}

function createSseTapper(onEvent) {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.toString("utf8");
    buffer = buffer.replace(/\r\n/g, "\n");
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const lines = part.split("\n");
      let eventType = "message";
      const dataLines = [];
      for (const line of lines) {
        if (line.startsWith("event:")) {
          eventType = line.slice("event:".length).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice("data:".length).trim());
        }
      }
      if (eventType !== "kiosk_event" || dataLines.length === 0) continue;
      const dataStr = dataLines.join("\n");
      try {
        const event = JSON.parse(dataStr);
        onEvent?.(event);
      } catch (err) {
        console.error(
          JSON.stringify({
            severity: "ERROR",
            message: "failed to parse kiosk_event",
            error: err.message,
          })
        );
      }
    }
  };
}

function encodePathSegments(relativePath) {
  return relativePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
}

async function listImagesRecursive(currentDir, baseDir, results) {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      await listImagesRecursive(fullPath, baseDir, results);
      continue;
    }
    if (!entry.isFile()) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(ext)) continue;
    const stat = await fs.stat(fullPath);
    const relativePath = path
      .relative(baseDir, fullPath)
      .split(path.sep)
      .join("/");
    results.push({
      relativePath,
      mtimeMs: stat.mtimeMs,
    });
  }
}

async function getIdTokenCached(keyPath, audience) {
  if (!keyPath || !audience) return null;
  const cacheKey = `${keyPath}::${audience}`;
  const now = Date.now();
  const cached = tokenCache.get(cacheKey);
  if (cached && now < cached.exp - TOKEN_MARGIN_MS) {
    return cached.token;
  }
  try {
    const client = new JWT({ keyFile: keyPath });
    const token = await client.fetchIdToken(audience);
    tokenCache.set(cacheKey, { token, exp: now + TOKEN_TTL_MS });
    return token;
  } catch (err) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        message: "id token fetch failed",
        keyPath,
        audience,
        error: err.message,
      })
    );
    return null;
  }
}

app.get("/sse", async (req, res) => {
  const targetUrl = safeUrl(TARGET_BASE, "/sse");
  if (!targetUrl) {
    console.error(JSON.stringify({ severity: "ERROR", message: "invalid TARGET_BASE", value: TARGET_BASE }));
    return res.status(500).json({ error: "proxy not configured (TARGET_BASE invalid)" });
  }
  targetUrl.search = req.originalUrl.split("?")[1] || "";
  const connectionStartedAt = Date.now();
  const sinceMs = parseSinceToMs(req.query?.since);
  const isHistoryLoad =
    sinceMs !== null && sinceMs < connectionStartedAt - HISTORY_UNREAD_CUTOFF_MS;
  let historyUnreadNotified = false;

  const client = targetUrl.protocol === "https:" ? https : http;

  const headers = { Accept: "text/event-stream" };
  const kioskBearer =
    (await getIdTokenCached(KIOSK_SA_KEY_PATH, TARGET_BASE)) ||
    BEARER;
  if (kioskBearer) headers.Authorization = `Bearer ${kioskBearer}`;

  const upstreamReq = client.request(
    targetUrl,
    {
      method: "GET",
      headers,
    },
    (upstreamRes) => {
      const tapSse = createSseTapper((event) => {
        if (!isUnreadEvent(event)) return;
        const createdAtMs = parseSinceToMs(event.createdAt);
        const isHistoryEvent =
          isHistoryLoad &&
          createdAtMs !== null &&
          createdAtMs < connectionStartedAt - HISTORY_UNREAD_CUTOFF_MS;

        if (isHistoryEvent && historyUnreadNotified) {
          // history unread already noticed; still track for continuous blinking
          addUnreadEvent(event.id);
          return;
        }

        if (isHistoryEvent && !historyUnreadNotified) {
          historyUnreadNotified = true;
        }

        addUnreadEvent(event.id);
      });
      upstreamRes.on("data", tapSse);
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on("error", (err) => {
    console.error(JSON.stringify({ severity: "ERROR", message: "proxy error", error: err.message }));
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: "proxy failed" }));
  });

  req.on("close", () => upstreamReq.destroy());
  upstreamReq.end();
});

app.post("/api/line/reply", async (req, res) => {
  console.log(JSON.stringify({ severity: "INFO", message: "POST /api/line/reply received", body: req.body }));
  const repliedMessageId = req.body?.line?.messageId;
  if (repliedMessageId) {
    resolveUnreadEvent(repliedMessageId);
  }
  const targetUrl = safeUrl(TARGET_BASE, "/line/reply");
  if (!targetUrl) {
    console.error(JSON.stringify({ severity: "ERROR", message: "invalid TARGET_BASE", value: TARGET_BASE }));
    return res.status(500).json({ error: "proxy not configured (TARGET_BASE invalid)" });
  }

  console.log(JSON.stringify({ severity: "INFO", message: "Proxying to upstream", url: targetUrl.toString() }));

  const client = targetUrl.protocol === "https:" ? https : http;
  const kioskBearer =
    (await getIdTokenCached(KIOSK_SA_KEY_PATH, TARGET_BASE)) ||
    BEARER;
  const bodyStr = JSON.stringify(req.body || {});
  const headers = {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(bodyStr),
  };
  if (kioskBearer) headers.Authorization = `Bearer ${kioskBearer}`;

  const upstreamReq = client.request(
    targetUrl,
    {
      method: "POST",
      headers,
    },
    (upstreamRes) => {
      console.log(JSON.stringify({ 
        severity: "INFO", 
        message: "Upstream response", 
        statusCode: upstreamRes.statusCode,
        headers: upstreamRes.headers 
      }));
      res.writeHead(upstreamRes.statusCode || 500, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on("error", (err) => {
    console.error(JSON.stringify({ severity: "ERROR", message: "reply proxy error", error: err.message, stack: err.stack }));
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: "reply proxy failed", details: err.message }));
  });

  upstreamReq.write(bodyStr);
  upstreamReq.end();
});

app.get("/api/photos", async (req, res) => {
  try {
    const files = [];
    await listImagesRecursive(PHOTO_DIR, PHOTO_DIR, files);

    files.sort((a, b) => b.mtimeMs - a.mtimeMs);
    shuffleInPlace(files);

    const photos = files.map((file) => {
      const encodedPath = encodePathSegments(file.relativePath);
      return {
        url: `${PHOTO_BASE_PATH}/${encodedPath}`,
        title: path.basename(file.relativePath),
        owner: "local file",
      };
    });

    res.json(photos);
  } catch (err) {
    console.error(
      JSON.stringify({
        severity: "ERROR",
        message: "failed to list local photos",
        photoDir: PHOTO_DIR,
        error: err.message,
      })
    );
    res.status(500).json({ error: "failed_to_list_local_photos" });
  }
});

app.use(PHOTO_BASE_PATH, express.static(PHOTO_DIR));

app.use(express.static(path.join(__dirname, "..", "..", "web")));

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.listen(PORT, () => {
  console.log(JSON.stringify({ severity: "INFO", message: `local-proxy listening on ${PORT}`, target: TARGET_BASE }));
});
