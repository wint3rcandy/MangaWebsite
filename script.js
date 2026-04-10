const API = "/api/manga";

let editingId = null;
let entryCache = {};
let hideNsfw = false;
let searchClearFocused = false;
let draggedRankId = null;
let draggedScoreValue = null;
let isSavingManualOrder = false;

try {
  hideNsfw = localStorage.getItem("hide-nsfw") === "true";
} catch {}

function toggleForm() {
  const form = document.getElementById("add-form");
  const panel = document.getElementById("add-panel");
  const btn = document.getElementById("toggle-btn");
  const toggle = document.querySelector(".add-toggle");

  const isOpen = form.classList.toggle("visible");
  panel.classList.toggle("open", isOpen);
  btn.classList.toggle("open", isOpen);
  toggle?.setAttribute("aria-expanded", String(isOpen));
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

function isNsfwEntry(entry) {
  const value = entry?.nsfw;
  return value === true || value === "true" || value === 1 || value === "1" || value === "on";
}

function updateNsfwToggle() {
  const button = document.getElementById("nsfw-toggle");
  if (!button) return;

  button.textContent = hideNsfw ? "Show NSFW" : "Hide NSFW";
  button.classList.toggle("active", hideNsfw);
  button.setAttribute("aria-pressed", String(hideNsfw));
}

function toggleNsfwFilter() {
  hideNsfw = !hideNsfw;

  try {
    localStorage.setItem("hide-nsfw", String(hideNsfw));
  } catch {}

  updateNsfwToggle();
  loadEntries();
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
        <button class="modal-x" onclick="closeEditModal()" aria-label="Close">&times;</button>
      </div>

      <div class="edit-grid">
        <div class="field full">
          <label>TITLE</label>
          <input type="text" id="edit-title">
        </div>

        <div class="field">
          <label>TIER</label>
          <select id="edit-score">
            <option value="">-- Ungraded --</option>
            <option value="S+">S+</option>
            <option value="S">S</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
            <option value="D">D</option>
            <option value="F">F</option>
          </select>
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

        <div class="field">
          <label>CONTENT FLAG</label>
          <label class="check-chip" for="edit-nsfw">
            <input type="checkbox" id="edit-nsfw">
            <span>NSFW</span>
          </label>
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
  document.getElementById("edit-nsfw").checked = isNsfwEntry(entry);
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

  const score = document.getElementById("edit-score").value;

  formData.append("title", document.getElementById("edit-title").value.trim());
  formData.append("score", score);
  formData.append("status", document.getElementById("edit-status").value);
  formData.append("chapter", document.getElementById("edit-chapter").value);
  formData.append("note", document.getElementById("edit-note").value.trim());
  formData.append("nsfw", document.getElementById("edit-nsfw").checked ? "true" : "false");

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

  const score = document.getElementById("f-score").value;

  formData.append("title", document.getElementById("f-title").value.trim());
  formData.append("score", score);
  formData.append("status", document.getElementById("f-status").value);
  formData.append("chapter", document.getElementById("f-ch").value);
  formData.append("year", yearInput);
  formData.append("note", document.getElementById("f-note").value.trim());
  formData.append("nsfw", document.getElementById("f-nsfw").checked ? "true" : "false");

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
  document.getElementById("f-note").value = "";
  document.getElementById("f-nsfw").checked = false;

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
function updateSearchClear() {
  const input = document.getElementById("search");
  const clearBtn = document.getElementById("search-clear");
  if (!input || !clearBtn) return;

  const shouldShow = searchClearFocused || input.value.length > 0;
  clearBtn.hidden = !shouldShow;
}

function showSearchClear() {
  searchClearFocused = true;
  updateSearchClear();
}

function hideSearchClear() {
  searchClearFocused = false;
  updateSearchClear();
}

function handleSearchInput() {
  updateSearchClear();
  loadEntries();
}

function clearSearch() {
  const input = document.getElementById("search");
  if (!input) return;

  input.value = "";
  searchClearFocused = true;
  updateSearchClear();
  loadEntries();
  input.focus();
}

const getSortTime = (val) => {
  if (!val) return 0;

  const s = String(val).trim();

  // MM/DD/YYYY
  const full = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (full) {
    const [, mm, dd, yyyy] = full;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd)).getTime();
  }

  // YYYY
  const year = s.match(/\d{4}/);
  if (year) {
    return new Date(Number(year[0]), 0, 1).getTime();
  }

  return 0;
};

const getYear = (val) => {
  if (!val) return 0;
  const match = val.match(/\d{4}/);
  return match ? Number(match[0]) : 0;
};

const TIER_ORDER = { "S+": 0, "S": 1, "A": 2, "B": 3, "C": 4, "D": 5, "F": 6 };

