// ============================================
// TutAR Vector Search — Node.js Backend
// Uses REAL HNSW via HuggingFace + Pinecone
//
// Run: npm start
// Open: http://localhost:3000
// ============================================

require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Validate env vars ──
const missingVars = [];
if (!process.env.HUGGINGFACE_API_KEY) missingVars.push("HUGGINGFACE_API_KEY");
if (!process.env.PINECONE_API_KEY) missingVars.push("PINECONE_API_KEY");
if (missingVars.length > 0) {
  console.error(`\n❌ Missing environment variables: ${missingVars.join(", ")}`);
  console.error("👉 Create a .env file in this folder with your API keys.");
  console.error("👉 See .env.example for the format.\n");
  process.exit(1);
}

// ── Load real vector search ──
const { vectorSearch } = require("./vectorSearch");

// ── Load catalogue ──
const catalogue = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data/catalogue.json"), "utf-8")
);

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Stop words for keyword extraction ──
const STOP_WORDS = new Set([
  "the","a","an","is","are","was","were","of","in","to","for","and",
  "how","do","does","what","about","me","tell","show","teach","explain",
  "can","you","class","help","please","want","need","give","find",
  "i","my","we","our","they","it","this","that","with","search","look",
]);

function extractKeyword(query) {
  const words = query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  return words.slice(0, 4).join(" ") || query.toLowerCase().trim();
}

function buildPromptPreview(query, className, subjectName, models) {
  return `You are an expert Educational AI Assistant for TutAR.

Teacher's Query: "${query}"
Class/Grade: ${className || "Not specified"}
Subject: ${subjectName || "Not specified"}

// OPTIMIZED: Only ${models.length} models injected (was ${catalogue.total})
// Retrieved via real HNSW vector search (HuggingFace + Pinecone)
Available 3D Models:
${JSON.stringify(models, null, 2)}

Tasks:
1. Generate searchKeyword — concise phrase (max 6 words)
2. Generate imageKeyword — core academic concept (1-3 words)
3. Rank the models above by relevancy
4. Generate educational content about the topic

Return ONLY valid JSON.`;
}

// ══════════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════════

// GET /api/classes
app.get("/api/classes", (req, res) => {
  res.json({ classes: catalogue.classes });
});

// GET /api/subjects?class=6
app.get("/api/subjects", (req, res) => {
  const cls = req.query.class;
  if (!cls || !catalogue.subjects_by_class[cls]) {
    return res.status(400).json({ error: "Invalid class" });
  }
  res.json({ subjects: catalogue.subjects_by_class[cls] });
});

// GET /api/stats
app.get("/api/stats", (req, res) => {
  res.json({
    totalModels: catalogue.total,
    totalClasses: catalogue.classes.length,
    totalSubjects: Object.values(catalogue.subjects_by_class).flat().length,
    searchType: "Real HNSW (HuggingFace + Pinecone)",
  });
});

// POST /api/search — REAL HNSW search
app.post("/api/search", async (req, res) => {
  try {
    const { query, className, subjectName } = req.body;

    if (!query || query.trim() === "") {
      return res.status(400).json({ error: "Query is required" });
    }

    // Step 2: Extract keyword
    const keyword = extractKeyword(query);
    console.log(`\n Query: "${query}" -> Keyword: "${keyword}"`);
    console.log(`   Class: ${className || "all"} | Subject: ${subjectName || "all"}`);

    // Step 3: Real HNSW vector search via Pinecone
    console.log(`   Running HNSW search via Pinecone...`);
    const result = await vectorSearch(keyword, className, subjectName, 25);
    console.log(`   Found ${result.results.length} models in ${result.latencyMs}ms`);

    // Step 4: Build optimized prompt
    const modelNames = result.results.map((r) => r.name);
    const promptPreview = buildPromptPreview(query, className, subjectName, modelNames);

    res.json({
      query,
      keyword,
      className,
      subjectName,
      results: result.results,
      searchType: "Real HNSW (HuggingFace + Pinecone)",
      stats: {
        totalModels: catalogue.total,
        matched: result.results.length,
        tokensBefore: catalogue.total * 20,
        tokensAfter: result.results.length * 20,
        reductionPercent: Math.round(
          (1 - result.results.length / catalogue.total) * 100
        ),
        latencyMs: result.latencyMs,
      },
      promptPreview,
    });
  } catch (err) {
    console.error("Search error:", err.message);
    if (err.message.includes("HuggingFace")) {
      return res.status(500).json({
        error: "HuggingFace API error — check your HUGGINGFACE_API_KEY in .env",
      });
    }
    if (err.message.includes("Pinecone") || err.message.includes("index")) {
      return res.status(500).json({
        error: "Pinecone error — make sure you ran: node indexing.js first",
      });
    }
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`\nTutAR Vector Search App (Real HNSW)`);
  console.log(`   Open: http://localhost:${PORT}`);
  console.log(`   Search engine: HuggingFace + Pinecone HNSW\n`);
});
