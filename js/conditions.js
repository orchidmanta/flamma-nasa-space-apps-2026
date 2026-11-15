// ================= Conditions (the 5 controls) =================
// Holds the current scenario in one object (`conditions`).
// Whenever anything changes, it fires a "conditionschange" event on document,
// so other parts of the page (the scene, later the ranking) can react.

// null / "any" means "I don't know": the ranking will ignore it.
const conditions = {
  o2: null,          // number, 0–100 (%)
  pressure: null,    // number, 0–5 (bar)
  phase: "any",      // "any" | "solid" | "liquid" | "gas"
  material: "any",   // e.g. "fabric" (see MATERIALS)
  airflow: "any",    // "any" | "still" | "gentle" | "strong"
  gravity: "any",    // "any" | "station" | "moon" | "mars" | "earth"
};

// materials available for each fuel type
const MATERIALS = {
  solid: [
    { value: "fabric", label: "Fabric" },
    { value: "pmma", label: "Plastic (PMMA)" },
    { value: "silicone", label: "Silicone" },
    { value: "nomex", label: "Nomex" },
  ],
  liquid: [{ value: "droplet", label: "Fuel droplet" }],
  gas: [{ value: "leak", label: "Gas leak" }],
};

// readable labels (used by the caption, later by the results)
const LABELS = {
  gravity: { station: "Space station", moon: "Moon", mars: "Mars", earth: "Earth" },
  airflow: { still: "Still air", gentle: "Gentle airflow", strong: "Strong fan" },
  phase: { solid: "Any solid", liquid: "Any liquid", gas: "Any gas" },
};

function materialLabel(value) {
  for (const list of Object.values(MATERIALS)) {
    const found = list.find(m => m.value === value);
    if (found) return found.label;
  }
  return value;
}

// tell the rest of the page that something changed
function conditionsChanged(changedKey) {
  document.dispatchEvent(new CustomEvent("conditionschange", {
    detail: { conditions, changed: changedKey },
  }));
}

// ================= sliders (oxygen, pressure) =================
// Every value on the slider is a real value (oxygen 0–100 %, pressure 0–5 bar).
// "Any" (unknown) is a separate tick box on the left; moving the slider unticks it.
const SLIDERS = {
  o2:       { step: "1",    unit: "percent", format: v => String(Math.round(v)) },
  pressure: { step: "0.01", unit: "bar",     format: v => Number(v).toFixed(2).replace(/0$/, "") },  // 1.0, 0.75, 0.71
};

// show the value, colour the track and set the tick box. Used by the user and quick picks.
function showSliderValue(key) {
  const input = document.getElementById(key);
  const min = Number(input.min), max = Number(input.max), value = Number(input.value);
  const isAny = conditions[key] === null;
  const text = isAny ? "Any" : SLIDERS[key].format(value);

  input.style.setProperty("--fill", isAny ? "0%" : ((value - min) / (max - min)) * 100 + "%");
  input.setAttribute("aria-valuetext", isAny ? "Any (unknown)" : `${text} ${SLIDERS[key].unit}`);
  document.getElementById(key + "-value").textContent = text;
  document.getElementById(key + "-any").checked = isAny;
  document.getElementById("cond-" + key).classList.toggle("is-any", isAny);
}

// running slider animations (from quick picks), so they can be cancelled or finished early
const sliderAnimations = {};
const sliderTargets = {};   // where each running animation is heading
function stopSliderAnimation(key) {
  cancelAnimationFrame(sliderAnimations[key]);
  delete sliderTargets[key];
  document.getElementById(key).step = SLIDERS[key].step;
}

// set a slider from code or user. value = null means "Any" (the thumb stays where it was, greyed out)
function setSlider(key, value) {
  const input = document.getElementById(key);
  if (value !== null) input.value = value;
  conditions[key] = value === null ? null : Number(input.value);
  showSliderValue(key);
  conditionsChanged(key);
}

Object.keys(SLIDERS).forEach(key => {
  // moving the slider = a real value (and "Any" gets unticked)
  document.getElementById(key).addEventListener("input", e => {
    stopSliderAnimation(key);   // the user grabbed it mid-animation
    setSlider(key, Number(e.target.value));
  });
  // ticking "Any" = unknown; unticking it = use the value the slider shows
  document.getElementById(key + "-any").addEventListener("change", e => {
    stopSliderAnimation(key);
    setSlider(key, e.target.checked ? null : Number(document.getElementById(key).value));
  });

  showSliderValue(key);
});

