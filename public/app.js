// ============================================
// TutAR Frontend — app.js
// Talks to the Node.js backend via fetch()
// ============================================

const EMOJIS = {
  Science: "🔬", Biology: "🌿", Chemistry: "⚗️", Physics: "⚡",
  Maths: "📐", EVS: "🌍", English: "📚", GK: "🌟",
  Animals: "🐾", "Social Science": "🏛️", General: "🎯",
};

const BGTYPES = ["bg-purple", "bg-green", "bg-blue", "bg-gray"];

let panelOpen = false;

// ── Load classes on start ──
async function loadClasses() {
  try {
    const res = await fetch("/api/classes");
    const data = await res.json();
    const sel = document.getElementById("classSelect");
    const ORDER = ["Kindergarten","1","2","3","4","5","6","7","8","9","10","11","12","Miscellaneous"];
    for (const cls of ORDER) {
      if (!data.classes.includes(cls)) continue;
      const opt = document.createElement("option");
      opt.value = cls;
      opt.textContent = cls === "Kindergarten" || cls === "Miscellaneous" ? cls : `Class ${cls}`;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", loadSubjects);
  } catch (e) {
    console.error("Failed to load classes:", e);
  }
}

// ── Load subjects when class changes ──
async function loadSubjects() {
  const cls = document.getElementById("classSelect").value;
  const sel = document.getElementById("subjectSelect");
  sel.innerHTML = '<option value="">All Subjects</option>';
  sel.disabled = !cls;
  if (!cls) return;
  try {
    const res = await fetch(`/api/subjects?class=${encodeURIComponent(cls)}`);
    const data = await res.json();
    for (const subj of data.subjects) {
      const opt = document.createElement("option");
      opt.value = subj; opt.textContent = subj;
      sel.appendChild(opt);
    }
    sel.disabled = false;
  } catch (e) { console.error("Failed to load subjects:", e); }
}

// ── Load stats ──
async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();
    document.getElementById("totalPill").textContent =
      `${data.totalModels.toLocaleString()} 3D Models · ${data.totalClasses} Classes · ${data.totalSubjects} Subjects`;
  } catch (e) {}
}

// ── Quick search helper ──
function quickSearch(cls, subj, query) {
  document.getElementById("classSelect").value = cls;
  document.getElementById("classSelect").dispatchEvent(new Event("change"));
  setTimeout(() => {
    document.getElementById("subjectSelect").value = subj;
    document.getElementById("queryInput").value = query;
    doSearch();
  }, 80);
}

// ── Main search ──
async function doSearch() {
  const query = document.getElementById("queryInput").value.trim();
  if (!query) return;

  const className = document.getElementById("classSelect").value;
  const subjectName = document.getElementById("subjectSelect").value;

  // Show loading
  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("results").classList.add("hidden");
  document.getElementById("loading").classList.remove("hidden");

  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, className, subjectName }),
    });
    const data = await res.json();
    renderResults(data);
  } catch (e) {
    console.error("Search failed:", e);
    document.getElementById("loading").classList.add("hidden");
    document.getElementById("emptyState").classList.remove("hidden");
  }
}

// ── Render results ──
function renderResults(data) {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("results").classList.remove("hidden");

  const { results, stats, promptPreview, query, className, subjectName } = data;

  // Results bar
  const label = query + (className ? ` · ${className === "Kindergarten" ? "KG" : "Class " + className}` : "")
    + (subjectName ? ` · ${subjectName}` : "");
  document.getElementById("resultsTitle").textContent = `"${label}"`;
  document.getElementById("resultsCount").textContent = `${results.length} models found`;

  // Pipeline stats
  document.getElementById("pTotal").textContent = stats.totalModels.toLocaleString();
  document.getElementById("pMatched").textContent = results.length;
  document.getElementById("pReduction").textContent = stats.reductionPercent + "%";
  document.getElementById("pLatency").textContent = stats.latencyMs + "ms";
  document.getElementById("tBefore").textContent = stats.tokensBefore.toLocaleString() + " tokens";
  document.getElementById("tAfter").textContent = stats.tokensAfter.toLocaleString() + " tokens";

  setTimeout(() => {
    document.getElementById("barBefore").style.width = "100%";
    document.getElementById("barAfter").style.width =
      Math.max(1, (stats.tokensAfter / stats.tokensBefore) * 100) + "%";
  }, 150);

  // Prompt preview
  document.getElementById("promptBadge").textContent = `${results.length} models injected`;
  document.getElementById("promptCode").textContent = promptPreview;

  // Model cards
  const grid = document.getElementById("modelGrid");
  grid.innerHTML = "";

  results.forEach((model, i) => {
    const pct = model.relevance;

    // Color tier based on relevance percentage
    let tier, thumbBg, barColor, badgeColor, textColor;
    if (pct >= 70) {
      tier = "green";
      thumbBg = "#E8F8EF";
      barColor = "#12A150";
      badgeColor = "#12A150";
      textColor = "#12A150";
    } else if (pct >= 40) {
      tier = "yellow";
      thumbBg = "#FFFBEA";
      barColor = "#D97706";
      badgeColor = "#D97706";
      textColor = "#D97706";
    } else {
      tier = "red";
      thumbBg = "#FDECEC";
      barColor = "#E04C4C";
      badgeColor = "#E04C4C";
      textColor = "#E04C4C";
    }

    const emoji = EMOJIS[model.subject] || "📦";
    const card = document.createElement("div");
    card.className = "model-card";
    card.style.borderTop = `3px solid ${barColor}`;
    card.innerHTML = `
      <div class="model-thumb" style="background:${thumbBg}">
        <span>${emoji}</span>
        <div class="rank-badge" style="background:${badgeColor};color:#fff;border-color:${badgeColor}">${i + 1}</div>
        <div class="relevance-bar-wrap">
          <div class="relevance-bar" style="width:0%;background:${barColor}" data-pct="${pct}"></div>
        </div>
      </div>
      <div class="model-info">
        <div class="model-name">${model.name}</div>
        <div class="model-topic">${model.topic}</div>
        <div class="model-footer">
          <span class="model-subject">${model.subject}</span>
          <span class="model-relevance" style="color:${textColor}">${pct}% match</span>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  // Animate relevance bars
  setTimeout(() => {
    document.querySelectorAll(".relevance-bar").forEach((bar) => {
      bar.style.width = bar.dataset.pct + "%";
    });
  }, 150);

  // Scroll to results
  document.getElementById("results").scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Toggle pipeline panel ──
function togglePanel() {
  panelOpen = !panelOpen;
  const panel = document.getElementById("pipelinePanel");
  const btn = document.getElementById("btnToggle");
  if (panelOpen) {
    panel.classList.remove("hidden");
    btn.textContent = "Hide Pipeline Stats ↑";
  } else {
    panel.classList.add("hidden");
    btn.textContent = "Show Pipeline Stats ↓";
  }
}

// ── Enter key ──
document.addEventListener("DOMContentLoaded", () => {
  loadClasses();
  loadStats();
  document.getElementById("queryInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doSearch();
  });
});
