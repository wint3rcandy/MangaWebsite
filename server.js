const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const multer = require("multer");

const app = express();
const PORT = 3000;

const DATA_FILE = path.join(__dirname, "data.json");
const UPLOADS_DIR = path.join(__dirname, "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static(UPLOADS_DIR));
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

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "original.html"));
});

app.get("/api/manga", (req, res) => {
  res.json(loadData());
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

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});