// ================= button groups (fuel type, airflow, gravity) =================
function setChoice(key, value) {
  conditions[key] = value;
  document.querySelectorAll(`[data-condition="${key}"] button`).forEach(btn => {
    btn.setAttribute("aria-pressed", String(btn.dataset.value === value));
  });
  if (key === "phase") fillMaterials();
  conditionsChanged(key);
}

document.querySelectorAll("[data-condition]").forEach(group => {
  group.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", () => setChoice(group.dataset.condition, btn.dataset.value));
  });
});

// ================= material dropdown =================
const materialSelect = document.getElementById("material");

// rebuild the dropdown for the chosen fuel type
function fillMaterials() {
  const list = MATERIALS[conditions.phase] || [];
  materialSelect.innerHTML =
    `<option value="any">Any material</option>` +
    list.map(m => `<option value="${m.value}">${m.label}</option>`).join("");
  materialSelect.disabled = list.length === 0;

  // liquid and gas only have one choice, so pick it straight away
  conditions.material = list.length === 1 ? list[0].value : "any";
  materialSelect.value = conditions.material;
}

materialSelect.addEventListener("change", () => {
  conditions.material = materialSelect.value;
  conditionsChanged("material");
});

// ================= open / close the conditions panel =================
// The scene uses the full width; the panel pops up over it.
// Flow: "Set conditions" -> choose -> "Will it burn?" (panel closes, animation plays big)
//       -> "New test" on the result badge (fire.js) opens it again.
const stage = document.querySelector(".stage");
const panelOpenBtn = document.getElementById("panel-open");     // small "Conditions" button in the corner
const panelCloseBtn = document.getElementById("panel-close");   // x in the panel
const sceneCtaBtn = document.getElementById("scene-cta");        // big "Set conditions" in the empty scene

function setPanelOpen(open) {
  stage.classList.toggle("panel-closed", !open);
  [panelOpenBtn, panelCloseBtn, sceneCtaBtn].forEach(b => b.setAttribute("aria-expanded", String(open)));
  // move keyboard focus to a button that is visible now (preventScroll: don't jump the page).
  // A moment later, because the panel is still invisible for a split second while it appears.
  setTimeout(() => (open ? panelCloseBtn : panelOpenBtn).focus({ preventScroll: true }), 50);
}

panelCloseBtn.addEventListener("click", () => setPanelOpen(false));
panelOpenBtn.addEventListener("click", () => setPanelOpen(true));
sceneCtaBtn.addEventListener("click", () => setPanelOpen(true));

// jump any gliding slider straight to its end value
function finishSliderAnimations() {
  Object.keys(sliderTargets).forEach(key => {
    const target = sliderTargets[key];
    stopSliderAnimation(key);
    setSlider(key, target);
  });
}

// ================= Animation on / off =================
// Off: the scene is hidden, the conditions are shown on the page, and
// "Will it burn?" goes straight to the results (quick access, e.g. for researchers).
// On (default): the animated scene plays the test. fire.js reads skipAnimation.
// The choice is remembered in this browser.
const animToggle = document.getElementById("anim-toggle");
let skipAnimation = true;

function setAnimation(on) {
  skipAnimation = !on;
  animToggle.checked = on;
  stage.classList.toggle("conditions-only", !on);
  stage.classList.toggle("panel-closed", on);     // no animation: the conditions are always shown
  try { localStorage.setItem("flamma-show-animation", on ? "1" : "0"); } catch {}
}

animToggle.addEventListener("change", () => setAnimation(animToggle.checked));
try { setAnimation(localStorage.getItem("flamma-show-animation") !== "0"); } catch { setAnimation(true); }   // on unless switched off

// "Will it burn?" closes the panel so the animation has the whole scene
// (if nothing is set, the panel stays open: the results area asks for a condition)
// It also finishes a quick pick's slider glide first: every glide step is a condition change,
// and a condition change would stop the fire animation that is about to start.
// (This listener runs before the ranking in app.js, because conditions.js loads first.)
document.getElementById("run-btn").addEventListener("click", () => {
  finishSliderAnimations();
  if (!nothingSet(conditions) && !skipAnimation) setPanelOpen(false);   // nothingSet() is in scene.js
});

// Escape closes the panel
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && !skipAnimation && !stage.classList.contains("panel-closed")) setPanelOpen(false);
});

