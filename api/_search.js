// ================= BM25 keyword search over api/chunks.json =================
// Finds the document chunks that best match a question. Plain JS, no libraries.
// (The "_" at the start of the file name tells Vercel this is a helper, not an /api/ address.)
//
// BM25 in plain words: a chunk scores higher when
//   - it contains the question's words, especially RARE words (e.g. "soot" beats "flame"),
//   - it contains them several times (but the 5th repeat counts less than the 1st),
//   - it is not extra long (long chunks contain many words just by being long).

let CHUNKS = [];
try {
  CHUNKS = require("./chunks.json");   // built by scripts/build_chunks.py; loaded once per server start
} catch {
  console.warn("api/chunks.json not found: answers will not use documents. Run scripts/build_chunks.py.");
}

const K1 = 1.5;    // how fast repeats stop counting extra
const B = 0.75;    // how much long chunks are penalised (0 = not at all, 1 = fully)
const MIN_MATCHED_WORDS = 2;
const MAX_PER_DOCUMENT = 4;   // pieces from one document in the results

// common words that say nothing about the topic
const STOPWORDS = new Set((
  "a an and are as at be by can could did do does for from had has have how i if in into is it its " +
  "me my no not of on or our so such than that the their them then there these they this those to " +
  "was we were what when where which while who why will with would you your about also been being " +
  "more most other some any all each tell explain describe best " +
  "lead leads led help helps helped make makes made"            // filler verbs ("how did X lead to Y?")
).split(" "));

// everyday phrases -> the word the documents use
const PHRASES = [
  [/\bput(ting)? (\w+ )?out\b|\bgo(es)? out\b|\bwent out\b/g, " extinguish "],
  [/\bfire ?fight\w*/g, " firefighter suppression "],                    // keep "firefighter" too (spinoff articles)
  [/\bweightless\w*|\bzero[- ]?g\b/g, " microgravity "],
  [/\b100 ?% ?(oxygen|o2)\b|\bpure (oxygen|o2)\b/g, " pure oxygen "],    // "100% oxygen" = "pure oxygen"
  [/\bshort[- ]?circuit\w*/g, " short circuit overcurrent "],            // a short circuit = too much current in a wire
  [/\bsafer\b|\bsafely\b/g, " safety "],                                  // "safer" = "safety"
  [/\bapollo fire of 1967\b|\b1967 apollo fire\b/g, " apollo 1 fire 1967 "], // "the Apollo fire of 1967" = Apollo 1
];

// "Flames were extinguished in CO₂!" -> ["flame", "extingu", "co2"]
// Every word is cut to its first 7 letters, so a word family matches:
// extinguish / extinguished / extinguishment -> "extingu", combustion / combustible -> "combust".
function words(text) {
  let t = text.toLowerCase().replace(/₂/g, "2");
  PHRASES.forEach(([re, word]) => (t = t.replace(re, word)));
  return t
    .split(/[^a-z0-9]+/)
    .filter(w => w && !STOPWORDS.has(w) && (w.length > 1 || /\d/.test(w)))
    .map(w => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))   // flames -> flame
    .map(w => w.slice(0, 7));
}

// ---- done once: count words in every chunk ----
const index = CHUNKS.map(chunk => {
  const counts = new Map();
  // the document's title counts too, so a paragraph that doesn't repeat the topic word
  // (e.g. "firefighter" in the middle of a firefighter-gear article) can still be found
  words(chunk.title + " " + chunk.text).forEach(w => counts.set(w, (counts.get(w) || 0) + 1));
  let length = 0;
  counts.forEach(n => (length += n));
  return { chunk, counts, length };
});
const averageLength = index.reduce((sum, d) => sum + d.length, 0) / (index.length || 1);

// in how many chunks does each word appear?
const chunksWith = new Map();
index.forEach(d => d.counts.forEach((_, w) => chunksWith.set(w, (chunksWith.get(w) || 0) + 1)));

// rare words weigh more
function rarity(word) {
  const n = chunksWith.get(word) || 0;
  return Math.log(1 + (index.length - n + 0.5) / (n + 0.5));
}

// ---- the search ----
function searchChunks(question, howMany = 5) {
  const perDocument = {};
  const queryWords = [...new Set(words(question))];
  if (!queryWords.length) return [];

  const ranked = index
    .map(d => {
      let score = 0, matched = 0;
      for (const w of queryWords) {
        const tf = d.counts.get(w) || 0;
        if (!tf) continue;
        matched++;
        score += rarity(w) * (tf * (K1 + 1)) / (tf + K1 * (1 - B + B * d.length / averageLength));
      }
      return { chunk: d.chunk, score, matched };
    })
    // a chunk must share at least 2 different words with the question (1 if the question has only 1),
    // so one lucky word like "best" doesn't make "best pizza recipe" match
    .filter(r => r.matched >= Math.min(MIN_MATCHED_WORDS, queryWords.length))
    .sort((a, b) => b.score - a.score);

  // at most MAX_PER_DOCUMENT pieces from one document, so an answer can draw on several sources;
  // if that leaves empty places, they are filled with the next best pieces anyway
  const picked = [], skipped = [];
  for (const r of ranked) {
    const seen = (perDocument[r.chunk.title] || 0) + 1;
    perDocument[r.chunk.title] = seen;
    (seen <= MAX_PER_DOCUMENT ? picked : skipped).push(r);
  }
  return [...picked, ...skipped].slice(0, howMany).sort((a, b) => b.score - a.score);
}

module.exports = { searchChunks, chunkCount: CHUNKS.length };
