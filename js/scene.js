// ================= Scenario scene (illustration) =================
// Listens for "conditionschange" (from conditions.js) and updates the picture.
// Each condition has its own layer:
//   gravity  -> background (station window / Moon / Mars / Earth horizon)
//   pressure -> faint dot grid (denser = higher pressure)
//   airflow  -> wind lines drifting left to right
//   oxygen   -> floating "O₂" molecules (more = more oxygen)

const scene = document.getElementById("scene");
const sceneEmpty = document.getElementById("scene-empty");
const pressureLayer = document.getElementById("pressure-dots");
const windLayer = document.getElementById("wind");
const moleculeLayer = document.getElementById("molecules");

// small helpers
const random = (min, max) => min + Math.random() * (max - min);
const lerp = (a, b, t) => a + (b - a) * t;

// true when every condition is "Any"
function nothingSet(c) {
  return c.o2 === null && c.pressure === null && c.phase === "any" &&
         c.material === "any" && c.airflow === "any" && c.gravity === "any";
}

// e.g. "Moon · 34% O₂ · 0.7 bar · Fabric · Gentle airflow"
function captionText(c) {
  const parts = [];
  if (c.gravity !== "any") parts.push(LABELS.gravity[c.gravity]);
  if (c.o2 !== null) parts.push(Math.round(c.o2) + "% O₂");
  if (c.pressure !== null) parts.push(SLIDERS.pressure.format(c.pressure) + " bar");
  if (c.material !== "any") parts.push(materialLabel(c.material));
  else if (c.phase !== "any") parts.push(LABELS.phase[c.phase]);
  if (c.airflow !== "any") parts.push(LABELS.airflow[c.airflow]);
  return parts.length ? parts.join(" · ") : "No conditions set";
}

// ---------- oxygen: floating O₂ molecules ----------
// how many molecules for an oxygen %: 21% -> 4, 34% -> 7, 100% -> 20
const O2_POINTS = [[10, 2], [21, 4], [34, 7], [100, 20]];

function moleculeCount(o2) {
  if (o2 === null) return 0;
  for (let i = 1; i < O2_POINTS.length; i++) {
    const [x0, y0] = O2_POINTS[i - 1], [x1, y1] = O2_POINTS[i];
    if (o2 <= x1) return Math.round(lerp(y0, y1, (o2 - x0) / (x1 - x0)));
  }
  return 20;
}

// Spot for molecule number i. The "R2" sequence spreads points evenly over
// an area (no clumps, no stripes); a little jitter keeps it looking natural.
function moleculeSpot(i) {
  const frac = n => n - Math.floor(n);
  return {
    x: 0.06 + 0.88 * frac(0.5 + i * 0.7548777) + random(-0.02, 0.02),
    y: 0.08 + 0.58 * frac(0.5 + i * 0.5698403) + random(-0.02, 0.02),
  };
}

function makeMolecule(i) {
  const m = document.createElement("div");
  const spot = moleculeSpot(i);
  m.className = "molecule";
  // position + slow random drift (CSS reads these variables)
  m.style.setProperty("--x", spot.x.toFixed(3));
  m.style.setProperty("--y", spot.y.toFixed(3));
  m.style.setProperty("--dx", random(-28, 28).toFixed(0) + "px");
  m.style.setProperty("--dy", random(-22, 22).toFixed(0) + "px");
  m.style.setProperty("--dur", random(6, 11).toFixed(1) + "s");
  m.style.setProperty("--delay", -random(0, 10).toFixed(1) + "s");
  m.innerHTML = '<span class="molecule-inner">O₂</span>';
  return m;
}

// add or remove only the difference, so the others keep floating undisturbed
function updateMolecules(o2) {
  const wanted = moleculeCount(o2);
  const current = [...moleculeLayer.querySelectorAll(".molecule:not(.leaving)")];

  for (let i = current.length; i < wanted; i++) {
    const m = makeMolecule(i);
    moleculeLayer.appendChild(m);
    m.getBoundingClientRect();        // let the browser see it at opacity 0 first...
    m.classList.add("is-in");         // ...so this fades it in
  }
  current.slice(wanted).forEach(m => {
    m.classList.add("leaving");       // fade out, then remove
    setTimeout(() => m.remove(), 600);
  });
}

