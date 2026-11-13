# TutAR — Vector Search Pipeline (Proof of Concept)

## 🌐 Live Demo

**[https://tutar-app-1.onrender.com/](https://tutar-app-1.onrender.com/)**

> ⏳ Hosted on Render's free tier, so the first load after idle time may take 30-60 seconds.

## What is this project?

TutAR is a 3D teaching-aid platform for K-12 teachers. This proof of concept (POC) tackles a performance problem in TutAR's AI-powered 3D model search: it adds a **retrieval layer** that finds the most relevant models first, so only a small shortlist has to be sent to the AI.

This POC builds and demonstrates the retrieval layer. It does **not** call an LLM; it builds the slimmed-down prompt and shows a preview of it.

---

## The Problem

Every time a teacher searched for a 3D model, the system sent **every model name in the catalogue** to the AI on each call (via `JSON.stringify(subjectWithModels)`). That means:

- A very large prompt: roughly 55,800 tokens for this POC's 2,790 entries, at an *estimated* ~20 tokens per model
- Reported symptoms in the original flow: slow responses, high API cost, and a risk of hitting context limits as the catalogue grows (these were not measured by this POC)
- The AI has to find a handful of relevant models among thousands

---

## The Solution

Retrieve first, then ask the AI. This is the "retrieval" half of a RAG (Retrieval-Augmented Generation) pattern:

```
STEP 1 — Indexing (when the catalogue changes)
Convert every model (name + topic + subject) into a 384-dimension
embedding vector and store it in Pinecone

STEP 2 — Keyword extraction
Strip filler words from the teacher's query
"tell me about the plant cell" → "plant cell"

STEP 3 — Vector similarity search
Embed the keyword with the same model (all-MiniLM-L6-v2, run locally)
Pinecone returns the 25 nearest vectors (approximate nearest-neighbor
search; the index algorithm is managed by Pinecone), optionally
filtered by class and subject

STEP 4 — Slimmed-down prompt
Only the 25 retrieved models go into the AI prompt, not the whole catalogue
```

---

## Results

| Metric | Before | After |
|---|---|---|
| Models in the AI prompt | 2,790 (whole catalogue) | 25 |
| Prompt size for the model list | ~55,800 tokens (estimate) | ~500 tokens (estimate) |
| Reduction | — | ~99% (estimate) |
| Retrieval time | — | Measured on every search and shown in the app (embedding + Pinecone query) |

**About these numbers:** the token counts are *estimates* (model count × an assumed ~20 tokens per model), not measured with a tokenizer, and the reduction is simply `1 − 25/2790`. End-to-end response time and cost depend on the LLM call, which is not part of this POC, so they have not been measured here.

---

## Project Structure

```
tutar-app/
├── server.js              ← Express backend: API routes, rate limit, cache
├── indexing.js            ← Step 1: embed catalogue and upload to Pinecone
├── vectorSearch.js        ← Step 3: embed query and search Pinecone
├── package.json           ← Dependencies and scripts
├── .env.example           ← Template for your keys (copy to .env)
├── .gitignore             ← Keeps .env and node_modules out of git
├── data/
│   └── catalogue.json     ← All model entries (class / subject / topic)
└── public/
    ├── index.html         ← Teacher-facing UI
    ├── style.css          ← Styling
    └── app.js             ← Frontend logic
```

---

## Tech Stack

| Tool | Purpose |
|---|---|
| Node.js + Express | Backend server |
| @xenova/transformers | Runs the embedding model (all-MiniLM-L6-v2) locally in Node |
| Pinecone (serverless) | Vector database: stores vectors + metadata, runs similarity search and filters |
| HTML + CSS + JS | Frontend teacher UI (no framework, no build step) |

---

## Dataset

Counts taken from `data/catalogue.json`:

- **2,790 model entries** (2,636 distinct model names; the same name can appear in more than one class or subject)
- **14 classes** (Kindergarten, 1-12, Miscellaneous)
- **11 subjects**, appearing as **44 class-subject combinations**
- **851 distinct topics**

---

## Prerequisites

- Node.js v18 or higher — https://nodejs.org
- Pinecone account (free tier) — https://pinecone.io

---

## Setup & Installation

### Step 1 — Install dependencies
```
npm install
```

### Step 2 — Create your .env file
Copy `.env.example` to `.env` and fill in your key:
```
PINECONE_API_KEY=your_pinecone_key_here
PINECONE_INDEX=tutar-models
```
No other API key is needed, because embeddings run locally. Never commit `.env`.

### Step 3 — Create the Pinecone index
Go to https://app.pinecone.io and create an index with:
```
Name:          tutar-models
Vector type:   dense
Dimension:     384
Metric:        cosine
Capacity mode: Serverless
Cloud:         AWS
Region:        us-east-1
```

### Step 4 — Run indexing
```
npm run index
```
This will:
- Load the all-MiniLM-L6-v2 model locally (~25MB download on first run)
- Convert every catalogue entry into a 384-dimension vector
- Upload the vectors to Pinecone in batches of 100 (with retries)
- Print how many vectors were embedded and uploaded

Run it again only when the catalogue changes. If vector IDs or the data changed in a way that could leave stale entries behind, use `npm run index -- --reset` to clear the index first.

### Step 5 — Start the app
```
npm start
```

### Step 6 — Open in browser
```
http://localhost:3000
```

---

## How to Use the App

```
1. Select a Class from the dropdown  (e.g. Class 6)
2. Select a Subject                  (e.g. Science)
3. Type a search query               (e.g. magnet)
4. Press Enter or click Search
5. Results are colour-coded by cosine similarity to your query:
   Green  = 55%+  (strong)
   Yellow = 35-54% (medium)
   Red    = below 35% (weak)
   (These cut-offs are provisional starting values, not tuned yet.)
6. If few results match your class/subject, the app broadens the search
   and shows a notice saying so
7. Click "Show Pipeline Stats" to see estimated token reduction,
   retrieval time, and a preview of the slimmed-down AI prompt
```

---

## Background: How Approximate Nearest-Neighbor Search Works

Finding the closest vectors by comparing a query against every stored vector is exact but slow at large scale. Vector databases use *approximate nearest-neighbor (ANN)* algorithms to avoid that. HNSW (Hierarchical Navigable Small World) is a widely used example:

```
A layered graph of vectors:
Top layer:    few nodes, long jumps    → get near the right area quickly
Middle layer: more nodes, shorter jumps
Bottom layer: all nodes, fine detail   → refine and return the top K
```

**Which algorithm does this app use?** Pinecone serverless manages its index internally and chooses indexing methods per data size, so the exact algorithm serving this index is not something the app controls or can inspect. With a catalogue of a few thousand vectors, HNSW is not necessarily what runs, and brute-force comparison would also be fast at this size. A vector database was chosen for managed storage, metadata filtering (class and subject), and room to grow.

---

## Known Limitations

- **No LLM call.** The POC retrieves candidates and previews the prompt; the integration with TutAR's existing AI call is the next step.
- **Token and reduction figures are estimates**, not measured with a tokenizer.
- **Colour thresholds are provisional.** They were not calibrated against labelled data.
- **Keyword extraction is rule-based** (stop words, first 6 words) and English-only.
- **No evaluation yet** of search quality (for example precision@k or recall@25 against teacher-labelled queries).
- **If the correct model is not in the top 25, the AI can never choose it.** Recall matters more than speed here.
- **Free-tier hosting:** cold starts, and the embedding model must load before the first search.
- No automated tests.

## Next Steps

- Integrate retrieval into the real LLM call; measure actual tokens, latency and cost before and after
- Build a labelled query set and measure precision@k / recall@25; tune K and the colour thresholds
- Try hybrid search (keyword + vector) and a reranker
- Multilingual embeddings for Hindi and regional-language queries
- Incremental re-indexing when models are added or removed
