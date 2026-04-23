const express = require("express");
const cors = require("cors");
const fs = require("fs");
const http = require("http");
const https = require("https");
const path = require("path");
const multer = require("multer");
const AdmZip = require("adm-zip");

const app = express();
const PORT = 3000;

const DATA_FILE = path.join(__dirname, "data.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const CBZ_DIR = path.join(__dirname, "cbz");
const CBZ_PAGES_DIR = path.join(__dirname, "cbz-pages");
const STATUS_LABELS = {
  reading: "Reading",
  "want to read": "Want to Read",
  finished: "Finished",
  hiatus: "Hiatus",
  cancelled: "Cancelled"
};

for (const dir of [UPLOADS_DIR, CBZ_DIR, CBZ_PAGES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOADS_DIR, {
  etag: true,
  lastModified: true,
  maxAge: "30d",
  immutable: true
}));
app.use("/cbz", express.static(CBZ_DIR, {
  etag: true,
  lastModified: true,
  maxAge: "7d"
}));
app.use("/cbz-pages", express.static(CBZ_PAGES_DIR, {
  etag: true,
  lastModified: true,
  maxAge: "30d",
  immutable: true
}));
app.use(express.static(__dirname, {
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === ".html") {
      res.setHeader("Cache-Control", "no-cache");
      return;
    }

    if (ext === ".css" || ext === ".js" || ext === ".ico") {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
  }
}));

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(normalizeEntry) : [];
  } catch {
    return [];
  }
}

function saveData(data) {
  const normalizedData = Array.isArray(data) ? data.map(normalizeEntry) : [];
  fs.writeFileSync(DATA_FILE, JSON.stringify(normalizedData, null, 2));
}

function normalizeStatusValue(status) {
  const normalized = String(status || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "canceled") return "cancelled";
  if (normalized === "want-to-read" || normalized === "wanttoread") return "want to read";
  if (normalized === "ongoing") return "reading";
  return normalized;
}

function formatStatusValue(status) {
  const normalized = normalizeStatusValue(status);
  if (!normalized) return "";
  return STATUS_LABELS[normalized] || String(status || "").trim();
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object") return entry;
  return {
    ...entry,
    status: formatStatusValue(entry.status)
  };
}

const AUTO_POSTER_USER_AGENT = "MangaReaderLocalArchive/1.0";
const AUTO_POSTER_TIMEOUT_MS = 15000;
const AUTO_POSTER_MIN_SCORE = 50;
const AUTO_POSTER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif"]);
const IMAGE_CONTENT_TYPE_TO_EXTENSION = {
  "image/avif": ".avif",
  "image/gif": ".gif",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp"
};

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function slugify(value) {
  const slug = normalizeText(value).replace(/\s+/g, "-").slice(0, 80);
  return slug || "untitled";
}

function scoreCandidate(searchNorm, candidateNorm) {
  if (!candidateNorm) return 0;
  if (candidateNorm === searchNorm) return 100;
  if (candidateNorm.startsWith(searchNorm)) return 92;
  if (searchNorm.startsWith(candidateNorm)) return 88;
  if (candidateNorm.includes(searchNorm)) return 80;
  if (searchNorm.includes(candidateNorm)) return 76;

  const searchWords = searchNorm.split(" ").filter(Boolean);
  const candidateWords = candidateNorm.split(" ").filter(Boolean);
  if (!searchWords.length || !candidateWords.length) return 0;

  const overlap = searchWords.filter(word => candidateWords.includes(word)).length;
  return Math.round(70 * (overlap / searchWords.length));
}