// ---------- pressure: faint dot grid ----------
// 0 bar -> dots 60px apart (almost empty), 1.0 bar -> 16px apart, 5 bar -> 8px apart (packed)
function updatePressure(pressure) {
  pressureLayer.classList.toggle("is-visible", pressure !== null);
  if (pressure === null) return;
  const gap = pressure <= 1 ? lerp(60, 16, pressure) : lerp(16, 8, Math.min(1, (pressure - 1) / 4));
  pressureLayer.style.setProperty("--dot-gap", gap.toFixed(1) + "px");
}

// ---------- airflow: wind lines ----------
const WIND = {
  gentle: { lines: 3, minDur: 9,   maxDur: 12,  minLen: 60,  maxLen: 90 },
  strong: { lines: 6, minDur: 2.4, maxDur: 3.4, minLen: 110, maxLen: 170 },
};
let currentWind = null;
let windTimer = null;

// One "gust" = the classic wind symbol: 2–3 stacked strokes,
// the top one curls up at its end, the bottom one curls down.
// `len` is the longest stroke in px. Drawn at real size, so curls never stretch.
function gustSVG(len, strokes) {
  const r = 9;                         // curl radius
  const top    = `M2 ${r + 3} H${Math.round(len * 0.72)} a${r} ${r} 0 1 0 -${r} -${r}`;
  const middle = `M${Math.round(len * 0.12)} ${r + 13} H${len}`;
  const bottom = `M2 ${r + 23} H${Math.round(len * 0.85)} a${r} ${r} 0 1 1 -${r} ${r}`;
  const paths = strokes === 3 ? [top, middle, bottom] : [top, bottom];
  const w = len + r + 4, h = r * 2 + 30;
  return `<svg width="${w}" height="${h}" viewBox="0 -2 ${w} ${h}" aria-hidden="true">
    ${paths.map(d => `<path d="${d}" />`).join("")}
  </svg>`;
}

function buildWind(airflow) {
  const cfg = WIND[airflow];
  windLayer.innerHTML = "";
  if (!cfg) return;
  for (let i = 0; i < cfg.lines; i++) {
    const line = document.createElement("span");
    const dur = random(cfg.minDur, cfg.maxDur);
    const len = Math.round(random(cfg.minLen, cfg.maxLen));
    line.className = "wind-line";
    line.innerHTML = gustSVG(len, i % 2 === 0 ? 3 : 2);
    line.style.top = (6 + (i / cfg.lines) * 58 + random(-3, 3)).toFixed(1) + "%";   // spread top to bottom
    line.style.setProperty("--x", random(0.05, 0.85).toFixed(2));   // used when motion is reduced
    line.style.animationDuration = dur.toFixed(2) + "s";
    line.style.animationDelay = -random(0, dur).toFixed(2) + "s";   // start mid-way, not all at once
    windLayer.appendChild(line);
  }
}

// fade the old lines out, swap, fade the new ones in
function updateWind(airflow) {
  if (airflow === currentWind) return;
  const hadLines = !!WIND[currentWind];
  currentWind = airflow;
  clearTimeout(windTimer);
  windLayer.classList.remove("is-visible");
  windTimer = setTimeout(() => {
    buildWind(airflow);
    if (WIND[airflow]) windLayer.classList.add("is-visible");
  }, hadLines ? 300 : 0);
}

// ---------- main update ----------
function updateScene(c) {
  sceneEmpty.classList.toggle("is-visible", nothingSet(c));

  // gravity background: fade in the matching layer, fade out the others
  scene.querySelectorAll(".scene-bg").forEach(layer => {
    layer.classList.toggle("is-visible", layer.dataset.gravity === c.gravity);
  });

  // label tag: the picked preset's name (e.g. "Moon base"), otherwise the gravity
  const place = document.getElementById("scene-place");
  const preset = document.querySelector('.chip[data-preset][aria-pressed="true"] .chip-label');
  const GRAVITY_NAMES = { station: "Space station · microgravity", moon: "Moon · 1/6 g", mars: "Mars · 1/3 g", earth: "Earth · 1 g" };
  place.textContent = preset ? preset.textContent : (GRAVITY_NAMES[c.gravity] || "");
  place.hidden = !place.textContent;

  updatePressure(c.pressure);
  updateWind(c.airflow);
  updateMolecules(c.o2);

  // the picture's description for screen readers
  const text = captionText(c);
  scene.setAttribute("aria-label", "Scenario illustration: " + text);
}

document.addEventListener("conditionschange", e => updateScene(e.detail.conditions));
updateScene(conditions);
