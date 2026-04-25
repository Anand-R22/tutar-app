# TutAR — Vector Search Pipeline

## What is this project?

TutAR is a 3D teaching aid platform for K-12 teachers. This project solves a critical performance problem in TutAR's AI-powered 3D model search feature by implementing a real HNSW vector search pipeline.

---

## The Problem

Every time a teacher searched for a 3D model, the system was sending all 2,626 model names to the AI on every single API call via `JSON.stringify(subjectWithModels)`. This caused:

- ~52,520 tokens wasted per call
- Slow response times (3-8 seconds)
- High API costs
- Risk of hitting context limits

---

## The Solution

Replace the brute-force approach with a 4-step HNSW vector search pipeline:

```
STEP 1 — One-time indexing
Convert all 2,626 model names into real vector embeddings
Store in Pinecone vector database (HNSW index built automatically)

STEP 2 — Keyword extraction
Extract core academic keyword from teacher's query
"tell me about plant cell" → "plant cell"

STEP 3 — HNSW vector search
Convert keyword to vector using all-MiniLM-L6-v2 model
Pinecone HNSW finds top 25 semantically similar models
Search takes ~10-50ms

STEP 4 — Optimized prompt injection
Only 25 matched models sent to AI
Instead of all 2,626
~99% token reduction
```

---

## Results

| Metric | Before | After |
|---|---|---|
| Models sent to AI | 2,626 | ~25 |
| Tokens per call | ~52,520 | ~500 |
| Token reduction | — | 99% |
| Search latency | — | ~10-50ms |
| API cost per call | ~$0.05-0.15 | ~$0.001 |

---

## Project Structure

```
tutar-app/
├── server.js              ← Node.js backend (Express)
├── indexing.js            ← Step 1: One-time indexing script
├── vectorSearch.js        ← Step 3: HNSW search via Pinecone
├── package.json           ← Project dependencies
├── .env.example           ← Template for API keys
├── data/
│   └── catalogue.json     ← All 2,626 models (class/subject/topic)
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
| @xenova/transformers | Local embedding model (all-MiniLM-L6-v2) |
| Pinecone | Vector database with HNSW indexing |
| HTML + CSS + JS | Frontend teacher UI |

---

## Dataset

- **2,626 unique 3D model names** from TutAR's catalogue
- Organized into **14 classes** (KG to Class 12)
- **44 subjects** (Science, Maths, EVS, Biology, Chemistry, Physics...)
- **873 topics**
- Stored in `data/catalogue.json`

---

## Prerequisites

- Node.js v18 or higher — https://nodejs.org
- Pinecone account (free) — https://pinecone.io

---

## Setup & Installation

### Step 1 — Install dependencies
```
npm install
```

### Step 2 — Create your .env file
Create a file named `.env` (no extension) in the tutar-app folder:
```
PINECONE_API_KEY=your_pinecone_key_here
PINECONE_INDEX=tutar-models
```

### Step 3 — Create Pinecone index
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

### Step 4 — Run indexing (ONE TIME ONLY)
```
npm run index
```
This will:
- Load the all-MiniLM-L6-v2 model locally (~25MB download on first run)
- Convert all 2,626 model names into 384-dimensional vectors
- Upload all vectors to Pinecone
- Takes about 5-10 minutes
- Never needs to run again unless models change

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
5. See results — color coded by relevance:
   Green  = 70%+ match (strong)
   Yellow = 40-69% match (medium)
   Red    = below 40% match (weak)
6. Click "Show Pipeline Stats" to see:
   - Token reduction comparison
   - Search latency
   - Optimized AI prompt preview
```

---

## How HNSW Works

HNSW (Hierarchical Navigable Small World) is the algorithm inside Pinecone that makes vector search fast.

```
Without HNSW:
Compare query against all 2,626 vectors one by one = slow

With HNSW (multi-layer graph):
Layer 2: Jump to Science neighborhood      (2-3 comparisons)
Layer 1: Jump to Biology neighborhood      (3-4 comparisons)
Layer 0: Scan local neighborhood           (20-30 comparisons)
Total: ~30 comparisons instead of 2,626 = fast
```
