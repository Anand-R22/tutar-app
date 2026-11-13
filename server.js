// ============================================
// TutAR Vector Search — Node.js Backend
//
// Pipeline: teacher query -> keyword extraction -> local embedding
//           -> Pinecone nearest-neighbor search -> top-K models
//           -> (preview of) the slimmed-down LLM prompt
//
// Run:  npm start
// Open: http://localhost:3000
// ============================================

require("dotenv").config();
const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = process.env.PORT || 3000;

// ── Settings ──
const TOP_K = 25;                       // models sent onward instead of the whole catalogue
const TOKENS_PER_MODEL_ESTIMATE = 20;   // rough guess, NOT measured with a tokenizer
const MAX_QUERY_LENGTH = 200;
const MAX_KEYWORD_WORDS = 6;
const RATE_LIMIT_MAX = 60;              // searches per IP per window
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

// ── Validate env vars (only Pinecone is needed; embeddings run locally) ──
if (!process.env.PINECONE_API_KEY) {
  console.error("\n❌ Missing environment variable: PINECONE_API_KEY");
  console.error("👉 Create a .env file in this folder (see .env.example).\n");
  process.exit(1);
}

// ── Load vector search (after env check, because it reads the API key) ──
const { vectorSearch, warmUp } = require("./vectorSearch");

// ── Load catalogue ──
const catalogue = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data/catalogue.json"), "utf-8")
);

// Render (and most hosts) sit behind a proxy; this makes req.ip the real client.
app.set("trust proxy", 1);
app.use(express.json({ limit: "10kb" }));
app.use(express.static(path.join(__dirname, "public")));

// ── Simple in-memory rate limiter (per IP) ──
const hits = new Map();

function rateLimit(req, res, next) {
  const now = Date.now();
  const record = hits.get(req.ip);
  if (!record || now > record.resetAt) {
    hits.set(req.ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return next();
  }
  record.count++;
  if (record.count > RATE_LIMIT_MAX) {
    res.set("Retry-After", String(Math.ceil((record.resetAt - now) / 1000)));
    return res
      .status(429)
      .json({ error: "Too many searches. Please wait a moment and try again." });
  }
  next();
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of hits) if (now > record.resetAt) hits.delete(ip);
}, RATE_LIMIT_WINDOW_MS).unref();

// ── Small in-memory cache for repeated searches ──
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    cache.delete(cache.keys().next().value); // drop the oldest entry
  }
  cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
}

// ── Keyword extraction (simple rule-based version) ──
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
  return words.slice(0, MAX_KEYWORD_WORDS).join(" ") || query.toLowerCase().trim();
}

function buildPromptPreview(query, className, subjectName, modelNames) {
  return `You are an expert Educational AI Assistant for TutAR.

Teacher's Query: "${query}"
Class/Grade: ${className || "Not specified"}
Subject: ${subjectName || "Not specified"}

// OPTIMIZED: only ${modelNames.length} candidate models are included (catalogue has ${catalogue.total})
// Candidates retrieved by vector similarity search (local embeddings + Pinecone)
Available 3D Models:
${JSON.stringify(modelNames, null, 2)}

Tasks:
1. Generate searchKeyword — concise phrase (max 6 words)
2. Generate imageKeyword — core academic concept (1-3 words)
3. Rank the models above by relevancy
4. Generate educational content about the topic

Return ONLY valid JSON.`;
}

// Turn internal errors into messages that help without leaking internals.
function describeError(err) {
  const name = err && err.name ? err.name : "";
  if (name.includes("Authorization")) {
    return "Pinecone rejected the API key. Check PINECONE_API_KEY in .env.";
  }
  if (name.includes("NotFound")) {
    return "Pinecone index not found. Create it, then run: npm run index";
  }
  if (name.includes("Connection") || name.includes("Unavailable")) {
    return "Could not reach Pinecone. Check your internet connection and try again.";
  }
  return "Search failed. Check the server logs for details.";
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
    totalSubjects: new Set(Object.values(catalogue.subjects_by_class).flat()).size,
    searchType: "Vector similarity search (local MiniLM embeddings + Pinecone)",
  });
});

// POST /api/search
app.post("/api/search", rateLimit, async (req, res) => {
  try {
    const body = req.body || {};
    const query = typeof body.query === "string" ? body.query.trim() : "";
    const className = typeof body.className === "string" ? body.className : "";
    const subjectName = typeof body.subjectName === "string" ? body.subjectName : "";

    if (!query) {
      return res.status(400).json({ error: "Query is required" });
    }
    if (query.length > MAX_QUERY_LENGTH) {
      return res
        .status(400)
        .json({ error: `Query is too long (max ${MAX_QUERY_LENGTH} characters)` });
    }

    // Step 2: extract keyword
    const keyword = extractKeyword(query);
    console.log(`\n Query: "${query}" -> Keyword: "${keyword}"`);
    console.log(`   Class: ${className || "all"} | Subject: ${subjectName || "all"}`);

    // Step 3: vector search (cached for repeated searches)
    const cacheKey = JSON.stringify([keyword, className, subjectName]);
    const startedAt = Date.now();
    let result = cacheGet(cacheKey);
    const cached = Boolean(result);
    if (!result) {
      result = await vectorSearch(keyword, className, subjectName, TOP_K);
      cacheSet(cacheKey, result);
    }
    const latencyMs = cached ? Date.now() - startedAt : result.latencyMs;
    console.log(
      `   Found ${result.results.length} models in ${latencyMs}ms` +
        (cached ? " (cached)" : "") +
        (result.fallbackUsed ? ` | filters broadened: ${result.fallbackUsed}` : "")
    );

    // Step 4: build the slimmed-down prompt (preview only; no LLM call in this POC)
    const modelNames = result.results.map((r) => r.name);
    const promptPreview = buildPromptPreview(query, className, subjectName, modelNames);

    res.json({
      query,
      keyword,
      className,
      subjectName,
      results: result.results,
      fallbackUsed: result.fallbackUsed,
      cached,
      searchType: "Vector similarity search (local MiniLM embeddings + Pinecone)",
      stats: {
        totalModels: catalogue.total,
        matched: result.results.length,
        // Estimates: model count x a rough tokens-per-model guess, not a real tokenizer.
        tokensBefore: catalogue.total * TOKENS_PER_MODEL_ESTIMATE,
        tokensAfter: result.results.length * TOKENS_PER_MODEL_ESTIMATE,
        tokensAreEstimated: true,
        reductionPercent: Math.round(
          (1 - result.results.length / catalogue.total) * 100
        ),
        latencyMs,
      },
      promptPreview,
    });
  } catch (err) {
    console.error("Search error:", err);
    res.status(500).json({ error: describeError(err) });
  }
});

// Return JSON (not an HTML page) for malformed requests such as bad JSON bodies.
app.use((err, req, res, next) => {
  if (err && err.status && err.status < 500) {
    return res.status(err.status).json({ error: "Invalid request" });
  }
  console.error("Unexpected error:", err);
  res.status(500).json({ error: "Unexpected server error" });
});

// Start server
app.listen(PORT, () => {
  console.log(`\nTutAR Vector Search App`);
  console.log(`   Open: http://localhost:${PORT}`);
  console.log(`   Search: local MiniLM embeddings + Pinecone\n`);

  // Load the embedding model now, in the background.
  warmUp()
    .then(() => console.log("   Embedding model ready.\n"))
    .catch((err) => console.error("   Embedding model failed to load:", err.message));
});
