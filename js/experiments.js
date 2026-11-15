// ================= Tabs + "NASA Investigations" page =================
// Uses INVESTIGATIONS (investigations.js) and TESTS (data.js), both generated
// by scripts/clean_data.py. COLORS / ON_COLORS come from app.js.

// ---------- tab switching (also works with a link like index.html#experiments) ----------
const tabs = document.querySelectorAll(".tab");
const HOME_PAGE = "home";   // the tab that opens first

function showPage(id) {
  const target = document.getElementById(id);
  if (!target || !target.classList.contains("page")) id = HOME_PAGE;   // e.g. "#ref-1" (a source on Home)
  document.querySelectorAll(".page").forEach(p => p.classList.toggle("active", p.id === id));
  tabs.forEach(t => {
    const on = t.dataset.page === id || (t.dataset.group || "").split(" ").includes(id);   // dropdown tab: any of its pages
    t.classList.toggle("active", on);
    if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
  return id;
}

// the header stays at the top while scrolling: share its height with the CSS (--header-h),
// so the Home video and the filter sidebar stick just below it (it's taller on phones)
const siteHeader = document.querySelector(".site-header");
const setHeaderHeight = () => document.documentElement.style.setProperty("--header-h", `${siteHeader.offsetHeight}px`);
setHeaderHeight();
if ("ResizeObserver" in window) new ResizeObserver(setHeaderHeight).observe(siteHeader);
else window.addEventListener("resize", setHeaderHeight);

// "Investigations": the tab opens the overview; the small ▾ (or hovering) shows the menu
const caretBtn = document.querySelector(".tab-caret-btn"), dropMenu = document.getElementById("inv-menu");
function setMenu(open) { dropMenu.hidden = !open; caretBtn.setAttribute("aria-expanded", String(open)); }
caretBtn.addEventListener("click", e => { e.stopPropagation(); setMenu(dropMenu.hidden); });
const tabMenu = document.querySelector(".tab-menu");
let menuTimer;   // a short delay before closing, so a slightly wobbly mouse doesn't shut the menu
tabMenu.addEventListener("mouseenter", () => { clearTimeout(menuTimer); setMenu(true); });
tabMenu.addEventListener("mouseleave", () => { menuTimer = setTimeout(() => setMenu(false), 300); });
dropMenu.addEventListener("click", () => setMenu(false));
document.addEventListener("click", e => { if (!e.target.closest(".tab-menu")) setMenu(false); });
document.addEventListener("keydown", e => { if (e.key === "Escape") setMenu(false); });

tabs.forEach(t => t.addEventListener("click", () => {
  history.replaceState(null, "", t.dataset.page === HOME_PAGE ? location.pathname : "#" + t.dataset.page);
  route();
  window.scrollTo(0, 0);
}));
// the first route() runs at the end of this file, once the pillar views can be built
// a link like index.html#burn makes the browser jump down to that section; start at the top instead
if (location.hash) window.addEventListener("load", () => window.scrollTo(0, 0));

// ---------- helpers ----------
const PILLAR_ORDER = ["Prevention", "Detection", "Suppression"];   // NASA's three fire-safety pillars
const NOT_STATED = "Not stated";

const escapeHtml = s => String(s).replace(/[&<>"']/g, ch =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// '2016-09-30' -> 'Sep 2016'
function monthYear(iso) {
  if (!iso) return "";
  const [y, m] = iso.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

function dateRange(inv) {
  if (!inv.start_date && !inv.end_date) return "Dates not listed";
  return `${monthYear(inv.start_date)} – ${monthYear(inv.end_date)}`;
}

// outcome counts for one investigation, in severity order, plus tests with no stated outcome
function outcomeCounts(name, tests = TESTS.filter(t => t.investigation === name)) {
  const counts = OUTCOMES.map(o => ({ label: o, n: tests.filter(t => t.outcome === o).length }));
  counts.push({ label: NOT_STATED, n: tests.filter(t => !t.outcome).length });
  return { total: tests.length, counts: counts.filter(c => c.n > 0) };
}

// ---------- outcome bar (stacked, one row) + legend with counts ----------
// tests: optional list (default: all of this investigation's tests in data.js)
function outcomeBar(name, tests, title) {
  const { total, counts } = outcomeCounts(name, tests);
  if (!total) return "";

  const segments = counts.map(c => {
    const pct = (c.n / total) * 100;
    const color = c.label === NOT_STATED ? "var(--border-2)" : COLORS[c.label];
    const tip = `${c.label}: ${c.n} of ${total} tests (${Math.round(pct)}%)`;
    return `<span class="bar-seg" style="flex:${c.n} 1 0; background:${color}" data-tip="${escapeHtml(tip)}"></span>`;
  }).join("");

  // legend doubles as the table view: every colour has its label and count
  const legend = counts.map(c => {
    const color = c.label === NOT_STATED ? "var(--border-2)" : COLORS[c.label];
    return `<li><span class="key" style="background:${color}"></span>${escapeHtml(c.label)}<b>${c.n}</b></li>`;
  }).join("");

  const summary = counts.map(c => `${c.label} ${c.n}`).join(", ");
  return `
    <div class="outcome">
      <p class="outcome-title">${title || `Outcomes of ${total} tests`}</p>
      <div class="bar" role="img" aria-label="Outcomes of ${total} tests: ${escapeHtml(summary)}">${segments}</div>
      <ul class="legend">${legend}</ul>
    </div>`;
}

// ---------- short introductions ----------
// One plain-English paragraph per pillar and per investigation (written from the NASA metadata).
const PILLAR_INTROS = {
  Prevention: "Stopping a fire before it starts or spreads. These experiments test how easily materials " +
    "and fuels ignite, how fast flames spread and when they go out on their own in low gravity. " +
    "The results help decide which materials and cabin atmospheres are safe to fly.",
  Detection: "Spotting a fire early. Without gravity, smoke does not rise and its particles can differ " +
    "from smoke on Earth, so detectors designed on Earth may miss it. This research measures the smoke " +
    "that overheated spacecraft materials give off.",
  Suppression: "Putting a fire out. Flames behave differently without buoyancy, so extinguishing agents " +
    "have to be tested in space. This research studies how burning fuel droplets go out, including " +
    "in air with added gases such as CO₂ and helium.",
};

const INVESTIGATION_INTROS = {
  "Saffire-II": "Large fire tests flown on an uncrewed Cygnus cargo ship, measuring how quickly fire " +
    "grows on spacecraft materials in low gravity, compared with Earth tests of the same samples.",
  "CFI-G": "Studies cool flames: faint, low-temperature flames of gaseous fuels such as propane and " +
    "butane, and the conditions in which they appear on the ISS.",
  "FLEX": "Burns single fuel droplets on the ISS to map when liquid fuels can burn in microgravity, " +
    "and how well gaseous suppressants such as CO₂ and helium put the flames out.",
  "BASS-II": "Burns small solid samples such as acrylic (PMMA) and fabric on the ISS to study " +
    "ignition, flame spread and extinction at different airflows and oxygen levels.",
  "SAME-R": "Heats common spacecraft materials until they smoke and measures the size of the smoke " +
    "particles, to help design smoke detectors that work in low gravity.",
  "ACME BRE": "Burns gas through a porous burner to imitate (emulate) a burning solid material, in still " +
    "air on the ISS, including the cabin atmospheres NASA has considered for crewed missions " +
    "(21% O₂ at 14.7 psi, 26.5% at 10.2 psi, 34% at 8.2 psi).",
  "BASS": "The first BASS (2012–13, before BASS-II): burned real spacecraft materials such as fabric, " +
    "acrylic spheres, Nomex and wax candles on the ISS at different airflows, and tested nitrogen as a " +
    "fire suppressant.",
  "SPICE": "Burned small gas jet flames on the ISS and turned up the fuel until each flame started to " +
    "give off soot (smoke), to learn how much smoke flames make without gravity.",
};

// first sentence of a long text, cut to a sensible length (fallback when there is no intro)
function oneLine(text) {
  if (!text) return "Objective not listed.";
  const first = text.split(/(?<=\.)\s/)[0];
  return first.length > 180 ? first.slice(0, 177).trimEnd() + "…" : first;
}

const investigationIntro = inv => INVESTIGATION_INTROS[inv.investigation] || oneLine(inv.objective);

// ---------- an icon for each investigation (instead of a logo) ----------
// Simple line icons that hint at what was studied; coloured by the investigation's pillar.
// every investigation uses the same lab-flask icon
const FLASK_ICON = '<path d="M9.5 3h5M10.5 3v5.5L5.4 17.6A2.3 2.3 0 0 0 7.4 21h9.2a2.3 2.3 0 0 0 2-3.4L13.5 8.5V3"/><path d="M7.6 15h8.8"/>';
function investigationIcon(inv, size = "") {
  return `<span class="inv-icon ${size}" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${FLASK_ICON}</svg></span>`;
}

// ---------- names + links ----------
// Full names as NASA's PSI site shows them
const FULL_NAMES = {
  "Saffire-II": "Spacecraft Fire Experiment-II (SAFFIRE-II)",
  "CFI-G": "Advanced Combustion via Microgravity Experiments / Cool Flames Investigation with Gases (ACME CFI-G)",
  "FLEX": "Flame Extinguishment Experiment (FLEX)",
  "BASS-II": "Burning and Suppression of Solids-II (BASS-II)",
  "SAME-R": "Smoke Aerosol Measurement Experiment-Reflight (SAME-R)",
  "ACME BRE": "Advanced Combustion via Microgravity Experiments / Burning Rate Emulator (ACME BRE)",
  "BASS": "Burning and Suppression of Solids (BASS)",
  "SPICE": "Smoke Point In Co-flow Experiment (SPICE)",
};
const fullName = inv => FULL_NAMES[inv.investigation] || inv.title || inv.investigation;

// the investigation's own page on NASA's PSI site (where its DOI also leads)
const psiPage = inv => `https://psi.nasa.gov/physci/repo/data/investigations/${encodeURIComponent(inv.psi_id)}`;
// "PSI-20 · DOI 10.60555/… ↗": the DOI is the link to the real dataset (cards themselves are not links)
const doiLink = inv => inv.doi
  ? `<a class="doi" href="https://doi.org/${encodeURI(inv.doi)}" target="_blank" rel="noopener">DOI ${escapeHtml(inv.doi)} <span aria-hidden="true">↗</span></a>`
  : `<a class="doi" href="${psiPage(inv)}" target="_blank" rel="noopener">NASA PSI page <span aria-hidden="true">↗</span></a>`;

// ---------- what was burned, and under which conditions ----------
// Raw fuel names in the data are long ("1 cm wide PMMA 2 mm thick"), so they are grouped
// into readable types. First matching rule wins. Unclear names are NOT guessed:
// e.g. BASS-II's '1/4" clear rod' does not say it is PMMA, so it stays "material not stated".
const FUEL_GROUPS = [
  [/pmma.*nomex|nomex.*pmma/i, "PMMA with Nomex"],
  [/sibal|cotton/i, "Cotton-fiberglass fabric (SIBAL)"],
  [/pmma|acrylic/i, "PMMA (acrylic plastic)"],
  [/nomex/i, "Nomex"],
  [/silicone/i, "Silicone"],
  [/rod/i, "Rods, clear or black (material not stated)"],
  [/film|micron/i, "Thin films (material not stated)"],
  [/candle|wax/i, "Wax candle"],
  [/spherical/i, "Spherical section (material not stated)"],
  [/methanol/i, "Methanol droplets"],
  [/heptane/i, "Heptane droplets"],
];

function fuelGroup(fuel) {
  const rule = FUEL_GROUPS.find(([re]) => re.test(fuel));
  if (rule) return rule[1];
  // gases: "30% butane" = butane diluted in the burner stream
  const diluted = fuel.match(/^\d+%\s*(\w+)/);
  const name = diluted ? diluted[1] : fuel;
  return name.charAt(0).toUpperCase() + name.slice(1) + (diluted ? " (diluted)" : "");
}

// SAME-R has no burn tests in data.js; its heated materials come from data/clean/detection.csv
const SAME_R_MATERIALS = ["Kapton", "Silicone", "Lampwick", "Pyrell", "Teflon"];

const round = (x, digits) => Number(x.toFixed(digits));

// "21.5–22.1%" (+ how many tests report it, if not all)
function rangeOf(tests, key, unit, digits) {
  const values = tests.map(t => t[key]).filter(v => v !== null && v !== undefined);
  if (!values.length) return "Not reported";
  const lo = round(Math.min(...values), digits), hi = round(Math.max(...values), digits);
  const text = lo === hi ? `${lo}${unit}` : `${lo}–${hi}${unit}`;
  return values.length < tests.length ? `${text} (reported in ${values.length} of ${tests.length} tests)` : text;
}

// ---------- BASS and SPICE: NASA's tables list samples/fuels but no oxygen, pressure or outcome per test ----------
// counts per value, most common first: "<li>PMMA <b>61</b></li>..."
function countList(rows, key) {
  const counts = {};
  rows.forEach(r => { const v = r[key] || "Not stated"; counts[v] = (counts[v] || 0) + 1; });
  return Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([v, n]) => `<li>${escapeHtml(v.charAt(0).toUpperCase() + v.slice(1))} <b>${n}</b></li>`).join("");
}
function bassConditions() {
  return `<dl class="exp-conditions">
      <div><dt>What burned</dt><dd><ul class="fuel-list">${countList(BASS_TESTS, "material")}</ul></dd></div>
      <div><dt>Shapes</dt><dd>Fabric strips, spheres, slabs, rods and candles (some burned behind another object, a "wake" flame)</dd></div>
      <div><dt>Airflow</dt><dd>Up to 40 cm/s, with or against the flame (NASA's description; not listed per test)</dd></div>
      <div><dt>Suppression</dt><dd>Nitrogen tested as a fire suppressant</dd></div>
      <div><dt>Gravity</dt><dd>Microgravity</dd></div>
    </dl>
    <p class="outcome-note">NASA's table lists only the date and sample of each test: no oxygen, airflow or
      outcome per test, so BASS is not in the "Will It Burn?" ranking.</p>`;
}
function spiceConditions() {
  const nozzles = [...new Set(SPICE_RUNS.map(r => r.nozzle_mm))].sort((a, b) => a - b).map(n => round(n, 2)).join(", ");
  return `<dl class="exp-conditions">
      <div><dt>What burned</dt><dd><ul class="fuel-list">${countList(SPICE_RUNS, "fuel")}</ul></dd></div>
      <div><dt>Burner nozzles</dt><dd>${nozzles} mm across</dd></div>
      <div><dt>Airflow</dt><dd>Air flowing alongside the flame (co-flow), 5.4–65 cm/s (NASA's description; a few readings fall outside it)</dd></div>
      <div><dt>Oxygen, pressure</dt><dd>Not listed per run</dd></div>
      <div><dt>Gravity</dt><dd>Microgravity</dd></div>
    </dl>
    <p class="outcome-note">Every flame was lit on purpose and burned: SPICE measured when it starts to give off
      soot (its "smoke point"), so there are no burn / no-burn outcomes. NASA reports 526 flames studied;
      its table lists ${SPICE_RUNS.length} runs.</p>`;
}

function conditionsBlock(inv) {
  if (inv.investigation === "ACME BRE") return breConditions();
  if (inv.investigation === "BASS") return bassConditions();
  if (inv.investigation === "SPICE") return spiceConditions();
  if (inv.investigation === "SAME-R") {
    return `<dl class="exp-conditions">
      <div><dt>Materials heated</dt><dd>${SAME_R_MATERIALS.join(", ")}</dd></div>
    </dl>`;
  }
  const tests = TESTS.filter(t => t.investigation === inv.investigation);
  if (!tests.length) return "";

  // fuel types with counts, most tested first
  const counts = {};
  tests.forEach(t => { const g = fuelGroup(t.fuel); counts[g] = (counts[g] || 0) + 1; });
  const fuels = Object.entries(counts).sort((a, b) => b[1] - a[1])
    .map(([g, n]) => `<li>${escapeHtml(g)} <b>${n}</b></li>`).join("");

  const airflow = rangeOf(tests, "airflow_cm_s", " cm/s", 0);
  const gravity = [...new Set(tests.map(t => t.gravity))]
    .map(g => g === "normal gravity" ? "Earth gravity (comparison tests)" : "Microgravity").join(" + ");

  return `<dl class="exp-conditions">
      <div><dt>What burned</dt><dd><ul class="fuel-list">${fuels}</ul></dd></div>
      <div><dt>Oxygen</dt><dd>${rangeOf(tests, "o2_percent", "%", 1)}</dd></div>
      <div><dt>Pressure</dt><dd>${rangeOf(tests, "pressure_bar", " bar", 2)}</dd></div>
      <div><dt>Airflow</dt><dd>${airflow === "0 cm/s" ? "Still air (0 cm/s)" : airflow}</dd></div>
      <div><dt>Gravity</dt><dd>${gravity}</dd></div>
    </dl>`;
}

// ---------- shared: an investigation card with some of its tests ----------
// Used by Ask (related investigations) and Will It Burn? (most relevant tests).
// columns = [{ label, show: test => html }]; extra = html added at the bottom (e.g. a button).
// Clicking the card opens the investigation's page on NASA PSI.
// To avoid repeating the same words over and over:
//   - a column that none of these tests reports (all "–") is left out and named once below the table
//   - the same value in rows next to each other is shown once, in one taller (merged) cell.
//     Columns with noMerge: true (Test, Outcome) are never merged: every test keeps its own result.
function testsTable(tests, columns) {
  const values = tests.map(t => columns.map(c => c.show(t)));            // values[row][column]
  const empty = columns.map((c, i) => values.every(row => row[i] === "–"));
  const shown = columns.map((c, i) => i).filter(i => !empty[i]);

  const rows = values.map((row, r) => {
    const cells = shown.map(i => {
      if (columns[i].noMerge) return `<td>${row[i]}</td>`;
      if (r > 0 && values[r - 1][i] === row[i]) return "";               // covered by the merged cell above
      let span = 1;
      while (r + span < values.length && values[r + span][i] === row[i]) span++;
      return span > 1 ? `<td rowspan="${span}" class="merged">${row[i]}</td>` : `<td>${row[i]}</td>`;
    });
    return `<tr>${cells.join("")}</tr>`;
  });

  const missing = columns.filter((c, i) => empty[i]).map(c => c.label);
  return `
    <div class="table-wrap ask-inv-tests">
      <table class="notranslate" translate="no">
        <tr>${shown.map(i => `<th>${columns[i].label}</th>`).join("")}</tr>
        ${rows.join("")}
      </table>
    </div>
    ${missing.length ? `<p class="ask-inv-count">Not reported by these tests: ${missing.join(", ")}</p>` : ""}`;
}

function investigationTestsCard(inv, tests, { columns, countText = "", extra = "" }) {
  let testsPart = "";
  if (tests.length) {
    const set = csvSets.push(tests) - 1;
    testsPart = `<p class="ask-inv-count">${countText}</p>` + testsTable(tests, columns) +
      csvButton(`Download ${tests.length === 1 ? "this test" : `these ${tests.length} tests`} (CSV)`,
                `data-csv-set="${set}" data-csv-name="${escapeHtml(inv.investigation)} tests"`) + extra;
  }
  else if (inv.pillar === "Detection") testsPart = `<p class="ask-inv-count">Smoke measurements only, no burn tests.</p>`;
  else if (inv.investigation === "ACME BRE") testsPart = `<p class="ask-inv-count">Daily summaries only (flames ignited per day), no individual test results.</p>`;
  else if (inv.investigation === "BASS") testsPart = `<p class="ask-inv-count">${BASS_TESTS.length} tests listed by sample only (no oxygen, airflow or outcome per test).</p>`;
  else if (inv.investigation === "SPICE") testsPart = `<p class="ask-inv-count">${SPICE_RUNS.length} smoke-point flame runs (no burn / no-burn outcomes).</p>`;

  return `
    <article class="ask-inv">
      <header class="exp-card-head">
        ${investigationIcon(inv, "small")}
        <div>
          <h5>${escapeHtml(fullName(inv))}</h5>
          <p class="exp-card-id">${escapeHtml(inv.psi_id)} · ${escapeHtml(inv.pillar)} <span aria-hidden="true">·</span> ${doiLink(inv)}</p>
        </div>
      </header>
      <p class="ask-inv-intro">${escapeHtml(investigationIntro(inv))}</p>
      ${testsPart}
    </article>`;
}

// a table cell: the value, or "–" if the test doesn't report it
const cellValue = v => (known(v) ? escapeHtml(v) : "–");

// tests grouped by investigation, in the order the investigations first appear in the list
function groupByInvestigation(tests) {
  const names = [...new Set(tests.map(t => t.investigation))];
  return names.map(n => ({
    inv: INVESTIGATIONS.find(i => i.investigation === n),
    tests: tests.filter(t => t.investigation === n),
  })).filter(g => g.inv);
}

// ---------- ACME BRE: NASA only gives daily summaries (bre.js) ----------
function breConditions() {
  const fuels = {};
  BRE_DAYS.forEach(d => fuels[d.fuel] = (fuels[d.fuel] || 0) + d.flames_ignited);
  const fuelList = Object.entries(fuels).sort((a, b) => b[1] - a[1])
    .map(([f, n]) => `<li>${escapeHtml(f.charAt(0).toUpperCase() + f.slice(1))} <b>${n} flames</b></li>`).join("");
  const o2 = BRE_DAYS.flatMap(d => String(d.o2_levels).split(";").map(Number));
  const levels = [...new Set(o2)].sort((a, b) => a - b).map(v => v + "%").join(", ");
  const burners = [...new Set(BRE_DAYS.map(d => d.burner_mm))].sort((a, b) => a - b).join(" and ");
  return `<dl class="exp-conditions">
      <div><dt>What burned</dt><dd><ul class="fuel-list">${fuelList}</ul></dd></div>
      <div><dt>Oxygen</dt><dd>${levels} (room oxygen, diluted with nitrogen)</dd></div>
      <div><dt>Pressure</dt><dd>Varied, but not listed in NASA's table</dd></div>
      <div><dt>Burner</dt><dd>${burners} mm porous burners</dd></div>
      <div><dt>Airflow</dt><dd>Still air</dd></div>
      <div><dt>Gravity</dt><dd>Microgravity</dd></div>
    </dl>`;
}

function breSummary() {
  const flames = BRE_DAYS.reduce((sum, d) => sum + d.flames_ignited, 0);
  return `<p class="outcome-note">Daily summaries only: NASA's table lists how many flames ignited each day
    (${flames} flames over ${BRE_DAYS.length} test days), not the outcome of each test.</p>`;
}

// ---------- CFI-G inverse flames (inverse.js): NASA's highest-oxygen microgravity tests ----------
// Oxygen flows OUT of the burner into a chamber of fuel and nitrogen, so the oxygen % is the
// burner stream, not the room air. Shown here and used by Ask, but kept out of the Will It Burn? ranking.
function inverseFlamesBlock() {
  const tests = INVERSE_TESTS;
  const o2 = tests.map(t => t.burner_o2_percent).filter(known);
  const p = tests.map(t => t.pressure_bar).filter(known);
  const high = tests.filter(t => t.burner_o2_percent >= 40).length;
  const fuels = [...new Set(tests.map(t => t.fuel))].join(", ");
  return `
    <div class="inverse-block">
      <p class="inverse-title">Plus ${tests.length} inverse-flame tests: NASA's highest-oxygen microgravity data</p>
      <p class="inverse-text">Here oxygen flows <b>out of the burner</b> into a chamber of fuel (${escapeHtml(fuels)})
        and nitrogen, so the oxygen level is that of the burner stream, not of the room air.
        Burner oxygen ${Math.min(...o2)}–${Math.max(...o2)}% (${high} tests at 40% or more),
        pressure ${Math.min(...p)}–${Math.max(...p)} bar.</p>
      ${outcomeBar("CFI-G", tests, `Outcomes of ${tests.length} inverse-flame tests`)}
    </div>`;
}

// ---------- CSV downloads ----------
// The files are made in the browser from the same data the page shows (so they also work without the server).
// Columns are the data's own field names, e.g. o2_percent, pressure_bar, outcome, notes.
function toCsv(rows) {
  const columns = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const cell = v => {
    if (v === null || v === undefined) return "";
    const text = String(v);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;   // quote commas, quotes and line breaks
  };
  return [columns.join(","), ...rows.map(r => columns.map(c => cell(r[c])).join(","))].join("\r\n");
}
function downloadCsv(filename, rows) {
  // "\uFEFF" tells Excel the file is UTF-8, so symbols like µ and O₂ show correctly
  const blob = new Blob(["\uFEFF" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
const fileName = text => "flamma-" + text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + ".csv";

// each investigation's own data
function investigationRows(name) {
  if (name === "ACME BRE") return BRE_DAYS;
  if (name === "SAME-R") return DETECTION_TESTS;
  if (name === "BASS") return BASS_TESTS;
  if (name === "SPICE") return SPICE_RUNS;
  return TESTS.filter(t => t.investigation === name);
}
// rows shown in a results card (Will It Burn? / Ask) are kept here, so its button downloads exactly those
const csvSets = [];
const downloadIcon = `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>`;
function csvButton(label, data) {
  return `<button type="button" class="csv-btn" ${data}>${downloadIcon}${label}</button>`;
}

document.addEventListener("click", e => {
  const btn = e.target.closest(".csv-btn");
  if (!btn) return;
  const { csvInv, csvSet, csvAll } = btn.dataset;
  if (csvInv) downloadCsv(fileName(csvInv), investigationRows(csvInv));
  else if (csvSet) downloadCsv(fileName(btn.dataset.csvName || "tests"), csvSets[csvSet]);
  else if (csvAll === "tests") downloadCsv("flamma-burn-tests.csv", TESTS);
  else if (csvAll === "inverse") downloadCsv("flamma-cfi-g-inverse-flames.csv", INVERSE_TESTS);
  else if (csvAll === "bre") downloadCsv("flamma-acme-bre-days.csv", BRE_DAYS);
  else if (csvAll === "detection") downloadCsv("flamma-same-r-smoke.csv", DETECTION_TESTS);
  else if (csvAll === "bass") downloadCsv("flamma-bass-tests.csv", BASS_TESTS);
  else if (csvAll === "spice") downloadCsv("flamma-spice-flame-runs.csv", SPICE_RUNS);
  else if (csvAll === "investigations") downloadCsv("flamma-investigations.csv", INVESTIGATIONS);
});

// "Download the data" on NASA Investigations
document.getElementById("csv-all-links").innerHTML = [
  csvButton(`Burn tests <span class="csv-n">${TESTS.length}</span>`, 'data-csv-all="tests"'),
  csvButton(`CFI-G inverse flames <span class="csv-n">${INVERSE_TESTS.length}</span>`, 'data-csv-all="inverse"'),
  csvButton(`ACME BRE daily summaries <span class="csv-n">${BRE_DAYS.length}</span>`, 'data-csv-all="bre"'),
  csvButton(`SAME-R smoke measurements <span class="csv-n">${DETECTION_TESTS.length}</span>`, 'data-csv-all="detection"'),
  csvButton(`BASS tests <span class="csv-n">${BASS_TESTS.length}</span>`, 'data-csv-all="bass"'),
  csvButton(`SPICE flame runs <span class="csv-n">${SPICE_RUNS.length}</span>`, 'data-csv-all="spice"'),
  csvButton(`Investigations <span class="csv-n">${INVESTIGATIONS.length}</span>`, 'data-csv-all="investigations"'),
].join("");

// ---------- one investigation card ----------
// Horizontal: left = logo, name, intro, key facts, DOI; right = what burned, conditions, outcome bar.
// The DOI next to the PSI ID links to the real dataset; the card itself is not a link.
function card(inv) {
  const unit = inv.investigation === "SAME-R" ? "Smoke measurements"
    : inv.investigation === "SPICE" ? "Flame runs"
    : inv.investigation === "BASS" ? "Tests listed"
    : inv.investigation === "ACME BRE" ? "Flames ignited"
    : inv.investigation === "CFI-G" ? "Burn tests (normal flames)" : "Burn tests";
  const facts = `
    <dl class="exp-meta">
      <div><dt>${unit}</dt><dd class="big">${inv.n_tests ?? "–"}</dd></div>
      <div><dt>Platform</dt><dd>${escapeHtml((inv.platform || "Not listed").replace("International Space Station (ISS)", "ISS"))}</dd></div>
      <div><dt>Dates</dt><dd>${escapeHtml(dateRange(inv))}</dd></div>
    </dl>`;
  let outcome;
  if (inv.investigation === "SAME-R")
    outcome = `<p class="outcome-note">No ignition outcomes: the materials were heated to make smoke, not burned.</p>`;
  else if (inv.investigation === "BASS" || inv.investigation === "SPICE") outcome = "";   // explained in the conditions block
  else if (inv.investigation === "ACME BRE") outcome = breSummary();
  else outcome = outcomeBar(inv.investigation, undefined,
    inv.investigation === "CFI-G" ? `Outcomes of ${TESTS.filter(t => t.investigation === "CFI-G").length} normal-flame tests` : "");
  if (inv.investigation === "CFI-G") outcome += inverseFlamesBlock();

  return `
    <article class="exp-card">
      <div class="exp-card-main">
      <header class="exp-card-head">
        ${investigationIcon(inv)}
        <div>
          <h3 class="notranslate" translate="no">${escapeHtml(fullName(inv))}</h3>
          <p class="exp-card-id">${escapeHtml(inv.psi_id)} <span aria-hidden="true">·</span> ${doiLink(inv)}</p>
        </div>
        <span class="pillar-tag tag-${inv.pillar.toLowerCase()}">${escapeHtml(inv.pillar)}</span>
      </header>
      <p class="exp-intro">${escapeHtml(investigationIntro(inv))}</p>
      ${facts}
      <div class="exp-links">
        <a class="csv-btn see-detail-btn" href="#experiment/${encodeURIComponent(inv.investigation)}">See details <span aria-hidden="true">→</span></a>
        ${csvButton("Download CSV", `data-csv-inv="${escapeHtml(inv.investigation)}"`)}
        ${inv.investigation === "CFI-G" ? csvButton("Inverse flames CSV", 'data-csv-all="inverse"') : ""}
      </div>
      </div>
      <div class="exp-card-data">
        ${conditionsBlock(inv)}
        ${outcome}
      </div>
    </article>`;
}

// the SoFIE-GEL video plays by itself, except for people who asked for reduced motion
document.querySelectorAll(".feature-video video, video.intro-video, .ov-tile video").forEach(v => {
  if (reducedMotion.matches) { v.removeAttribute("autoplay"); v.pause(); }
});

// ================= the NASA Investigations page =================
// 1. three explanation cards (Prevention, Detection, Suppression)
// 2. search + sort, then every investigation card (each with its pillar tag)
// 3. "Compare investigations": a side-by-side table

// ---------- 1. the three pillars: corners of a triangle (on the Home page) ----------
// Each corner's caption has a "See investigations" link that opens NASA Investigations filtered
// to that pillar (#experiments/<pillar>). There, the pillar's explanation appears above the list.
const PILLAR_CORNERS = { Prevention: "top", Detection: "left", Suppression: "right" };
let activePillar = null;
const triangle = document.getElementById("pillar-triangle");

triangle.insertAdjacentHTML("beforeend", PILLAR_ORDER.map(pillar => `
  <span class="tri-node tri-${PILLAR_CORNERS[pillar]} tag-${pillar.toLowerCase()}" data-pillar="${pillar}">
    <span class="tri-dot" aria-hidden="true"></span>
    <span class="tri-label">${pillar}</span>
  </span>`).join(""));

// what the experiments in each pillar do, in one short line (shortened from PILLAR_INTROS)
const PILLAR_BRIEFS = {
  Prevention: "Tests how easily materials ignite and how fast flames spread.",
  Detection: "Measures the smoke that overheated materials give off.",
  Suppression: "Studies how flames and burning fuel droplets go out.",
};
// each pillar's name, first sentence and brief line next to its corner
PILLAR_ORDER.forEach(pillar => {
  const [first] = PILLAR_INTROS[pillar].split(/(?<=\.)\s+/);
  document.getElementById("pd-" + pillar.toLowerCase()).innerHTML =
    `<p class="pd-name tag-${pillar.toLowerCase()}">${pillar}` +
    ` <a class="pd-link" href="#experiments/${pillar.toLowerCase()}" aria-label="See ${pillar} investigations" title="See ${pillar} investigations"><span aria-hidden="true">↗</span></a></p>` +
    `<p class="pd-first">${escapeHtml(first)}</p><p class="pd-brief">${escapeHtml(PILLAR_BRIEFS[pillar])}</p>`;   // short: the full text is on NASA Investigations
});


// ---------- tickbox filters under the search bar (NASA Investigations) ----------
// Within a group: any ticked value matches. Between groups: all must match. Nothing ticked = no filter.
const SAMPLE_TYPES = { BASS: ["solid"], SPICE: ["gas"], "ACME BRE": ["gas"], "SAME-R": ["solid"] };   // not in TESTS
const sampleTypes = inv => SAMPLE_TYPES[inv.investigation]
  || [...new Set(TESTS.filter(t => t.investigation === inv.investigation).map(t => t.fuel_phase))];
const platformOf = inv => /cygnus/i.test(inv.platform || "") ? "cygnus" : "iss";
const FILTER_GROUPS = [
  { key: "pillar", label: "Pillar", options: PILLAR_ORDER.map(p => [p, p]), value: inv => [inv.pillar] },
  { key: "sample", label: "Sample type", options: [["solid", "Solid"], ["liquid", "Liquid"], ["gas", "Gas"]], value: sampleTypes },
  { key: "platform", label: "Platform", options: [["iss", "ISS"], ["cygnus", "Cygnus cargo ship"]], value: inv => [platformOf(inv)] },
];
const invFilters = document.getElementById("inv-filters");
invFilters.innerHTML = FILTER_GROUPS.map(g => `
  <fieldset class="filter-group"><legend>${g.label}</legend>
    ${g.options.map(([v, l]) => `<label class="check filter-check"><input type="checkbox" data-group="${g.key}" value="${v}"> ${l}</label>`).join("")}
  </fieldset>`).join("") + `<button type="button" class="link-btn filter-clear" id="filter-clear" hidden>Clear filters</button>`;
const ticked = key => [...invFilters.querySelectorAll(`input[data-group="${key}"]:checked`)].map(i => i.value);
const passesFilters = inv => FILTER_GROUPS.every(g => {
  const want = ticked(g.key);
  return !want.length || g.value(inv).some(v => want.includes(v));
});
invFilters.addEventListener("change", () => {
  if (activePillar) setPillarCaption(null);          // the user is choosing filters now
  renderInvestigations();
});
document.getElementById("filter-clear").addEventListener("click", () => {
  invFilters.querySelectorAll("input").forEach(i => i.checked = false);
  history.replaceState(null, "", "#experiments");
  setPillarCaption(null);
  renderInvestigations();
});

// a link like #experiments/detection ticks that pillar (and shows its explanation above the list)
function setPillarFilter(pillar) {
  invFilters.querySelectorAll('input[data-group="pillar"]').forEach(i => i.checked = i.value === pillar);
  setPillarCaption(pillar);
  renderInvestigations();
}
function setPillarCaption(pillar) {
  activePillar = pillar;
  const caption = document.getElementById("pillar-caption");
  caption.className = "pillar-caption" + (pillar ? " tag-" + pillar.toLowerCase() : "");
  caption.innerHTML = pillar
    ? `<span class="pillar-tag tag-${pillar.toLowerCase()}">${pillar}</span> ${escapeHtml(PILLAR_INTROS[pillar])} <button type="button" class="link-btn" id="pillar-clear">Show all investigations</button>`
    : "";
  if (pillar) document.getElementById("pillar-clear").addEventListener("click", () => {
    history.replaceState(null, "", "#experiments");
    setPillarFilter(null);
  });
}

// ---------- 2. all investigation cards, with search and sort ----------
const invList = document.getElementById("inv-list");
const invSearch = document.getElementById("inv-search");
const invSort = document.getElementById("inv-sort");

// total tests per investigation (CFI-G: normal + inverse flames), for "Most tests"
const totalTests = inv => inv.investigation === "CFI-G" ? inv.n_tests + INVERSE_TESTS.length : (inv.n_tests || 0);

// build every card once; keep the text each one can be found by
const invCards = INVESTIGATIONS.map(inv => {
  const holder = document.createElement("div");
  holder.innerHTML = card(inv).trim();
  const el = holder.firstElementChild;
  el.dataset.search = [el.textContent, inv.investigation, inv.title, inv.pillar, inv.hardware, inv.psi_id]
    .join(" ").toLowerCase().replace(/\s+/g, " ");
  return { inv, el };
});

const SORTS = {
  az: (a, b) => fullName(a.inv).localeCompare(fullName(b.inv)),
  za: (a, b) => fullName(b.inv).localeCompare(fullName(a.inv)),
  recent: (a, b) => (b.inv.end_date || "").localeCompare(a.inv.end_date || ""),     // no date -> last
  oldest: (a, b) => (a.inv.start_date || "9999").localeCompare(b.inv.start_date || "9999"),
  tests: (a, b) => totalTests(b.inv) - totalTests(a.inv),
};

function renderInvestigations() {
  const words = invSearch.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const shown = invCards
    .filter(c => passesFilters(c.inv))                                // tickbox filters
    .filter(c => words.every(w => c.el.dataset.search.includes(w)))   // every word must match
    .sort(SORTS[invSort.value]);
  invList.replaceChildren(...shown.map(c => c.el));
  const n = shown.length, total = invCards.length;
  const tickedLabels = FILTER_GROUPS.flatMap(g => g.options.filter(([v]) => ticked(g.key).includes(v)).map(([, l]) => l));
  document.getElementById("filter-clear").hidden = !tickedLabels.length;
  const filters = [...tickedLabels, words.length ? `"${invSearch.value.trim()}"` : ""].filter(Boolean).join(" + ");
  document.getElementById("inv-count").textContent = filters
    ? `${n} of ${total} investigations match ${filters}`
    : `${total} investigations`;
  document.getElementById("inv-empty").classList.toggle("hidden", n > 0);
}

invSearch.addEventListener("input", renderInvestigations);
invSort.addEventListener("change", renderInvestigations);
renderInvestigations();

// ---------- 3. compare investigations side by side ----------
// Hardware comes from NASA's metadata ("Experiment Hardware"). Samples, what changed between
// tests, and sensors are summarised from each investigation's NASA objective/approach text and
// test-table columns; "Not listed" where NASA's metadata does not say.
const COMPARE_INFO = {
  "Saffire-II": {
    samples: "9 flat sample sheets, 5 × 29 cm each, from 0.27 mm thin to 1 cm thick, burned in a flow duct",
    variables: "Material, sample thickness, flow direction (with or against the flame), airflow 20 or 30 cm/s",
    sensors: "2 cameras; thermocouples (flow, flame and plume temperatures); 2 radiometers (flame radiation); solid-state pressure, CO₂ and O₂ sensors; 2 anemometers (flow speed)",
  },
  "CFI-G": {
    samples: "Spherical porous burner: gas flows out of it (normal flames: fuel; inverse flames: oxygen)",
    variables: "Fuel (ethane, propane, butane), dilution, flow rates, pressure, normal vs inverse flames",
    sensors: "Cameras (incl. intensified video), radiometers, photomultiplier tubes, thermocouples",
  },
  "ACME BRE": {
    samples: "Porous circular gas burners, 25 and 50 mm across, burning gas to imitate burning solids",
    variables: "Fuel (ethylene or methane, pure or diluted), room oxygen, pressure, burner size, fuel flow rate",
    sensors: "Heat flux sensor and burner surface temperature (other instruments not listed)",
  },
  "FLEX": {
    samples: "Single fuel droplets, 1.1–4.67 mm across",
    variables: "Fuel (methanol, heptane), droplet size, oxygen, pressure, added gas (nitrogen, CO₂, helium)",
    sensors: "Measured: burning rate, flame extinction size, heat radiation, soot, temperature (instrument names not listed)",
  },
  "BASS-II": {
    samples: "Rods, slabs, films, spherical sections and fabric sheets, mostly 1–2 cm wide",
    variables: "Airflow speed and direction, oxygen (lowered by adding nitrogen), sample shape and material",
    sensors: "Glovebox video imaging, a radiometer, O₂/CO₂/CO readings (from the test table)",
  },
  "BASS": {
    samples: "Fabric strips (SIBAL, Nomex), acrylic (PMMA) spheres, rods and slabs, Ultem sheets, wax candles and slabs; some burned in the wake of another object",
    variables: "Material and shape, airflow speed (up to 40 cm/s) and direction, nitrogen as a suppressant",
    sensors: "Top and edge views of the flame (size, shape, colour, spread rate, quenching)",
  },
  "SPICE": {
    samples: "Gas jet flames from round nozzles 0.41, 0.76 and 1.6 mm across",
    variables: "Fuel (ethylene, propane, propylene and propylene mixtures, methane), nozzle size, fuel flow rate, co-flow air speed",
    sensors: "Still and video cameras; flame height, radiative heat loss and co-flow air speed measured",
  },
  "SAME-R": {
    samples: "Spacecraft materials heated until they smoke: Kapton, silicone, lampwick, Pyrell foam, Teflon",
    variables: "Material, heating level, smoke aging time, flow through the chamber (0–8.1 cm/s)",
    sensors: "Ionization smoke detector, DustTrak (particle mass), M-pass (new NASA Glenn instrument)",
  },
};

// make the comparison details searchable too (e.g. "thermocouple", "droplet", "spherical burner")
invCards.forEach(c => {
  const info = COMPARE_INFO[c.inv.investigation] || {};
  c.el.dataset.search += " " + [info.samples, info.variables, info.sensors].join(" ").toLowerCase();
});

// fix two typos in NASA's metadata when displaying
const tidyHardware = h => (h || "Not listed").replace("Appartatus", "Apparatus").replace("Comparitive", "Comparative");

// small outcome bar, no legend (the colours have tooltips and the full bars are on the cards)
function miniBar(tests) {
  if (!tests.length) return "–";
  const counts = OUTCOMES.map(o => [o, tests.filter(t => t.outcome === o).length]).filter(([, n]) => n);
  const unknown = tests.filter(t => !t.outcome).length;
  if (unknown) counts.push([NOT_STATED, unknown]);
  return `<div class="bar bar-mini" role="img" aria-label="${escapeHtml(counts.map(([o, n]) => `${o} ${n}`).join(", "))}">` +
    counts.map(([o, n]) => `<span class="bar-seg" style="flex:${n} 1 0; background:${o === NOT_STATED ? "var(--border-2)" : COLORS[o]}" data-tip="${escapeHtml(`${o}: ${n}`)}"></span>`).join("") +
    `</div>`;
}

function compareColumn(inv) {
  const name = inv.investigation;
  const tests = TESTS.filter(t => t.investigation === name);
  const info = COMPARE_INFO[name] || {};
  const capital = t => t.charAt(0).toUpperCase() + t.slice(1);
  const fuels = name === "ACME BRE" ? [...new Set(BRE_DAYS.map(d => capital(d.fuel)))].join(", ")
    : name === "BASS" ? [...new Set(BASS_TESTS.map(t => t.material))].join(", ")
    : name === "SPICE" ? [...new Set(SPICE_RUNS.map(r => capital(r.fuel)))].join(", ")
    : name === "SAME-R" ? "No fuel burned (materials heated to make smoke)"
    : [...new Set(tests.map(t => fuelGroup(t.fuel)))].join(", ");
  let oxygen = tests.length ? rangeOf(tests, "o2_percent", "%", 1) : "–";
  let pressure = tests.length ? rangeOf(tests, "pressure_bar", " bar", 2) : "–";
  let airflow = tests.length ? rangeOf(tests, "airflow_cm_s", " cm/s", 0) : "–";
  let count = name === "SAME-R" ? `${inv.n_tests} smoke measurements` : `${inv.n_tests} burn tests`;
  let outcomes = name === "SAME-R" ? "No ignition outcomes" : miniBar(tests);
  if (name === "CFI-G") {
    const o2 = INVERSE_TESTS.map(t => t.burner_o2_percent);
    oxygen += ` (room); inverse flames: burner ${Math.min(...o2)}–${Math.max(...o2)}%`;
    count = `${inv.n_tests} normal + ${INVERSE_TESTS.length} inverse-flame tests`;
    outcomes = `<span class="cmp-sub">Normal</span>${miniBar(tests)}<span class="cmp-sub">Inverse</span>${miniBar(INVERSE_TESTS)}`;
  }
  if (name === "ACME BRE") {
    oxygen = "21–40% (room)"; pressure = "Varied, not listed"; airflow = "Still air";
    count = `${inv.n_tests} flames over ${BRE_DAYS.length} days`; outcomes = "Daily summaries only";
  }
  if (name === "SAME-R") airflow = "0–8.1 cm/s (through the smoke chamber)";
  if (name === "BASS") {
    oxygen = "Not listed per test"; pressure = "Not listed per test"; airflow = "Up to 40 cm/s (NASA's description)";
    count = `${inv.n_tests} tests (samples only)`; outcomes = "Not recorded in NASA's table";
  }
  if (name === "SPICE") {
    oxygen = "Not listed per run"; pressure = "Not listed per run"; airflow = "5.4–65 cm/s co-flow (NASA's description)";
    count = `${inv.n_tests} flame runs (NASA: 526 flames studied)`; outcomes = "Smoke point measured; every flame burned";
  }
  const gravity = name === "Saffire-II" ? "Microgravity + Earth comparison tests" : "Microgravity";
  const hardware = inv.hardware_link
    ? `<a href="${escapeHtml(inv.hardware_link)}" target="_blank" rel="noopener">${escapeHtml(tidyHardware(inv.hardware))} <span aria-hidden="true">↗</span></a>`
    : escapeHtml(tidyHardware(inv.hardware));
  return {
    "Pillar": `<span class="pillar-tag tag-${inv.pillar.toLowerCase()}">${escapeHtml(inv.pillar)}</span>`,
    "Platform": escapeHtml((inv.platform || "Not listed").replace("International Space Station (ISS)", "ISS")),
    "Hardware": hardware,
    "Fuels / samples": escapeHtml(fuels),
    "Sample shape & size": escapeHtml(info.samples || "Not listed"),
    "Oxygen": escapeHtml(oxygen),
    "Pressure": escapeHtml(pressure),
    "Airflow": escapeHtml(airflow === "0 cm/s" ? "Still air (0 cm/s)" : airflow),
    "Gravity": gravity,
    "What changed between tests": escapeHtml(info.variables || "Not listed"),
    "Sensors / measurements": escapeHtml(info.sensors || "Not listed"),
    "Tests": escapeHtml(count),
    "Outcomes": outcomes,
  };
}

// ---------- Compare (the second view of NASA Investigations) ----------
// Pick investigations by name, then press Compare to build the table.
const compareSelected = new Set();
let comparedKey = "";                                   // which picks the table currently shows
const pickKey = () => [...compareSelected].sort().join("|");
const comparePicks = document.getElementById("compare-picks");
const compareGo = document.getElementById("compare-go");
const compareResult = document.getElementById("compare-result");

function renderPicks() {
  comparePicks.innerHTML = INVESTIGATIONS.map(inv => {
    const on = compareSelected.has(inv.investigation);
    return `
    <button type="button" class="compare-pick" data-inv="${escapeHtml(inv.investigation)}" aria-pressed="${on}">
      <span class="pick-check" aria-hidden="true"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg></span>
      <span class="pick-text">
        <span class="pick-name">${escapeHtml(inv.investigation)}</span>
        <span class="pick-full">${escapeHtml(fullName(inv))}</span>
      </span>
      <span class="pillar-tag tag-${inv.pillar.toLowerCase()}">${escapeHtml(inv.pillar)}</span>
    </button>`;
  }).join("");
}

function updateCompareActions() {
  const n = compareSelected.size;
  const shownNow = !compareResult.hidden && comparedKey === pickKey();
  compareGo.disabled = n < 2 || shownNow;
  compareGo.textContent = !compareResult.hidden && !shownNow && n >= 2 ? "Update comparison" : "Compare";
  document.getElementById("compare-status").textContent =
    n === 0 ? "Nothing picked yet." : n === 1 ? "1 picked · pick one more." : `${n} picked.`;
}

function renderCompare() {
  const chosen = INVESTIGATIONS.filter(i => compareSelected.has(i.investigation));   // in the usual order
  const cols = chosen.map(compareColumn);
  const rows = Object.keys(cols[0]);
  document.getElementById("compare-grid").innerHTML =
    `<tr><th scope="col"></th>${chosen.map(i => `<th scope="col">${escapeHtml(i.investigation)}</th>`).join("")}</tr>` +
    rows.map(r => `<tr><th scope="row">${r}</th>${cols.map(c => `<td>${c[r]}</td>`).join("")}</tr>`).join("");
  comparedKey = pickKey();
  compareResult.hidden = false;
}

comparePicks.addEventListener("click", e => {
  const pick = e.target.closest(".compare-pick");
  if (!pick) return;
  const name = pick.dataset.inv;
  compareSelected.has(name) ? compareSelected.delete(name) : compareSelected.add(name);
  pick.setAttribute("aria-pressed", compareSelected.has(name));
  updateCompareActions();
});
compareGo.addEventListener("click", () => {
  renderCompare();
  updateCompareActions();
  compareResult.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
});
document.getElementById("compare-clear").addEventListener("click", () => {
  compareSelected.clear();
  compareResult.hidden = true;
  renderPicks();
  updateCompareActions();
});
renderPicks();
updateCompareActions();

// show one of the two views and mark its sub-tab
function showInvView(view) {
  document.getElementById("inv-view-list").hidden = view !== "list";
  document.getElementById("inv-view-compare").hidden = view !== "compare";
  document.querySelectorAll(".subtab").forEach(t => {
    const on = t.dataset.view === view;
    t.classList.toggle("active", on);
    if (on) t.setAttribute("aria-current", "page"); else t.removeAttribute("aria-current");
  });
}

// ---------- which page? (from the address) ----------
// Old links like #experiments/prevention still work: they open the list searched for that pillar.
// footer Sources: the first 3 are shown; the button shows or hides the rest
const srcMore = document.getElementById("src-more");
function showAllSources(all) {
  document.getElementById("footer-sources").classList.toggle("show-all", all);
  srcMore.setAttribute("aria-expanded", all);
  srcMore.querySelector(".src-more-text").textContent = all ? "Show fewer" : "Show all";
}
srcMore.addEventListener("click", () => showAllSources(srcMore.getAttribute("aria-expanded") !== "true"));

// a citation like [5] (#ref-5): show all Sources in the footer and highlight that source
function showSource(id) {
  const item = document.getElementById(id);
  if (!item) return;
  showAllSources(true);
  item.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "center" });
  item.classList.remove("flash"); void item.offsetWidth; item.classList.add("flash");
}
document.addEventListener("click", e => {
  const cite = e.target.closest('a[href^="#ref-"]');
  if (!cite) return;
  e.preventDefault();                       // don't change the page; just show the source
  showSource(cite.getAttribute("href").slice(1));
});

let currentPage = null;

function route() {
  const [page, sub] = location.hash.slice(1).split("/");
  const shown = showPage(page || HOME_PAGE);
  // a link to another tab starts at the top (a link to a source on the same page scrolls to it)
  if (currentPage !== null && shown !== currentPage) window.scrollTo(0, 0);
  currentPage = shown;
  if (page === "experiments") {
    showInvView(sub === "compare" ? "compare" : "list");           // #experiments/compare -> the Compare view
    const pillar = PILLAR_ORDER.find(p => p.toLowerCase() === sub);
    if (pillar) setPillarFilter(pillar);                           // #experiments/detection -> tick only Detection
  }
}

window.addEventListener("hashchange", route);
route();

// ---------- filters sidebar: open / close (remembered in this browser) ----------
const invLayout = document.getElementById("inv-layout");
const filterToggle = document.getElementById("filter-toggle");
function setFiltersOpen(open) {
  invLayout.classList.toggle("side-closed", !open);
  filterToggle.setAttribute("aria-expanded", String(open));
  try { localStorage.setItem("flamma-filters-open", open ? "1" : "0"); } catch {}
}
filterToggle.addEventListener("click", () => setFiltersOpen(invLayout.classList.contains("side-closed")));
document.getElementById("inv-side-close").addEventListener("click", () => setFiltersOpen(false));
try { setFiltersOpen(localStorage.getItem("flamma-filters-open") !== "0"); } catch { setFiltersOpen(true); }

// ---------- an investigation's data table (on its own page, #experiment/<name>): cleaned next to NASA's original ----------
const tableBox = document.getElementById("dt-data");
const tdState = { inv: null, show: new Set(["clean"]), part: 0 };
const TD_VERSIONS = {
  clean: { title: "Cleaned (FLAMMA)", suffix: "cleaned" },
  raw: { title: "Original (NASA PSI)", suffix: "original NASA" },
};
// cleaned rows for each part of an investigation (same order as RAW_TABLES[inv])
function cleanedParts(name) {
  if (name === "CFI-G") return [TESTS.filter(t => t.investigation === "CFI-G"), INVERSE_TESTS];
  return [investigationRows(name)];
}
// columns + rows of one version ("clean" or "raw") of the current table
function tdTable(version) {
  const part = (RAW_TABLES[tdState.inv] || [])[tdState.part] || { columns: [], rows: [], file: "" };
  if (version === "raw") return { columns: part.columns, rows: part.rows, file: part.file };
  const objs = cleanedParts(tdState.inv)[tdState.part] || [];
  const columns = [...new Set(objs.flatMap(o => Object.keys(o)))];
  return { columns, rows: objs.map(o => columns.map(c => o[c] ?? "")) };
}
function renderDataTable() {
  const inv = INVESTIGATIONS.find(i => i.investigation === tdState.inv);
  const raw = RAW_TABLES[tdState.inv] || [];
  tableBox.querySelectorAll(".td-check input").forEach(c => { c.checked = tdState.show.has(c.dataset.version); });
  const sel = document.getElementById("td-part");
  sel.hidden = raw.length < 2;
  sel.innerHTML = raw.map((p, i) => `<option value="${i}"${i === tdState.part ? " selected" : ""}>${escapeHtml(p.label)}</option>`).join("");
  const versions = ["clean", "raw"].filter(v => tdState.show.has(v));
  const panes = document.getElementById("td-panes");
  panes.classList.toggle("two", versions.length === 2);
  panes.innerHTML = versions.map(v => {
    const { columns, rows, file } = tdTable(v);
    const note = v === "raw"
      ? `NASA's table exactly as published on PSI (${escapeHtml(file)}). Nothing changed.`
      : "FLAMMA's cleaned version: shared column names, units converted, outcomes read from NASA's wording (kept in notes). Row counts can differ from the original where rows were split or dropped.";
    return `<section class="td-pane" aria-label="${TD_VERSIONS[v].title}">
      <div class="td-pane-head">
        <h3>${TD_VERSIONS[v].title}</h3>
        <span class="td-count">${rows.length} rows · ${columns.length} columns</span>
        <button type="button" class="csv-btn" data-td-download="${v}">${downloadIcon}Download CSV</button>
      </div>
      <p class="td-note">${note}</p>
      <div class="table-wrap td-wrap"><table class="td-table notranslate" translate="no">
        <thead><tr>${columns.map(c => `<th scope="col">${escapeHtml(c)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map(x => `<td>${escapeHtml(x ?? "")}</td>`).join("")}</tr>`).join("")}</tbody>
      </table></div>
    </section>`;
  }).join("");
}
// tickboxes: one or both versions; at least one always stays ticked
tableBox.querySelectorAll(".td-check input").forEach(c => c.addEventListener("change", () => {
  if (c.checked) tdState.show.add(c.dataset.version);
  else if (tdState.show.size > 1) tdState.show.delete(c.dataset.version);
  else c.checked = true;
  renderDataTable();
}));
document.getElementById("td-part").addEventListener("change", e => { tdState.part = Number(e.target.value); renderDataTable(); });
document.getElementById("td-panes").addEventListener("click", e => {
  const btn = e.target.closest("[data-td-download]");
  if (!btn) return;
  const v = btn.dataset.tdDownload;
  const { columns, rows } = tdTable(v);
  const objs = rows.map(r => Object.fromEntries(columns.map((c, i) => [c, r[i]])));
  const parts = RAW_TABLES[tdState.inv] || [];
  const extra = parts.length > 1 ? " " + parts[tdState.part].label : "";
  downloadCsv(fileName(`${tdState.inv}${extra} ${TD_VERSIONS[v].suffix}`), objs);
});

// ---------- Compare: download the comparison as a CSV ----------
document.getElementById("compare-download").addEventListener("click", () => {
  const chosen = INVESTIGATIONS.filter(i => compareSelected.has(i.investigation));
  const cols = chosen.map(compareColumn);
  // cell HTML -> plain text (outcome bars have no text, so their counts come from aria-label, e.g. "Kept burning 27, ...")
  const text = html => {
    const d = document.createElement("div"); d.innerHTML = html;
    const words = d.textContent.replace(/\s+/g, " ").trim();
    const bars = [...d.querySelectorAll("[aria-label]")].map(b => b.getAttribute("aria-label")).join(" | ");
    return [words, bars].filter(Boolean).join(" ");
  };
  const rows = Object.keys(cols[0]).map(row => Object.fromEntries([["Attribute", row], ...chosen.map((inv, i) => [inv.investigation, text(cols[i][row])])]));
  downloadCsv(fileName("comparison " + chosen.map(i => i.investigation).join(" ")), rows);
});