function getTierOrder(entry) {
  const score = entry?.score;
  if (score && TIER_ORDER.hasOwnProperty(score)) return TIER_ORDER[score];
  return 99; // ungraded goes last
}

function getNumericScore(entry) {
  // kept for drag-drop compatibility — use tier order as a pseudo-score
  const order = getTierOrder(entry);
  return order === 99 ? Number.NEGATIVE_INFINITY : -order; // higher = better
}

function getManualOrder(entry) {
  const manualOrder = Number(entry?.manualOrder);
  return Number.isFinite(manualOrder) ? manualOrder : Number.POSITIVE_INFINITY;
}

function sortDefaultEntries(entries) {
  entries.sort((a, b) => {
    const tierDiff = getTierOrder(a) - getTierOrder(b);
    if (tierDiff !== 0) return tierDiff;

    const orderDiff = getManualOrder(a) - getManualOrder(b);
    if (orderDiff !== 0) return orderDiff;

    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

function clearRankDropIndicators(scope = document) {
  scope.querySelectorAll(".entry-card.drop-before, .entry-card.drop-after")
    .forEach(card => card.classList.remove("drop-before", "drop-after"));
}

function resetRankDragging(grid) {
  clearRankDropIndicators(grid);
  grid?.querySelector(".entry-card.dragging")?.classList.remove("dragging");
  draggedRankId = null;
  draggedScoreValue = null;
}

function getGridColumnCount(grid) {
  const template = getComputedStyle(grid).gridTemplateColumns;
  if (!template) return 1;
  return Math.max(1, template.split(" ").filter(Boolean).length);
}

function getDropPosition(event, targetCard, grid) {
  const rect = targetCard.getBoundingClientRect();
  if (getGridColumnCount(grid) <= 1) {
    return event.clientY < rect.top + rect.height / 2 ? "before" : "after";
  }
  return event.clientX < rect.left + rect.width / 2 ? "before" : "after";
}

async function saveManualTieOrder(grid, scoreValue) {
  if (isSavingManualOrder) return;

  const ids = Array.from(grid.querySelectorAll(".entry-card"))
    .filter(card => Number(card.dataset.scoreValue) === scoreValue)
    .map(card => Number(card.dataset.entryId));

  if (ids.length < 2) return;

  isSavingManualOrder = true;
  let requestFailed = false;

  try {
    const response = await fetch(`${API}/reorder`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids })
    });

    if (!response.ok) {
      throw new Error("Failed to save manual order");
    }
  } catch (error) {
    requestFailed = true;
    console.error(error);
  } finally {
    isSavingManualOrder = false;
  }

  if (requestFailed) {
    alert("Couldn't save that rank order.");
  }

  loadEntries();
}

function setupRankDragging(grid) {
  const handles = grid.querySelectorAll(".rank-badge-draggable");
  const cards = grid.querySelectorAll(".entry-card");
  if (!handles.length || !cards.length) return;

  handles.forEach(handle => {
    handle.addEventListener("dragstart", event => {
      const card = handle.closest(".entry-card");
      if (!card || isSavingManualOrder) return;

      draggedRankId = Number(card.dataset.entryId);
      draggedScoreValue = Number(card.dataset.scoreValue);
      card.classList.add("dragging");

      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(draggedRankId));
      }
    });

    handle.addEventListener("dragend", () => {
      resetRankDragging(grid);
    });
  });

  cards.forEach(card => {
    card.addEventListener("dragover", event => {
      if (draggedRankId === null || isSavingManualOrder) return;
      if (Number(card.dataset.entryId) === draggedRankId) return;
      if (Number(card.dataset.scoreValue) !== draggedScoreValue) return;

      event.preventDefault();
      clearRankDropIndicators(grid);
      const position = getDropPosition(event, card, grid);
      card.classList.add(position === "before" ? "drop-before" : "drop-after");

      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = "move";
      }
    });

    card.addEventListener("drop", async event => {
      if (draggedRankId === null || isSavingManualOrder) return;
      if (Number(card.dataset.entryId) === draggedRankId) return;
      if (Number(card.dataset.scoreValue) !== draggedScoreValue) return;

      event.preventDefault();

      const draggedCard = grid.querySelector(`.entry-card[data-entry-id="${draggedRankId}"]`);
      if (!draggedCard || draggedCard === card) return;

      const position = getDropPosition(event, card, grid);
      clearRankDropIndicators(grid);

      if (position === "before") {
        grid.insertBefore(draggedCard, card);
      } else {
        grid.insertBefore(draggedCard, card.nextElementSibling);
      }

      await saveManualTieOrder(grid, draggedScoreValue);
    });
  });
}

