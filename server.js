const express = require("express");
const cors = require("cors");
const fs = require("fs");

const app = express();
const PORT = 3000;
const DATA_FILE = "/app/data.json";

app.use(cors());
app.use(express.json({ limit: "10mb" })); // needed for base64 images

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return [];
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

app.get("/api/manga", (req, res) => {
  res.json(loadData());
});

app.post("/api/manga", (req, res) => {
  const data = loadData();

  const newEntry = {
    id: Date.now(),
    title: req.body.title || "",
    score: req.body.score || "",
    status: req.body.status || "",
    chapter: req.body.chapter || "",
    year: req.body.year || "",
    image: req.body.image || ""
  };

  data.push(newEntry);
  saveData(data);

  res.json(newEntry);
});

app.listen(PORT, () => {
  console.log("API running on port 3000");
});