function requestBuffer(url, options = {}, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error("Too many redirects"));
  }

  const target = new URL(url);
  const client = target.protocol === "http:" ? http : https;
  const headers = {
    "User-Agent": AUTO_POSTER_USER_AGENT,
    ...options.headers
  };

  if (options.body && headers["Content-Length"] === undefined) {
    headers["Content-Length"] = Buffer.byteLength(options.body);
  }

  return new Promise((resolve, reject) => {
    const req = client.request(target, {
      method: options.method || "GET",
      headers,
      timeout: AUTO_POSTER_TIMEOUT_MS
    }, res => {
      const status = res.statusCode || 0;

      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        const redirectUrl = new URL(res.headers.location, target).toString();
        resolve(requestBuffer(redirectUrl, options, redirectCount + 1));
        return;
      }

      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        if (status < 200 || status >= 300) {
          reject(new Error(`Request failed with status ${status}`));
          return;
        }

        resolve({
          buffer: Buffer.concat(chunks),
          contentType: String(res.headers["content-type"] || ""),
          finalUrl: target.toString()
        });
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error("Request timed out"));
    });

    req.on("error", reject);

    if (options.body) {
      req.write(options.body);
    }

    req.end();
  });
}

async function requestJson(url, options = {}) {
  const response = await requestBuffer(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...options.headers
    }
  });

  return JSON.parse(response.buffer.toString("utf8"));
}

async function findAniListPoster(title) {
  const searchTitle = String(title || "").trim();
  if (!searchTitle) return null;

  const query = `
    query ($search: String) {
      Page(page: 1, perPage: 8) {
        media(search: $search, type: MANGA) {
          id
          siteUrl
          title {
            romaji
            english
            native
            userPreferred
          }
          synonyms
          coverImage {
            extraLarge
            large
            medium
          }
        }
      }
    }
  `;

  const payload = JSON.stringify({
    query,
    variables: { search: searchTitle }
  });

  const response = await requestJson("https://graphql.anilist.co", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: payload
  });

  const mediaList = Array.isArray(response?.data?.Page?.media) ? response.data.Page.media : [];
  const searchNorm = normalizeText(searchTitle);
  let bestMatch = null;
  let bestScore = -1;

  for (const media of mediaList) {
    const titles = [
      media?.title?.english,
      media?.title?.romaji,
      media?.title?.native,
      media?.title?.userPreferred,
      ...(Array.isArray(media?.synonyms) ? media.synonyms : [])
    ].filter(Boolean);

    const score = titles.reduce((maxScore, candidate) => {
      return Math.max(maxScore, scoreCandidate(searchNorm, normalizeText(candidate)));
    }, 0);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = media;
    }
  }

  if (!bestMatch || bestScore < AUTO_POSTER_MIN_SCORE) {
    return null;
  }

  const imageUrl = bestMatch?.coverImage?.large
    || bestMatch?.coverImage?.medium
    || bestMatch?.coverImage?.extraLarge;

  if (!imageUrl) {
    return null;
  }

  return {
    imageUrl,
    matchedTitle: bestMatch?.title?.userPreferred
      || bestMatch?.title?.english
      || bestMatch?.title?.romaji
      || searchTitle,
    score: bestScore,
    siteUrl: bestMatch?.siteUrl || ""
  };
}

function getImageExtension(url, contentType) {
  const pathname = new URL(url).pathname;
  const extension = path.extname(pathname).toLowerCase();

  if (AUTO_POSTER_EXTENSIONS.has(extension)) {
    return extension;
  }

  const normalizedType = String(contentType || "").split(";")[0].trim().toLowerCase();
  return IMAGE_CONTENT_TYPE_TO_EXTENSION[normalizedType] || ".jpg";
}

async function fetchAndStorePoster(title, entryId) {
  const poster = await findAniListPoster(title);
  if (!poster) return "";

  const download = await requestBuffer(poster.imageUrl);
  const normalizedType = String(download.contentType || "").split(";")[0].trim().toLowerCase();

  if (normalizedType && !normalizedType.startsWith("image/")) {
    throw new Error(`Remote poster was not an image (${normalizedType})`);
  }

  const extension = getImageExtension(download.finalUrl || poster.imageUrl, download.contentType);
  const filename = `poster-${entryId}-${slugify(title)}${extension}`;
  const outputPath = path.join(UPLOADS_DIR, filename);

  fs.writeFileSync(outputPath, download.buffer);
  return `/uploads/${filename}`;
}

