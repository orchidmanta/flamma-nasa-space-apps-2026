// ================= "Ask" page (home) =================
// Step A (no AI): read the question, pick out keywords and numbers, and find
// related tests (data.js) and investigations (investigations.js). Shown at once.
// Step B: send the question + that data to api/ask.js for an AI answer, and
// offer "Try this scenario in Will It Burn?" if the question describes one.
// Uses helpers from other files: compare/known/pill/MATERIAL_FUELS (app.js),
// PRESETS/SLIDERS/MATERIALS/setSlider/setChoice/animateSlider (conditions.js), escapeHtml/investigationIntro/fullName/psiPage/dateRange/investigationTestsCard/cellValue (experiments.js).

// ---------- keyword lists ----------
// Words that point to an investigation. `focus` (optional) moves the most relevant tests to the top.
const INVESTIGATION_WORDS = [
  { words: /saffire/i,  investigation: "Saffire-II", label: "Saffire-II" },
  { words: /\bflex\b/i, investigation: "FLEX",       label: "FLEX" },
  { words: /cfi[- ]?g/i, investigation: "CFI-G",     label: "CFI-G" },
  { words: /\bbass[- ]?(ii|2)\b/i, investigation: "BASS-II", label: "BASS-II" },
  { words: /\bbass\b(?![- ]?(ii|2)\b)/i, investigation: "BASS", label: "BASS (the first BASS)" },
  { words: /\bspice\b|smoke[- ]?point|\bsoot/i, investigation: "SPICE", label: "smoke point / soot (SPICE)" },
  { words: /same[- ]?r\b/i, investigation: "SAME-R", label: "SAME-R" },
  { words: /\bbre\b|burning rate emulator|acme bre/i, investigation: "ACME BRE", label: "ACME BRE" },
  { words: /suppress|extinguish|put (\w+ )?out|\bco2\b|co₂|carbon dioxide|helium/i,
    investigation: "FLEX", label: "fire suppression (FLEX; tests with a CO₂ or helium suppressant first)", focus: t => /suppressant/i.test(t.notes) },
  { words: /smoke|detector|detection/i, investigation: "SAME-R", label: "smoke detection (SAME-R)" },
  { words: /cool flame/i, investigation: "CFI-G", label: "cool flames (CFI-G; cool-flame tests first)", focus: t => /cool flame/i.test(t.notes) },
];

// Words that point to a material or fuel. `fuel` is matched against the test's fuel name.
const FUEL_WORDS = [
  { words: /fabric|cloth|textile|cotton|sibal/i, fuel: MATERIAL_FUELS.fabric, label: "fabric (SIBAL / cotton)" },
  { words: /plastic|pmma|acrylic|plexiglass/i,   fuel: MATERIAL_FUELS.pmma,   label: "plastic (PMMA)" },
  { words: /silicone/i,  fuel: /silicone/i,  label: "silicone" },
  { words: /nomex/i,     fuel: /nomex/i,     label: "Nomex" },
  { words: /methanol/i,  fuel: /methanol/i,  label: "methanol" },
  { words: /heptane/i,   fuel: /heptane/i,   label: "heptane" },
  { words: /\bethane/i,  fuel: /\bethane/i,  label: "ethane" },
  { words: /propane/i,   fuel: /propane/i,   label: "propane" },
  { words: /butane/i,    fuel: /butane/i,    label: "butane" },
  { words: /droplet|liquid fuel/i, phase: "liquid", label: "liquid fuel" },
  { words: /gas leak|gaseous/i,    phase: "gas",    label: "gas fuel" },
];

// Places that stand for a set of conditions (the same presets as the Will It Burn? chips)
const PLACE_WORDS = [
  { words: /rover/i,                    preset: "rover", label: "pressurized rover (30% O₂, 0.7 bar, Moon gravity)" },
  { words: /mars (base|habitat|outpost)/i, preset: "mars", label: "Mars base (assumed 30% O₂, 0.7 bar, Mars gravity)" },
  { words: /moon/i,                     preset: "moon",  label: "Moon base (34% O₂, 0.7 bar, Moon gravity)" },
  { words: /space ?suit|\bsuit\b/i,     preset: "suit",  label: "spacesuit (100% O₂, 0.3 bar)" },
  { words: /\biss\b|space station/i,    preset: "iss",   label: "ISS cabin (21% O₂, 1.0 bar, microgravity)" },
  { words: /mars/i,                     gravity: "mars", label: "Mars gravity" },
];

