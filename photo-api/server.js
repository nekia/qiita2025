// server.js

const express = require("express");
const cors = require("cors");
const { listPhotosForFrontend } = require("./photosClient");

const app = express();

app.use(
  cors({
    origin: true,
  })
);

app.use(express.json());

/**
 * GET /api/photos
 * Google Photos から取得した写真一覧を返却
 */
app.get("/api/photos", async (req, res) => {
  try {
    const photos = await listPhotosForFrontend();
    res.json(photos);
  } catch (err) {
    console.error("Failed to list photos:", err.response?.data || err);
    res.status(500).json({ error: "failed_to_fetch_photos" });
  }
});

app.get("/healthz", (req, res) => {
  res.status(200).send("ok");
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`Photo API listening on port ${PORT}`);
});
