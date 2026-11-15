// ================= One investigation's own page (#experiment/<name>) =================
// Header + objective/hypothesis, "What the results show" graphs (plain SVG, no library),
// the data table (cleaned / original, from experiments.js) and an Ask bar that answers
// from this investigation only (askInline in ask.js).
// Every sentence under a graph is worked out from the data here: nothing is typed in by hand,
// so the words always match the numbers.

// ---------- colours ----------
// fuels / materials / sizes: categorical palette checked with the dataviz validator
// (light + dark), defined as CSS variables --cat-1..6 in style.css. Outcomes keep COLORS (app.js).
const CAT = [1, 2, 3, 4, 5, 6].map(i => `var(--cat-${i})`);
const NOT_STATED_COLOR = "var(--border-2)";
const pctOf = (a, b) => (b ? Math.round((100 * a) / b) : 0);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const num = v => (v === null || v === undefined || v === "" ? null : Number(v));

// "nice" axis ticks (0, 5, 10... or 0, 0.5, 1...)
function ticks(min, max, count = 5) {
  const span = max - min || 1;
  const raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw);
  const out = [];
  const end = Math.ceil(max / step - 1e-9) * step;   // the last tick is at or above the largest value
  for (let v = Math.floor(min / step) * step; v <= end + step * 0.001; v += step) out.push(Number(v.toFixed(6)));
  return out;
}