// ---------- read the question ----------
// Returns everything Step A understood, in one object.
function parseQuestion(text) {
  const found = {
    investigations: [],   // names, in the order they were found
    fuels: [],            // regexes for the fuel name
    phase: null,          // "solid" | "liquid" | "gas"
    focus: null,          // function: which tests to show first
    conditions: { o2: null, pressure: null, phase: "any", material: "any", airflow: "any", gravity: "any" },
    sortByO2: null,       // "high" | "low"
    earthVsSpace: false,
    labels: [],           // what to show in "Matched on: ..."
  };
  const addInvestigation = name => { if (!found.investigations.includes(name)) found.investigations.push(name); };

  INVESTIGATION_WORDS.forEach(k => {
    if (!k.words.test(text)) return;
    addInvestigation(k.investigation);
    if (k.focus) found.focus = k.focus;
    found.labels.push(k.label);
  });

  FUEL_WORDS.forEach(k => {
    if (!k.words.test(text)) return;
    if (k.fuel) found.fuels.push(k.fuel);
    if (k.phase) found.phase = k.phase;
    found.labels.push(k.label);
  });

  // Earth vs space: Saffire-II flew each sample in space AND repeated it on Earth (the "1g" rows)
  if (/earth/i.test(text) && /space|microgravity|orbit|different|compare|\bvs\.?\b|versus/i.test(text)) {
    found.earthVsSpace = true;
    addInvestigation("Saffire-II");
    found.labels.push("space vs Earth (Saffire-II flight + 1g comparison tests)");
  } else {
    PLACE_WORDS.forEach(k => {
      if (!k.words.test(text)) return;
      if (k.preset) Object.assign(found.conditions, PRESETS[k.preset]);
      if (k.gravity) found.conditions.gravity = k.gravity;
      found.labels.push(k.label);
    });
    if (/\bon earth\b|normal gravity|\b1 ?g\b/i.test(text)) {
      found.conditions.gravity = "earth";
      found.labels.push("Earth gravity");
    }
  }

  // numbers: "34%" or "34 % oxygen" -> oxygen; "0.7 bar", "1 atm", "70 kPa" -> pressure (bar)
  const o2 = text.match(/(\d+(?:\.\d+)?)\s*%/);
  if (o2 && +o2[1] <= 100) {
    found.conditions.o2 = +o2[1];
    found.labels.push(`${+o2[1]}% oxygen`);
  }
  const pressure = text.match(/(\d+(?:\.\d+)?)\s*(bar|atm|kpa)\b/i);
  if (pressure) {
    const toBar = { bar: 1, atm: 1.013, kpa: 0.01 }[pressure[2].toLowerCase()];
    found.conditions.pressure = Math.round(+pressure[1] * toBar * 100) / 100;
    found.labels.push(`${found.conditions.pressure} bar`);
  }

  // "high oxygen" / "low oxygen" without a number: sort by oxygen instead
  if (found.conditions.o2 === null) {
    if (/(high|higher|enriched|rich|elevated)[\s-]+(oxygen|o2|o₂)|oxygen[\s-]rich/i.test(text)) found.sortByO2 = "high";
    if (/(low|lower|reduced)[\s-]+(oxygen|o2|o₂)/i.test(text)) found.sortByO2 = "low";
    if (found.sortByO2) found.labels.push(`${found.sortByO2} oxygen (sorted by O₂, ${found.sortByO2 === "high" ? "highest" : "lowest"} first)`);
  }

  // high oxygen (above the 40% of the room-oxygen tests): also look at CFI-G's inverse flames
  found.highOxygen = (found.conditions.o2 !== null && found.conditions.o2 > 40) || found.sortByO2 === "high" ||
    /inverse flame|oxygen leak|pure oxygen|100 ?% ?(oxygen|o2)|oxygen[- ]rich|enriched/i.test(text);
  if (found.highOxygen) found.labels.push("high oxygen: includes CFI-G inverse flames (burner oxygen)");
  return found;
}

// true if the question gave us anything to search with
function hasConditions(c) {
  return c.o2 !== null || c.pressure !== null || c.gravity !== "any";
}

// ---------- CFI-G inverse flames as tests (Ask only; not in the Will It Burn? ranking) ----------
// o2_percent here is the BURNER oxygen (oxygen flows out of the burner into fuel + nitrogen).
const INVERSE_AS_TESTS = INVERSE_TESTS.map(t => ({
  investigation: "CFI-G",
  test_id: t.test_id + " (inverse)",
  fuel: t.fuel + " (inverse flame)",
  fuel_phase: "gas",
  o2_percent: t.burner_o2_percent,
  pressure_bar: t.pressure_bar,
  gravity: "microgravity",
  airflow_cm_s: 0,
  burn_time_s: t.burn_time_s,
  outcome: t.outcome,
  notes: "INVERSE flame: the oxygen % is the burner stream flowing into a chamber of fuel and nitrogen, not the room air",
  inverse: true,
}));

// ---------- find related tests ----------
const MAX_AI_TESTS = 15;      // sent to the AI
const MAX_TABLE_TESTS = 5;    // the top 5 are shown on the page (inside the investigation cards)

