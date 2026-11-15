// ================= "Where Flamma's NASA data has tests" =================
// A simple scatter chart (plain SVG, no library): every burn test that reports both oxygen and
// pressure is one dot, coloured by outcome; a star marks the conditions the user picked.
// Shows at a glance where NASA's data is dense and where there are no tests (e.g. Moon-base air).
const MAP_TESTS = TESTS.filter(t => t.o2_percent !== null && t.pressure_bar !== null);
const SVG_NS = "http://www.w3.org/2000/svg";

function drawTestMap() {
  const box = document.getElementById("test-map");
  if (!box) return;
  const W = 640, H = 300, L = 46, R = 14, T = 12, B = 40;          // size and margins (px)
  const xMax = Math.max(50, (conditions.o2 ?? 0) + 5);             // oxygen axis, %
  const yMax = Math.max(3.5, (conditions.pressure ?? 0) + 0.3);    // pressure axis, bar
  const x = v => L + (v / xMax) * (W - L - R);
  const y = v => H - B - (v / yMax) * (H - T - B);

  let svg = `<svg viewBox="0 0 ${W} ${H}" class="test-map-svg" role="img"
    aria-label="Scatter chart of ${MAP_TESTS.length} NASA burn tests by oxygen and pressure, coloured by outcome">`;
  // grid lines + axis labels
  for (let o = 0; o <= xMax; o += 10)
    svg += `<line class="tm-grid" x1="${x(o)}" x2="${x(o)}" y1="${T}" y2="${H - B}"/><text class="tm-tick" x="${x(o)}" y="${H - B + 16}" text-anchor="middle">${o}%</text>`;
  for (let p = 0; p <= yMax + 0.001; p += 0.5)
    svg += `<line class="tm-grid" x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}"/><text class="tm-tick" x="${L - 8}" y="${y(p) + 4}" text-anchor="end">${p}</text>`;
  svg += `<text class="tm-axis" x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">Oxygen (%)</text>`;
  svg += `<text class="tm-axis" transform="translate(13 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">Pressure (bar)</text>`;
  // one dot per test (hover shows what it was)
  MAP_TESTS.forEach(t => {
    const color = t.outcome ? COLORS[t.outcome] : "var(--border-2)";
    const tip = `${t.investigation} · ${t.fuel} · ${t.o2_percent}% O₂, ${t.pressure_bar} bar · ${t.outcome || "outcome not stated"}`;
    svg += `<circle class="tm-dot" cx="${x(t.o2_percent).toFixed(1)}" cy="${y(t.pressure_bar).toFixed(1)}" r="4" fill="${color}"><title>${escapeHtml(tip)}</title></circle>`;
  });
  // the user's conditions (only when both oxygen and pressure are set)
  if (conditions.o2 !== null && conditions.pressure !== null) {
    const cx = x(conditions.o2), cy = y(conditions.pressure);
    const star = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => {
      const r = i % 2 ? 5 : 12, a = Math.PI / 5 * i - Math.PI / 2;
      return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
    }).join(" ");
    svg += `<polygon class="tm-star" points="${star}"><title>Your conditions: ${conditions.o2}% O₂, ${conditions.pressure} bar</title></polygon>`;
  }
  box.innerHTML = svg + "</svg>";
  document.getElementById("test-map-star").hidden = conditions.o2 === null || conditions.pressure === null;
}

// legend (outcome colours), drawn once
document.getElementById("test-map-legend").innerHTML =
  [...OUTCOMES.map(o => [o, COLORS[o]]), ["Outcome not stated", "var(--border-2)"]]
    .map(([o, c]) => `<span><i style="background:${c}"></i>${o}</span>`).join("") +
  `<span id="test-map-star"><i class="tm-star-key">★</i>Your conditions</span>`;
document.getElementById("test-map-count").textContent = MAP_TESTS.length;

drawTestMap();
document.addEventListener("rankingdone", drawTestMap);
document.addEventListener("conditionschange", drawTestMap);
