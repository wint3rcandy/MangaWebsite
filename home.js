const API = "/api/manga";
const LIBRARY_API = "/api/library";
const CHAPTER_FILE_PATTERN = /(?:^|[^a-z0-9])(?:ch(?:apter)?|c)[\s._-]*0*\d+(?=[^a-z0-9]|$)/i;
const VOLUME_FILE_PATTERN = /(?:^|[^a-z0-9])(?:vol(?:ume)?|v)[\s._-]*0*\d+(?=[^a-z0-9]|$)/i;

let allLibraryEntries = [];
let entryCache = {};
let editingId = null;
let hideHomeNsfw = false;
let isAddingEntry = false;
const posterFetchInFlight = new Set();
const posterFetchAttempted = new Set();
const STATUS_LABELS = {
  reading: "Reading",
  "want to read": "Want to Read",
  finished: "Finished",
  hiatus: "Hiatus",
  cancelled: "Cancelled"
};

try {
  hideHomeNsfw = localStorage.getItem("hide-nsfw") === "true";
} catch {}

function normalizeStatusValue(status) {
  const value = String(status || "").trim().toLowerCase();
  if (value === "canceled") return "cancelled";
  if (value === "want-to-read" || value === "wanttoread") return "want to read";
  if (value === "ongoing") return "reading";
  return value;
}

function getStatusLabel(status) {
  const normalized = normalizeStatusValue(status);
  if (!normalized) return "";
  return STATUS_LABELS[normalized] || String(status || "").trim();
}

function getStatusSelectValue(status) {
  return getStatusLabel(status) || "Want to Read";
}

function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isNsfwEntry(entry) {
  const value = entry?.nsfw;
  return value === true || value === "true" || value === 1 || value === "1" || value === "on";
}

function statusClass(status) {
  const value = normalizeStatusValue(status);
  if (value === "want to read") return "status-want-to-read";
  if (value === "reading") return "status-reading";
  if (value === "finished") return "status-finished";
  if (value === "hiatus") return "status-hiatus";
  if (value === "cancelled") return "status-cancelled";
  return "status-unknown";
}

function getStatusProgressLabel(status) {
  const value = normalizeStatusValue(status);
  if (value === "finished") return "Read";
  if (value === "want to read") return "Added";
  return "Started";
}

function getTierOrder(entry) {
  const value = String(entry?.score || "").toUpperCase();
  if (value === "S+") return 0;
  if (value === "S") return 1;
  if (value === "A") return 2;
  if (value === "B") return 3;
  if (value === "C") return 4;
  if (value === "D") return 5;
  if (value === "F") return 6;
  return 99;
}

