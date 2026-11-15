// ================= Ranking + results =================
// When "Will it burn?" is clicked: compare the user's conditions with every
// test in data.js, rank them by similarity, and fill the Results area.
// Conditions set to "Any" are ignored in the comparison.

// ---------- settings ----------
const OUTCOMES = ["Didn't ignite", "Went out quickly", "Burned, then went out", "Kept burning"];
// Outcome colours: an ordered severity scale (safe -> most dangerous).
// Checked with the dataviz palette validator: light mode passes all checks; in dark mode
// the amber sits above the lightness band on purpose (a darker amber becomes
// indistinguishable from the orange for red-green colour-blind readers).
// Every colour is always shown together with its text label.
const COLORS = {
  "Didn't ignite": "#2a9d5c",
  "Went out quickly": "#cfa700",
  "Burned, then went out": "#e8552d",
  "Kept burning": "#a8235f",
};
// text colour on top of each outcome colour (dark ink on amber, white elsewhere)
const ON_COLORS = {
  "Didn't ignite": "#ffffff",
  "Went out quickly": "#0b0b0b",
  "Burned, then went out": "#ffffff",
  "Kept burning": "#ffffff",
};

// How far apart counts as "1 unit" of difference for each condition.
// e.g. 20% oxygen apart = 1, 0.5 bar apart = 1.
const SCALE = { o2: 20, pressure: 0.5, gravity: 1, airflow: 20 };

// gravity as a fraction of Earth's (tests are either microgravity or Earth)
const USER_G = { station: 0, moon: 0.16, mars: 0.38, earth: 1 };
const TEST_G = { "microgravity": 0, "normal gravity": 1 };

// rough air speed for each airflow choice (cm/s), to compare with the tests
const USER_AIRFLOW = { still: 0, gentle: 10, strong: 25 };

// which fuels in the data count as each material
// which fuels in the data count as each material (matched by keyword, case-insensitive).
// Only clear names are matched: e.g. BASS-II '1/4" clear rod' is NOT assumed to be PMMA.
const MATERIAL_FUELS = {
  fabric: /sibal|cotton/i,                 // Saffire-II / BASS-II cotton-fiberglass fabric
  pmma: /pmma|acrylic/i,
  silicone: /silicone/i,
  nomex: /nomex/i,
  droplet: /methanol|heptane/i,            // FLEX droplets
  leak: /ethane|propane|butane/i,          // CFI-G gases (incl. diluted, e.g. '30% butane')
};
const WRONG_MATERIAL = 0.5;   // same fuel type but a different material

// if even the best match is further than this (average difference), say so honestly
const FAR_DISTANCE = 0.4;


// ---------- similarity ----------
// true if a test actually reports this value (empty cells in the data = unknown)
const known = v => v !== null && v !== undefined && v !== "";

// a test that doesn't report a condition the user set gets this fixed difference
const MISSING_PENALTY = 0.5;

// Compare one test with the user's conditions.
// Every condition the user set ("Any" ones are ignored) gives one difference:
//   - the normalized gap if the test reports it (e.g. 10% O2 apart = 0.5)
//   - MISSING_PENALTY if the test doesn't report it
// distance = the average of those differences (0 = identical).
function compare(test, c) {
  const parts = {};
  let reported = 0;
  const add = (name, testValue, diff) => {
    if (known(testValue)) { parts[name] = diff(); reported++; }
    else parts[name] = MISSING_PENALTY;
  };

  if (c.o2 !== null)
    add("o2", test.o2_percent, () => Math.abs(test.o2_percent - c.o2) / SCALE.o2);
  if (c.pressure !== null)
    add("pressure", test.pressure_bar, () => Math.abs(test.pressure_bar - c.pressure) / SCALE.pressure);
  if (c.gravity !== "any")
    add("gravity", TEST_G[test.gravity], () => Math.abs(TEST_G[test.gravity] - USER_G[c.gravity]) / SCALE.gravity);
  if (c.airflow !== "any")
    add("airflow", test.airflow_cm_s, () => Math.abs(test.airflow_cm_s - USER_AIRFLOW[c.airflow]) / SCALE.airflow);
  if (c.material !== "any")
    add("material", test.fuel, () => MATERIAL_FUELS[c.material].test(test.fuel) ? 0 : WRONG_MATERIAL);

  const values = Object.values(parts);
  const distance = values.length ? values.reduce((sum, x) => sum + x, 0) / values.length : 0;
  return { parts, distance, reported, total: values.length };
}

