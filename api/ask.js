// ================= /api/ask (Vercel serverless function) =================
// The Ask page sends: the question, metadata + stats for every investigation,
// what its keyword search understood (matched_on), and the related tests it found (max 15).
// This function also searches the documents (NASA + JAXA FLARE page; api/chunks.json, see _search.js)
// for the 5 most relevant pieces, numbered [1]..[5].
// We ask Gemini to answer from all of that only, citing the pieces like [1], as JSON:
//   { answer, sources: [{ n, title, url, page }], investigations: [...], scenario: {...} or null }
// Same setup as api/summary.js: runs on the server, key from .env (locally)
// or Vercel's settings (online), never sent to the browser.

const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";
const MAX_QUESTION_LENGTH = 500;
const MAX_TESTS = 15;
const MAX_FOCUS_CHARS = 40000;   // the focus investigation's table sample, as JSON

// on an investigation's page: search with its names added, then put the pieces that
// actually mention it first (e.g. "FLEX" or "Flame Extinguishment Experiment")
function focusChunks(focus, question) {
  const names = [focus.investigation, focus.full_name.replace(/\s*\(.*\)\s*$/, "")].filter(Boolean);
  const results = searchChunks(`${names.join(" ")} ${question}`, MAX_CHUNKS * 4);
  const escape = t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/[-\s]+/g, "[-\\s]?");
  const mentions = new RegExp(`\\b(${names.map(escape).join("|")})\\b`, "i");
  const about = results.filter(r => mentions.test(r.chunk.title + " " + r.chunk.text));
  return (about.length ? about : results).slice(0, MAX_CHUNKS);   // no unrelated filler when it has its own pieces
}

// keep only a known investigation, plain values, and a bounded number of rows
function readFocus(focus, investigations) {
  if (!focus || typeof focus !== "object" || typeof focus.investigation !== "string") return null;
  if (!investigations.some(i => i && i.investigation === focus.investigation)) return null;
  const out = {
    investigation: focus.investigation,
    full_name: String(focus.full_name || "").slice(0, 200),
    row_count: Number(focus.row_count) || 0,
    result_summary: (Array.isArray(focus.result_summary) ? focus.result_summary : []).slice(0, 6).map(t => String(t).slice(0, 600)),
    table_rows: [],
  };
  let size = JSON.stringify(out).length;
  for (const row of Array.isArray(focus.table_rows) ? focus.table_rows.slice(0, 100) : []) {
    if (!row || typeof row !== "object") continue;
    const clean = {};
    for (const [k, v] of Object.entries(row).slice(0, 25)) {
      if (v === null || ["string", "number", "boolean"].includes(typeof v)) clean[String(k).slice(0, 60)] = typeof v === "string" ? v.slice(0, 200) : v;
    }
    size += JSON.stringify(clean).length;
    if (size > MAX_FOCUS_CHARS) break;
    out.table_rows.push(clean);
  }
  out.rows_shown = out.table_rows.length;
  return out;
}
const MAX_CHUNKS = 6;

const { searchChunks } = require("./_search.js");

