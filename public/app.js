// ============================================
// TutAR Frontend — app.js
// Talks to the Node.js backend via fetch()
// ============================================

const EMOJIS = {
  Science: "🔬", Biology: "🌿", Chemistry: "⚗️", Physics: "⚡",
  Maths: "📐", EVS: "🌍", English: "📚", GK: "🌟",
  Animals: "🐾", "Social Science": "🏛️", General: "🎯",
};

// Colour tiers use the raw cosine similarity (0-100%) from the server.
// These cut-offs are a PROVISIONAL starting point, not tuned values:
// check them against real scores from your index and adjust.
const STRONG_THRESHOLD = 55; // at or above: green
const MEDIUM_THRESHOLD = 35; // at or above: yellow, below: red

let panelOpen = false;
let searching = false;

// Escape text before putting it into innerHTML.
function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function className_label(cls) {
  if (!cls) return "";
  return cls === "Kindergarten" ? "KG" : cls === "Miscellaneous" ? "Misc" : `Class ${cls}`;
}

// ── Error banner ──
function showError(message) {
  const el = document.getElementById("errorBanner");
  el.textContent = message;
  el.classList.remove("hidden");
}
function clearError() {
  document.getElementById("errorBanner").classList.add("hidden");
}

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
    showError("Could not load the class list. Is the server running?");
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
      opt.value = subj;
      opt.textContent = subj;
      sel.appendChild(opt);
    }
    sel.disabled = false;
  } catch (e) {
    console.error("Failed to load subjects:", e);
  }
}

// ── Load stats ──
async function loadStats() {
  try {
    const res = await fetch("/api/stats");
    const data = await res.json();
    document.getElementById("totalPill").textContent =
      `${data.totalModels.toLocaleString()} 3D Models · ${data.totalClasses} Classes · ${data.totalSubjects} Subjects`;
  } catch (e) {
    document.getElementById("totalPill").textContent = "";
  }
}

// ── Quick search helper ──
// Waits for the subject list to finish loading before selecting a subject
// (the old version guessed with a fixed 80ms delay).
async function quickSearch(cls, subj, query) {
  document.getElementById("classSelect").value = cls;
  await loadSubjects();
  document.getElementById("subjectSelect").value = subj;
  document.getElementById("queryInput").value = query;
  doSearch();
}

// ── Main search ──
async function doSearch() {
  const query = document.getElementById("queryInput").value.trim();
  if (!query || searching) return;

  const className = document.getElementById("classSelect").value;
  const subjectName = document.getElementById("subjectSelect").value;

  searching = true;
  document.getElementById("searchBtn").disabled = true;
  clearError();
  document.getElementById("emptyState").classList.add("hidden");
  document.getElementById("results").classList.add("hidden");
  document.getElementById("loading").classList.remove("hidden");

  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, className, subjectName }),
    });

    let data = null;
    try { data = await res.json(); } catch (e) { /* non-JSON response */ }
    if (!res.ok) throw new Error((data && data.error) || `Search failed (${res.status})`);

    renderResults(data);
  } catch (e) {
    console.error("Search failed:", e);
    document.getElementById("loading").classList.add("hidden");
    document.getElementById("emptyState").classList.remove("hidden");
    showError(e.message || "Search failed. Please try again.");
  } finally {
    searching = false;
    document.getElementById("searchBtn").disabled = false;
  }
}

// ── Render results ──
function renderResults(data) {
  document.getElementById("loading").classList.add("hidden");
  document.getElementById("results").classList.remove("hidden");

  const { results, stats, promptPreview, query, className, subjectName, fallbackUsed, cached } = data;

  // Results bar
  const label = query
    + (className ? ` · ${className_label(className)}` : "")
    + (subjectName ? ` · ${subjectName}` : "");
  document.getElementById("resultsTitle").textContent = `"${label}"`;
  document.getElementById("resultsCount").textContent = `${results.length} models found`;

  // Notice when the filters had to be broadened
  const notice = document.getElementById("fallbackNotice");
  if (fallbackUsed === "class") {
    notice.textContent =
      `Few close matches in ${subjectName} (${className_label(className)}), so these results also include other subjects in the same class.`;
    notice.classList.remove("hidden");
  } else if (fallbackUsed === "all") {
    notice.textContent =
      "Few close matches under your filters, so these results also include other classes and subjects.";
    notice.classList.remove("hidden");
  } else {
    notice.classList.add("hidden");
  }

  // Pipeline stats (token numbers are estimates)
  document.getElementById("pTotal").textContent = stats.totalModels.toLocaleString();
  document.getElementById("pMatched").textContent = results.length;
  document.getElementById("pReduction").textContent = "~" + stats.reductionPercent + "%";
  document.getElementById("pLatency").textContent = stats.latencyMs + "ms" + (cached ? " (cached)" : "");
  document.getElementById("tBefore").textContent = "~" + stats.tokensBefore.toLocaleString() + " tokens (est.)";
  document.getElementById("tAfter").textContent = "~" + stats.tokensAfter.toLocaleString() + " tokens (est.)";

  setTimeout(() => {
    document.getElementById("barBefore").style.width = "100%";
    document.getElementById("barAfter").style.width =
      Math.max(1, (stats.tokensAfter / stats.tokensBefore) * 100) + "%";
  }, 150);

  // Prompt preview (set as text, never as HTML)
  document.getElementById("promptBadge").textContent = `${results.length} models injected`;
  document.getElementById("promptCode").textContent = promptPreview;

  // Model cards
  const grid = document.getElementById("modelGrid");
  grid.innerHTML = "";

  if (results.length === 0) {
    grid.innerHTML = '<p class="no-results">No models found. Try a different word, or check that the Pinecone index has been filled (npm run index).</p>';
    return;
  }

  results.forEach((model, i) => {
    const pct = model.similarity;

    let thumbBg, barColor;
    if (pct >= STRONG_THRESHOLD) {
      thumbBg = "#E8F8EF"; barColor = "#12A150";
    } else if (pct >= MEDIUM_THRESHOLD) {
      thumbBg = "#FFFBEA"; barColor = "#D97706";
    } else {
      thumbBg = "#FDECEC"; barColor = "#E04C4C";
    }

    const emoji = EMOJIS[model.subject] || "📦";
    const card = document.createElement("div");
    card.className = "model-card";
    card.style.borderTop = `3px solid ${barColor}`;
    card.innerHTML = `
      <div class="model-thumb" style="background:${thumbBg}">
        <span>${emoji}</span>
        <div class="rank-badge" style="background:${barColor};color:#fff;border-color:${barColor}">${i + 1}</div>
        <div class="relevance-bar-wrap">
          <div class="relevance-bar" style="width:0%;background:${barColor}" data-pct="${pct}"></div>
        </div>
      </div>
      <div class="model-info">
        <div class="model-name">${esc(model.name)}</div>
        <div class="model-topic">${esc(model.topic)}</div>
        <div class="model-footer">
          <span class="model-subject">${esc(model.subject)}</span>
          <span class="model-relevance" style="color:${barColor}">${pct}% similar</span>
        </div>
      </div>
    `;
    grid.appendChild(card);
  });

  // Animate similarity bars
  setTimeout(() => {
    document.querySelectorAll(".relevance-bar").forEach((bar) => {
      bar.style.width = bar.dataset.pct + "%";
    });
  }, 150);

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
