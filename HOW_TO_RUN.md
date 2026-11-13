# TutAR Vector Search Web App — How to Run

## What this is
A teacher-facing web app that demonstrates vector similarity search over TutAR's 3D model catalogue. Teachers pick a class and subject, type a topic, and get the most relevant models ranked by similarity.

Search works like this: the query is turned into a vector by a small embedding model running locally, and Pinecone returns the 25 closest model vectors. The app also builds a preview of the slimmed-down AI prompt. (There is no LLM call in this POC.)

## Project Structure
```
tutar-app/
├── server.js          ← Node.js backend (Express)
├── indexing.js        ← Embeds the catalogue and uploads it to Pinecone
├── vectorSearch.js    ← Embeds a query and searches Pinecone
├── package.json       ← Dependencies and scripts
├── .env.example       ← Copy to .env and add your Pinecone key
├── .gitignore
├── data/
│   └── catalogue.json ← Model entries with class / subject / topic
└── public/
    ├── index.html     ← Teacher-facing UI
    ├── style.css      ← Styling
    └── app.js         ← Frontend logic (talks to the backend via the API)
```

## How to Run

### Step 1 — Make sure Node.js is installed
```
node --version
```
You need v18 or higher. If not installed, download it from https://nodejs.org

### Step 2 — Install dependencies
```
npm install
```

### Step 3 — Set up Pinecone (one time)
1. Create a free account at https://pinecone.io and copy your API key.
2. Create an index with these settings: name `tutar-models`, dense vectors, dimension `384`, metric `cosine`, serverless (AWS, us-east-1).
3. Copy `.env.example` to `.env` and fill in:
```
PINECONE_API_KEY=your_pinecone_key_here
PINECONE_INDEX=tutar-models
```

### Step 4 — Index the catalogue
```
npm run index
```
The first run downloads the ~25MB embedding model and takes several minutes. Re-run it only when the catalogue changes. Use `npm run index -- --reset` to wipe the index and re-upload everything.

### Step 5 — Start the server
```
npm start
```

### Step 6 — Open in browser
Go to: http://localhost:3000

The first search can be slow while the embedding model loads (the server starts loading it in the background at launch).

## How to use the app
1. Select a Class from the dropdown
2. Select a Subject
3. Type a topic (e.g. "plant", "magnet", "photosynthesis")
4. Click Search or press Enter
5. See the retrieved models ranked by similarity (green = strong, yellow = medium, red = weak; thresholds are provisional)
6. If few models match your filters, a notice explains that the search was broadened
7. Click "Show Pipeline Stats" to see estimated token reduction, retrieval time and the prompt preview

## API Endpoints
- `GET  /api/classes` — all available classes
- `GET  /api/subjects?class=6` — subjects for a class
- `GET  /api/stats` — catalogue statistics
- `POST /api/search` — main search endpoint

`POST /api/search` body:
```json
{ "query": "plant cell", "className": "8", "subjectName": "Science" }
```
`className` and `subjectName` are optional. The query is limited to 200 characters, and each IP is limited to 60 searches per minute.

The response includes `results` (name, class, subject, topic, raw `score`, `similarity` percent), `fallbackUsed` (`null`, `"class"` or `"all"`), `cached`, `stats` (estimated token numbers and retrieval time) and `promptPreview`.

## Sample queries to try
- Kindergarten + EVS + "plant"
- Class 6 + Science + "magnet"
- Class 11 + Biology + "photosynthesis"
- Class 12 + Chemistry + "crystal"
- Class 3 + EVS + "food"
- Class 8 + Science + "cell"

## Troubleshooting
- **"Missing environment variable: PINECONE_API_KEY"** — create `.env` from `.env.example`.
- **"Pinecone index not found"** — create the index (Step 3), and check `PINECONE_INDEX` matches its name.
- **"Pinecone rejected the API key"** — re-copy the key from the Pinecone dashboard.
- **No results appear** — make sure `npm run index` finished successfully.
- **Very slow first search** — the embedding model is loading; later searches are fast.