// ================= quick picks =================
// One click fills oxygen, pressure, airflow and gravity.
// Presets never change the material: that stays as the user set it.
const PRESETS = {
  earth: { o2: 21,  pressure: 1.0, airflow: "still",  gravity: "earth" },
  moon:  { o2: 34,  pressure: 0.7, airflow: "gentle", gravity: "moon" },
  suit:  { o2: 100, pressure: 0.3, airflow: "still",  gravity: "station" },
  iss:   { o2: 21,  pressure: 1.0, airflow: "gentle", gravity: "station" },   // ISS: Earth-like air, fans always running
  // Moon base / rovers: NASA expects "30% oxygen or greater, at 10.2 psi (~0.70 bar) or less" (challenge brief)
  rover: { o2: 30,  pressure: 0.7, airflow: "gentle", gravity: "moon" },
  // Mars base: no NASA figure yet; assumed like the Moon base / rover atmosphere, with Mars gravity
  mars:  { o2: 30,  pressure: 0.7, airflow: "gentle", gravity: "mars" },
};

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// glide a slider to a new value instead of jumping
function animateSlider(key, target, duration = 600) {
  const input = document.getElementById(key);
  stopSliderAnimation(key);
  if (reducedMotion.matches) { setSlider(key, target); return; }

  const from = Number(input.value);   // start from where the thumb is (also when it was "Any")
  sliderTargets[key] = target;
  const start = performance.now();
  input.step = "any";   // so the thumb moves smoothly, not in steps

  function frame() {
    const t = Math.min(1, (performance.now() - start) / duration);
    const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;  // ease in-out
    if (t < 1) {
      setSlider(key, from + (target - from) * eased);
      sliderAnimations[key] = requestAnimationFrame(frame);
    } else {
      stopSliderAnimation(key);   // restores the normal step
      setSlider(key, target);
    }
  }
  sliderAnimations[key] = requestAnimationFrame(frame);
}

// highlight one chip (or none)
function setActiveChip(name) {
  document.querySelectorAll(".chip[data-preset]").forEach(chip => {
    chip.setAttribute("aria-pressed", String(chip.dataset.preset === name));
  });
  if (typeof updateScene === "function") updateScene(conditions);   // refresh the place label in the scene
}

function applyPreset(name) {
  const p = PRESETS[name];
  animateSlider("o2", p.o2);
  animateSlider("pressure", p.pressure);
  setChoice("airflow", p.airflow);
  setChoice("gravity", p.gravity);
  setActiveChip(name);
  showConditions();
}

// after a quick pick: open the conditions so the user sees what it set
function showConditions() {
  if (stage.classList.contains("panel-closed")) setPanelOpen(true);   // animation on: the panel was closed
  else {                                                              // animation off: the panel is on the page
    const panel = document.querySelector(".panel");
    const r = panel.getBoundingClientRect();
    if (r.top > window.innerHeight * 0.6) panel.scrollIntoView({ behavior: reducedMotion.matches ? "auto" : "smooth", block: "start" });
  }
}

document.querySelectorAll(".chip[data-preset]").forEach(chip => {
  chip.addEventListener("click", () => applyPreset(chip.dataset.preset));

  // hover / keyboard-focus tooltip with the values this quick pick sets, built from PRESETS
  // (so it always matches), e.g. "34% O₂ · 0.7 bar · Gentle airflow · Moon"
  const p = PRESETS[chip.dataset.preset];
  const tip = `${p.o2}% O₂ · ${SLIDERS.pressure.format(p.pressure)} bar · ${LABELS.airflow[p.airflow]} · ${LABELS.gravity[p.gravity]}`;
  chip.dataset.tip = tip;
  chip.insertAdjacentHTML("beforeend", `<span class="visually-hidden">: ${tip}</span>`);   // for screen readers
});

// Changing any condition by hand deselects the chip.
// (Code-driven changes don't fire these events, so presets don't deselect themselves.)
const panelBody = document.querySelector(".panel-body");
panelBody.addEventListener("input", () => setActiveChip(null));
panelBody.addEventListener("click", e => {
  if (e.target.closest("button")) setActiveChip(null);
});

// Home's "Try Will It Burn?" buttons: open Will It Burn? with that quick pick already chosen (e.g. ISS cabin)
document.querySelectorAll("[data-try-preset]").forEach(link => link.addEventListener("click", () => {
  setTimeout(() => applyPreset(link.dataset.tryPreset), 0);   // after the page has switched to Will It Burn?
}));
