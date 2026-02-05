const express = require("express");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const path = require("path");
const fs = require("fs/promises");
const { JWT } = require("google-auth-library");
const cors = require("cors");

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ type: "application/json" }));
const PORT = process.env.PORT || 8080;
const TARGET_BASE = process.env.TARGET_BASE || "https://<kiosk-gateway-url>";
const BEARER = process.env.PROXY_BEARER_TOKEN;
const KIOSK_SA_KEY_PATH = process.env.KIOSK_SA_KEY_PATH; // pi-kiosk-sa key (JSON)
const PHOTO_DIR = process.env.PHOTO_DIR || path.join(__dirname, "..", "..", "photos");
const PHOTO_BASE_PATH = "/local-photos";
const TOKEN_TTL_MS = Number(process.env.TOKEN_TTL_MS || 50 * 60 * 1000); // 50 minutes
const TOKEN_MARGIN_MS = Number(process.env.TOKEN_MARGIN_MS || 60 * 1000); // 1 minute

function safeUrl(base, path) {
  try {
    return new URL(path, base);
  } catch (err) {
    return null;
  }
}

const tokenCache = new Map(); // key: `${keyPath}::${audience}` => { token, exp }
const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

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
