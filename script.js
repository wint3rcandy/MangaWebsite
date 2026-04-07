const API = "/api/manga";

let editingId = null;
let entryCache = {};

function toggleForm() {
  const form = document.getElementById("add-form");
  const btn = document.getElementById("toggle-btn");

  form.classList.toggle("visible");
  btn.classList.toggle("open");
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

function ensureEditModal() {
  if (document.getElementById("edit-modal")) return;

  const modal = document.createElement("div");
  modal.id = "edit-modal";
  modal.className = "edit-modal";
  modal.innerHTML = `
    <div class="edit-backdrop" onclick="closeEditModal()"></div>
    <div class="edit-card">
      <div class="edit-head">
        <h3>Edit entry</h3>
        <button class="modal-x" onclick="closeEditModal()">×</button>
      </div>

      <div class="edit-grid">
        <div class="field full">
          <label>TITLE</label>
          <input type="text" id="edit-title">
        </div>

        <div class="field">
          <label>SCORE</label>
          <input type="number" id="edit-score">
        </div>

        <div class="field">
          <label>STATUS</label>
          <select id="edit-status">
            <option>Ongoing</option>
            <option>Finished</option>
            <option>Hiatus</option>
          </select>
        </div>

        <div class="field">
          <label>CHAPTER</label>
          <input type="number" id="edit-chapter">
        </div>

        <div class="field">
          <label>STARTED READING</label>
          <input type="text" id="edit-year" placeholder="e.g. 2019 or 02/22/2024">
        </div>

        <div class="field full">
          <label>REPLACE IMAGE (optional)</label>
          <input type="file" id="edit-image" accept="image/*">
        </div>

        <div class="field full">
          <label>NOTE / REVIEW</label>
          <input type="text" id="edit-note">
        </div>
      </div>

      <div class="modal-actions">
        <button class="modal-btn ghost" onclick="closeEditModal()">Cancel</button>
        <button class="modal-btn primary" onclick="saveEditEntry()">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
}

function openEditModal(id) {
  const entry = entryCache[id];
  if (!entry) return;

  ensureEditModal();
  editingId = id;

  document.getElementById("edit-title").value = entry.title || "";
  document.getElementById("edit-score").value = entry.score || "";
  document.getElementById("edit-status").value = entry.status || "Ongoing";
  document.getElementById("edit-chapter").value = entry.chapter || "";
  document.getElementById("edit-year").value = entry.year || "";
  document.getElementById("edit-image").value = "";
  document.getElementById("edit-note").value = entry.note || "";

  document.getElementById("edit-modal").classList.add("open");
}

function closeEditModal() {
  const modal = document.getElementById("edit-modal");
  if (modal) modal.classList.remove("open");
  editingId = null;
}

async function saveEditEntry() {
  if (!editingId) return;

  const formData = new FormData();

  let score = parseFloat(document.getElementById("edit-score").value);
  if (isNaN(score)) score = "";
  else score = Math.max(0, Math.min(100, score));

  formData.append("title", document.getElementById("edit-title").value.trim());
  formData.append("score", score);
  formData.append("status", document.getElementById("edit-status").value);
  formData.append("chapter", document.getElementById("edit-chapter").value);
  formData.append("note", document.getElementById("edit-note").value.trim());

  const yearInput = document.getElementById("edit-year").value.trim();

  if (
    yearInput &&
    !/^\d{4}$/.test(yearInput) &&
    !/^\d{2}\/\d{2}\/\d{4}$/.test(yearInput)
  ) {
    alert("Enter either YYYY or MM/DD/YYYY");
    return;
  }

  formData.append("year", yearInput);

  const file = document.getElementById("edit-image").files[0];
  if (file) formData.append("image", file);

  await fetch(`${API}/${editingId}`, {
    method: "PUT",
    body: formData
  });

  closeEditModal();
  loadEntries();
}

async function addEntry() {
  const formData = new FormData();
  const yearInput = document.getElementById("f-year").value.trim();

  if (
    yearInput &&
    !/^\d{4}$/.test(yearInput) &&
    !/^\d{2}\/\d{2}\/\d{4}$/.test(yearInput)
  ) {
    alert("Enter either YYYY or MM/DD/YYYY");
    return;
  }

  formData.append("year", yearInput);

  let score = parseFloat(document.getElementById("f-score").value);
  if (isNaN(score)) score = "";
  else score = Math.max(0, Math.min(10, score));

  formData.append("title", document.getElementById("f-title").value.trim());
  formData.append("score", score);
  formData.append("status", document.getElementById("f-status").value);
  formData.append("chapter", document.getElementById("f-ch").value);
  formData.append("year", document.getElementById("f-year").value);
  formData.append("note", document.getElementById("f-note").value.trim());

  const file = document.getElementById("f-image").files[0];
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

  entryCache = {};

  const filtered = data
    .filter(entry => {
      const title = String(entry.title || "").toLowerCase();
      return title.includes(search);
    })
    .sort((a, b) => {
      const scoreA = Number(a.score || 0);
      const scoreB = Number(b.score || 0);
      if (scoreB !== scoreA) return scoreB - scoreA;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });

  const container = document.getElementById("tiers");
  container.innerHTML = "";

  const stats = document.createElement("div");
  stats.className = "stats";
  stats.innerHTML = `
    <div class="stat"><b>${filtered.length}</b> entries</div>
  `;
  container.appendChild(stats);

  const grid = document.createElement("div");
  grid.className = "entry-grid";

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state">No entries match your search.</div>`;
    container.appendChild(grid);
    return;
  }

  filtered.forEach((entry, index) => {
    entryCache[entry.id] = entry;

    const score = entry.score || "—";
    const chapter = entry.chapter || "—";
    const year = entry.year || "—";
    const note = entry.note || "";

    const card = document.createElement("div");
    card.className = `entry-card rank-${index + 1}`;
    card.innerHTML = `
      <div class="entry-poster">
        ${
          entry.image
            ? `<img class="poster-img" src="${entry.image}" alt="${escapeHtml(entry.title)}">`
            : `<div class="poster-empty">No Image</div>`
        }
      </div>

      <div class="entry-content">
        <h2 class="entry-title">${escapeHtml(entry.title)}</h2>

        <div class="entry-meta">
          <span class="badge ${statusClass(entry.status)}">${escapeHtml(entry.status || "Unknown")}</span>
          <span>
            Score:
            <b class="${scoreClass(score)}">${escapeHtml(score)}</b>
          </span>
          ${chapter && chapter !== "—" ? `<span>Ch: <b>${escapeHtml(chapter)}</b></span>` : ""}
          <span>
            ${String(entry.status).toLowerCase() === "finished" ? "Read" : "Started"}:
            <b>${escapeHtml(year)}</b>
          </span>
        </div>

        ${note ? `<div class="entry-note">${escapeHtml(note)}</div>` : ""}

        <div class="card-actions">
          <button class="card-btn edit" onclick="openEditModal(${entry.id})">✎</button>
          <button class="card-btn delete" onclick="deleteEntry(${entry.id})">×</button>
        </div>
      </div>

      <div class="rank-badge">#${index + 1}</div>
    `;

    grid.appendChild(card);
  });

  container.appendChild(grid);
}
function scoreClass(score) {
  const s = Number(score);
  if (s >= 11) return "super-high";
  if (s >= 9) return "score-high";
  if (s >= 7) return "score-mid";
  if (s >= 5) return "score-low";
  return "score-bad";
}

ensureEditModal();
loadEntries();