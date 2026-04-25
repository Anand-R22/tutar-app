// ============================================
// STEP 1 — Real HNSW Indexing Script
// Uses @xenova/transformers (runs locally)
// No API key needed for embeddings!
// Run ONCE: node indexing.js
// ============================================

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pinecone } = require("@pinecone-database/pinecone");

if (!process.env.PINECONE_API_KEY) {
  console.error("❌ Missing PINECONE_API_KEY in .env file");
  process.exit(1);
}

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index(process.env.PINECONE_INDEX || "tutar-models");
const catalogue = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data/catalogue.json"), "utf-8")
);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runIndexing() {
  console.log("\n🚀 TutAR — Real HNSW Indexing");
  console.log("================================");

  // Load local transformer model (downloads once, ~25MB)
  console.log("Loading embedding model (downloads once ~25MB)...");
  const { pipeline } = await import("@xenova/transformers");
  const extractor = await pipeline(
    "feature-extraction",
    "Xenova/all-MiniLM-L6-v2"
  );
  console.log("✅ Model loaded!\n");

  // Deduplicate models
  const seen = new Set();
  const models = catalogue.models.filter(m => {
    const key = `${m.class}||${m.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`📦 Models to index: ${models.length}`);
  console.log(`🗄️  Pinecone index: ${process.env.PINECONE_INDEX || "tutar-models"}`);
  console.log("\nEmbedding and uploading...\n");

  const UPSERT_BATCH = 100;
  const vectors = [];
  let done = 0;
  let failed = 0;

  for (const model of models) {
    try {
      const text = `${model.name} ${model.topic} ${model.subject}`;

      // Generate embedding locally
      const output = await extractor(text, {
        pooling: "mean",
        normalize: true,
      });
      const embedding = Array.from(output.data);

      const id = `${model.class}-${model.subject}-${model.name}`
        .replace(/[^a-zA-Z0-9\-_]/g, "_")
        .slice(0, 512);

      vectors.push({
        id,
        values: embedding,
        metadata: {
          name: model.name,
          class: model.class,
          subject: model.subject,
          topic: model.topic,
        },
      });

      done++;
      if (done % 50 === 0) {
        process.stdout.write(`\r⏳ Embedded: ${done} / ${models.length}`);
      }

      // Upload to Pinecone in batches of 100
      if (vectors.length >= UPSERT_BATCH) {
        const batch = vectors.splice(0, UPSERT_BATCH);
        await index.upsert(batch);
        process.stdout.write(`\r⏳ Embedded: ${done} / ${models.length} | Uploaded: ${done - vectors.length}`);
        await sleep(100);
      }

    } catch (err) {
      console.error(`\n❌ Failed "${model.name}": ${err.message}`);
      failed++;
    }
  }

  // Upload remaining vectors
  if (vectors.length > 0) {
    await index.upsert(vectors);
  }

  console.log(`\n\n🎉 Indexing Complete!`);
  console.log(`================================`);
  console.log(`✅ Vectors stored: ${done - failed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`\nNow run: npm start`);
}

runIndexing().catch(err => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