async function populateEntryPoster(entry, options = {}) {
  const force = options.force === true;

  if (!entry || !String(entry.title || "").trim()) {
    return "";
  }

  if (!force && entry.image) {
    return entry.image;
  }

  const image = await fetchAndStorePoster(entry.title, entry.id);
  if (image) {
    entry.image = image;
  }

  return image;
}

const CHAPTER_FILE_PATTERN = /(?:^|[^a-z0-9])(?:ch(?:apter)?|c)[\s._-]*0*\d+(?=[^a-z0-9]|$)/i;
const VOLUME_FILE_PATTERN = /(?:^|[^a-z0-9])(?:vol(?:ume)?|v)[\s._-]*0*\d+(?=[^a-z0-9]|$)/i;

function listCbzFiles(mangaId) {
  const dir = path.join(CBZ_DIR, String(mangaId));

  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter(file => file.toLowerCase().endsWith(".cbz"))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map(file => ({
      filename: file,
      url: `/cbz/${mangaId}/${encodeURIComponent(file)}`,
      size: fs.statSync(path.join(dir, file)).size
    }));
}

function inferCbzUnit(cbzFiles) {
  let chapterMatches = 0;
  let volumeMatches = 0;

  cbzFiles.forEach(file => {
    const filename = typeof file === "string" ? file : file?.filename || "";
    const basename = path.basename(filename, path.extname(filename));

    if (CHAPTER_FILE_PATTERN.test(basename)) {
      chapterMatches++;
      return;
    }

    if (VOLUME_FILE_PATTERN.test(basename)) {
      volumeMatches++;
    }
  });

  if (chapterMatches > volumeMatches && chapterMatches > 0) return "chapter";
  if (volumeMatches > chapterMatches && volumeMatches > 0) return "volume";
  return "file";
}

function withLibraryMeta(entry) {
  const cbzFiles = listCbzFiles(entry.id);
  return {
    ...entry,
    cbzCount: cbzFiles.length,
    hasCbz: cbzFiles.length > 0,
    cbzUnit: inferCbzUnit(cbzFiles)
  };
}

function parseBoolean(value) {
  return value === true || value === "true" || value === 1 || value === "1" || value === "on";
}

function parseManualOrder(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function getNextManualOrder(data, scoreValue) {
  const score = Number(scoreValue);
  if (!Number.isFinite(score)) return null;

  let max = -1;
  for (const entry of data) {
    if (Number(entry.score) !== score) continue;
    const order = Number(entry.manualOrder);
    if (Number.isFinite(order) && order > max) {
      max = order;
    }
  }

  return max + 1;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({ storage });

// CBZ-specific storage — stored under cbz/<mangaId>/
const cbzStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const mangaId = req.params.id;
    const dir = path.join(CBZ_DIR, mangaId);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // Keep original filename but sanitise it
    const ext = path.extname(file.originalname).toLowerCase();
    const base = path.basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 120);
    cb(null, `${base}${ext}`);
  }
});

