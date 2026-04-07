const express = require("express");
const fs = require("fs");
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

const FILE = "./data.json";

// Get data
app.get("/api/manga", (req, res) => {
  if (!fs.existsSync(FILE)) return res.json([]);
  const data = JSON.parse(fs.readFileSync(FILE));
  res.json(data);
});

// Save data
app.post("/api/manga", (req, res) => {
  fs.writeFileSync(FILE, JSON.stringify(req.body, null, 2));
  res.json({ status: "saved" });
});

app.listen(3000, () => console.log("API running on port 3000"));