const SYSTEM_PROMPT =
  "You are a research assistant for NASA microgravity combustion data. Answer ONLY from the " +
  "provided data. If the data doesn't cover the question, say so clearly and mention it as a " +
  "data gap. Never invent numbers: only quote a count or value that appears exactly in the data " +
  "(for a group of tests, use that group's own counts, e.g. a by_burner_oxygen level); never " +
  "estimate, mix, add up or reuse counts from a different group. If the exact count is not in " +
  "the data, describe it without a number. Never present the user's hypothetical conditions as tested " +
  "conditions. Do not give safety certifications; you can describe what the evidence shows. " +
  "If the question is off-topic or harmful, the whole answer is exactly: \"Sorry, Flamma only covers " +
  "fire safety in space, using research from NASA and partner agencies.\" Never put that sentence " +
  "inside an on-topic answer. A question about how anything burns, or about fire in space, on the Moon or Mars, " +
  "in a spacecraft or spacesuit, is ON-topic even if that material or condition was never " +
  "tested: answer it with the data gap and the closest evidence, never with the off-topic reply. " +
  "Mention investigation names.\n\n" +
  // length and structure: informative, but still readable
  "Write an informative answer in plain English, in 2 short paragraphs separated by a blank line " +
  "(about 6-9 sentences in total). Paragraph 1: answer the question directly. Paragraph 2: explain " +
  "only the investigations that help answer this question (usually 1-3; never list every " +
  "investigation just to name them): what each one studied and how (from its objective and approach), " +
  "what its tests show (you may quote numbers that appear in the data, such as outcome counts, " +
  "oxygen or pressure ranges, or a specific test's conditions), and how it connects to the " +
  "question. Mention a data gap or limitation only if there is a real one that matters for the " +
  "question (e.g. no tests at the asked conditions); never invent one just to have one. " +
  "Define technical terms briefly " +
  "the first time you use them.\n\n" +
  // how to fill the JSON fields (so the website can use them)
  "Reply as JSON. \"investigations\": names of the investigations your answer relies on, " +
  "spelled exactly as in the data (e.g. \"FLEX\"). \"scenario\": only if the question describes " +
  "a fire scenario (conditions such as oxygen, pressure, a material or a place like a Moon base), " +
  "otherwise null. The scenario describes the QUESTION only: never copy values from the tests " +
  "into it, and use null for anything the question (or matched_on) does not state. " +
  "oxygen = percent (number), pressure = bar (number), " +
  "fuel_phase = solid | liquid | gas, " +
  "material = fabric | pmma | silicone | nomex | droplet | leak, " +
  "airflow = still | gentle | strong, gravity = station | moon | mars | earth " +
  "(station means microgravity, e.g. ISS or a spacecraft).\n\n" +
  // what the website already found
  "related_tests were picked by Flamma's search as the closest matches to the question, and " +
  "matched_on says what the search understood (for example the preset conditions it uses for a " +
  "Moon base). Base your answer on related_tests when they are relevant, quote their actual " +
  "conditions, and say how they differ from what the question asks about. " +
  "For questions about how or why an experiment was done, what it set out to find, or what it " +
  "means for spacecraft, use the investigations' objective, approach, hypothesis and " +
  "research_impacts texts. When summarizing NASA's texts, keep each point's meaning; do not " +
  "link separate points with 'because' or 'so' unless the text does.\n\n" +
  // checks Flamma computed in code: always use them
  "condition_checks are comparisons Flamma computed from the data for the conditions in the " +
  "question (inside or outside the tested ranges). Include the substance of EVERY condition " +
  "check in your answer (each condition check has a text and a key; use the text), with its numbers, in your own words (don't copy them word for word), " +
  "and do not contradict them. When a value is below the tested range, compare it with the " +
  "lowest tested value, not the highest (and the other way round).\n\n" +
  // when the question asks about something NASA did not test
  "If the asked material or conditions are not in the data: (1) say clearly what is missing; " +
  "(2) point to the closest tested evidence and quote it: the most similar tested material " +
  "(match by type, e.g. a plant-based or cellulose material is closest to the cotton fabric " +
  "(SIBAL); a plastic is closest to PMMA; a liquid fuel to the droplet fuels) and the closest " +
  "tested conditions, using related_tests and the materials summary (quote the closest " +
  "material's real numbers, e.g. how many tests, at what oxygen, and their outcomes); (3) say plainly that this is only a rough comparison, " +
  "not evidence about the asked material. Check oxygen, pressure and gravity one by one: for " +
  "EACH that is outside what was tested, state the tested range from overall_ranges (e.g. the " +
  "highest room oxygen in any burn test) and say the asked value is beyond it. For oxygen above " +
  "about 40%, also mention CFI-G's inverse flames (NASA's highest-oxygen microgravity data, up to " +
  "85%), always explaining that their oxygen flows out of a burner into fuel and nitrogen, so it " +
  "is not the oxygen level of a room or cabin. ACME BRE has daily summaries only (flames ignited " +
  "per day), never individual test outcomes. Each entry in materials " +
  "belongs to one investigation: never add numbers from different entries together or credit " +
  "one investigation with another's tests. Likewise, attribute every finding to the investigation " +
  "or document that reported it; never write that several investigations 'together' show something " +
  "only one of them reported. You may describe a trend only if the " +
  "data or chunks show it, and never turn it into a prediction or a safety judgement.\n\n" +
  // asked from one investigation's page
  "If the data has focus_investigation, the user is on that investigation's own page and every question " +
  "is about it, even if it doesn't name it. Answer about that investigation only (mention another one only " +
  "if the question asks). Base the answer first on focus_investigation: result_summary (sentences worked " +
  "out from its full table, shown on the page under its graphs) and table_rows (real rows of its data " +
  "table; rows_shown of row_count rows, spread evenly, so use result_summary and row_count for totals and " +
  "never count rows yourself as if they were all of them), then its metadata and the document chunks about it. " +
  "If its table doesn't contain what is asked, say that this investigation's table doesn't record it.\n\n" +
  // the document pieces
  "document_chunks are numbered excerpts from NASA documents and from JAXA documents on its FLARE " +
  "experiment (JAXA is a partner space agency: two web pages, one translated by Flamma from Japanese, " +
  "and a leaflet); each has a title. When a fact comes from a JAXA chunk, say so in the sentence (e.g. 'JAXA's FLARE experiment...'). Answer only from the provided " +
  "chunks and data. After each sentence that uses a chunk, cite it like [1] or [2] (for two " +
  "chunks write [1][2]). Only use the numbers of the chunks given. Facts from the tests or the " +
  "investigation metadata need no citation. If the chunks don't contain the answer, say so. " +
  "Never invent sources. Cite a chunk only for a sentence whose fact that chunk directly states; " +
  "never add a list of citations at the end just to name sources. Never add a cause, mechanism or " +
  "detail that the chunk does not state (e.g. do not call a result an ISS or orbital test unless the " +
  "chunk says so, and do not explain why something happens unless the chunk explains it). Do not open " +
  "with a yes/no verdict like 'Yes, X is a severe hazard'; start with what the evidence shows. " +
  "Keep the chunk's framing: " +
  "for example, a listed benefit of doing research is not a cause of how fire behaves.";