const cbzUpload = multer({
  storage: cbzStorage,
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === ".cbz") return cb(null, true);
    cb(new Error("Only .cbz files are allowed"));
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.get("/rankings", (req, res) => {
  res.sendFile(path.join(__dirname, "original.html"));
});

app.get("/reader", (req, res) => {
  res.sendFile(path.join(__dirname, "reader.html"));
});

app.get("/api/manga", (req, res) => {
  res.json(loadData());
});

app.get("/api/library", (req, res) => {
  res.json(loadData().map(withLibraryMeta));
});

app.post("/api/manga", upload.single("image"), async (req, res) => {
  try {
    const data = loadData();
    const id = Date.now();
    const title = req.body.title || "";
    const shouldAutoFetchPoster = !req.file && !parseBoolean(req.body.skipAutoImage);
    let image = req.file ? `/uploads/${req.file.filename}` : "";

    if (!image && shouldAutoFetchPoster && String(title).trim()) {
      try {
        image = await fetchAndStorePoster(title, id);
      } catch (error) {
        console.warn(`Auto poster fetch failed for "${title}": ${error.message}`);
      }
    }

    const newEntry = {
      id,
      title,
      score: req.body.score || "",
      status: formatStatusValue(req.body.status),
      chapter: req.body.chapter || "",
      year: req.body.year || "",
      image,
      note: req.body.note || "",
      nsfw: parseBoolean(req.body.nsfw),
      manualOrder: req.body.manualOrder !== undefined
        ? parseManualOrder(req.body.manualOrder)
        : getNextManualOrder(data, req.body.score),
    };

    data.push(newEntry);
    saveData(data);

    res.json(newEntry);
  } catch (error) {
    console.error("Failed to create manga entry", error);
    res.status(500).json({ error: "Failed to create entry" });
  }
});

app.post("/api/manga/:id/fetch-poster", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const data = loadData();
    const idx = data.findIndex(entry => entry.id === id);

    if (idx === -1) {
      return res.status(404).json({ error: "Entry not found" });
    }

    const entry = data[idx];
    const force = parseBoolean(req.body?.force);
    const image = await populateEntryPoster(entry, { force });

    if (!image) {
      return res.status(404).json({ error: "Poster not found" });
    }

    data[idx] = entry;
    saveData(data);
    res.json(entry);
  } catch (error) {
    console.error(`Failed to fetch poster for entry ${req.params.id}`, error);
    res.status(500).json({ error: "Failed to fetch poster" });
  }
});

app.post("/api/manga/reorder", (req, res) => {
  const ids = Array.isArray(req.body.ids)
    ? req.body.ids.map(Number).filter(Number.isFinite)
    : [];

  if (ids.length < 2) {
    return res.status(400).json({ error: "At least two ids are required" });
  }

  const data = loadData();
  const entries = ids.map(id => data.find(entry => entry.id === id));

  if (entries.some(entry => !entry)) {
    return res.status(404).json({ error: "One or more entries were not found" });
  }

  const scores = new Set(entries.map(entry => Number(entry.score)));
  if (scores.size > 1) {
    return res.status(400).json({ error: "Only entries with the same score can be reordered" });
  }

  ids.forEach((id, index) => {
    const entry = data.find(item => item.id === id);
    if (entry) entry.manualOrder = index;
  });

  saveData(data);
  res.json({ success: true, ids });
});

app.put("/api/manga/:id", upload.single("image"), (req, res) => {
  const id = Number(req.params.id);
  const data = loadData();
  const idx = data.findIndex(entry => entry.id === id);

  if (idx === -1) {
    return res.status(404).json({ error: "Entry not found" });
  }

  const existing = data[idx];
  const nextScore = req.body.score !== undefined ? req.body.score : existing.score;
  const scoreChanged = Number(nextScore) !== Number(existing.score);

  const updated = {
    ...existing,
    title: req.body.title !== undefined ? req.body.title : existing.title,
    score: nextScore,
    status: req.body.status !== undefined ? formatStatusValue(req.body.status) : formatStatusValue(existing.status),
    chapter: req.body.chapter !== undefined ? req.body.chapter : existing.chapter,
    year: req.body.year !== undefined ? req.body.year : existing.year,
    image: existing.image || "",
    note: req.body.note !== undefined ? req.body.note : existing.note,
    nsfw: req.body.nsfw !== undefined ? parseBoolean(req.body.nsfw) : parseBoolean(existing.nsfw),
    manualOrder: req.body.manualOrder !== undefined
      ? parseManualOrder(req.body.manualOrder)
      : scoreChanged
        ? getNextManualOrder(data, nextScore)
        : parseManualOrder(existing.manualOrder),
  };

  if (req.file) {
    if (existing.image) {
      const oldPath = path.join(__dirname, existing.image);
      if (fs.existsSync(oldPath)) {
        fs.unlinkSync(oldPath);
      }
    }
    updated.image = `/uploads/${req.file.filename}`;
  }

  data[idx] = updated;
  saveData(data);

  res.json(updated);
});

