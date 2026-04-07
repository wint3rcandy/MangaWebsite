const API = "http://192.168.1.166:3000/api/manga";

function toggleForm() {
  document.getElementById("add-form").classList.toggle("visible");
}

function getBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function addEntry() {
  const title = document.getElementById("f-title").value.trim();
  const score = document.getElementById("f-score").value;
  const status = document.getElementById("f-status").value;
  const chapter = document.getElementById("f-ch").value;
  const year = document.getElementById("f-year").value;

  const fileInput = document.getElementById("f-image");
  const file = fileInput.files[0];

  let image = "";
  if (file) {
    image = await getBase64(file);
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
      year,
      image
    })
  });

  document.getElementById("f-title").value = "";
  document.getElementById("f-score").value = "";
  document.getElementById("f-ch").value = "";
  document.getElementById("f-year").value = "";
  fileInput.value = "";

  loadEntries();
}

async function loadEntries() {
  const res = await fetch(API);
  const data = await res.json();

  const container = document.getElementById("tiers");
  container.innerHTML = "";

  if (data.length === 0) {
    container.innerHTML = "<p>No entries yet</p>";
    return;
  }

  data.forEach(entry => {
    const div = document.createElement("div");
    div.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; margin:10px 0;">
        ${entry.image ? `<img src="${entry.image}" style="width:40px;height:60px;object-fit:cover;border-radius:4px;">` : ""}
        <div>
          <b>${entry.title}</b> — ${entry.score} (${entry.status})
        </div>
      </div>
    `;
    container.appendChild(div);
  });
}

loadEntries();