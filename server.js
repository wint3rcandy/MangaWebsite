const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const AdmZip = require("adm-zip");

const app = express();
const PORT = 3000;

const DATA_FILE = path.join(__dirname, "data.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");
const CBZ_DIR = path.join(__dirname, "cbz");
const CBZ_PAGES_DIR = path.join(__dirname, "cbz-pages");

for (const dir of [UPLOADS_DIR, CBZ_DIR, CBZ_PAGES_DIR]) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOADS_DIR));
app.use("/cbz", express.static(CBZ_DIR));
app.use("/cbz-pages", express.static(CBZ_PAGES_DIR));
app.use(express.static(__dirname));

function loadData() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

const CHAPTER_FILE_PATTERN = /(?:^|[^a-z0-9])(?:ch(?:apter)?\s*|c)0*\d+(?=[^a-z0-9]|$)/i;
const VOLUME_FILE_PATTERN = /(?:^|[^a-z0-9])(?:vol(?:ume)?\s*|v)0*\d+(?=[^a-z0-9]|$)/i;

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

app.post("/api/manga", upload.single("image"), (req, res) => {
  const data = loadData();

  const newEntry = {
    id: Date.now(),
    title: req.body.title || "",
    score: req.body.score || "",
    status: req.body.status || "",
    chapter: req.body.chapter || "",
    year: req.body.year || "",
    image: req.file ? `/uploads/${req.file.filename}` : "",
    note: req.body.note || "",
    nsfw: parseBoolean(req.body.nsfw),
    manualOrder: req.body.manualOrder !== undefined
      ? parseManualOrder(req.body.manualOrder)
      : getNextManualOrder(data, req.body.score),
  };

  data.push(newEntry);
  saveData(data);

  res.json(newEntry);
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
    status: req.body.status !== undefined ? req.body.status : existing.status,
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