app.delete("/api/manga/:id", (req, res) => {
  const id = Number(req.params.id);
  const data = loadData();
  const entry = data.find(e => e.id === id);

  if (!entry) {
    return res.status(404).json({ error: "Entry not found" });
  }

  if (entry.image) {
    const filePath = path.join(__dirname, entry.image);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }

  const updated = data.filter(e => e.id !== id);
  saveData(updated);

  res.json({ success: true });
});

// ── CBZ routes ─────────────────────────────────────────────────────────────

// List CBZ files for a manga entry
app.get("/api/manga/:id/cbz", (req, res) => {
  res.json(listCbzFiles(req.params.id));
});

// Upload one or more CBZ files for a manga entry
app.post("/api/manga/:id/cbz", cbzUpload.array("cbz", 50), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No CBZ files uploaded" });
  }

  const mangaId = req.params.id;
  const uploaded = req.files.map(f => ({
    filename: f.filename,
    url: `/cbz/${mangaId}/${encodeURIComponent(f.filename)}`,
    size: f.size
  }));

  res.json({ success: true, files: uploaded });
});

// Delete a specific CBZ file
app.delete("/api/manga/:id/cbz/:filename", (req, res) => {
  const mangaId = req.params.id;
  const filename = req.params.filename;
  const filePath = path.join(CBZ_DIR, mangaId, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: "File not found" });
  }

  fs.unlinkSync(filePath);

  // Also remove extracted pages if they exist
  const pagesDir = path.join(CBZ_PAGES_DIR, mangaId, path.basename(filename, ".cbz"));
  if (fs.existsSync(pagesDir)) {
    fs.rmSync(pagesDir, { recursive: true, force: true });
  }

  res.json({ success: true });
});

// Extract and serve pages from a CBZ — returns ordered list of image URLs
app.get("/api/manga/:id/cbz/:filename/pages", (req, res) => {
  const mangaId = req.params.id;
  const filename = req.params.filename;
  const cbzPath = path.join(CBZ_DIR, mangaId, filename);

  if (!fs.existsSync(cbzPath)) {
    return res.status(404).json({ error: "CBZ file not found" });
  }

  const baseName = path.basename(filename, ".cbz");
  const pagesDir = path.join(CBZ_PAGES_DIR, mangaId, baseName);

  // Re-use already-extracted pages
  if (fs.existsSync(pagesDir)) {
    const pages = getPageUrls(pagesDir, mangaId, baseName);
    return res.json(pages);
  }

  // Extract the CBZ (which is just a ZIP)
  try {
    fs.mkdirSync(pagesDir, { recursive: true });
    const zip = new AdmZip(cbzPath);
    const entries = zip.getEntries()
      .filter(e => !e.isDirectory && /\.(jpe?g|png|gif|webp|avif)$/i.test(e.entryName))
      .sort((a, b) => a.entryName.localeCompare(b.entryName, undefined, { numeric: true, sensitivity: "base" }));

    entries.forEach(entry => {
      const safeName = path.basename(entry.entryName).replace(/[^a-zA-Z0-9._-]/g, "_");
      const outPath = path.join(pagesDir, safeName);
      fs.writeFileSync(outPath, entry.getData());
    });

    const pages = getPageUrls(pagesDir, mangaId, baseName);
    res.json(pages);
  } catch (err) {
    console.error("CBZ extraction error:", err);
    res.status(500).json({ error: "Failed to extract CBZ" });
  }
});

function getPageUrls(pagesDir, mangaId, baseName) {
  return fs.readdirSync(pagesDir)
    .filter(f => /\.(jpe?g|png|gif|webp|avif)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }))
    .map(f => ({
      filename: f,
      url: `/cbz-pages/${mangaId}/${encodeURIComponent(baseName)}/${encodeURIComponent(f)}`
    }));
}

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});
