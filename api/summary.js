// ================= /api/summary (Vercel serverless function) =================
// The browser sends the ranking facts here. This code runs on the SERVER, so the
// Gemini API key stays secret (it is read from .env locally / Vercel settings online and
// never sent to the browser). We ask Gemini for a short summary and send back
// { text: "..." }.

// Model name. To try another one, set GEMINI_MODEL in .env.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.5-flash-lite";

const INSTRUCTIONS =
  "You are a spacecraft fire-safety assistant. Using ONLY the facts below, write 2-3 " +
  "plain-English sentences for an engineer about fire risk in this scenario. Mention the " +
  "investigation names. If the facts mention a data gap, missing data, or Moon/Mars gravity, " +
  "say so honestly. Do not invent any numbers or facts that are not in the data. " +
  "The user's scenario (user_scenario) is hypothetical. Never say the NASA tests were done at " +
  "the user's conditions. When you mention test conditions, use only the closest_tests values. " +
  "If they differ a lot from the user's scenario, say so. " +
  "Name the closest test (closest_tests[0]: investigation and test_id) and quote its oxygen, " +
  "pressure and gravity; if a value is \"not reported\", say it was not reported. " +
  "Address the reader as 'you'.";

module.exports = async (req, res) => {
  // only POST is allowed
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

  // the body may arrive already parsed (JSON) or as a string
  // (reading req.body itself throws if the JSON is broken, so it goes inside try)
  let body;
  try {
    body = req.body;
    if (typeof body === "string") body = JSON.parse(body);
  } catch {
    return res.status(400).json({ error: "Body must be JSON." });
  }
  const facts = body && body.facts;
  if (!facts || typeof facts !== "object") {
    return res.status(400).json({ error: 'Send JSON like { "facts": { ... } }.' });
  }

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: INSTRUCTIONS + "\n\nFACTS (JSON):\n" + JSON.stringify(facts, null, 2) }],
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 300 },
      }),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const reason = (data && data.error && data.error.message) || response.statusText;
      return res.status(500).json({ error: `Gemini API error (${response.status}): ${reason}` });
    }

    // the answer text lives in candidates[0].content.parts[*].text
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const text = parts.map(p => p.text || "").join("").trim();
    if (!text) {
      return res.status(500).json({ error: "Gemini returned no text." });
    }

    return res.status(200).json({ text });
  } catch (err) {
    return res.status(500).json({ error: "Could not reach Gemini: " + err.message });
  }
};
