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

app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.static(__dirname));
app.use(cors());
app.use(express.json());

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
    image: req.file ? `/uploads/${req.file.filename}` : ""
  };

  data.push(newEntry);
  saveData(data);

  res.json(newEntry);
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