function findTests(found) {
  const anything = found.highOxygen || found.investigations.length || found.fuels.length || found.phase ||
                   found.earthVsSpace || hasConditions(found.conditions) || found.sortByO2;
  if (!anything) return [];

  // high-oxygen questions also search the inverse flames (NASA's highest-oxygen data)
  let pool = found.highOxygen ? [...TESTS, ...INVERSE_AS_TESTS] : TESTS;
  if (found.investigations.length) pool = pool.filter(t => found.investigations.includes(t.investigation));
  if (found.fuels.length) pool = pool.filter(t => found.fuels.some(re => re.test(t.fuel)));
  if (found.phase) pool = pool.filter(t => t.fuel_phase === found.phase);

  // order: closest to the conditions, or by oxygen, or keep the data's own order
  let ranked = [...pool];
  if (hasConditions(found.conditions)) {
    ranked = ranked
      .map(t => ({ t, d: compare(t, found.conditions).distance }))
      .sort((a, b) => a.d - b.d)
      .map(x => x.t);
  } else if (found.sortByO2) {
    const sign = found.sortByO2 === "high" ? -1 : 1;
    ranked.sort((a, b) => (known(b.o2_percent) - known(a.o2_percent)) || sign * (a.o2_percent - b.o2_percent));
  }

  // tests with a recorded outcome first (as on Will It Burn?), the focus tests before the rest.
  // sort() keeps the order above for ties.
  const score = t => (t.outcome ? 0 : 2) + (found.focus && !found.focus(t) ? 1 : 0);
  ranked.sort((a, b) => score(a) - score(b));

  // Earth vs space: keep each flight test next to its Earth twin
  if (found.earthVsSpace) ranked = pool;

  return ranked.slice(0, MAX_AI_TESTS);
}

// investigations: the ones named in the question first, then the ones the tests come from
function findInvestigations(found, tests) {
  const names = [...found.investigations];
  tests.forEach(t => { if (!names.includes(t.investigation)) names.push(t.investigation); });
  return names.map(n => INVESTIGATIONS.find(i => i.investigation === n)).filter(Boolean);
}

// ---------- show the results ----------
// ---------- related investigations, each with its matching tests ----------
// One card per investigation. Clicking the card opens its page on NASA PSI (like the
// NASA Investigations cards); the tests that matched the question are listed inside it.
let askTests = [];   // the top tests Step A found for the current question (max 5)

const ASK_TEST_COLUMNS = [
  { label: "Test", noMerge: true, show: t => cellValue(t.test_id) },
  { label: "Fuel", show: t => cellValue(t.fuel) },
  { label: "O₂ %", show: t => cellValue(t.o2_percent) + (t.inverse && known(t.o2_percent) ? ' <small class="muted-note">burner</small>' : "") },
  { label: "Pressure (bar)", show: t => cellValue(t.pressure_bar) },
  { label: "Gravity", show: t => cellValue(t.gravity) },
  { label: "Outcome", noMerge: true, show: t => pill(t.outcome) },
];

function relatedCard(inv) {
  const tests = askTests.filter(t => t.investigation === inv.investigation);
  const best = tests.find(t => !t.inverse);   // closest test Will It Burn? can recreate (not an inverse flame)
  const button = best ? `
    <button type="button" class="test-btn" data-test-index="${askTests.indexOf(best)}">
      <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
        <path d="M12 2c.6 3.2 4.5 5.4 4.5 10a4.5 4.5 0 0 1-9 0c0-2 .9-3.4 1.9-4.6.3 1.4 1 2.3 2 2.6C11 8.2 11 5 12 2z" fill="currentColor"/>
      </svg>
      Let's test it
      <span class="test-btn-note">with test ${escapeHtml(best.test_id)}'s conditions in Will It Burn?</span>
    </button>` : "";
  return investigationTestsCard(inv, tests, {
    columns: ASK_TEST_COLUMNS,
    countText: `${tests.length} matching test${tests.length === 1 ? "" : "s"}`,
    extra: button,
  });
}

// "Let's test it": turn one NASA test into Will It Burn? settings (unknown values stay "Any")
function testToScenario(t) {
  const material = Object.keys(MATERIAL_FUELS).find(key => MATERIAL_FUELS[key].test(t.fuel)) || null;
  const air = t.airflow_cm_s;
  return {
    oxygen: known(t.o2_percent) ? t.o2_percent : null,
    pressure: known(t.pressure_bar) ? t.pressure_bar : null,
    fuel_phase: t.fuel_phase || null,
    material,
    // the closest of the page's choices: still 0, gentle ~10, strong ~25 cm/s
    airflow: !known(air) ? null : air < 5 ? "still" : air < 17.5 ? "gentle" : "strong",
    gravity: { microgravity: "station", "normal gravity": "earth" }[t.gravity] || null,
  };
}

