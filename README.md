# 🔥 Flamma

**Explore how fire behaves in space, using NASA's microgravity combustion data.**
Built by **Team Nyala** for the **NASA Space Apps Challenge 2026**: *Flame in Freefall*.

🌐 **Live site:** https://flamma-one.vercel.app

---

## What is Flamma?

On Earth, hot air rises and pulls fresh oxygen into a flame. In space there is no "up". Flames turn
round and slow, and some keep burning in conditions where they would go out on Earth. That makes fire one of the
most dangerous emergencies on a spacecraft.

Flamma turns NASA's raw experiment tables into something anyone can explore:

| Page | What you can do |
|---|---|
| **Home** | Learn why fire behaves differently in microgravity, NASA's three fire-safety pillars (prevention, detection, suppression), lessons from Apollo 1, Apollo 13 and Mir, and the Malaysian astronaut connection. |
| **Ask** | Ask a question in plain English. Flamma finds matching NASA tests and answers with **cited** NASA documents (Gemini + retrieval). |
| **Will It Burn?** | Set the oxygen, pressure, gravity and fuel, and see which real NASA tests are closest, what happened in them, and a flame animation. |
| **Investigations** | An overview of combustion science, every NASA investigation in the data (filters, search, compare and download), and other space agencies' research (JAXA FLARE). |
| **Investigation pages** | Each investigation has its own page with graphs of its results (worked out from the data), the cleaned table next to NASA's original table, CSV downloads, and Ask/Summarize about that investigation only. |
| **Back on Earth** | NASA fire-safety technology that came back to Earth (firefighter air tanks, smoke detectors, fire-resistant fabric). |

## NASA data used

Eight investigations from **NASA's Physical Sciences Informatics (PSI)** system:

| Investigation | Pillar | What's in the table |
|---|---|---|
| Saffire-II | Prevention | Large samples burned on a Cygnus cargo ship, with Earth comparison tests |
| ACME CFI-G | Prevention | Cool flames from gaseous fuels (normal and inverse flames) |
| ACME BRE | Prevention | Burning Rate Emulator: flames ignited per test day |
| BASS-II | Prevention | Burning solid materials under different oxygen and airflow |
| BASS | Prevention | Materials and shapes burned |
| SAME-R | Detection | Smoke made from heated spacecraft materials |
| SPICE | Detection | Smoke-point flames from gas jets |
| FLEX | Suppression | Burning fuel droplets and fire suppressants |

The raw tables in `Dataset/` are never changed. `scripts/clean_data.py` builds a cleaned copy with shared
column names, converted units and outcomes read from NASA's wording. The site shows the **cleaned and
original tables side by side**, so every change can be checked.

## How it works

- **Front end:** plain HTML, CSS and JavaScript (no framework). Graphs are hand-made SVG.
- **AI:** two small serverless functions on Vercel (`api/ask.js`, `api/summary.js`) call **Google Gemini**.
  The API key stays on the server and never reaches the browser.
- **Retrieval (RAG):** NASA and JAXA documents are split into pieces (`scripts/build_chunks.py` →
  `api/chunks.json`). `api/_search.js` finds the best pieces with BM25 search, and Gemini answers only from
  those pieces and the NASA data, citing them as [1], [2]…
- **Honesty rules:** the AI is told not to invent causes, numbers or verdicts, and to say when the data doesn't
  cover a question. The sentences under the graphs are calculated from the data, not written by hand.

## Project structure

```
index.html, style.css      the whole site (pages switch with #links)
*.js                       site scripts (data.js etc. are generated data files)
results.js                 investigation pages: graphs + Ask about one investigation
api/                       Vercel serverless functions (Gemini) + search
scripts/                   Python: clean the NASA data, build the document pieces
Dataset/                   NASA PSI tables, exactly as downloaded
data/clean/                cleaned CSV files
assets/                    images, video, logo
```

## Run it on your computer

1. Install [Node.js](https://nodejs.org/).
2. Create a file called `.env` in the project folder:
   ```
   GEMINI_API_KEY=your-key-from-google-ai-studio
   ```
3. Build the document pieces for Ask (see the note below), then start the site:
   ```
   npx vercel dev
   ```
4. Open http://localhost:3000

To rebuild the cleaned data: `python -m venv .venv && .venv/bin/pip install pandas && .venv/bin/python scripts/clean_data.py`

> **Note:** the source documents (`data/docs/`) and the pieces built from them (`api/chunks.json`) are
> **not in this repository**, because some of them belong to others (e.g. JAXA). Everything else works without
> them. Ask needs them for cited answers.

## Credits

- **Data:** NASA Physical Sciences Informatics (PSI), https://psi.nasa.gov
- **Documents:** NASA (Researcher's Guide to Combustion Science, FLEX results, NASA Spinoff, Apollo and Mir
  histories) and JAXA's FLARE experiment pages (courtesy of JAXA)
- **Images and video:** NASA (credited on the site next to each picture)
- **AI:** Google Gemini

## Disclaimer

Flamma is an independent student project by **orchidmanta (Team Nyala)** for the NASA Space Apps Challenge
2026. It is **not affiliated with or endorsed by NASA, JAXA** or any other organisation. It is for learning
only and must not be used for real fire-safety decisions.

Portfolio: https://mahirahsofea-portfolio.vercel.app/
