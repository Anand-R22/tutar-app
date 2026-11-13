// ============================================
// Vector Search (query time)
//
// 1. Embeds the teacher's keyword locally with all-MiniLM-L6-v2
//    (@xenova/transformers, 384 dimensions, no API key needed).
// 2. Asks Pinecone for the nearest vectors (approximate nearest-neighbor
//    search; the index algorithm is managed by Pinecone).
// 3. Optionally broadens the filters if too few results come back,
//    and reports that it did so.
// ============================================

const { Pinecone } = require("@pinecone-database/pinecone");

const pinecone = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
const index = pinecone.index(process.env.PINECONE_INDEX || "tutar-models");

// If a filtered search returns fewer than this many results, broaden it.
const MIN_RESULTS = 5;

// ── Embedding model: loaded once, shared by all requests ──
// We store the *promise*, not the finished model. If two requests arrive
// while the model is still loading, they both wait on the same promise
// instead of each starting their own ~25MB load.
let extractorPromise = null;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = import("@xenova/transformers")
      .then(({ pipeline }) =>
        pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2")
      )
      .catch((err) => {
        extractorPromise = null; // allow a retry on the next request
        throw err;
      });
  }
  return extractorPromise;
}

async function embedQuery(text) {
  const extractor = await getExtractor();
  const output = await extractor(text, { pooling: "mean", normalize: true });
  return Array.from(output.data);
}

// Load the model at server start so the first teacher doesn't wait for it.
async function warmUp() {
  await embedQuery("warm up");
}

function buildFilter(className, subjectName) {
  const filter = {};
  if (className) filter.class = { $eq: className };
  if (subjectName) filter.subject = { $eq: subjectName };
  return filter;
}

async function runQuery(vector, topK, filter) {
  const options = { vector, topK, includeMetadata: true };
  if (filter && Object.keys(filter).length > 0) options.filter = filter;
  const response = await index.query(options);
  return response.matches || [];
}

/**
 * @returns {{
 *   results: Array<{name, class, subject, topic, score, similarity}>,
 *   latencyMs: number,
 *   fallbackUsed: null | "class" | "all"
 * }}
 *   fallbackUsed tells the UI whether the filters had to be broadened:
 *   null    = results match the filters the teacher chose
 *   "class" = subject filter dropped (same class, other subjects)
 *   "all"   = class and subject filters dropped
 */
async function vectorSearch(keyword, className, subjectName, topK = 25) {
  const t0 = Date.now();
  const vector = await embedQuery(keyword);

  let matches = await runQuery(vector, topK, buildFilter(className, subjectName));
  let fallbackUsed = null;

  if (matches.length < MIN_RESULTS && className && subjectName) {
    matches = await runQuery(vector, topK, buildFilter(className, ""));
    fallbackUsed = "class";
  }
  if (matches.length < MIN_RESULTS && (className || subjectName)) {
    matches = await runQuery(vector, topK, null);
    fallbackUsed = "all";
  }

  return {
    results: matches.map((m) => ({
      name: m.metadata.name,
      class: m.metadata.class,
      subject: m.metadata.subject,
      topic: m.metadata.topic,
      score: m.score, // raw cosine similarity, roughly 0 to 1
      similarity: Math.max(0, Math.round(m.score * 100)),
    })),
    latencyMs: Date.now() - t0,
    fallbackUsed,
  };
}

module.exports = { vectorSearch, warmUp };