function rankTests(c) {
  // fuel type is a hard filter: a gas test says little about a solid
  const pool = TESTS.filter(t => c.phase === "any" || t.fuel_phase === c.phase);
  return pool
    .map(t => {
      const { distance, reported, total } = compare(t, c);
      return { ...t, distance, relevance: 1 / (1 + distance), dataReported: reported, dataTotal: total };
    })
    .sort((a, b) => a.distance - b.distance);
}

// most common outcome among the top tests (ties go to the higher-ranked one)
function mostCommonOutcome(tests) {
  const counts = {};
  tests.forEach(t => counts[t.outcome] = (counts[t.outcome] || 0) + 1);
  return tests.reduce((best, t) => counts[t.outcome] > counts[best] ? t.outcome : best, tests[0].outcome);
}

// ---------- helpers ----------
const $ = id => document.getElementById(id);
const show = (id, visible) => $(id).classList.toggle("hidden", !visible);

function pill(outcome) {
  if (!outcome) return `<span class="pill pill-unknown">Not stated</span>`;
  return `<span class="pill" style="background:${COLORS[outcome]};color:${ON_COLORS[outcome]}">${outcome}</span>`;
}

// columns of the test tables inside each investigation card
const TABLE_COLUMNS = [
  { label: "Relevance", show: r => Math.round(r.relevance * 100) + "%" },
  { label: "Data", show: r => `<span title="This test reports ${r.dataReported} of the ${r.dataTotal} conditions you set">${r.dataReported}/${r.dataTotal}</span>` },
  { label: "Test", noMerge: true, show: r => cellValue(r.test_id) },
  { label: "Fuel", show: r => cellValue(r.fuel) },
  { label: "O₂ %", show: r => cellValue(r.o2_percent) },
  { label: "Pressure (bar)", show: r => cellValue(r.pressure_bar) },
  { label: "Gravity", show: r => cellValue(r.gravity) },
  { label: "Airflow (cm/s)", show: r => cellValue(r.airflow_cm_s) },
  { label: "Burn time (s)", show: r => cellValue(r.burn_time_s) },
  { label: "Outcome", noMerge: true, show: r => pill(r.outcome) },
];

