// ============================================
// STEP 1 — Indexing script (run when the catalogue changes)
//
// Embeds every model with all-MiniLM-L6-v2 (runs locally via
// @xenova/transformers, no API key needed) and uploads the vectors
// to Pinecone, which builds the search index.
//
// Usage:
//   node indexing.js            add / update all models
//   node indexing.js --reset    delete every vector in the index first,
//                               then re-upload (use if IDs or data changed)
// ============================================

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Pinecone } = require("@pinecone-database/pinecone");

if (!process.env.PINECONE_API_KEY) {
  console.error("❌ Missing PINECONE_API_KEY in .env file");
  process.exit(1);
}

const INDEX_NAME = process.env.PINECONE_INDEX || "tutar-models";
const UPSERT_BATCH = 100;
const MAX_RETRIES = 3;
const RESET = process.argv.includes("--reset");

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index(INDEX_NAME);
const catalogue = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data/catalogue.json"), "utf-8")
);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Pinecone IDs must be plain ASCII, so unusual characters become "_".
function makeId(model) {
  return `${model.class}-${model.subject}-${model.name}`
    .replace(/[^a-zA-Z0-9\-_]/g, "_")
    .slice(0, 512);
}

// Upload one batch, retrying a few times on temporary failures.
async function upsertWithRetry(batch) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      await index.upsert(batch);
      return true;
    } catch (err) {
      console.error(`\n⚠️  Upload attempt ${attempt}/${MAX_RETRIES} failed: ${err.message}`);
      if (attempt < MAX_RETRIES) await sleep(1000 * attempt);
    }
  }
  return false;
}

async function runIndexing() {
  console.log("\n🚀 TutAR — Indexing");
  console.log("================================");

  if (RESET) {
    console.log("🧹 --reset: deleting all existing vectors in the index...");
    await index.deleteAll();
    console.log("✅ Index cleared.\n");
  }

  // Load local transformer model (downloads once, ~25MB)
  console.log("Loading embedding model (downloads once ~25MB)...");
  const { pipeline } = await import("@xenova/transformers");
  const extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  console.log("✅ Model loaded!\n");

  // Deduplicate on the same fields that make up the vector ID
  // (class + subject + name), so two different entries never share an ID.
  const seen = new Set();
  const models = catalogue.models.filter((m) => {
    const key = `${m.class}||${m.subject}||${m.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  console.log(`📦 Models to index: ${models.length}`);
  console.log(`🗄️  Pinecone index: ${INDEX_NAME}`);
  console.log("\nEmbedding and uploading...\n");

  const usedIds = new Set();
  let pending = [];
  let embedded = 0;
  let uploaded = 0;
  let failedEmbeddings = 0;
  let failedUploads = 0;

  async function flush() {
    if (pending.length === 0) return;
    const batch = pending;
    pending = [];
    const ok = await upsertWithRetry(batch);
    if (ok) uploaded += batch.length;
    else failedUploads += batch.length;
    process.stdout.write(
      `\r⏳ Embedded: ${embedded} / ${models.length} | Uploaded: ${uploaded}`
    );
    await sleep(100);
  }

  for (const model of models) {
    try {
      // Name + topic + subject gives the embedding more context than the name alone.
      const text = `${model.name} ${model.topic} ${model.subject}`;
      const output = await extractor(text, { pooling: "mean", normalize: true });

      // Guard: if sanitizing made two IDs identical, make the second unique.
      let id = makeId(model);
      if (usedIds.has(id)) id = `${id}_${model.id}`;
      usedIds.add(id);

      pending.push({
        id,
        values: Array.from(output.data),
        metadata: {
          name: model.name,
          class: model.class,
          subject: model.subject,
          topic: model.topic,
        },
      });
      embedded++;
    } catch (err) {
      console.error(`\n❌ Failed to embed "${model.name}": ${err.message}`);
      failedEmbeddings++;
    }

    if (pending.length >= UPSERT_BATCH) await flush();
  }
  await flush();

  console.log(`\n\n🎉 Indexing finished`);
  console.log(`================================`);
  console.log(`✅ Embedded:         ${embedded}`);
  console.log(`✅ Uploaded:         ${uploaded}`);
  console.log(`❌ Embedding errors: ${failedEmbeddings}`);
  console.log(`❌ Upload errors:    ${failedUploads}`);

  // Ask Pinecone how many vectors it holds. This can lag behind for a few
  // seconds after an upload, so a slightly lower number is normal.
  try {
    const stats = await index.describeIndexStats();
    console.log(`📊 Vectors in Pinecone now: ${stats.totalRecordCount}`);
  } catch (err) {
    console.log(`(Could not read index stats: ${err.message})`);
  }

  if (failedEmbeddings > 0 || failedUploads > 0) {
    console.log("\n⚠️  Some items failed. Re-run this script to retry (it is safe to repeat).");
    process.exitCode = 1;
  } else {
    console.log("\nNow run: npm start");
  }
}

runIndexing().catch((err) => {
  console.error("\n❌ Fatal error:", err.message);
  process.exit(1);
});
