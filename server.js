const express = require("express");
const cors = require("cors");
const fs = require("fs");

const app = express();
const PORT = 3000;
const DATA_FILE = "/app/data.json";

app.use(cors());
app.use(express.json());

// Load data
function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE));
  } catch {
    return [];
  }
}

// Save data
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// GET
app.get("/api/manga", (req, res) => {
  res.json(loadData());
});

// POST
app.post("/api/manga", (req, res) => {
  const data = loadData();

  const newEntry = {
    id: Date.now(),
    title: req.body.title,
    score: req.body.score,
    status: req.body.status,
    chapter: req.body.chapter,
    year: req.body.year
  };

  data.push(newEntry);
  saveData(data);

  res.json(newEntry);
});

app.listen(PORT, () => {
  console.log("API running on port 3000");
});