// the shape Gemini must reply in
const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    answer: { type: "STRING" },
    investigations: { type: "ARRAY", items: { type: "STRING" } },
    scenario: {
      type: "OBJECT",
      nullable: true,
      properties: {
        oxygen: { type: "NUMBER", nullable: true },
        pressure: { type: "NUMBER", nullable: true },
        fuel_phase: { type: "STRING", nullable: true },
        material: { type: "STRING", nullable: true },
        airflow: { type: "STRING", nullable: true },
        gravity: { type: "STRING", nullable: true },
      },
    },
  },
  required: ["answer", "investigations", "scenario"],
};

// allowed scenario values (anything else becomes null, so the website never gets a value it can't use)
const ALLOWED = {
  fuel_phase: ["solid", "liquid", "gas"],
  material: ["fabric", "pmma", "silicone", "nomex", "droplet", "leak"],
  airflow: ["still", "gentle", "strong"],
  gravity: ["station", "moon", "mars", "earth"],
};

function cleanScenario(s) {
  if (!s || typeof s !== "object") return null;
  const num = (v, min, max) => (typeof v === "number" && v >= min && v <= max ? v : null);
  const pick = (v, list) => (list.includes(v) ? v : null);
  const out = {
    oxygen: num(s.oxygen, 0, 100),
    pressure: num(s.pressure, 0, 5),
    fuel_phase: pick(s.fuel_phase, ALLOWED.fuel_phase),
    material: pick(s.material, ALLOWED.material),
    airflow: pick(s.airflow, ALLOWED.airflow),
    gravity: pick(s.gravity, ALLOWED.gravity),
  };
  return Object.values(out).some(v => v !== null) ? out : null;   // all empty -> no scenario
}

// ---------- automatic source check ----------
// The AI sometimes uses a document piece but forgets to cite it. If a sentence without a
// citation repeats at least AUTO_CITE_WORDS words in a row from a piece we sent, cite that
// piece automatically (so its page appears under "Sources").
const AUTO_CITE_WORDS = 7;
const wordList = text => text.toLowerCase().replace(/[^a-z0-9%.]+/g, " ").replace(/\.(?=\s|$)/g, "").split(" ").filter(Boolean);

function wordRuns(text, n) {
  const w = wordList(text), runs = new Set();
  for (let i = 0; i + n <= w.length; i++) runs.add(w.slice(i, i + n).join(" "));
  return runs;
}

function addMissingCitations(answer, chunks) {
  const chunkRuns = chunks.map(c => wordRuns(c.text, AUTO_CITE_WORDS));
  // split into sentences, keeping the paragraph breaks
  return answer.replace(/[^.!?\n]+[.!?]+(\s*\[\d+\])*/g, sentence => {
    if (/\[\d+\]/.test(sentence)) return sentence;            // already cited
    const runs = wordRuns(sentence, AUTO_CITE_WORDS);
    const found = chunkRuns.findIndex(cr => [...runs].some(r => cr.has(r)));
    return found === -1 ? sentence : `${sentence} [${found + 1}]`;
  });
}