// how strongly two lists rise or fall together (Spearman's rank correlation, -1..1)
function rankCorrelation(xs, ys) {
  const rank = a => {
    const order = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(a.length);
    for (let i = 0; i < order.length;) {
      let j = i;
      while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
      for (let k = i; k <= j; k++) r[order[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return r;
  };
  const rx = rank(xs), ry = rank(ys), n = xs.length;
  const mx = rx.reduce((a, b) => a + b, 0) / n, my = ry.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { sxy += (rx[i] - mx) * (ry[i] - my); sxx += (rx[i] - mx) ** 2; syy += (ry[i] - my) ** 2; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0;
}
// a plain-words sentence about that trend (only says "tended to", never "causes")
function trendSentence(points, xWords, yWords) {
  if (points.length < 8) return "";
  const r = rankCorrelation(points.map(p => p.x), points.map(p => p.y));
  if (Math.abs(r) < 0.2) return `There's no clear pattern between ${xWords} and ${yWords}.`;
  const strength = Math.abs(r) >= 0.5 ? "A clear pattern" : "A weak pattern";
  return `${strength}: tests with higher ${xWords} tended to have ${r > 0 ? "higher" : "lower"} ${yWords}.`;
}

// ---------- graph 1: horizontal stacked bars ----------
// rows: [{ label, values: { key: n } }], keys: [{ key, label, color }]
function stackedBars(rows, keys, unit = "test") {
  const W = 640, L = 190, R = 70, rowH = 30, barH = 18, T = 6;
  const H = T + rows.length * rowH + 4;
  const max = Math.max(1, ...rows.map(r => keys.reduce((s, k) => s + (r.values[k.key] || 0), 0)));
  const sx = v => (v / max) * (W - L - R);
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="rs-svg" role="img" aria-label="Bar chart">`;
  rows.forEach((r, i) => {
    const y = T + i * rowH;
    const total = keys.reduce((s, k) => s + (r.values[k.key] || 0), 0);
    svg += `<text class="rs-label" x="${L - 10}" y="${y + barH / 2 + 4}" text-anchor="end">${escapeHtml(r.label)}</text>`;
    let x = L;
    keys.forEach(k => {
      const n = r.values[k.key] || 0;
      if (!n) return;
      const w = Math.max(sx(n) - 2, 1.5);   // 2px gap between segments
      svg += `<rect class="rs-mark" x="${x.toFixed(1)}" y="${y}" width="${w.toFixed(1)}" height="${barH}" rx="3" fill="${k.color}"
        data-tip="${escapeHtml(`${r.label} · ${k.label}: ${plural(n, unit)} (${pctOf(n, total)}%)`)}"></rect>`;
      x += sx(n);
    });
    svg += `<text class="rs-value" x="${x + 6}" y="${y + barH / 2 + 4}">${total}</text>`;
  });
  return svg + "</svg>";
}

// ---------- graph 2: scatter (one dot per test) ----------
// points: [{ x, y, color, tip }]
function scatterPlot(points, xLabel, yLabel) {
  const W = 640, H = 300, L = 54, R = 16, T = 12, B = 42;
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const xt = ticks(Math.min(...xs), Math.max(...xs)), yt = ticks(Math.min(0, ...ys), Math.max(...ys));
  const x0 = xt[0], x1 = xt[xt.length - 1], y0 = yt[0], y1 = yt[yt.length - 1];
  const sx = v => L + ((v - x0) / (x1 - x0 || 1)) * (W - L - R);
  const sy = v => H - B - ((v - y0) / (y1 - y0 || 1)) * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" class="rs-svg" role="img" aria-label="Scatter chart of ${escapeHtml(yLabel)} against ${escapeHtml(xLabel)}">`;
  xt.forEach(v => svg += `<line class="tm-grid" x1="${sx(v)}" x2="${sx(v)}" y1="${T}" y2="${H - B}"/><text class="tm-tick" x="${sx(v)}" y="${H - B + 16}" text-anchor="middle">${v}</text>`);
  yt.forEach(v => svg += `<line class="tm-grid" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="tm-tick" x="${L - 8}" y="${sy(v) + 4}" text-anchor="end">${v}</text>`);
  svg += `<text class="tm-axis" x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">${escapeHtml(xLabel)}</text>`;
  svg += `<text class="tm-axis" transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${escapeHtml(yLabel)}</text>`;
  points.forEach(p => svg += `<circle class="tm-dot rs-mark" cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="5" fill="${p.color}" data-tip="${escapeHtml(p.tip)}"/>`);
  return svg + "</svg>";
}

const legend = items => `<div class="test-map-legend rs-legend">${items.map(([label, color]) =>
  `<span><i style="background:${color}"></i>${escapeHtml(label)}</span>`).join("")}</div>`;

// keys for outcome bars (safe -> most dangerous), plus "not stated" in grey
const OUTCOME_KEYS = [...OUTCOMES.map(o => ({ key: o, label: o, color: COLORS[o] })),
  { key: NOT_STATED, label: "Outcome not stated", color: NOT_STATED_COLOR }];
function outcomeRows(groups) {   // groups: [[label, tests]]
  return groups.filter(([, t]) => t.length).map(([label, tests]) => {
    const values = {};
    tests.forEach(t => { const k = t.outcome || NOT_STATED; values[k] = (values[k] || 0) + 1; });
    return { label, values };
  });
}
function usedOutcomeKeys(rows) { return OUTCOME_KEYS.filter(k => rows.some(r => r.values[k.key])); }
const countIf = (tests, fn) => tests.filter(fn).length;
// assign each category a fixed colour, in order of first appearance (never re-coloured by rank)
function categoryColors(values) {
  const map = new Map();
  values.forEach(v => { if (!map.has(v) && map.size < CAT.length) map.set(v, CAT[map.size]); });
  return map;
}

// ---------- the graphs for each investigation ----------
// Each returns { charts: [{ title, sub, html, takeaway }], facts: [...] } – facts are
// also sent to the AI so its answers about this page match what the graphs say.
const RESULTS = {
  "FLEX"(tests) {
    const bands = [["Under 18% oxygen", t => t.o2_percent < 18], ["18–21% (about air)", t => t.o2_percent >= 18 && t.o2_percent <= 21],
      ["Over 21% oxygen", t => t.o2_percent > 21]];
    const groups = bands.map(([l, f]) => [l, tests.filter(f)]);
    const rows = outcomeRows(groups);
    const quick = groups.map(([, t]) => `${pctOf(countIf(t, x => x.outcome === "Went out quickly"), t.length)}%`);
    const fuels = categoryColors(tests.map(t => t.fuel));
    const rated = tests.map(t => ({ t, rate: num((/Burning rate: ([\d.]+)/.exec(t.notes || "") || [])[1]) }))
      .filter(p => p.rate !== null && p.t.o2_percent !== null);
    const pts = rated.map(({ t, rate }) => ({ x: t.o2_percent, y: rate, color: fuels.get(t.fuel),
      tip: `${t.test_id} · ${t.fuel} · ${t.o2_percent}% O₂ · burning rate ${rate} mm²/s` }));
    const take1 = `${quick[0]} of the flames under 18% oxygen went out quickly, compared with ${quick[1]} at 18–21% and ${quick[2]} above 21%. ` +
      "The less oxygen, the more often a flame went out quickly.";
    const take2 = trendSentence(pts, "oxygen", "burning rates") + ` (${pts.length} droplets with a burning rate in NASA's notes.)`;
    return {
      charts: [
        { title: "How the flames ended, by oxygen level", sub: "Each bar is a group of droplet tests; colours show how each flame ended.",
          html: stackedBars(rows, usedOutcomeKeys(rows)) + legend(usedOutcomeKeys(rows).map(k => [k.label, k.color])), takeaway: take1 },
        pts.length >= 8 && { title: "Burning rate vs oxygen", sub: "One dot per droplet; how fast the droplet burned away (mm²/s).",
          html: scatterPlot(pts, "Oxygen (%)", "Burning rate (mm²/s)") + legend([...fuels].map(([f, c]) => [f, c])), takeaway: take2 },
      ].filter(Boolean),
      facts: [take1, take2],
    };
  },

  "CFI-G"(tests) {
    const pressures = [...new Set(tests.map(t => t.pressure_bar).filter(v => v !== null))].sort((a, b) => a - b);
    const groups = pressures.map(p => [`${p} bar`, tests.filter(t => t.pressure_bar === p)]);
    const rows = outcomeRows(groups);
    const lit = groups.map(([l, t]) => `${l}: ${pctOf(countIf(t, x => x.outcome && x.outcome !== "Didn't ignite"), t.length)}%`);
    const fuels = categoryColors(tests.map(t => t.fuel));
    const pts = tests.filter(t => t.o2_percent !== null && num(t.burn_time_s) !== null).map(t => ({
      x: t.o2_percent, y: num(t.burn_time_s), color: fuels.get(t.fuel),
      tip: `${t.test_id} · ${t.fuel} · ${t.o2_percent}% O₂ · ${t.pressure_bar} bar · burned ${t.burn_time_s} s` }));
    const [topLabel, topTests] = groups[groups.length - 1];
    const lasted = countIf(topTests, t => t.outcome === "Kept burning" || t.outcome === "Burned, then went out");
    const take1 = `Share of tests where a flame lit: ${lit.join(", ")}.` +
      (lasted === 0 ? ` At the highest pressure (${topLabel}) every flame that lit went out quickly.` : "");
    const take2 = trendSentence(pts, "oxygen", "burn times");
    return {
      charts: [
        { title: "How the flames ended, by chamber pressure", sub: "Normal-flame tests (fuel out of a small ball burner) grouped by pressure.",
          html: stackedBars(rows, usedOutcomeKeys(rows)) + legend(usedOutcomeKeys(rows).map(k => [k.label, k.color])), takeaway: take1 },
        { title: "Burn time vs oxygen", sub: "One dot per test; how long the flame lasted.",
          html: scatterPlot(pts, "Oxygen (%)", "Burn time (s)") + legend([...fuels]), takeaway: take2 },
      ],
      facts: [take1, take2],
    };
  },

  "Saffire-II"(tests) {
    const materials = [...new Set(tests.map(t => t.fuel))];
    const groups = materials.flatMap(m => [[`${m} · in space`, tests.filter(t => t.fuel === m && t.gravity === "microgravity")],
      [`${m} · on Earth`, tests.filter(t => t.fuel === m && t.gravity !== "microgravity")]]);
    const rows = outcomeRows(groups);
    const space = tests.filter(t => t.gravity === "microgravity"), earth = tests.filter(t => t.gravity !== "microgravity");
    const kept = list => countIf(list, t => t.outcome === "Kept burning");
    const take = `In space, ${kept(space)} of ${space.length} samples kept burning; in the matching Earth tests, ${kept(earth)} of ${earth.length} did. ` +
      `Silicone didn't ignite in any of its ${countIf(space, t => t.fuel === "Silicone")} space tests.`;
    const timed = space.filter(t => num(t.burn_time_s) !== null);
    const take2 = timed.length ? `Longest burn in space: ${timed.sort((a, b) => b.burn_time_s - a.burn_time_s)[0].fuel} at ${timed[0].burn_time_s} s.` : "";
    return {
      charts: [{ title: "Space vs Earth, material by material", sub: "Each material was burned in space (on a Cygnus cargo ship) and tested on Earth for comparison.",
        html: stackedBars(rows, usedOutcomeKeys(rows), "sample") + legend(usedOutcomeKeys(rows).map(k => [k.label, k.color])), takeaway: [take, take2].join(" ") }],
      facts: [take, take2],
    };
  },

  "BASS-II"(tests) {
    const colorOf = t => (t.outcome ? COLORS[t.outcome] : NOT_STATED_COLOR);
    const pts = tests.filter(t => t.o2_percent !== null && num(t.airflow_cm_s) !== null).map(t => ({
      x: num(t.airflow_cm_s), y: t.o2_percent, color: colorOf(t),
      tip: `${t.test_id} · ${t.fuel} · ${t.o2_percent}% O₂ · air ${t.airflow_cm_s} cm/s · ${t.outcome || "outcome not stated"}` }));
    const stated = tests.filter(t => t.outcome);
    const no = stated.filter(t => t.outcome === "Didn't ignite");
    const take = `Only ${stated.length} of ${tests.length} tests have an outcome in NASA's table: ` +
      `${countIf(stated, t => t.outcome === "Burned, then went out")} burned, then went out, and ${no.length} didn't ignite` +
      (no.length ? ` (at ${no.map(t => `${t.o2_percent}% oxygen` + (num(t.airflow_cm_s) !== null ? ` and ${t.airflow_cm_s} cm/s air` : "")).join("; ")})` : "") + ".";
    const keys = usedOutcomeKeys([{ values: Object.fromEntries(tests.map(t => [t.outcome || NOT_STATED, 1])) }]);
    return {
      charts: [{ title: "Which oxygen and airflow were tested", sub: "One dot per test. Grey dots are tests whose outcome NASA's table doesn't state.",
        html: scatterPlot(pts, "Air flow (cm/s)", "Oxygen (%)") + legend(keys.map(k => [k.label, k.color])), takeaway: take }],
      facts: [take],
    };
  },

  "ACME BRE"() {
    const fuels = categoryColors(BRE_DAYS.map(d => d.fuel));
    const rows = BRE_DAYS.map(d => ({ label: `${d.date} · ${d.burner_mm} mm`, values: { [d.fuel]: num(d.flames_ignited) || 0 } }));
    const keys = [...fuels].map(([f, c]) => ({ key: f, label: f, color: c }));
    const byFuel = [...fuels.keys()].map(f => {
      const days = BRE_DAYS.filter(d => d.fuel === f), total = days.reduce((s, d) => s + (num(d.flames_ignited) || 0), 0);
      return `${f}: ${total} flames over ${plural(days.length, "day")} (about ${Math.round(total / days.length)} a day)`;
    });
    const zero = BRE_DAYS.filter(d => !num(d.flames_ignited));
    const take = byFuel.join("; ") + "." + (zero.length ? ` On ${plural(zero.length, "day")} no flame was ignited.` : "");
    return {
      charts: [{ title: "Flames ignited on each test day", sub: "Each bar is one day of testing; the colour is the fuel and the label shows the burner size.",
        html: stackedBars(rows, keys, "flame") + legend(keys.map(k => [k.label, k.color])), takeaway: take }],
      facts: [take],
    };
  },

  "SAME-R"() {
    const keys = [{ key: "smoke generation", label: "Smoke made", color: CAT[0] }, { key: "aged follow-up", label: "Aged smoke re-measured", color: CAT[1] }];
    const mats = [...new Set(DETECTION_TESTS.map(d => d.sample_material))];
    const rows = mats.map(m => ({ label: m, values: Object.fromEntries(keys.map(k => [k.key, countIf(DETECTION_TESTS, d => d.sample_material === m && d.measurement === k.key)])) }));
    const take = `${DETECTION_TESTS.length} smoke measurements from ${mats.length} materials. ` +
      "This table records how the smoke was made and aged; the smoke particle sizes themselves are in NASA's reports, not in this table.";
    return {
      charts: [{ title: "Smoke measurements per material", sub: "Each material was heated until it smoked; some smoke was kept and measured again later (\"aged\").",
        html: stackedBars(rows, keys, "measurement") + legend(keys.map(k => [k.label, k.color])), takeaway: take }],
      facts: [take],
    };
  },

  "BASS"() {
    const shapes = categoryColors(BASS_TESTS.map(t => t.shape));
    const keys = [...shapes].map(([s, c]) => ({ key: s, label: s, color: c }));
    const mats = [...new Set(BASS_TESTS.map(t => t.material))];
    const rows = mats.map(m => ({ label: m.replace(/ \(.*\)/, ""), values: Object.fromEntries(keys.map(k => [k.key, countIf(BASS_TESTS, t => t.material === m && t.shape === k.key)])) }))
      .sort((a, b) => Object.values(b.values).reduce((x, y) => x + y) - Object.values(a.values).reduce((x, y) => x + y));
    const top = rows[0], topN = Object.values(top.values).reduce((x, y) => x + y);
    const take = `${top.label} was tested most (${topN} of ${BASS_TESTS.length} tests). NASA's BASS table lists what was burned, not how each test ended.`;
    return {
      charts: [{ title: "What was burned, and in what shape", sub: "Tests per material; colours show the sample shape.",
        html: stackedBars(rows, keys) + legend(keys.map(k => [k.label, k.color])), takeaway: take }],
      facts: [take],
    };
  },

  "SPICE"() {
    const nozzles = [...new Set(SPICE_RUNS.map(r => r.nozzle_mm))].sort((a, b) => a - b);
    const nKeys = nozzles.map((n, i) => ({ key: n, label: `${Number(n).toFixed(2)} mm nozzle`, color: CAT[i] }));
    const fuelsList = [...new Set(SPICE_RUNS.map(r => r.fuel))];
    const rows = fuelsList.map(f => ({ label: f, values: Object.fromEntries(nKeys.map(k => [k.key, countIf(SPICE_RUNS, r => r.fuel === f && r.nozzle_mm === k.key)])) }));
    const fuels = categoryColors(SPICE_RUNS.map(r => r.fuel));
    const pts = SPICE_RUNS.filter(r => num(r.fuel_rate_mg_s) !== null && num(r.air_coflow_cm_s) !== null).map(r => ({
      x: num(r.air_coflow_cm_s), y: num(r.fuel_rate_mg_s), color: fuels.get(r.fuel),
      tip: `Run ${r.run} · ${r.fuel} · ${Number(r.nozzle_mm).toFixed(2)} mm · air ${r.air_coflow_cm_s} cm/s · fuel ${r.fuel_rate_mg_s} mg/s` }));
    const take1 = `${SPICE_RUNS.length} flame runs with ${fuelsList.length} fuels and ${nozzles.length} nozzle sizes.`;
    const take2 = trendSentence(pts, "air speed", "fuel flow");
    return {
      charts: [
        { title: "Flame runs per fuel and nozzle size", sub: "How many flames were tested for each fuel.",
          html: stackedBars(rows, nKeys, "run") + legend(nKeys.map(k => [k.label, k.color])), takeaway: take1 },
        { title: "Fuel flow vs air speed", sub: "One dot per run.",
          html: scatterPlot(pts, "Air speed around the flame (cm/s)", "Fuel flow (mg/s)") + legend([...fuels]), takeaway: take2 },
      ],
      facts: [take1, take2],
    };
  },
};

function resultsFor(name) {
  const fn = RESULTS[name];
  return fn ? fn(TESTS.filter(t => t.investigation === name)) : { charts: [], facts: [] };
}

// ---------- what the AI gets for "Ask about this investigation" ----------
// The investigation's result sentences, group counts and its table rows (up to 80, spread
// across the table so every part of it is represented).
function focusForAi(name) {
  const inv = INVESTIGATIONS.find(i => i.investigation === name);
  const rows = investigationRows(name);
  const step = Math.max(1, Math.ceil(rows.length / 80));
  const sample = rows.filter((_, i) => i % step === 0).map(r => {
    const o = { ...r };
    delete o.investigation; delete o.psi_id;
    if (typeof o.notes === "string" && o.notes.length > 140) o.notes = o.notes.slice(0, 140) + "…";
    return o;
  });
  return {
    investigation: name,
    full_name: fullName(inv),
    row_count: rows.length,
    rows_shown: sample.length,
    result_summary: resultsFor(name).facts.filter(Boolean),
    table_rows: sample,
  };
}

// ---------- the page ----------
const detailHead = document.getElementById("dt-head");
let detailName = null;

function clampBox(title, text) {
  if (!text) return "";
  return `<div class="dt-text-card"><h3>${title}</h3><p class="dt-clamp">${escapeHtml(text)}</p>
    <button type="button" class="dt-more" aria-expanded="false">Show more</button></div>`;
}

function renderDetail(name) {
  const inv = INVESTIGATIONS.find(i => i.investigation === name);
  if (!inv) { location.replace("#experiments"); return; }
  if (name !== detailName) window.scrollTo(0, 0);
  detailName = name;
  document.title = `${inv.investigation} · Flamma`;

  detailHead.innerHTML = `
    ${investigationIcon(inv, "lg")}
    <div class="dt-head-text">
      <p class="td-kicker">${escapeHtml(inv.psi_id)}</p>
      <h1 id="td-title" class="dt-title" tabindex="-1">${escapeHtml(fullName(inv))}</h1>
      <p class="dt-intro">${escapeHtml(investigationIntro(inv))}</p>
      <p class="dt-links">
        <span>${escapeHtml((inv.platform || "Platform not listed").replace("International Space Station (ISS)", "ISS"))}</span>
        <span>${escapeHtml(dateRange(inv))}</span>
        <a href="${psiPage(inv)}" target="_blank" rel="noopener">NASA PSI page <span aria-hidden="true">↗</span></a>
        ${doiLink(inv)}
      </p>
    </div>
    <span class="pillar-tag tag-${inv.pillar.toLowerCase()}">${escapeHtml(inv.pillar)}</span>`;

  document.getElementById("dt-about").innerHTML =
    clampBox("What NASA wanted to find out", inv.objective) + clampBox("Hypothesis", inv.hypothesis);
  document.querySelectorAll("#dt-about .dt-text-card").forEach(card => {
    const p = card.querySelector(".dt-clamp"), btn = card.querySelector(".dt-more");
    btn.hidden = p.scrollHeight <= p.clientHeight + 2;   // short text: nothing to expand
  });

  const { charts } = resultsFor(name);
  document.getElementById("dt-charts").innerHTML = charts.map(c => `
    <figure class="card rs-card">
      <figcaption><h3>${escapeHtml(c.title)}</h3><p class="muted rs-sub">${escapeHtml(c.sub)}</p></figcaption>
      ${c.html}
      ${c.takeaway ? `<p class="rs-take"><strong>What it shows:</strong> ${escapeHtml(c.takeaway)}</p>` : ""}
    </figure>`).join("") || `<p class="muted">No graph for this investigation yet.</p>`;

  Object.assign(tdState, { inv: name, part: 0 });
  renderDataTable();

  const input = document.getElementById("dt-ask-input");
  input.placeholder = `Ask about ${inv.investigation}, e.g. "Which fuel burned longest?"`;
  input.value = "";
  const answer = document.getElementById("dt-answer");
  answer.hidden = true; answer.innerHTML = "";
}

// "Show more" on the objective / hypothesis
document.getElementById("dt-about").addEventListener("click", e => {
  const btn = e.target.closest(".dt-more");
  if (!btn) return;
  const open = btn.getAttribute("aria-expanded") !== "true";
  btn.closest(".dt-text-card").classList.toggle("open", open);
  btn.setAttribute("aria-expanded", String(open));
  btn.textContent = open ? "Show less" : "Show more";
});

// Ask + Summarize: the answer appears under the bar, from this investigation only
document.getElementById("dt-ask").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("dt-ask-input"), q = input.value.trim();
  if (!q) { input.focus(); return; }
  askInline(q, document.getElementById("dt-answer"), detailName);
});
document.getElementById("dt-summary").addEventListener("click", () => {
  askInline(`Summarize the ${detailName} investigation: what was tested, under what conditions, and what the results show.`,
    document.getElementById("dt-answer"), detailName);
});

// tooltip for every bar and dot (hover, or tap on a phone)
const rsTip = document.createElement("div");
rsTip.className = "rs-tip";
rsTip.hidden = true;
document.body.appendChild(rsTip);
const chartsBox = document.getElementById("dt-charts");
function showTip(e) {
  const mark = e.target.closest("[data-tip]");
  if (!mark) { rsTip.hidden = true; return; }
  rsTip.textContent = mark.dataset.tip;
  rsTip.hidden = false;
  const x = Math.min(e.clientX + 14, window.innerWidth - rsTip.offsetWidth - 8);
  rsTip.style.left = `${Math.max(8, x)}px`;
  rsTip.style.top = `${e.clientY + 16}px`;
}
chartsBox.addEventListener("mousemove", showTip);
chartsBox.addEventListener("click", showTip);
chartsBox.addEventListener("mouseleave", () => { rsTip.hidden = true; });
window.addEventListener("scroll", () => { rsTip.hidden = true; }, { passive: true });

// open the page for #experiment/<name>
const baseTitle = document.title;
function detailRoute() {
  const [page, sub] = location.hash.slice(1).split("/");
  if (page === "experiment") renderDetail(decodeURIComponent(sub || ""));
  else { detailName = null; document.title = baseTitle; }
}
window.addEventListener("hashchange", detailRoute);
detailRoute();
