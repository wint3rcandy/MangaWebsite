const API = "/api/manga";

function toggleForm() {
  const form = document.getElementById("add-form");
  const btn = document.getElementById("toggle-btn");
  form.classList.toggle("visible");
  btn.classList.toggle("open");
}

async function addEntry() {
  const title = document.getElementById("f-title").value.trim();
  const score = document.getElementById("f-score").value;
  const status = document.getElementById("f-status").value;
  const chapter = document.getElementById("f-ch").value;
  const year = document.getElementById("f-year").value;
  const file = document.getElementById("f-image").files[0];

  const formData = new FormData();
  formData.append("title", title);
  formData.append("score", score);
  formData.append("status", status);
  formData.append("chapter", chapter);
  formData.append("year", year);
  if (file) formData.append("image", file);

  await fetch(API, {
    method: "POST",
    body: formData
  });

  document.getElementById("f-title").value = "";
  document.getElementById("f-score").value = "";
  document.getElementById("f-ch").value = "";
  document.getElementById("f-year").value = "";
  document.getElementById("f-image").value = "";

  loadEntries();
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function statusClass(status) {
  const s = String(status || "").toLowerCase();
  if (s === "ongoing") return "status-ongoing";
  if (s === "finished") return "status-finished";
  if (s === "hiatus") return "status-hiatus";
  return "status-unknown";
}

async function deleteEntry(id) {
  const ok = confirm("Delete this entry?");
  if (!ok) return;

  await fetch(`${API}/${id}`, {
    method: "DELETE"
  });

  loadEntries();
}

async function loadEntries() {
  const search = document.getElementById("search").value.trim().toLowerCase();
  const res = await fetch(API);
  const data = await res.json();

  const filtered = data.filter(entry => {
    const title = String(entry.title || "").toLowerCase();
    return title.includes(search);
  });

  const container = document.getElementById("tiers");
  container.innerHTML = "";

  const total = filtered.length;
  const withImages = filtered.filter(e => e.image).length;

  const stats = document.createElement("div");
  stats.className = "stats";
  stats.innerHTML = `
    <div class="stat"><b>${total}</b> entries</div>
    <div class="stat"><b>${withImages}</b> with images</div>
  `;
  container.appendChild(stats);

  const grid = document.createElement("div");
  grid.className = "entry-grid";

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state">No entries match your search.</div>`;
    container.appendChild(grid);
    return;
  }

  filtered
    .sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")))
    .forEach(entry => {
      const card = document.createElement("div");
      card.className = "entry-card";

      const imgSrc = entry.image ? entry.image : "";
      const score = entry.score === "" || entry.score === null || entry.score === undefined ? "—" : entry.score;
      const chapter = entry.chapter === "" || entry.chapter === null || entry.chapter === undefined ? "—" : entry.chapter;
      const year = entry.year === "" || entry.year === null || entry.year === undefined ? "—" : entry.year;

      card.innerHTML = `
        <div class="entry-poster">
          ${
            imgSrc
              ? `<img class="poster-img" src="${imgSrc}" alt="${escapeHtml(entry.title)}">`
              : `<div class="poster-empty">No Image</div>`
          }
        </div>

        <div class="entry-content">
          <div class="entry-top">
            <div>
              <h2 class="entry-title">${escapeHtml(entry.title)}</h2>
              <div class="entry-meta">
                <span class="badge ${statusClass(entry.status)}">${escapeHtml(entry.status || "Unknown")}</span>
                <span>Score: <b>${escapeHtml(score)}</b></span>
                <span>Ch: <b>${escapeHtml(chapter)}</b></span>
                <span>Year: <b>${escapeHtml(year)}</b></span>
              </div>
            </div>

            <button class="del-btn" onclick="deleteEntry(${entry.id})" title="Delete entry">✕</button>
          </div>
        </div>
      `;

      grid.appendChild(card);
    });

  container.appendChild(grid);
}

loadEntries();