function getReadProgress(entry) {
  const raw = String(entry?.chapter ?? "").trim();
  if (!raw) return 0;

  const parsed = Number.parseFloat(raw.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function isUnreadEntry(entry) {
  return getTierOrder(entry) === 99 && getReadProgress(entry) <= 0;
}

function getSortTime(value) {
  if (typeof value !== "string" || value.trim() === "") return Number.NEGATIVE_INFINITY;
  const raw = value.trim();

  if (/^\d{4}$/.test(raw)) {
    return Number(raw);
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}

function matchesSearch(entry, search) {
  if (!search) return true;
  return String(entry?.title || "").toLowerCase().includes(search);
}

function getEntryCollectionUnit(entry) {
  if (entry?.cbzUnit === "chapter") return "chapter";
  if (entry?.cbzUnit === "volume") return "volume";
  return "file";
}

function inferCollectionUnitFromFiles(files) {
  let chapterMatches = 0;
  let volumeMatches = 0;

  files.forEach(file => {
    const basename = String(file?.filename || "").replace(/\.cbz$/i, "");

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

async function hydrateCollectionUnits(entries) {
  const readableEntries = entries.filter(entry => entry.hasCbz);

  await Promise.all(readableEntries.map(async entry => {
    if (entry.cbzUnit === "chapter" || entry.cbzUnit === "volume") return;

    try {
      const response = await fetch(`/api/manga/${entry.id}/cbz`);
      if (!response.ok) return;

      const files = await response.json();
      entry.cbzUnit = inferCollectionUnitFromFiles(files);
    } catch (error) {
      console.error(`Failed to inspect CBZ files for ${entry.title || entry.id}`, error);
    }
  }));
}

async function fetchPosterForEntry(id) {
  const response = await fetch(`${API}/${encodeURIComponent(id)}/fetch-poster`, {
    method: "POST"
  });

  if (!response.ok) return null;
  return response.json();
}

async function requestMissingPoster(id) {
  const key = String(id || "");
  if (!key || posterFetchInFlight.has(key) || posterFetchAttempted.has(key)) return;

  posterFetchAttempted.add(key);
  posterFetchInFlight.add(key);

  try {
    const updatedEntry = await fetchPosterForEntry(key);
    if (!updatedEntry?.image) return;

    const index = allLibraryEntries.findIndex(entry => String(entry.id) === key);
    if (index !== -1) {
      allLibraryEntries[index] = {
        ...allLibraryEntries[index],
        ...updatedEntry
      };
    }

    entryCache[key] = {
      ...(entryCache[key] || {}),
      ...updatedEntry
    };

    renderHome();
  } catch (error) {
    console.error(`Failed to fetch missing poster for entry ${key}`, error);
  } finally {
    posterFetchInFlight.delete(key);
  }
}

function getCardPosterSrc(entry) {
  return entry?.thumbnail || entry?.image || "";
}

function getAddProgressElements() {
  return {
    form: document.getElementById("add-form"),
    submit: document.getElementById("add-submit-btn"),
    progress: document.getElementById("add-progress"),
    label: document.getElementById("add-progress-label"),
    value: document.getElementById("add-progress-value"),
    fill: document.getElementById("add-progress-fill")
  };
}

function setAddFormBusy(isBusy) {
  const { form, submit } = getAddProgressElements();
  if (!form) return;

  form.classList.toggle("is-busy", isBusy);
  form.querySelectorAll("input, select, button").forEach(control => {
    control.disabled = isBusy;
  });

  if (submit) {
    submit.textContent = isBusy ? "Working..." : "Add Entry";
  }
}

function setAddProgress(percent, label) {
  const { progress, label: labelEl, value, fill } = getAddProgressElements();
  if (!progress || !labelEl || !value || !fill) return;

  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  progress.hidden = false;
  progress.classList.add("visible");
  labelEl.textContent = label;
  value.textContent = `${safePercent}%`;
  fill.style.width = `${safePercent}%`;
}

function resetAddProgress() {
  const { progress, label, value, fill } = getAddProgressElements();
  if (!progress || !label || !value || !fill) return;

  progress.hidden = true;
  progress.classList.remove("visible");
  label.textContent = "Preparing entry...";
  value.textContent = "0%";
  fill.style.width = "0%";
}

function formatCollectionCount(count, unit = "file") {
  const total = Number(count) || 0;
  const label = unit === "chapter"
    ? (total === 1 ? "chapter" : "chapters")
    : unit === "volume"
      ? (total === 1 ? "volume" : "volumes")
      : (total === 1 ? "file" : "files");
  return `${total} ${label}`;
}

function getReadableEntries() {
  return allLibraryEntries.filter(entry => entry.hasCbz && !isUnreadEntry(entry));
}

function getUnreadEntries() {
  return allLibraryEntries.filter(isUnreadEntry);
}

function getAllowedReadableEntries() {
  return getReadableEntries().filter(entry => !(hideHomeNsfw && isNsfwEntry(entry)));
}

function getAllowedUnreadEntries() {
  return getUnreadEntries().filter(entry => !(hideHomeNsfw && isNsfwEntry(entry)));
}

function sortReadableEntries(entries) {
  return entries.sort((a, b) => {
    const tierDiff = getTierOrder(a) - getTierOrder(b);
    if (tierDiff !== 0) return tierDiff;

    const yearDiff = getSortTime(b.year) - getSortTime(a.year);
    if (yearDiff !== 0) return yearDiff;

    const volumeDiff = Number(b.cbzCount || 0) - Number(a.cbzCount || 0);
    if (volumeDiff !== 0) return volumeDiff;

    return String(a.title || "").localeCompare(String(b.title || ""));
  });
}

function sortUnreadEntries(entries) {
  return entries.sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
}

function getSearchValue() {
  return document.getElementById("home-search")?.value.trim().toLowerCase() || "";
}

function updateSearchClear() {
  const clear = document.getElementById("home-search-clear");
  if (!clear) return;
  clear.hidden = getSearchValue() === "";
}

function updateHomeNsfwToggle() {
  const button = document.getElementById("home-nsfw-toggle");
  if (!button) return;

  button.textContent = hideHomeNsfw ? "Show NSFW" : "Hide NSFW";
  button.classList.toggle("active", hideHomeNsfw);
  button.setAttribute("aria-pressed", String(hideHomeNsfw));
}

function toggleHomeNsfw() {
  hideHomeNsfw = !hideHomeNsfw;

  try {
    localStorage.setItem("hide-nsfw", String(hideHomeNsfw));
  } catch {}

  updateHomeNsfwToggle();
  renderHome();
}

function handleHomeSearch() {
  updateSearchClear();
  renderHome();
}

function toggleForm() {
  if (isAddingEntry) return;

  const form = document.getElementById("add-form");
  const panel = document.getElementById("add-panel");
  const btn = document.getElementById("toggle-btn");
  const toggle = document.querySelector(".add-toggle");

  if (!form || !panel || !btn) return;

  const isOpen = form.classList.toggle("visible");
  panel.classList.toggle("open", isOpen);
  btn.classList.toggle("open", isOpen);
  toggle?.setAttribute("aria-expanded", String(isOpen));

  if (isOpen) {
    document.getElementById("f-title")?.focus();
  }
}

function clearHomeSearch() {
  const input = document.getElementById("home-search");
  if (!input) return;
  input.value = "";
  updateSearchClear();
  renderHome();
  input.focus();
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
            <option>Want to Read</option>
            <option>Reading</option>
            <option>Finished</option>
            <option>Hiatus</option>
            <option>Cancelled</option>
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
  const entry = entryCache[String(id)];
  if (!entry) return;

  ensureEditModal();
  editingId = id;

  document.getElementById("edit-title").value = entry.title || "";
  document.getElementById("edit-score").value = entry.score || "";
  document.getElementById("edit-status").value = getStatusSelectValue(entry.status);
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

async function addEntry() {
  if (isAddingEntry) return;

  const titleInput = document.getElementById("f-title");
  const title = titleInput?.value.trim() || "";

  if (!title) {
    alert("Enter a title.");
    titleInput?.focus();
    return;
  }

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

  formData.append("title", title);
  formData.append("score", document.getElementById("f-score").value);
  formData.append("status", document.getElementById("f-status").value);
  formData.append("chapter", document.getElementById("f-ch").value);
  formData.append("year", yearInput);
  formData.append("note", document.getElementById("f-note").value.trim());
  formData.append("nsfw", document.getElementById("f-nsfw").checked ? "true" : "false");

  const file = document.getElementById("f-image").files[0];
  if (file) formData.append("image", file);

  isAddingEntry = true;
  setAddFormBusy(true);
  setAddProgress(16, file ? "Uploading your entry..." : "Creating your entry...");

  try {
    const response = await fetch(API, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      throw new Error("Failed to add the entry.");
    }

    let createdEntry = await response.json();
    setAddProgress(54, file ? "Saving uploaded poster..." : "Entry saved. Checking poster...");

    if (!file && createdEntry?.id && !createdEntry?.image) {
      setAddProgress(76, "Fetching poster from AniList...");
      const fetchedEntry = await fetchPosterForEntry(createdEntry.id);
      if (fetchedEntry?.image) {
        createdEntry = fetchedEntry;
        setAddProgress(94, "Poster saved to uploads.");
      } else {
        setAddProgress(94, "Finishing without a poster.");
      }
    } else {
      setAddProgress(94, file ? "Poster uploaded." : "Poster saved to uploads.");
    }

    titleInput.value = "";
    document.getElementById("f-score").value = "";
    document.getElementById("f-ch").value = "";
    document.getElementById("f-year").value = "";
    document.getElementById("f-image").value = "";
    document.getElementById("f-note").value = "";
    document.getElementById("f-nsfw").checked = false;

    await loadHomePage();
    setAddProgress(100, "Complete.");
    await new Promise(resolve => setTimeout(resolve, 320));
    resetAddProgress();
    titleInput.focus();
  } catch (error) {
    console.error(error);
    setAddProgress(100, "Something went wrong.");
    await new Promise(resolve => setTimeout(resolve, 500));
    resetAddProgress();
    alert("Failed to add the entry.");
  } finally {
    setAddFormBusy(false);
    isAddingEntry = false;
  }
}

async function saveEditEntry() {
  if (!editingId) return;

  const formData = new FormData();
  const yearInput = document.getElementById("edit-year").value.trim();

  if (
    yearInput &&
    !/^\d{4}$/.test(yearInput) &&
    !/^\d{2}\/\d{2}\/\d{4}$/.test(yearInput)
  ) {
    alert("Enter either YYYY or MM/DD/YYYY");
    return;
  }

  formData.append("title", document.getElementById("edit-title").value.trim());
  formData.append("score", document.getElementById("edit-score").value);
  formData.append("status", document.getElementById("edit-status").value);
  formData.append("chapter", document.getElementById("edit-chapter").value);
  formData.append("year", yearInput);
  formData.append("note", document.getElementById("edit-note").value.trim());
  formData.append("nsfw", document.getElementById("edit-nsfw").checked ? "true" : "false");

  const file = document.getElementById("edit-image").files[0];
  if (file) formData.append("image", file);

  const response = await fetch(`${API}/${editingId}`, {
    method: "PUT",
    body: formData
  });

  if (!response.ok) {
    alert("Failed to save the entry.");
    return;
  }

  closeEditModal();
  await loadHomePage();
}

function buildHomeCard(entry, index = 0) {
  const score = entry.score || null;
  const chapter = entry.chapter || "-";
  const year = entry.year || "-";
  const nsfw = isNsfwEntry(entry);
  const posterSrc = getCardPosterSrc(entry);
  const isPriorityPoster = index < 6;

  if (!entry.image) {
    void requestMissingPoster(entry.id);
  }

  const card = document.createElement("article");
  card.className = "entry-card home-entry-card";
  card.innerHTML = `
    <a class="entry-poster entry-poster-link" href="/reader?id=${entry.id}" aria-label="Open reader for ${escapeHtml(entry.title || "Untitled")}">
      ${posterSrc
        ? `<img class="poster-img" src="${posterSrc}" alt="${escapeHtml(entry.title)}" loading="${isPriorityPoster ? "eager" : "lazy"}" decoding="async" fetchpriority="${isPriorityPoster ? "high" : "low"}" width="300" height="400">`
        : `<div class="poster-empty">No Image</div>`
      }
      <span class="home-volume-badge">${escapeHtml(formatCollectionCount(entry.cbzCount, getEntryCollectionUnit(entry)))}</span>
    </a>
    <div class="entry-content">
      <h2 class="entry-title">${escapeHtml(entry.title || "Untitled")}</h2>
      <div class="entry-meta">
        <span class="badge ${statusClass(entry.status)}">${escapeHtml(getStatusLabel(entry.status) || "Unknown")}</span>
        ${nsfw ? `<span class="badge badge-nsfw">NSFW</span>` : ""}
        ${score ? `<span class="tier-badge tier-${score.replace("+", "plus")}">${escapeHtml(score)}</span>` : `<span class="tier-badge tier-ungraded">--</span>`}
        ${chapter && chapter !== "-" ? `<span>Ch: <b>${escapeHtml(chapter)}</b></span>` : ""}
        <span>${getStatusProgressLabel(entry.status)}: <b>${escapeHtml(year)}</b></span>
      </div>
      <div class="card-actions home-card-actions">
        <a class="card-read-btn" href="/reader?id=${entry.id}" aria-label="Open reader for ${escapeHtml(entry.title)}">Open Reader</a>
        <span class="home-files-pill">${escapeHtml(formatCollectionCount(entry.cbzCount, getEntryCollectionUnit(entry)))}</span>
      </div>
    </div>
  `;

  return card;
}

function buildUnreadCard(entry, index = 0) {
  const nsfw = isNsfwEntry(entry);
  const safeTitle = escapeHtml(entry.title || "Untitled");
  const posterSrc = getCardPosterSrc(entry);
  const isPriorityPoster = index < 6;

  if (!entry.image) {
    void requestMissingPoster(entry.id);
  }

  const card = document.createElement("article");
  card.className = "entry-card home-entry-card home-unread-card";
  card.innerHTML = `
    <a class="entry-poster entry-poster-link" href="/reader?id=${entry.id}" aria-label="Open reader for ${safeTitle}">
      ${posterSrc
        ? `<img class="poster-img" src="${posterSrc}" alt="${safeTitle}" loading="${isPriorityPoster ? "eager" : "lazy"}" decoding="async" fetchpriority="${isPriorityPoster ? "high" : "low"}" width="300" height="400">`
        : `<div class="poster-empty">No Image</div>`
      }
    </a>
    <div class="entry-content">
      <h2 class="entry-title">${safeTitle}</h2>
      <div class="entry-meta">
        <span class="badge ${statusClass(entry.status)}">${escapeHtml(getStatusLabel(entry.status) || "Unknown")}</span>
        ${nsfw ? `<span class="badge badge-nsfw">NSFW</span>` : ""}
        <span class="tier-badge tier-ungraded">Unread</span>
      </div>
      <div class="card-actions home-card-actions">
        <div class="card-action-right">
          <button class="card-btn edit home-unread-edit" type="button" onclick="openEditModal(${entry.id})" aria-label="Edit ${safeTitle}">&#9998;</button>
        </div>
      </div>
    </div>
  `;

  return card;
}

function updateSummary(allowedReadableEntries) {
  const entryCount = document.getElementById("home-entry-count");
  if (entryCount) {
    entryCount.textContent = `${allowedReadableEntries.length} ready`;
  }
}

function renderGrid(allowedReadableEntries, visibleReadableEntries) {
  const grid = document.getElementById("home-library-grid");
  if (!grid) return;

  grid.innerHTML = "";

  if (!allowedReadableEntries.length) {
    grid.innerHTML = `
      <div class="empty-state home-empty-state">
        No started readable manga are available yet.
      </div>
    `;
    return;
  }

  if (!visibleReadableEntries.length) {
    grid.innerHTML = `
      <div class="empty-state home-empty-state">
        No readable manga match your search right now.
      </div>
    `;
    return;
  }

  visibleReadableEntries.forEach((entry, index) => {
    grid.appendChild(buildHomeCard(entry, index));
  });
}

function renderUnread(allowedUnreadEntries, visibleUnreadEntries) {
  const grid = document.getElementById("home-unread-grid");
  const copy = document.getElementById("home-unread-copy");
  if (!grid) return;

  grid.innerHTML = "";

  if (copy) {
    if (!allowedUnreadEntries.length) {
      copy.textContent = "Nothing is waiting in your unread backlog right now.";
    } else if (!visibleUnreadEntries.length) {
      copy.textContent = "No unread entries match your current search.";
    } else {
      const label = visibleUnreadEntries.length === 1 ? "title" : "titles";
      copy.textContent = `${visibleUnreadEntries.length} unread ${label} waiting in your backlog.`;
    }
  }

  if (!allowedUnreadEntries.length) {
    grid.innerHTML = `
      <div class="empty-state home-empty-state">
        Everything you are tracking has already been started.
      </div>
    `;
    return;
  }

  if (!visibleUnreadEntries.length) {
    grid.innerHTML = `
      <div class="empty-state home-empty-state">
        No unread entries match your search right now.
      </div>
    `;
    return;
  }

  visibleUnreadEntries.forEach((entry, index) => {
    grid.appendChild(buildUnreadCard(entry, index));
  });
}

function renderHome() {
  const search = getSearchValue();
  const allowedReadableEntries = sortReadableEntries([...getAllowedReadableEntries()]);
  const allowedUnreadEntries = sortUnreadEntries([...getAllowedUnreadEntries()]);
  const visibleReadableEntries = allowedReadableEntries.filter(entry => matchesSearch(entry, search));
  const visibleUnreadEntries = allowedUnreadEntries.filter(entry => matchesSearch(entry, search));

  updateSummary(allowedReadableEntries);
  renderGrid(allowedReadableEntries, visibleReadableEntries);
  renderUnread(allowedUnreadEntries, visibleUnreadEntries);
}

async function loadHomePage() {
  updateHomeNsfwToggle();
  updateSearchClear();

  try {
    const response = await fetch(LIBRARY_API);
    if (!response.ok) throw new Error(`Library request failed: ${response.status}`);
    allLibraryEntries = await response.json();
    entryCache = {};
    allLibraryEntries.forEach(entry => {
      entryCache[String(entry.id)] = entry;
    });
    await hydrateCollectionUnits(allLibraryEntries);
    renderHome();
  } catch (error) {
    const grid = document.getElementById("home-library-grid");
    const unreadGrid = document.getElementById("home-unread-grid");
    const unreadCopy = document.getElementById("home-unread-copy");

    if (unreadCopy) {
      unreadCopy.textContent = "Failed to load your unread backlog.";
    }

    if (grid) {
      grid.innerHTML = `<div class="empty-state home-empty-state">Failed to load your manga library.</div>`;
    }

    if (unreadGrid) {
      unreadGrid.innerHTML = `<div class="empty-state home-empty-state">Failed to load your unread backlog.</div>`;
    }

    console.error(error);
  }
}

loadHomePage();