$("ask-investigations").addEventListener("click", e => {
  const btn = e.target.closest(".test-btn");
  if (btn) applyScenario(testToScenario(askTests[Number(btn.dataset.testIndex)]));
});

function showMatches(found, tests, investigations) {
  $("ask-matched").textContent = found.labels.length
    ? "Matched on: " + found.labels.join(" · ")
    : "No investigation, material or condition words recognised. Try naming a material (fabric, PMMA), " +
      "a fuel (heptane), an investigation (FLEX), a place (Moon base) or a number like 34% oxygen.";
  askTests = tests.slice(0, MAX_TABLE_TESTS);
  showInvestigations(investigations);
}

function showInvestigations(investigations) {
  $("ask-investigations").innerHTML = investigations.length
    ? investigations.map(relatedCard).join("")
    : `<p class="muted">No investigations matched.</p>`;
}

// ---------- data sent to the AI ----------
// metadata for every investigation (computed once)
// (objective, approach, hypothesis and research impacts let the AI explain HOW and WHY an experiment was done)
const AI_INVESTIGATIONS = INVESTIGATIONS.map(i => ({
  investigation: i.investigation, full_name: fullName(i), psi_id: i.psi_id, doi: i.doi,
  pillar: i.pillar, platform: i.platform, dates: dateRange(i),
  n_tests: i.investigation === "CFI-G"
    ? `${i.n_tests} normal-flame tests, plus ${INVERSE_TESTS.length} inverse-flame tests (${i.n_tests + INVERSE_TESTS.length} in total)`
    : i.investigation === "ACME BRE" ? `${i.n_tests} flames ignited over ${BRE_DAYS.length} test days (daily summaries)`
    : i.investigation === "SAME-R" ? `${i.n_tests} smoke measurements`
    : i.investigation === "BASS" ? `${i.n_tests} tests listed by sample only (no oxygen, airflow or outcome per test)`
    : i.investigation === "SPICE" ? `${i.n_tests} smoke-point flame runs in NASA's table (NASA reports 526 flames studied)`
    : `${i.n_tests} burn tests`,
  objective: i.objective, approach: i.approach, hypothesis: i.hypothesis, research_impacts: i.research_impacts,
}));

