// ================= Material + fire animation =================
// The material (what's burning) sits in the middle of the scene.
// After "Will it burn?" (the "rankingdone" event from app.js):
//   - the flame's LOOK comes from the conditions (gravity, oxygen, pressure, airflow)
//   - the flame's ENDING comes from the NASA data result (the most common outcome)
//   - when it ends, the picture freezes and the page scrolls to the results.
//     With the Animation button off, there is no animation at all.
// Changing any condition afterwards fades the fire out so the user can try again.

const materialObj = document.getElementById("material-obj");
const materialTag = document.getElementById("material-tag");
const flameCenter = materialObj.querySelector(".flame-center");
const flameLeft = materialObj.querySelector(".flame-left");
const flameRight = materialObj.querySelector(".flame-right");
const spark = materialObj.querySelector(".spark");

const clamp01 = x => Math.min(1, Math.max(0, x));

// ---------- the material ----------
// forRun = true: if no fuel type is set, show a generic sample so the fire has something to burn
function updateMaterial(c, forRun = false) {
  let shape = c.phase !== "any" ? c.phase : (forRun ? "generic" : "");
  materialObj.dataset.phase = shape;
  materialObj.classList.toggle("is-visible", shape !== "");

  if (c.material !== "any") materialTag.textContent = materialLabel(c.material);
  else if (c.phase !== "any") materialTag.textContent = LABELS.phase[c.phase];
  else materialTag.textContent = "Any material";
}

// ---------- the flame's look (CSS variables) ----------
// Unknown ("Any") values fall back to Earth-like air: 21% O₂, 1.0 bar.
function setFlameLook(c) {
  const g = c.gravity === "any" ? 1 : USER_G[c.gravity];   // 0 = space station, 1 = Earth
  const round = 1 - Math.sqrt(g);                           // 1 = round ball, 0 = tall teardrop
  const o2 = c.o2 ?? 21;
  const pressure = c.pressure ?? 1;
  const o2n = clamp01((o2 - 10) / 90);                      // 0 at 10% O₂ or less, 1 at 100%

  const lean = { still: 0, gentle: 12, strong: 32 }[c.airflow] ?? 0;   // degrees, wind blows left -> right
  const stretch = c.airflow === "strong" ? 1.25 : 1;

  const width = 72 + 26 * round;                           // px; round flames are a bit wider
  const height = width * (1 + 1.9 * (1 - round)) * stretch; // Earth: tall and long; space: round
  const size = 0.8 + 0.6 * Math.sqrt(o2n);                  // more oxygen = bigger (max 1.4x, so it stays in the scene)
  const blue = clamp01(0.05 + 0.75 * round + 0.2 * (1 - Math.min(1, o2n * 3)));   // low gravity / low O₂ = bluer
  const brightness = (0.75 + 0.25 * Math.min(1, 0.3 + o2n * 2)) * (0.8 + 0.2 * Math.min(pressure, 1));   // low pressure = dimmer
  const core = (0.25 + 0.75 * Math.min(1, o2n * 2)) * (1 - 0.4 * round);   // more O₂ = yellow-white core

  const vars = {
    "--fw": width + "px",
    "--fh": height.toFixed(1) + "px",
    "--size": size.toFixed(3),
    "--lean": lean + "deg",
    "--alpha": brightness.toFixed(3),
    "--blue-alpha": (0.35 + 0.6 * blue).toFixed(3),
    "--orange-alpha": (1 - 0.8 * blue).toFixed(3),
    "--core-alpha": core.toFixed(3),
    "--rt": (50 + 15 * (1 - round)).toFixed(1) + "%",      // teardrop: pointier top...
    "--rb": (50 - 15 * (1 - round)).toFixed(1) + "%",      // ...rounder bottom
    "--flicker-dur": (0.22 + 1.8 * round).toFixed(2) + "s", // Earth flickers fast, space is calm
    "--amp": (0.05 + 0.13 * (1 - round)).toFixed(3),
  };
  Object.entries(vars).forEach(([k, v]) => materialObj.style.setProperty(k, v));
}

// ---------- timeline helpers ----------
let fireTimers = [];
const later = (ms, fn) => fireTimers.push(setTimeout(fn, ms));
let fireActive = false;