// ---------- make sure every condition check is in the answer ----------
// The AI is told to include every check, but sometimes skips one. If the answer does not
// contain a check's key (e.g. the lowest tested pressure "0.507"), add that check's sentence
// at the end of the first paragraph.
function addMissingChecks(answer, checks) {
  const missing = checks.filter(c => c.key && !answer.toLowerCase().includes(c.key.toLowerCase()));
  if (!missing.length) return answer;
  const [first, ...rest] = answer.split(/\n\s*\n/);
  return [first.trim() + " " + missing.map(c => c.text).join(" "), ...rest].join("\n\n");
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST." });
  }

  // AI switched off (AI_OFF=1 in .env, or in Vercel's settings): answer straight away without
  // calling Gemini. The website then shows its non-AI fallback, so no API quota is used.
  if (process.env.AI_OFF === "1") {
    return res.status(503).json({ error: "AI is switched off (AI_OFF=1)." });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not set on the server." });
  }

  // ---- check what the browser sent ----
  // (reading req.body itself throws if the JSON is broken, so it goes inside try)
  let body;
  try {
    body = req.body;
    if (typeof body === "string") body = JSON.parse(body);
  } catch {
    return res.status(400).json({ error: "Body must be JSON." });
  }
  const question = body && typeof body.question === "string" ? body.question.trim() : "";
  if (!question) {
    return res.status(400).json({ error: 'Send JSON like { "question": "...", "investigations": [...], "stats": {...}, "tests": [...] }.' });
  }
  if (question.length > MAX_QUESTION_LENGTH) {
    return res.status(400).json({ error: `Question is too long (max ${MAX_QUESTION_LENGTH} characters).` });
  }
  const data = {
    investigations: Array.isArray(body.investigations) ? body.investigations : [],
    stats: body.stats && typeof body.stats === "object" ? body.stats : {},
    matched_on: Array.isArray(body.matched_on) ? body.matched_on.slice(0, 10) : [],
    related_tests: Array.isArray(body.tests) ? body.tests.slice(0, MAX_TESTS) : [],
    overall_ranges: body.overall_ranges && typeof body.overall_ranges === "object" ? body.overall_ranges : {},
    materials: Array.isArray(body.materials) ? body.materials.slice(0, 40) : [],
    condition_checks: Array.isArray(body.condition_checks)
      ? body.condition_checks.slice(0, 6).filter(c => c && typeof c.text === "string").map(c => ({ text: c.text, key: String(c.key || "") }))
      : [],
  };

  // asked from one investigation's own page: its table rows + result sentences (capped in size)
  const focus = readFocus(body.focus, data.investigations);
  if (focus) data.focus_investigation = focus;

  // ---- find the best document pieces for this question ----
  // (on an investigation's page, its name is added so its own documents come first)
  const found = focus ? focusChunks(focus, question) : searchChunks(question, MAX_CHUNKS);
  data.document_chunks = found.map((r, i) => ({ n: i + 1, title: r.chunk.title, page: r.chunk.page, text: r.chunk.text }));
  const sources = found.map((r, i) => ({ n: i + 1, title: r.chunk.title, url: r.chunk.url, page: r.chunk.page }));

  // ---- ask Gemini ----
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{
          role: "user",
          parts: [{ text: "QUESTION:\n" + question + "\n\nDATA (JSON):\n" + JSON.stringify(data) }],
        }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
      }),
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = (result && result.error && result.error.message) || response.statusText;
      return res.status(500).json({ error: `Gemini API error (${response.status}): ${reason}` });
    }

    // Gemini's reply is JSON text inside candidates[0].content.parts[*].text
    const parts = result?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || "").join("").trim();
    let reply;
    try {
      reply = JSON.parse(text);
    } catch {
      return res.status(500).json({ error: "Gemini did not return valid JSON." });
    }
    if (!reply || typeof reply.answer !== "string" || !reply.answer.trim()) {
      return res.status(500).json({ error: "Gemini returned no answer." });
    }

    // keep only investigation names that really exist in the data we sent
    const knownNames = data.investigations.map(i => i && i.investigation);
    const investigations = (Array.isArray(reply.investigations) ? reply.investigations : [])
      .filter(name => knownNames.includes(name));

    // citations: "[1, 2]" -> "[1][2]", and drop any number we did not send (never a made-up source)
    const answer = reply.answer.trim()
      .replace(/\[(\d+(?:\s*,\s*\d+)+)\]/g, (_, list) => list.split(",").map(n => `[${n.trim()}]`).join(""))
      .replace(/\s?\[(\d+)\]/g, (match, n) => (n >= 1 && n <= sources.length ? match : ""))
      .replace(/\s?\[(?!\d)[A-Za-z][^\]]{0,40}\]/g, "");   // "[CFI-G]" etc.: not a real citation
    const citedAnswer = addMissingChecks(addMissingCitations(answer, found.map(r => r.chunk)), data.condition_checks);

    return res.status(200).json({
      answer: citedAnswer,
      sources,
      investigations,
      scenario: cleanScenario(reply.scenario),
    });
  } catch (err) {
    return res.status(500).json({ error: "Could not reach Gemini: " + err.message });
  }
};
