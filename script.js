const API = "http://192.168.1.166:3000/api/manga";

let manga = [];

// Load from backend
async function load() {
  try {
    const res = await fetch(API);
    manga = await res.json();
    render();
  } catch (err) {
    console.error("API error:", err);
  }
}

// Add new entry
async function addEntry() {
  const title = document.getElementById("f-title").value;
  const score = parseFloat(document.getElementById("f-score").value);
  const status = document.getElementById("f-status").value;
  const chapter = parseInt(document.getElementById("f-ch").value);
  const year = parseInt(document.getElementById("f-year").value);

  if (!title) {
    alert("Title required");
    return;
  }

  await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title,
      score,
      status,
      chapter,
      year
    })
  });

  // clear form
  document.getElementById("f-title").value = "";
  document.getElementById("f-score").value = "";
  document.getElementById("f-ch").value = "";
  document.getElementById("f-year").value = "";

  load();
}

// Render
function render() {
  const container = document.getElementById("tiers");
  container.innerHTML = "";

  if (manga.length === 0) {
    container.innerHTML = "<p style='color:#666'>No entries yet</p>";
    return;
  }

  manga.forEach(item => {
    const div = document.createElement("div");
    div.style.padding = "10px";
    div.style.borderBottom = "1px solid #222";

    div.innerHTML = `
      <strong>${item.title}</strong> 
      — ${item.score ?? "?"} 
      (${item.status || "Unknown"})
    `;

    container.appendChild(div);
  });
}
function toggleForm() {
  const form = document.getElementById("add-form");
  const btn = document.getElementById("toggle-btn");

  form.classList.toggle("visible");
  btn.classList.toggle("open");
}
// init
load();