// charred part of the material: 0 = none, 1 = fully burned
function setChar(amount, seconds) {
  materialObj.style.setProperty("--char-dur", seconds + "s");
  materialObj.style.setProperty("--char", amount);
}

// the last frame of each outcome (used when there is no animation, or motion is reduced)
function showFinalState(verdict, seconds = 0) {
  [flameCenter, flameLeft, flameRight].forEach(f => f.classList.remove("grow", "sputter"));
  spark.classList.remove("flash");
  const allOn = verdict === "Kept burning";
  [flameCenter, flameLeft, flameRight].forEach(f => f.classList.toggle("is-on", allOn));
  setChar({ "Kept burning": 1, "Burned, then went out": 0.45 }[verdict] || 0, seconds);
}

const RESULTS_LOADING_MS = 1000;   // how long the "Comparing your test…" step shows

// the test is done: freeze the picture and go to the results
function finishTest() {
  fireTimers.forEach(clearTimeout);
  fireTimers = [];
  materialObj.classList.add("is-done");          // flames stop flickering (CSS)
  const results = document.getElementById("results");
  results.classList.remove("hidden");
  // a short loading step while the page scrolls down, then the results fade in (CSS)
  results.classList.add("is-loading");
  setTimeout(() => results.classList.remove("is-loading"), reducedMotion.matches ? 0 : RESULTS_LOADING_MS);
  // scroll down to "Your test" + the results below it (only if the user is still on this page)
  if (document.getElementById("burn").classList.contains("active")) {
    document.getElementById("your-test-box").scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
  }
}

// stop everything and fade the fire out
function resetFire() {
  fireTimers.forEach(clearTimeout);
  fireTimers = [];
  fireActive = false;
  [flameCenter, flameLeft, flameRight].forEach(f => f.classList.remove("is-on", "grow", "sputter"));
  spark.classList.remove("flash");
  materialObj.classList.remove("is-done");
  setChar(0, 0.4);
}

// ---------- play the outcome ----------
function playFire(verdict) {
  resetFire();
  setChar(0, 0);                 // start from a clean material
  updateMaterial(conditions, true);
  setFlameLook(conditions);
  materialObj.getBoundingClientRect();   // apply the reset before starting again
  fireActive = true;

  // no animation: the Animation button is off, or the computer asks for reduced motion
  if (skipAnimation || reducedMotion.matches) {
    showFinalState(verdict);
    finishTest();
    return;
  }

  // timings in ms (kept long on purpose so people can watch what happens)
  switch (verdict) {
    case "Didn't ignite":
      spark.classList.add("flash");                   // a spark flashes...
      later(1400, () => {                              // ...tries once more, nothing catches
        spark.classList.remove("flash");
        spark.getBoundingClientRect();
        spark.classList.add("flash");
      });
      later(3000, finishTest);
      break;

    case "Went out quickly":
      flameCenter.classList.add("is-on");
      later(1800, () => flameCenter.classList.add("sputter"));   // flickers a few times
      later(4000, () => flameCenter.classList.remove("is-on"));  // then goes out
      later(5000, finishTest);
      break;

    case "Burned, then went out":
      flameCenter.classList.add("is-on");
      later(600, () => setChar(0.45, 6));              // partial char mark builds up slowly
      later(7000, () => flameCenter.classList.remove("is-on"));  // shrinks away
      later(8200, finishTest);
      break;

    case "Kept burning":
      flameCenter.classList.add("is-on");
      later(1500, () => flameCenter.classList.add("grow"));
      later(2500, () => flameLeft.classList.add("is-on"));     // spreads along the material
      later(3500, () => flameRight.classList.add("is-on"));
      later(600, () => setChar(1, 5));                         // gets darker as it burns
      later(5800, finishTest);                                 // stops once the material is charred
      break;
  }
}

// ---------- wiring ----------
document.addEventListener("rankingdone", e => playFire(e.detail.verdict));

document.addEventListener("conditionschange", e => {
  if (fireActive) resetFire();
  updateMaterial(e.detail.conditions);
});

updateMaterial(conditions);