// a short stats summary per investigation: O₂ range, pressure range, outcome counts
function rangeText(values, unit) {
  values = values.filter(known);
  return values.length ? `${Math.min(...values)}–${Math.max(...values)}${unit}` : "not reported";
}
const AI_STATS = {};
INVESTIGATIONS.forEach(inv => {
  const tests = TESTS.filter(t => t.investigation === inv.investigation);
  if (inv.investigation === "ACME BRE") {
    AI_STATS[inv.investigation] = {
      note: "daily summaries only (flames ignited per day), no individual test outcomes; pressures varied but not listed",
      test_days: BRE_DAYS.length,
      flames_ignited: BRE_DAYS.reduce((sum, d) => sum + d.flames_ignited, 0),
      room_oxygen_levels: [...new Set(BRE_DAYS.flatMap(d => String(d.o2_levels).split(";").map(Number)))].sort((a, b) => a - b).join(", ") + "%",
      fuels: [...new Set(BRE_DAYS.map(d => d.fuel))].join(", "),
      burners: "25 and 50 mm porous burners, still air",
    };
    return;
  }
  if (inv.investigation === "BASS") {
    const counts = {};
    BASS_TESTS.forEach(t => counts[t.material] = (counts[t.material] || 0) + 1);
    AI_STATS.BASS = {
      note: "NASA's table lists only date and sample per test: no oxygen, pressure, airflow or outcome per test; NOT in the Will It Burn ranking",
      tests_by_material: counts,
      airflow: "up to 40 cm/s, opposed or concurrent (from NASA's description, not per test)",
      suppression: "nitrogen tested as a suppressant (from NASA's description)",
      dates: "March 2012 to June 2013",
    };
    return;
  }
  if (inv.investigation === "SPICE") {
    const counts = {};
    SPICE_RUNS.forEach(r => counts[r.fuel] = (counts[r.fuel] || 0) + 1);
    AI_STATS.SPICE = {
      note: "smoke-point study: every flame was lit and burned; the fuel flow was raised until the flame started to emit soot. No burn/no-burn outcomes; oxygen and pressure not listed per run; NOT in the Will It Burn ranking",
      runs_by_fuel: counts,
      nozzles_mm: [...new Set(SPICE_RUNS.map(r => r.nozzle_mm))].sort((a, b) => a - b).join(", "),
      coflow_air_speed: "5.4-65 cm/s (NASA's description; a few table readings fall outside it)",
      flames: `${SPICE_RUNS.length} runs in NASA's table; NASA reports 526 flames studied`,
    };
    return;
  }
  if (!tests.length) {
    AI_STATS[inv.investigation] = { note: "smoke measurements only, no burn tests or ignition outcomes" };
    return;
  }
  const outcomeCounts = {};
  tests.forEach(t => { const o = t.outcome || "Not stated"; outcomeCounts[o] = (outcomeCounts[o] || 0) + 1; });
  AI_STATS[inv.investigation] = {
    o2_range: rangeText(tests.map(t => t.o2_percent), "%"),
    pressure_range: rangeText(tests.map(t => t.pressure_bar), " bar"),
    outcome_counts: outcomeCounts,
  };
});
// CFI-G also has inverse flames (oxygen flows out of the burner into fuel + nitrogen)
{
  const outcomes = {};
  INVERSE_TESTS.forEach(t => { const o = t.outcome || "Not stated"; outcomes[o] = (outcomes[o] || 0) + 1; });
  AI_STATS["CFI-G"].note = "o2_range and outcome_counts above are the normal flames (fuel from the burner into room air)";
  AI_STATS["CFI-G"].inverse_flames = {
    note: "oxygen flows OUT of the burner into a chamber of fuel and nitrogen: burner oxygen, NOT a room/cabin oxygen level",
    number_of_tests: INVERSE_TESTS.length,
    burner_o2_range: rangeText(INVERSE_TESTS.map(t => t.burner_o2_percent), "%"),
    pressure_range: rangeText(INVERSE_TESTS.map(t => t.pressure_bar), " bar"),
    fuels: [...new Set(INVERSE_TESTS.map(t => t.fuel))].join(", "),
    outcome_counts_all_inverse_tests: outcomes,
    // exact counts per burner-oxygen level, so a high-oxygen answer never has to estimate
    by_burner_oxygen: Object.fromEntries(
      [...new Set(INVERSE_TESTS.map(t => t.burner_o2_percent))].sort((a, b) => a - b).map(level => {
        const tests = INVERSE_TESTS.filter(t => t.burner_o2_percent === level);
        const counts = {};
        tests.forEach(t => { const o = t.outcome || "Not stated"; counts[o] = (counts[o] || 0) + 1; });
        return [`${level}%`, { number_of_tests: tests.length, outcome_counts: counts }];
      })),
  };
}

// the tested range across ALL burn tests (so the AI can say "the highest oxygen tested is ...")
function overallRange(key, unit) {
  const values = TESTS.map(t => t[key]).filter(known);
  const lo = Math.min(...values), hi = Math.max(...values);
  const where = v => [...new Set(TESTS.filter(t => t[key] === v).map(t => t.investigation))].join(", ");
  return { lowest: `${lo}${unit} (${where(lo)})`, highest: `${hi}${unit} (${where(hi)})` };
}
const AI_OVERALL_RANGES = {
  room_oxygen_in_burn_tests: overallRange("o2_percent", "%"),
  inverse_flame_burner_oxygen: `up to ${Math.max(...INVERSE_TESTS.map(t => t.burner_o2_percent))}% (CFI-G inverse flames, ${INVERSE_TESTS.filter(t => t.burner_o2_percent >= 40).length} tests at 40% or more): oxygen flowing OUT of a burner into fuel and nitrogen, NOT an oxygen level of the room; NASA's highest-oxygen microgravity data`,
  acme_bre_room_oxygen: "21-40% (daily summaries only, no individual outcomes)",
  pressure: overallRange("pressure_bar", " bar"),
  gravity: "microgravity (all investigations) and Earth gravity (Saffire-II comparison tests only); no Moon or Mars gravity",
  materials: "solids: silicone, cotton-fiberglass fabric (SIBAL), PMMA (acrylic), Nomex, wax candle; liquids: methanol and heptane droplets; gases: ethane, propane, butane, plus ethylene and methane in ACME BRE (burned to imitate solids). Not in the burn-test ranges: BASS also burned Ultem sheets and wax candles/slabs (no per-test conditions), and SPICE burned gas jets of ethylene, propane, propylene and methane (smoke-point study)",
};

// a short summary of every tested material type, one entry per material AND investigation
// (fuelGroup is in experiments.js), so the AI can quote the closest material's real results
// even when the search picked other tests, and each number belongs to one investigation
const AI_MATERIALS = [];
const materialGroups = {};
TESTS.forEach(t => {
  const key = fuelGroup(t.fuel) + " | " + t.investigation;
  (materialGroups[key] = materialGroups[key] || []).push(t);
});
Object.entries(materialGroups).forEach(([key, tests]) => {
  const [material, investigation] = key.split(" | ");
  const outcomes = {};
  tests.forEach(t => { const o = t.outcome || "Not stated"; outcomes[o] = (outcomes[o] || 0) + 1; });
  AI_MATERIALS.push({
    material,
    investigation,
    number_of_tests: tests.length,
    o2_range: rangeText(tests.map(t => t.o2_percent), "%"),
    pressure_range: rangeText(tests.map(t => t.pressure_bar), " bar"),
    gravity: [...new Set(tests.map(t => t.gravity))].join(", "),
    outcome_counts: outcomes,
  });
});

