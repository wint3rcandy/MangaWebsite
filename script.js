// ===== DATA (you can edit/add here) =====
// let data is an example of how the data will look 
let data = [
  { title: "Berserk", score: 100, year: 2019, status: "Ongoing", ch: null },
  { title: "Chainsaw Man", score: 100, year: 2020, status: "Ongoing", ch: null },
  { title: "Kengan Asura", score: 100, year: 2020, status: "Finished", ch: null },
  { title: "Kingdom", score: 100, year: 2020, status: "Ongoing", ch: 844 },
  { title: "One Punch Man", score: 100, year: 2020, status: "Ongoing", ch: null },

  { title: "Blame!", score: 10, year: 2021, status: "Finished", ch: null },
  { title: "Claymore", score: 10, year: 2020, status: "Finished", ch: null },
  { title: "Demon Slayer", score: 10, year: 2020, status: "Finished", ch: null },
];

// ===== TIERS =====
const TIERS = [
  { id: "S", label: "S tier", min: 100, color: "#B8860B" },
  { id: "A", label: "A tier", min: 9, color: "#0D47A1" },
  { id: "B", label: "B tier", min: 8, color: "#4A148C" },
  { id: "C", label: "C tier", min: 7, color: "#212121" },
  { id: "D", label: "D tier", min: 6, color: "#7F0000" },
  { id: "F", label: "F tier", min: 0, color: "#3E1000" },
];

function getTier(score) {
  return TIERS.find(t => score >= t.min);
}

// ===== UI STATE =====
let expanded = {};
let collapsed = {};
let formOpen = false;

// ===== FORM =====
function toggleForm() {
  formOpen = !formOpen;
  document.getElementById("add-form").classList.toggle("visible", formOpen);
  document.getElementById("toggle-btn").classList.toggle("open", formOpen);
}

function addEntry() {
  const title = document.getElementById("f-title").value.trim();
  const score = parseFloat(document.getElementById("f-score").value);
  const status = document.getElementById("f-status").value;
  const ch = document.getElementById("f-ch").value || null;
  const year = document.getElementById("f-year").value || new Date().getFullYear();

  if (!title || isNaN(score)) return;

  data.push({ title, score, year, status, ch: ch ? Number(ch) : null });

  document.getElementById("f-title").value = "";
  document.getElementById("f-score").value = "";
  document.getElementById("f-ch").value = "";
  document.getElementById("f-year").value = "";

  render();
}

// ===== EXPAND =====
function toggleExpand(title) {
  expanded[title] = !expanded[title];
  render();
}

// ===== DELETE =====
function deleteEntry(title) {
  data = data.filter(d => d.title !== title);
  render();
}

// ===== RENDER =====
function render() {
  const search = document.getElementById("search").value.toLowerCase();

  let filtered = data.filter(d =>
    d.title.toLowerCase().includes(search)
  );

  filtered.sort((a, b) => b.score - a.score);

  // stats
  document.getElementById("stats").innerHTML =
    TIERS.map(t => {
      const count = filtered.filter(d => getTier(d.score).id === t.id).length;
      return count ? `<div class="stat"><b style="color:${t.color}">${t.id}</b> ${count}</div>` : "";
    }).join("") + `<div class="stat">Total <b>${filtered.length}</b></div>`;

  const container = document.getElementById("tiers");
  container.innerHTML = "";

  let rank = 1;

  TIERS.forEach(tier => {
    const items = filtered.filter(d => getTier(d.score).id === tier.id);
    if (!items.length) return;

    const section = document.createElement("div");
    section.className = "tier-section";

    const header = document.createElement("div");
    header.className = "tier-header";
    header.style.background = tier.color;

    header.innerHTML = `
      <span>${tier.label}</span>
      <span class="tier-count">${items.length} titles</span>
      <span class="tier-toggle">${collapsed[tier.id] ? "▶" : "▼"}</span>
    `;

    header.onclick = () => {
      collapsed[tier.id] = !collapsed[tier.id];
      render();
    };

    const body = document.createElement("div");
    body.style.display = collapsed[tier.id] ? "none" : "block";

    const table = document.createElement("table");
    table.innerHTML = `
      <thead>
        <tr>
          <th>#</th><th></th><th>Title</th><th>Score</th>
          <th>Status</th><th>Chapter</th><th>Year</th><th></th>
        </tr>
      </thead>
    `;

    const tbody = document.createElement("tbody");

    items.forEach(item => {
      const tr = document.createElement("tr");
      tr.className = "row";

      const isOpen = expanded[item.title];

      tr.innerHTML = `
        <td class="rank">${rank++}</td>
        <td class="thumb-cell"><div class="thumb-placeholder">?</div></td>
        <td class="title-cell">${item.title}</td>
        <td>
          <input class="score-input" type="number" value="${item.score}">
        </td>
        <td><span class="badge status-${item.status.toLowerCase()}">${item.status}</span></td>
        <td>${item.ch ? "ch. " + item.ch : "—"}</td>
        <td>${item.year}</td>
        <td><button class="del-btn">✕</button></td>
      `;

      tr.onclick = (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "BUTTON") return;
        toggleExpand(item.title);
      };

      // score change
      tr.querySelector("input").onchange = (e) => {
        item.score = parseFloat(e.target.value);
        render();
      };

      // delete
      tr.querySelector(".del-btn").onclick = (e) => {
        e.stopPropagation();
        deleteEntry(item.title);
      };

      const expand = document.createElement("tr");
      expand.className = "expand-row" + (isOpen ? " open" : "");

      expand.innerHTML = `
        <td colspan="8" class="expand-cell">
          <div class="expand-inner">
            <div class="poster-empty">No poster</div>
            <div class="poster-info">
              <h2>${item.title}</h2>
              <div class="info-grid">
                <span class="lbl">Score</span><span>${item.score}</span>
                <span class="lbl">Status</span><span>${item.status}</span>
                <span class="lbl">Chapter</span><span>${item.ch || "—"}</span>
                <span class="lbl">Year</span><span>${item.year}</span>
              </div>
            </div>
          </div>
        </td>
      `;

      tbody.appendChild(tr);
      tbody.appendChild(expand);
    });

    table.appendChild(tbody);
    body.appendChild(table);

    section.appendChild(header);
    section.appendChild(body);
    container.appendChild(section);
  });
}

render();  