// ============================================
// Real HNSW Vector Search
// Uses @xenova/transformers (local) + Pinecone
// ============================================

const { Pinecone } = require("@pinecone-database/pinecone");

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index(process.env.PINECONE_INDEX || "tutar-models");

// Load model once and reuse
let extractor = null;

async function getExtractor() {
  if (!extractor) {
    const { pipeline } = await import("@xenova/transformers");
    extractor = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2");
  }
  return extractor;
}

async function embedQuery(text) {
  const ext = await getExtractor();
  const output = await ext(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

async function vectorSearch(keyword, className, subjectName, topK = 25) {
  const t0 = Date.now();

  // Convert keyword to real vector locally
  const queryVector = await embedQuery(keyword);

  // Build metadata filter
  const filter = {};
  if (className && className !== "") filter.class = { $eq: className };
  if (subjectName && subjectName !== "") filter.subject = { $eq: subjectName };

  let queryOptions = { vector: queryVector, topK, includeMetadata: true };
  if (Object.keys(filter).length > 0) queryOptions.filter = filter;

  // Query Pinecone — HNSW runs here
  let response = await index.query(queryOptions);

  // Fallback: expand if too few results
  if (response.matches.length < 5 && className && subjectName) {
    response = await index.query({
      vector: queryVector, topK,
      filter: { class: { $eq: className } },
      includeMetadata: true,
    });
  }
  if (response.matches.length < 5) {
    response = await index.query({ vector: queryVector, topK, includeMetadata: true });
  }

  const latency = Date.now() - t0;
  const maxScore = response.matches.length > 0 ? response.matches[0].score : 1;

  return {
    results: response.matches.map(m => ({
      name: m.metadata.name,
      class: m.metadata.class,
      subject: m.metadata.subject,
      topic: m.metadata.topic,
      score: m.score,
      relevance: Math.round((m.score / maxScore) * 100),
    })),
    latencyMs: latency,
  };
}

module.exports = { vectorSearch };