// inverse flames in the material summary too (burner oxygen, clearly labelled)
{
  const byFuel = {};
  INVERSE_TESTS.forEach(t => (byFuel[t.fuel] = byFuel[t.fuel] || []).push(t));
  Object.entries(byFuel).forEach(([fuel, tests]) => {
    const outcomes = {};
    tests.forEach(t => { const o = t.outcome || "Not stated"; outcomes[o] = (outcomes[o] || 0) + 1; });
    AI_MATERIALS.push({
      material: fuel.charAt(0).toUpperCase() + fuel.slice(1) + " (inverse flame: oxygen from the burner)",
      investigation: "CFI-G",
      number_of_tests: tests.length,
      burner_o2_range: rangeText(tests.map(t => t.burner_o2_percent), "%"),
      pressure_range: rangeText(tests.map(t => t.pressure_bar), " bar"),
      gravity: "microgravity",
      outcome_counts: outcomes,
    });
  });
}

// ---------- condition checks, computed by code (not left to the AI) ----------
// For each condition the question states (oxygen, pressure, gravity), say whether it lies
// inside or outside what NASA tested, and which end of the range matters.
function lowestHighest(key, unit) {
  const tests = TESTS.filter(t => known(t[key]));
  const lo = tests.reduce((a, t) => (t[key] < a[key] ? t : a));
  const hi = tests.reduce((a, t) => (t[key] > a[key] ? t : a));
  return { lo: `${lo[key]}${unit} in ${lo.investigation}`, loValue: lo[key], hi: `${hi[key]}${unit} in ${hi.investigation}`, hiValue: hi[key] };
}

// each check: the sentence, and a key (a number or word) that an answer covering it must contain
const check = (text, key) => ({ text, key: String(key) });

function conditionChecks(c) {
  const checks = [];
  const maxInverse = Math.max(...INVERSE_TESTS.map(t => t.burner_o2_percent));
  if (c.o2 !== null) {
    const r = lowestHighest("o2_percent", "%");
    if (c.o2 > r.hiValue) {
      checks.push(check(`The asked oxygen (${c.o2}%) is above the highest room oxygen in any NASA burn test (${r.hi}).`, r.hiValue));
      if (c.o2 > 40) checks.push(check(`NASA's only higher-oxygen microgravity data are CFI-G's inverse flames, with burner oxygen up to ${maxInverse}%; ` +
          `there the oxygen flows out of a burner into fuel and nitrogen, so it is not the oxygen level of a room or cabin.`, maxInverse));
    } else if (c.o2 < r.loValue) {
      checks.push(check(`The asked oxygen (${c.o2}%) is below the lowest room oxygen in any NASA burn test (${r.lo}).`, r.loValue));
    } else {
      checks.push(check(`The asked oxygen (${c.o2}%) is within the tested room-oxygen range (${r.lo} to ${r.hi}).`, r.hiValue));
    }
  }
  if (c.pressure !== null) {
    const r = lowestHighest("pressure_bar", " bar");
    if (c.pressure < r.loValue) checks.push(check(`The asked pressure (${c.pressure} bar) is below the lowest pressure in any NASA burn test (${r.lo}).`, r.loValue));
    else if (c.pressure > r.hiValue) checks.push(check(`The asked pressure (${c.pressure} bar) is above the highest pressure in any NASA burn test (${r.hi}).`, r.hiValue));
    else checks.push(check(`The asked pressure (${c.pressure} bar) is within the tested range (${r.lo} to ${r.hi}), though Saffire-II and BASS-II do not report pressure.`, r.loValue));
  }
  if (c.gravity === "moon" || c.gravity === "mars")
    checks.push(check(`There is no NASA fire data at ${c.gravity === "moon" ? "Moon" : "Mars"} gravity yet; only microgravity and Earth gravity were tested, and these bound what to expect.`, "gravity"));
  return checks;
}

// the related tests, with only the columns the AI needs
function testForAi(t) {
  const notes = t.notes && t.notes.length > 200 ? t.notes.slice(0, 200) + "…" : t.notes;
  return {
    investigation: t.investigation, test_id: t.test_id, fuel: t.fuel, fuel_phase: t.fuel_phase,
    o2_percent: t.o2_percent, pressure_bar: t.pressure_bar, gravity: t.gravity,
    airflow_cm_s: t.airflow_cm_s, outcome: t.outcome || "not stated", notes,
  };
}

