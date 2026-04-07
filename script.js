const API = "http://192.168.1.166:3000/api/manga";

function toggleForm() {
  document.getElementById("add-form").classList.toggle("visible");
}

async function addEntry() {
  const formData = new FormData();

  formData.append("title", document.getElementById("f-title").value.trim());
  formData.append("score", document.getElementById("f-score").value);
  formData.append("status", document.getElementById("f-status").value);
  formData.append("chapter", document.getElementById("f-ch").value);
  formData.append("year", document.getElementById("f-year").value);

  const file = document.getElementById("f-image").files[0];
  if (file) {
    formData.append("image", file);
  }

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

async function loadEntries() {
  const res = await fetch(API);
  const data = await res.json();

  const container = document.getElementById("tiers");
  container.innerHTML = "";

  if (!data.length) {
    container.innerHTML = "<p>No entries yet</p>";
    return;
  }

  data.forEach(entry => {
    const imgSrc = entry.image
      ? `http://192.168.1.166:3000${entry.image}`
      : "";

    const div = document.createElement("div");
    div.innerHTML = `
      <div style="display:flex; align-items:center; gap:10px; margin:10px 0;">
        ${
          imgSrc
            ? `<img src="${imgSrc}" style="width:40px;height:60px;object-fit:cover;border-radius:4px;">`
            : ""
        }
        <div>
          <b>${entry.title}</b> — ${entry.score} (${entry.status})
        </div>
      </div>
    `;
    container.appendChild(div);
  });
}

loadEntries();