async function loadEntries() {
  updateSearchClear();
  const search = document.getElementById("search").value.trim().toLowerCase();
  const res = await fetch(API);
  const data = await res.json();

  entryCache = {};

  const filtered = data
    .filter(entry => {
      const title = String(entry.title || "").toLowerCase();
      if (!title.includes(search)) return false;
      if (hideNsfw && isNsfwEntry(entry)) return false;
      return true;
    });

  const container = document.getElementById("tiers");
  container.innerHTML = "";

  const entryCount = document.getElementById("entry-count");
  if (entryCount) entryCount.textContent = `${filtered.length} entries`;

  const grid = document.createElement("div");
  grid.className = "entry-grid";

  if (!filtered.length) {
    grid.innerHTML = `<div class="empty-state">No entries match your search.</div>`;
    container.appendChild(grid);
    return;
  }
  const sortValue = document.getElementById("sortSelect")?.value || "default";
  const canReorderTies = sortValue === "default" && search === "" && !hideNsfw;
  const scoreCounts = new Map();

  if (canReorderTies) {
    filtered.forEach(entry => {
      const numericScore = getNumericScore(entry);
      if (numericScore === Number.NEGATIVE_INFINITY) return;
      scoreCounts.set(numericScore, (scoreCounts.get(numericScore) || 0) + 1);
    });
  }

 if (sortValue === "year-desc") {
  filtered.sort((a, b) => {
    const diff = getSortTime(b.year) - getSortTime(a.year);
    if (diff !== 0) return diff;
    const sd = getTierOrder(a) - getTierOrder(b);
    if (sd !== 0) return sd;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
  } else if (sortValue === "year-asc") {
    filtered.sort((a, b) => {
      const diff = getSortTime(a.year) - getSortTime(b.year);
      if (diff !== 0) return diff;
      const sd = getTierOrder(a) - getTierOrder(b);
      if (sd !== 0) return sd;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  } else if (sortValue === "created-desc") {
    filtered.sort((a, b) => b.id - a.id);
  } else if (sortValue === "created-asc") {
    filtered.sort((a, b) => a.id - b.id);
  } else if (sortValue === "score-desc") {
    filtered.sort((a, b) => getTierOrder(a) - getTierOrder(b));
  } else if (sortValue === "score-asc") {
    filtered.sort((a, b) => getTierOrder(b) - getTierOrder(a));
    } else {
    sortDefaultEntries(filtered);
  }
  filtered.forEach((entry, index) => {
    entryCache[entry.id] = entry;

    const score = entry.score || null;
    const chapter = entry.chapter || "-";
    const year = entry.year || "-";
    const note = entry.note || "";
    const nsfw = isNsfwEntry(entry);
    const numericScore = getNumericScore(entry);
    const canDragRank = canReorderTies && numericScore !== Number.NEGATIVE_INFINITY && (scoreCounts.get(numericScore) || 0) > 1;
    const rankBadgeHtml = canDragRank
      ? `<div class="rank-badge rank-badge-draggable" draggable="true" title="Drag to reorder ties" aria-label="Drag to reorder ties">#${index + 1}</div>`
      : `<div class="rank-badge">#${index + 1}</div>`;

    const card = document.createElement("div");
    card.className = `entry-card ${score === "S+" ? "score-100" : ""}`;
    card.dataset.entryId = String(entry.id);
    card.dataset.scoreValue = String(numericScore);
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
          ${nsfw ? `<span class="badge badge-nsfw">NSFW</span>` : ""}
          ${score ? `<span class="tier-badge tier-${score.replace("+","plus")}">${escapeHtml(score)}</span>` : `<span class="tier-badge tier-ungraded">—</span>`}
          ${chapter && chapter !== "-" ? `<span>Ch: <b>${escapeHtml(chapter)}</b></span>` : ""}
          <span>
            ${String(entry.status).toLowerCase() === "finished" ? "Read" : "Started"}:
            <b>${escapeHtml(year)}</b>
          </span>
        </div>

        ${note ? `<div class="entry-note">${escapeHtml(note)}</div>` : ""}

        <div class="card-actions">
          <button class="card-btn edit" onclick="openEditModal(${entry.id})" aria-label="Edit entry">&#9998;</button>
          <button class="card-btn delete" onclick="deleteEntry(${entry.id})" aria-label="Delete entry">&times;</button>
        </div>
      </div>

      ${rankBadgeHtml}
    `;

    grid.appendChild(card);
  });

  if (canReorderTies) {
    setupRankDragging(grid);
  }

  container.appendChild(grid);
}
// scoreStyle removed — tiers are styled via CSS classes

document.getElementById("sortSelect")?.addEventListener("change", loadEntries);
updateNsfwToggle();
ensureEditModal();
loadEntries();