// "your scenario vs closest test", one row per condition the user set
function renderComparison(best, c) {
  const rows = [];
  const or = (v, unit = "") => known(v) ? v + unit : "not reported";
  if (c.o2 !== null) rows.push(["Oxygen", c.o2 + "%", or(best.o2_percent, "%")]);
  if (c.pressure !== null) rows.push(["Pressure", SLIDERS.pressure.format(c.pressure) + " bar", or(best.pressure_bar, " bar")]);
  if (c.gravity !== "any") rows.push(["Gravity", LABELS.gravity[c.gravity], or(best.gravity)]);
  if (c.airflow !== "any") rows.push(["Airflow", `${LABELS.airflow[c.airflow]} (~${USER_AIRFLOW[c.airflow]} cm/s)`, or(best.airflow_cm_s, " cm/s")]);
  if (c.material !== "any") rows.push(["Material", materialLabel(c.material), or(best.fuel)]);
  else if (c.phase !== "any") rows.push(["Fuel type", c.phase, best.fuel_phase]);

  $("compare-table").innerHTML =
    "<tr><th></th><th>Your scenario</th><th>Closest test (" + best.investigation + " " + best.test_id + ")</th></tr>" +
    rows.map(r => `<tr><td>${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join("");
}

// ---------- "Your test": the current conditions, under the scene ----------
// Follows the conditions live (every change).
// One item per condition, with a clear label. "Any" (not set) is shown greyed out.
function renderYourTest(c) {
  const item = (label, value) => value === null
    ? `<div class="is-any"><dt>${label}</dt><dd>Any <small>(not set)</small></dd></div>`
    : `<div><dt>${label}</dt><dd>${value}</dd></div>`;
  const fuel = c.material !== "any" ? materialLabel(c.material) : c.phase !== "any" ? LABELS.phase[c.phase] : null;
  $("your-test").innerHTML = [
    item("Oxygen", c.o2 === null ? null : `${Math.round(c.o2)}<small>%</small>`),
    item("Pressure", c.pressure === null ? null : `${SLIDERS.pressure.format(c.pressure)}<small> bar</small>`),
    item("What's burning", fuel),
    item("Airflow", c.airflow === "any" ? null : LABELS.airflow[c.airflow]),
    item("Gravity", c.gravity === "any" ? null : LABELS.gravity[c.gravity]),
  ].join("");
}

document.addEventListener("conditionschange", e => renderYourTest(e.detail.conditions));
renderYourTest(conditions);


// ---------- main: "Will it burn?" ----------
function runRanking() {
  const c = conditions;   // from conditions.js
  show("results-stale", false);
  // the results appear when the fire animation is done (finishTest in fire.js);
  // the two early exits below have no animation, so they show the results straight away
  show("results", false);
  summaryRun++;                       // ignore any AI answer still on its way from an earlier click
  show("h-summary-label", false);

  if (nothingSet(c)) {    // nothingSet() is in scene.js
    $("h-summary").textContent = 'Set at least one condition, then click "Will it burn?".';
    ["h-gap", "h-partial", "compare-card"].forEach(id => show(id, false));
    $("habitat-cards").innerHTML = "";
    show("results", true);
    return;
  }

  const ranked = rankTests(c);
  lastRanked = ranked;                                 // the table can re-render without re-ranking
  // verdict, summary and fire animation only use tests WITH an outcome
  const withOutcome = ranked.filter(t => t.outcome);
  const evidence = withOutcome.slice(0, 10);

  if (evidence.length === 0) {
    $("h-summary").textContent = "No tests with a known outcome match these conditions.";
    ["h-gap", "compare-card"].forEach(id => show(id, false));
    renderResultsTable();
    show("results", true);
    return;
  }
  const best = evidence[0];
  const verdict = mostCommonOutcome(evidence);

  // honesty checks
  const far = best.distance > FAR_DISTANCE;
  const noCloseO2 = c.o2 !== null && !ranked.some(t => known(t.o2_percent) && Math.abs(t.o2_percent - c.o2) <= 5);
  const fuelWord = c.phase === "any" ? "" : c.phase + " ";

  const gapMessages = [];
  if (noCloseO2) gapMessages.push(`No ${fuelWord}tests within ±5% of ${c.o2}% oxygen.`);
  // above the highest room-oxygen tests, point to the only higher-oxygen data (CFI-G inverse flames)
  if (c.o2 !== null && c.o2 > 40) gapMessages.push(`Above 40% oxygen, NASA's only microgravity data are CFI-G's inverse flames (up to 85% oxygen flowing out of a burner into fuel and nitrogen, not an oxygen-filled room). See NASA Investigations → Prevention → CFI-G.`);
  if (far) gapMessages.push(`Even the closest test is far from your scenario (relevance ${Math.round(best.relevance * 100)}%). Treat these results as a rough guide, not evidence.`);
  $("h-gap-list").innerHTML = gapMessages.map(m => `<li>${m}</li>`).join("");
  show("h-gap", gapMessages.length > 0);

  show("h-partial", c.gravity === "moon" || c.gravity === "mars");

  // summary: the code-written sentence is ready at once; the AI version replaces it if it arrives
  const count = o => evidence.filter(t => t.outcome === o).length;
  const sources = [...new Set(evidence.map(t => t.investigation))].slice(0, 3).join(", ");
  const codeSummary =
    `Of the <b>${evidence.length}</b> most similar tests with a known outcome, <b>${count("Kept burning")}</b> kept burning, ` +
    `<b>${count("Burned, then went out")}</b> burned then went out, ` +
    `<b>${count("Went out quickly")}</b> went out quickly, and <b>${count("Didn't ignite")}</b> didn't ignite. ` +
    `Closest evidence comes from <b>${sources}</b>.`;
  $("h-summary").classList.remove("muted");
  $("h-summary").innerHTML = `Most common outcome: ${pill(verdict)}<br><span class="summary-text"></span>`;

  const gaps = [...gapMessages];
  if (c.gravity === "moon" || c.gravity === "mars") gaps.push($("h-partial-text").textContent);
  requestAiSummary(buildFacts(c, evidence, verdict, gaps), codeSummary);

  // comparison table only when the best match is far away
  if (far) renderComparison(best, c);
  show("compare-card", far);

  renderResultsTable();

  // let other parts of the page (the scene's fire animation, later) know the result
  document.dispatchEvent(new CustomEvent("rankingdone", {
    detail: { top: evidence, verdict, uncertain: far || noCloseO2 },
  }));

}

$("run-btn").addEventListener("click", runRanking);
$("loading-count").textContent = TESTS.length;   // "Comparing your test with 600 NASA tests…"

// ---------- AI summary (api/summary.js) ----------
// Only called from runRanking, i.e. when "Will it burn?" is clicked (never on slider moves).

// The facts the AI may use. user_scenario (hypothetical) is kept apart from
// closest_tests (real NASA conditions), so the AI can't mix them up.
function buildFacts(c, evidence, verdict, gaps) {
  const setOrAny = (isSet, value) => isSet ? value : "Any (not set)";
  const outcomeCounts = {};
  OUTCOMES.forEach(o => outcomeCounts[o] = evidence.filter(t => t.outcome === o).length);
  const avgReported = evidence.reduce((sum, t) => sum + t.dataReported, 0) / evidence.length;

  return {
    user_scenario: {
      oxygen: setOrAny(c.o2 !== null, Math.round(c.o2) + "%"),
      pressure: setOrAny(c.pressure !== null, SLIDERS.pressure.format(c.pressure) + " bar"),
      fuel_type: setOrAny(c.phase !== "any", c.phase),
      material: setOrAny(c.material !== "any", materialLabel(c.material)),
      airflow: setOrAny(c.airflow !== "any", LABELS.airflow[c.airflow]),
      gravity: setOrAny(c.gravity !== "any", LABELS.gravity[c.gravity]),
    },
    most_common_outcome: verdict,
    outcome_counts_of_top_tests: outcomeCounts,
    number_of_top_tests: evidence.length,
    closest_tests: evidence.slice(0, 5).map(t => ({
      investigation: t.investigation,
      test_id: t.test_id,
      fuel: t.fuel || "not reported",
      o2_percent: known(t.o2_percent) ? t.o2_percent : "not reported",
      pressure_bar: known(t.pressure_bar) ? t.pressure_bar : "not reported",
      gravity: t.gravity || "not reported",
      airflow_cm_s: known(t.airflow_cm_s) ? t.airflow_cm_s : "not reported",
      outcome: t.outcome,
      relevance_percent: Math.round(t.relevance * 100),
    })),
    investigations_in_top_tests: [...new Set(evidence.map(t => t.investigation))],
    data_gaps: gaps.length ? gaps : ["none flagged"],
    average_data_coverage: `${avgReported.toFixed(1)}/${evidence[0].dataTotal} of the set conditions are reported by the top tests`,
  };
}

let summaryRun = 0;   // so an old, slow answer never overwrites a newer one
const AI_TIMEOUT_MS = 8000;

async function requestAiSummary(facts, codeSummary) {
  const run = ++summaryRun;
  const box = $("h-summary");
  const text = box.querySelector(".summary-text");
  show("h-summary-label", false);

  // opened by double-clicking index.html: there is no server, so use the code summary straight away
  if (location.protocol === "file:") {
    text.innerHTML = codeSummary;
    return;
  }

  box.classList.add("is-loading");
  text.textContent = "Generating summary...";

  // give up after 8 seconds: abort() makes fetch throw, which lands in catch below
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const res = await fetch("/api/summary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ facts }),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!res.ok || !data.text) throw new Error(data.error || "No text in response");
    if (run !== summaryRun) return;
    text.textContent = data.text;          // textContent: AI text is shown as plain text, never as HTML
    show("h-summary-label", true);
  } catch (err) {
    if (run !== summaryRun) return;
    const reason = err.name === "AbortError" ? `no answer within ${AI_TIMEOUT_MS / 1000} s` : err.message;
    console.warn("AI summary unavailable, using the code-written summary:", reason);
    text.innerHTML = codeSummary;
  } finally {
    clearTimeout(timer);
    if (run === summaryRun) box.classList.remove("is-loading");
  }
}

// ---------- results table ----------
// By default only tests with a recorded outcome; the checkbox reveals the rest.
// (The verdict always uses tests with an outcome, whatever the checkbox says.)
let lastRanked = [];

// the top 10 tests, shown as one card per investigation (the same cards as on Ask);
// investigations appear in the order of their best-ranked test
function renderResultsTable() {
  const showUnknown = $("show-unknown").checked;
  const rows = (showUnknown ? lastRanked : lastRanked.filter(t => t.outcome)).slice(0, 10);
  $("habitat-cards").innerHTML = rows.length
    ? groupByInvestigation(rows).map(g => investigationTestsCard(g.inv, g.tests, {
        columns: TABLE_COLUMNS,
        countText: `${g.tests.length} of the top ${rows.length} tests`,
      })).join("")
    : `<p class="muted">No tests to show.</p>`;
}

$("show-unknown").addEventListener("change", renderResultsTable);

// after a run, changing a condition marks the results as out of date
let hasRun = false;
document.addEventListener("rankingdone", () => hasRun = true);
document.addEventListener("conditionschange", () => { if (hasRun) show("results-stale", true); });