// ---------- "Try this scenario in Will It Burn?" ----------
// which fuel type each material belongs to (e.g. fabric -> solid)
const PHASE_OF_MATERIAL = {};
Object.entries(MATERIALS).forEach(([phase, list]) => list.forEach(m => PHASE_OF_MATERIAL[m.value] = phase));

const clampTo = (v, min, max) => Math.min(max, Math.max(min, v));

// Fill the Will It Burn? controls: values the AI gave, everything else back to "Any"
function applyScenario(s) {
  // sliders go 0–100% and 0–5 bar (every NASA test fits); anything outside is moved to the nearest end
  const o2 = s.oxygen === null ? null : clampTo(Math.round(s.oxygen), 0, 100);
  const pressure = s.pressure === null ? null : clampTo(Math.round(s.pressure * 100) / 100, 0, 5);

  ["o2", "pressure"].forEach(key => stopSliderAnimation(key));
  setSlider("o2", null);
  setSlider("pressure", null);

  const phase = s.fuel_phase || PHASE_OF_MATERIAL[s.material] || "any";
  setChoice("phase", phase);                       // also refills the material dropdown
  if (s.material && PHASE_OF_MATERIAL[s.material] === phase) {
    materialSelect.value = s.material;
    conditions.material = s.material;
    conditionsChanged("material");
  }
  setChoice("airflow", s.airflow || "any");
  setChoice("gravity", s.gravity || "any");
  setActiveChip(null);

  // switch tab (same as clicking it), open the conditions, then glide the sliders so the change is visible
  document.querySelector('.tab[data-page="burn"]').click();
  setPanelOpen(true);
  if (o2 !== null) animateSlider("o2", o2);
  if (pressure !== null) animateSlider("pressure", pressure);
}

let askScenario = null;
$("ask-try").addEventListener("click", () => { if (askScenario) applyScenario(askScenario); });

