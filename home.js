const LIBRARY_API = "/api/library";
const CHAPTER_FILE_PATTERN = /(?:^|[^a-z0-9])(?:ch(?:apter)?|c)[\s._-]*0*\d+(?=[^a-z0-9]|$)/i;
const VOLUME_FILE_PATTERN = /(?:^|[^a-z0-9])(?:vol(?:ume)?|v)[\s._-]*0*\d+(?=[^a-z0-9]|$)/i;

let allLibraryEntries = [];
let hideHomeNsfw = false;

try {
  hideHomeNsfw = localStorage.getItem("hide-nsfw") === "true";
} catch {}

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
  const value = String(status || "").toLowerCase();
  if (value === "ongoing") return "status-ongoing";
  if (value === "finished") return "status-finished";
  if (value === "hiatus") return "status-hiatus";
  return "status-unknown";
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

function getSortTime(value) {
  if (typeof value !== "string" || value.trim() === "") return Number.NEGATIVE_INFINITY;
  const raw = value.trim();

  if (/^\d{4}$/.test(raw)) {
    return Number(raw);
  }

  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
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
  return allLibraryEntries.filter(entry => entry.hasCbz);
}

function getAllowedEntries() {
  return getReadableEntries().filter(entry => !(hideHomeNsfw && isNsfwEntry(entry)));
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

function sortSpotlightEntries(entries) {
  return entries.sort((a, b) => {
    const volumeDiff = Number(b.cbzCount || 0) - Number(a.cbzCount || 0);
    if (volumeDiff !== 0) return volumeDiff;

    const tierDiff = getTierOrder(a) - getTierOrder(b);
    if (tierDiff !== 0) return tierDiff;

    return String(a.title || "").localeCompare(String(b.title || ""));
  });
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

function clearHomeSearch() {
  const input = document.getElementById("home-search");
  if (!input) return;
  input.value = "";
  updateSearchClear();
  renderHome();
  input.focus();
}

function renderSpotlight(entries) {
  const spotlight = document.getElementById("home-spotlight");
  if (!spotlight) return;

  const featured = sortSpotlightEntries([...entries]).slice(0, 3);

  if (!featured.length) {
    spotlight.innerHTML = `
      <div class="home-spotlight-empty">
        Upload CBZ files to a manga entry and it will show up here.
      </div>
    `;
    return;
  }

  spotlight.innerHTML = "";

  featured.forEach((entry, index) => {
    const item = document.createElement("article");
    item.className = "home-spotlight-item";
    item.innerHTML = `
      <span class="home-spotlight-rank">0${index + 1}</span>
      <div class="home-spotlight-body">
        <div class="home-spotlight-title">${escapeHtml(entry.title || "Untitled")}</div>
        <div class="home-spotlight-meta">
          ${formatCollectionCount(entry.cbzCount, getEntryCollectionUnit(entry))}${entry.status ? ` | ${escapeHtml(entry.status)}` : ""}
        </div>
      </div>
      <a class="home-spotlight-link" href="/reader?id=${entry.id}">Read</a>
    `;
    spotlight.appendChild(item);
  });
}

function buildHomeCard(entry) {
  const score = entry.score || null;
  const chapter = entry.chapter || "-";
  const year = entry.year || "-";
  const note = entry.note || "";
  const nsfw = isNsfwEntry(entry);

  const card = document.createElement("article");
  card.className = "entry-card home-entry-card";
  card.innerHTML = `
    <div class="entry-poster">
      ${entry.image
        ? `<img class="poster-img" src="${entry.image}" alt="${escapeHtml(entry.title)}">`
        : `<div class="poster-empty">No Image</div>`
      }
      ${note ? `<div class="note-tooltip">${escapeHtml(note)}</div><div class="note-indicator" aria-label="Has note">&#9998;</div>` : ""}
      <span class="home-volume-badge">${escapeHtml(formatCollectionCount(entry.cbzCount, getEntryCollectionUnit(entry)))}</span>
    </div>
    <div class="entry-content">
      <h2 class="entry-title">${escapeHtml(entry.title || "Untitled")}</h2>
      <div class="entry-meta">
        <span class="badge ${statusClass(entry.status)}">${escapeHtml(entry.status || "Unknown")}</span>
        ${nsfw ? `<span class="badge badge-nsfw">NSFW</span>` : ""}
        ${score ? `<span class="tier-badge tier-${score.replace("+", "plus")}">${escapeHtml(score)}</span>` : `<span class="tier-badge tier-ungraded">--</span>`}
        ${chapter && chapter !== "-" ? `<span>Ch: <b>${escapeHtml(chapter)}</b></span>` : ""}
        <span>${String(entry.status).toLowerCase() === "finished" ? "Read" : "Started"}: <b>${escapeHtml(year)}</b></span>
      </div>
      <div class="card-actions home-card-actions">
        <a class="card-read-btn" href="/reader?id=${entry.id}" aria-label="Open reader for ${escapeHtml(entry.title)}">Open Reader</a>
        <span class="home-files-pill">${escapeHtml(formatCollectionCount(entry.cbzCount, getEntryCollectionUnit(entry)))}</span>
      </div>
    </div>
  `;

  return card;
}

function updateSummary(allowedEntries, visibleEntries) {
  const totalFiles = allowedEntries.reduce((sum, entry) => sum + (Number(entry.cbzCount) || 0), 0);
  const visibleFiles = visibleEntries.reduce((sum, entry) => sum + (Number(entry.cbzCount) || 0), 0);

  const entryCount = document.getElementById("home-entry-count");
  if (entryCount) {
    entryCount.textContent = `${allowedEntries.length} ready`;
  }

  const readyCount = document.getElementById("home-ready-count");
  if (readyCount) readyCount.textContent = String(allowedEntries.length);

  const totalCount = document.getElementById("home-total-count");
  if (totalCount) totalCount.textContent = String(allLibraryEntries.length);

  const visibleCount = document.getElementById("home-visible-count");
  if (visibleCount) visibleCount.textContent = String(visibleEntries.length);

  const volumeCount = document.getElementById("home-volume-count");
  if (volumeCount) volumeCount.textContent = formatCollectionCount(totalFiles, "file");

  const resultsCopy = document.getElementById("home-results-copy");
  if (!resultsCopy) return;

  if (!allowedEntries.length) {
    resultsCopy.textContent = "No reader-ready manga match the current NSFW filter yet.";
    return;
  }

  if (!visibleEntries.length) {
    resultsCopy.textContent = "No readable manga match your current search.";
    return;
  }

  resultsCopy.textContent = `Showing ${visibleEntries.length} readable series with ${formatCollectionCount(visibleFiles, "file")} loaded.`;
}

function renderGrid(allowedEntries, visibleEntries) {
  const grid = document.getElementById("home-library-grid");
  if (!grid) return;

  grid.innerHTML = "";

  if (!allowedEntries.length) {
    grid.innerHTML = `
      <div class="empty-state home-empty-state">
        No readable manga are available yet. Upload CBZ files from the <a href="/rankings">rankings page</a> to build your library.
      </div>
    `;
    return;
  }

  if (!visibleEntries.length) {
    grid.innerHTML = `
      <div class="empty-state home-empty-state">
        No readable manga match your search right now.
      </div>
    `;
    return;
  }

  visibleEntries.forEach(entry => {
    grid.appendChild(buildHomeCard(entry));
  });
}

function renderHome() {
  const allowedEntries = sortReadableEntries([...getAllowedEntries()]);
  const search = getSearchValue();
  const visibleEntries = allowedEntries.filter(entry => {
    if (!search) return true;
    return String(entry.title || "").toLowerCase().includes(search);
  });

  updateSummary(allowedEntries, visibleEntries);
  renderSpotlight(allowedEntries);
  renderGrid(allowedEntries, visibleEntries);
}

async function loadHomePage() {
  updateHomeNsfwToggle();
  updateSearchClear();

  try {
    const response = await fetch(LIBRARY_API);
    if (!response.ok) throw new Error(`Library request failed: ${response.status}`);
    allLibraryEntries = await response.json();
    await hydrateCollectionUnits(allLibraryEntries);
    renderHome();
  } catch (error) {
    const grid = document.getElementById("home-library-grid");
    const resultsCopy = document.getElementById("home-results-copy");
    const spotlight = document.getElementById("home-spotlight");

    if (resultsCopy) {
      resultsCopy.textContent = "Failed to load your manga library.";
    }

    if (spotlight) {
      spotlight.innerHTML = `<div class="home-spotlight-empty">Failed to load spotlight entries.</div>`;
    }

    if (grid) {
      grid.innerHTML = `<div class="empty-state home-empty-state">Failed to load your manga library.</div>`;
    }

    console.error(error);
  }
}

loadHomePage();
