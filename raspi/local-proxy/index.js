const express = require("express");
const http = require("http");
const https = require("https");
const { URL } = require("url");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;
const TARGET_BASE = process.env.TARGET_BASE || "https://<kiosk-gateway-url>";
const PHOTO_API_BASE = process.env.PHOTO_API_BASE || "https://<photo-api-url>";
const BEARER = process.env.PROXY_BEARER_TOKEN;
const PHOTO_BEARER = process.env.PROXY_PHOTO_BEARER_TOKEN || BEARER;

function safeUrl(base, path) {
  try {
    return new URL(path, base);
  } catch (err) {
    return null;
  }
}

app.get("/sse", (req, res) => {
  const targetUrl = safeUrl(TARGET_BASE, "/sse");
  if (!targetUrl) {
    console.error(JSON.stringify({ severity: "ERROR", message: "invalid TARGET_BASE", value: TARGET_BASE }));
    return res.status(500).json({ error: "proxy not configured (TARGET_BASE invalid)" });
  }
  targetUrl.search = req.originalUrl.split("?")[1] || "";

  const client = targetUrl.protocol === "https:" ? https : http;

  const headers = {
    Accept: "text/event-stream",
  };
  if (BEARER) headers.Authorization = `Bearer ${BEARER}`;

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

app.get("/api/photos", (req, res) => {
  const targetUrl = safeUrl(PHOTO_API_BASE, "/api/photos");
  if (!targetUrl) {
    console.error(JSON.stringify({ severity: "ERROR", message: "invalid PHOTO_API_BASE", value: PHOTO_API_BASE }));
    return res.status(500).json({ error: "proxy not configured (PHOTO_API_BASE invalid)" });
  }
  targetUrl.search = req.originalUrl.split("?")[1] || "";

  const client = targetUrl.protocol === "https:" ? https : http;
  const headers = {};
  if (PHOTO_BEARER) headers.Authorization = `Bearer ${PHOTO_BEARER}`;

  const upstreamReq = client.request(
    targetUrl,
    { method: "GET", headers },
    (upstreamRes) => {
      res.writeHead(upstreamRes.statusCode || 500, upstreamRes.headers);
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on("error", (err) => {
    console.error(JSON.stringify({ severity: "ERROR", message: "photo proxy error", error: err.message }));
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
    }
    res.end(JSON.stringify({ error: "photo proxy failed" }));
  });

  req.on("close", () => upstreamReq.destroy());
  upstreamReq.end();
});

app.use(express.static(path.join(__dirname, "..", "..", "web")));

app.get("/healthz", (_req, res) => res.status(200).send("ok"));

app.listen(PORT, () => {
  console.log(JSON.stringify({ severity: "INFO", message: `local-proxy listening on ${PORT}`, target: TARGET_BASE }));
});
