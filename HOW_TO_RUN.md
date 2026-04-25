# TutAR Vector Search Web App

## What this is
A teacher-facing web app that demonstrates the HNSW vector search pipeline.
Teachers can select their class, subject, and search for 3D models.
The backend uses simulated HNSW search across all 2,626 models.

## Project Structure
```
tutar-app/
├── server.js          ← Node.js backend (Express)
├── package.json       ← Project dependencies
├── data/
│   └── catalogue.json ← All 2,626 models with class/subject/topic
└── public/
    ├── index.html     ← Teacher-facing UI
    ├── style.css      ← Styling
    └── app.js         ← Frontend logic (talks to backend via API)
```

## How to Run

### Step 1 — Make sure Node.js is installed
Open terminal and type:
```
node --version
```
If you see a version number (e.g. v18.x.x) you are good.
If not, download Node.js from: https://nodejs.org

### Step 2 — Install dependencies
Open terminal in this folder and run:
```
npm install
```

### Step 3 — Start the server
```
npm start
```

### Step 4 — Open in browser
Go to: http://localhost:3000

## How to use the app
1. Select a Class from the dropdown
2. Select a Subject
3. Type a topic (e.g. "plant", "magnet", "photosynthesis")
4. Click Search or press Enter
5. See the retrieved 3D models ranked by relevance
6. Click "Show Pipeline Stats" to see token reduction comparison

## API Endpoints (for reference)
- GET  /api/classes         — returns all available classes
- GET  /api/subjects?class=6 — returns subjects for a class
- POST /api/search          — main search endpoint
- GET  /api/stats           — overall catalogue statistics

## Sample queries to try
- Kindergarten + EVS + "plant"
- Class 6 + Science + "magnet"
- Class 11 + Biology + "photosynthesis"
- Class 12 + Chemistry + "crystal lattice"
- Class 3 + EVS + "food"
- Class 8 + Science + "cell"