// ---------- sources used by the answer ----------
// The AI marks what it used with [1], [2]... We use those marks only to know which
// document pages it used: the marks are removed from the text, and each page is listed once.
const sourceLink = src => (src.page && /\.pdf($|[?#])/i.test(src.url) ? `${src.url}#page=${src.page}` : src.url);
const sourceLabel = src => src.title + (src.page ? `, p. ${src.page}` : "");

// removes the [1] marks; returns the clean text and the pages it used
function citedAnswer(text, sources) {
  const byNumber = new Map((sources || []).map(src => [src.n, src]));
  const used = new Map();   // link -> source, in the order the answer first uses them (one entry per page)
  const clean = text
    .replace(/\s*\[(\d+)\]/g, (match, n) => {
      const src = byNumber.get(Number(n));
      if (src && !used.has(sourceLink(src))) used.set(sourceLink(src), src);
      return "";
    })
    .replace(/\s+([.,;:])/g, "$1");   // "sizes ." -> "sizes."
  return { clean, used: [...used.values()] };
}
const sourceItems = used => used.map(src => `
    <li>
      <a href="${escapeHtml(sourceLink(src))}" target="_blank" rel="noopener">${escapeHtml(sourceLabel(src))}
        <span aria-hidden="true">↗</span></a>
    </li>`).join("");

function showAnswer(text, sources) {
  const { clean, used } = citedAnswer(text, sources);
  askAnswer.textContent = clean;      // plain text, never HTML
  $("ask-sources-list").innerHTML = sourceItems(used);
  show("ask-sources", used.length > 0);
}

// what /api/ask is sent for a question (shared by the Ask tab and the table window)
function aiRequestBody(question, found, tests) {
  return {
    question,
    matched_on: found.labels,
    investigations: AI_INVESTIGATIONS,
    stats: AI_STATS,
    overall_ranges: AI_OVERALL_RANGES,
    condition_checks: conditionChecks(found.conditions),
    materials: AI_MATERIALS,
    tests: tests.map(testForAi),
  };
}

// Ask from an investigation's own page: the answer is written into `box`, no page change.
// focusName: that investigation; its table + result sentences go along (focusForAi, results.js)
// and the related tests come only from it.
let inlineRun = 0;
async function askInline(question, box, focusName) {
  const run = ++inlineRun;
  box.hidden = false;
  box.innerHTML = `<p class="td-answer-text is-loading">Searching NASA data...</p>`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    if (location.protocol === "file:") throw new Error("no server (page opened from a file)");
    const found = parseQuestion(question);
    if (focusName) found.investigations = [focusName];
    const body = aiRequestBody(question, found, findTests(found));
    if (focusName) body.focus = focusForAi(focusName);
    const res = await fetch("/api/ask", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.answer) throw new Error(data.error || "No answer in response");
    if (run !== inlineRun) return;
    const { clean, used } = citedAnswer(data.answer, data.sources);
    box.innerHTML = `<p class="td-answer-q">${escapeHtml(question)}</p><p class="td-answer-text"></p>` +
      (used.length ? `<p class="td-answer-src">Sources</p><ul class="td-answer-list">${sourceItems(used)}</ul>` : "");
    box.querySelector(".td-answer-text").textContent = clean;   // plain text, never HTML
  } catch (err) {
    if (run !== inlineRun) return;
    console.warn("AI answer unavailable:", err.name === "AbortError" ? "timed out" : err.message);
    box.innerHTML = `<p class="td-answer-text">AI answer unavailable right now. Please try again in a moment.</p>`;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- asking ----------
const askForm = document.getElementById("ask-form");
const askInput = document.getElementById("ask-input");
const askAnswer = $("ask-answer");
let askRun = 0;                 // so an old, slow answer never overwrites a newer one
const ASK_TIMEOUT_MS = 10000;   // after 10 s, show the NASA data without the AI answer

async function ask(question) {
  question = question.trim();
  if (!question) { askInput.focus(); return; }
  const run = ++askRun;

  // Step A: keyword matching, shown straight away
  const found = parseQuestion(question);
  const tests = findTests(found);
  const stepAInvestigations = findInvestigations(found, tests);
  $("ask-results").classList.remove("hidden");
  // the question box sits on a full-screen photo: bring the answer into view
  $("ask-results").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
  showMatches(found, tests, stepAInvestigations);

  // Step B: the AI answer
  askScenario = null;
  show("ask-try", false);
  show("ask-answer-label", false);
  show("ask-sources", false);
  $("ask-related").classList.add("hidden");   // shown once the answer is there (see finally below)
  askAnswer.classList.add("is-loading");
  askAnswer.textContent = "Searching NASA data...";

  // give up after ASK_TIMEOUT_MS: abort() makes fetch throw, which lands in catch below
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASK_TIMEOUT_MS);

  try {
    // opened by double-clicking index.html: there is no server, so skip the AI
    if (location.protocol === "file:") throw new Error("no server (page opened from a file)");

    const res = await fetch("/api/ask", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(aiRequestBody(question, found, tests)),
    });
    const data = await res.json();
    if (!res.ok || !data.answer) throw new Error(data.error || "No answer in response");
    if (run !== askRun) return;

    showAnswer(data.answer, data.sources);
    show("ask-answer-label", true);

    // cards: the AI's investigations first, then the Step A ones
    const names = [...data.investigations, ...stepAInvestigations.map(i => i.investigation)];
    const unique = [...new Set(names)];
    showInvestigations(unique.map(n => INVESTIGATIONS.find(i => i.investigation === n)).filter(Boolean));

    // The AI sometimes copies the tests' fuel into the scenario. Only keep a fuel
    // if the question itself named one (Step A found a fuel or material word).
    let scenario = data.scenario;
    if (scenario && !found.fuels.length && !found.phase) {
      scenario = { ...scenario, fuel_phase: null, material: null };
      if (Object.values(scenario).every(v => v === null)) scenario = null;
    }
    // "Let's test it" on a related investigation (a real NASA test) comes first.
    // The AI's "Try this scenario" only shows when no card has that button.
    const hasLetsTest = askTests.length > 0;
    if (scenario && !hasLetsTest) {
      askScenario = scenario;
      show("ask-try", true);
    }
  } catch (err) {
    if (run !== askRun) return;
    const reason = err.name === "AbortError" ? `no answer within ${ASK_TIMEOUT_MS / 1000} s` : err.message;
    console.warn("AI answer unavailable:", reason);
    askAnswer.textContent = "AI answer unavailable right now. Here's the matching NASA data.";
  } finally {
    clearTimeout(timer);
    if (run === askRun) {
      askAnswer.classList.remove("is-loading");
      $("ask-related").classList.remove("hidden");   // after the answer (or the "unavailable" message)
    }
  }
}

// Ask button or Enter
askForm.addEventListener("submit", e => {
  e.preventDefault();          // stay on the page (a form would normally reload it)
  ask(askInput.value);
});

// example questions: fill the bar and ask
// Home's "Ask Flamma about this" links: open the Ask tab and ask that question
document.querySelectorAll("[data-ask]").forEach(link => link.addEventListener("click", () => {
  askInput.value = link.dataset.ask;
  setTimeout(() => ask(link.dataset.ask), 0);   // after the page has switched to the Ask tab
}));

document.querySelectorAll(".examples [data-question]").forEach(btn =>
  btn.addEventListener("click", () => {
    askInput.value = btn.dataset.question;
    ask(btn.dataset.question);
  }));
