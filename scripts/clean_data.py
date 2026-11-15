"""
Clean NASA PSI experiment tables into ONE common table.

Reads:   Dataset/<PSI-xx_NAME>/<PSI-xx_NAME>_experiments.csv   (never modified)
Writes:  data/clean/tests.csv

Run from the project folder:
    .venv/bin/python scripts/clean_data.py

One small function per investigation. Each returns a DataFrame with the
COMMON SCHEMA columns below. Empty cell = the investigation doesn't report it.
"""

import csv
import json
import re
from pathlib import Path

import pandas as pd

# ---------------------------------------------------------------- paths
ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "Dataset"          # raw files (read only)
CLEAN = ROOT / "data" / "clean"
JS_DATA = ROOT / "js" / "data"    # data files the website loads

# ---------------------------------------------------------------- common schema
COLUMNS = [
    "investigation", "psi_id", "test_id", "fuel", "fuel_phase",
    "o2_percent", "pressure_bar", "airflow_cm_s", "gravity",
    "ignited", "burn_time_s", "extinction_type", "outcome", "notes",
]
OUTCOMES = ["Didn't ignite", "Went out quickly", "Burned, then went out", "Kept burning"]

PSI_TO_BAR = 0.0689476


# ---------------------------------------------------------------- small helpers
def read_raw(folder, filename):
    """Read a raw CSV with every cell as text (so IDs like '2-1' stay as text)."""
    path = RAW / folder / filename
    try:
        df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="utf-8-sig")
    except UnicodeDecodeError:
        # some files were saved by Excel on Windows (cp1252); there '–' shows up as '�' elsewhere
        df = pd.read_csv(path, dtype=str, keep_default_na=False, encoding="cp1252")
    df.columns = [c.strip() for c in df.columns]
    return df


MONTHS = {m: i for i, m in enumerate(
    ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], start=1)}


def fix_excel_id(text):
    """Excel turns IDs like '2-1' into dates like '1-Feb'. Turn them back."""
    text = text.strip()
    m = re.fullmatch(r"(\d{1,2})-([A-Za-z]{3})", text)
    if m and m.group(2).title() in MONTHS:
        return f"{MONTHS[m.group(2).title()]}-{int(m.group(1))}"
    return text


def first_number(text):
    """First number in a text cell: '~ 21.5' -> 21.5, '20 cm/s' -> 20.0, '145 s' -> 145.0.
    Returns None if there is no number."""
    m = re.search(r"-?\d+(?:\.\d+)?", str(text))
    return float(m.group()) if m else None


def empty_table():
    return pd.DataFrame(columns=COLUMNS)


# ================================================================ SAFFIRE-II (PSI-99)
def saffire2_outcome_ug(burn_raw, length_raw, burn_time):
    """
    OUTCOME RULE, microgravity (flight) rows:
      - Burn time 'Insignificant' and µg burn length '~ 0'      -> "Didn't ignite"
            ignited left blank: the source doesn't say if a brief flame appeared ("no sustained flame")
      - burned the full sample length (29 cm or 'Complete')       -> "Kept burning"
            (fire spread across the whole sample; extinction_type = "Fuel consumed")
      - Note 2 (composite PMMA + Nomex): PMMA part consumed,
        Nomex not ignited, so the fire stopped part-way           -> "Burned, then went out"
      - Long burn (>= 600 s), only part burned, flame still
        anchored at the base (Note 4)                             -> "Kept burning"
            (the table never says the flame went out; flagged in notes)
    Returns (outcome, ignited, extinction_type).
    """
    if burn_raw.lower() == "insignificant" and first_number(length_raw) == 0:
        return "Didn't ignite", "", ""
    if length_raw.startswith("29") or length_raw.lower().startswith("complete"):
        return "Kept burning", "Yes", "Fuel consumed"
    if "note 2" in length_raw.lower():
        return "Burned, then went out", "Yes", "Fuel consumed"
    if burn_time is not None and burn_time >= 600:
        return "Kept burning", "Yes", ""
    return "", "", ""          # no rule matched: left empty on purpose


def saffire2_outcome_1g(length_raw):
    """
    OUTCOME RULE, 1-g (Earth) comparison rows, from '1-g Burn Length':
      - 'Complete'                 -> "Kept burning"         (spread across the whole sample)
      - '~ 0'                      -> "Didn't ignite"        (ignited left blank, as above)
      - a partial length ('7.6 cm') -> "Burned, then went out"
    Returns (outcome, ignited).
    """
    text = length_raw.lower()
    if text.startswith("complete"):
        return "Kept burning", "Yes"
    if first_number(text) == 0:
        return "Didn't ignite", ""
    if first_number(text) is not None:
        return "Burned, then went out", "Yes"
    return "", ""


def clean_saffire2():
    """
    Spacecraft Fire Experiment-II: large samples burned inside a Cygnus cargo
    vehicle after it left the ISS (microgravity), forced air flow, ~ISS air.
    Each sample also has a 1-g (Earth) comparison result -> extra row "<id> (1g)".

    Column mapping (raw -> common):
      Sample Number      -> test_id      (only rows like '2-1'; skips 'F1C1/F1C2' flow-visualisation rows and 'Note n' rows)
      Material           -> fuel         (blank = same as the row above; filled and noted)
      (all samples solid) -> fuel_phase = solid
      Percent O2 (Note 1) -> o2_percent  ('~ 21.5' -> 21.5; '22.1 to 22.0' -> 22.1, the start value, range kept in notes)
      (not reported)     -> pressure_bar = empty
      Air Flow (cm/s)    -> airflow_cm_s ('20 cm/s' -> 20)
      (orbit)            -> gravity = microgravity
      Burn Time (s)      -> burn_time_s  ('145 s' -> 145; 'Insignificant' -> empty, kept in notes)
      µg Burn Length / µg Spread rate -> outcome rule + notes
      1-g Burn Length / 1-g Spread Rate -> the extra 1g rows (outcome rule + notes)
    1g rows: O2, airflow and burn time are NOT in the table for the Earth tests -> left empty.
    """
    df = read_raw("PSI-99_SAFFIRE-II", "PSI-99_SAFFIRE-II_experiments.csv")
    # the 'µ' in these headers is garbled in the raw file ('?-g ...'), so find them by ending
    ug_length_col = next(c for c in df.columns if c.endswith("g Burn Length") and not c.startswith("1-g"))
    ug_spread_col = next(c for c in df.columns if c.endswith("g Spread Length") and not c.startswith("1-g"))

    rows = []
    last_material = ""
    for _, r in df.iterrows():
        test_id = fix_excel_id(r["Sample Number"])
        if not re.fullmatch(r"\d+-\d+", test_id):      # skip note / flow-visualisation rows
            continue

        # blank material = same as the row above
        material = r["Material"].strip()
        filled = False
        if not material and last_material:
            material, filled = last_material, True
        last_material = material

        o2_raw = r["Percent O2 (Note 1)"].strip()
        burn_raw = r["Burn Time (s)"].strip()
        length_raw = r[ug_length_col].strip()
        burn_time = first_number(burn_raw)
        sample_notes = [f"Thickness: {r['Samle Thickness'].strip()}"]
        if filled:
            sample_notes.append("material filled from row above (blank in source)")

        # ---------- microgravity (flight) row ----------
        outcome, ignited, extinction = saffire2_outcome_ug(burn_raw, length_raw, burn_time)
        notes = [f"Flow: {r['Flow Direction'].strip()}"] + sample_notes + [
            f"µg burn length: {length_raw}",
            f"µg spread rate: {r[ug_spread_col].strip()}",
            "O2 derived from CO2 production (Note 1)",
        ]
        if " to " in o2_raw:
            notes.append(f"O2 changed {o2_raw}%")
        if burn_raw.lower() == "insignificant":
            notes.append("Burn time: Insignificant; no sustained flame")
        if "note 2" in length_raw.lower():
            notes.append("PMMA completely consumed, Nomex not ignited (Note 2)")
        if outcome == "Kept burning" and not extinction:
            notes.append("Flame still anchored at sample base, very slow regression (Note 4); end of burn not reported")

        rows.append({
            "investigation": "Saffire-II", "psi_id": "PSI-99", "test_id": test_id,
            "fuel": material, "fuel_phase": "solid",
            "o2_percent": first_number(o2_raw), "pressure_bar": None,
            "airflow_cm_s": first_number(r["Air Flow (cm/s)"]), "gravity": "microgravity",
            "ignited": ignited, "burn_time_s": burn_time, "extinction_type": extinction,
            "outcome": outcome, "notes": "; ".join(notes),
        })

        # ---------- 1-g (Earth) comparison row ----------
        length_1g = r["1-g Burn Length"].strip()
        outcome_1g, ignited_1g = saffire2_outcome_1g(length_1g)
        if "(nomex)" in length_1g.lower():
            # the '~ 0' refers only to the Nomex part; the PMMA part's 1-g result is unknown
            outcome_1g, ignited_1g = "", ""
        notes_1g = sample_notes + [
            f"1-g burn length: {length_1g}",
            f"1-g spread rate: {r['1-g Spread Rate'].strip()}",
            "Earth comparison test: O2, airflow and burn time not given in the table",
        ]
        if "(nomex)" in length_1g.lower():
            notes_1g.append("1-g value refers to the Nomex part only; PMMA result unknown, outcome left blank")
        if outcome_1g == "Didn't ignite":
            notes_1g.append("no sustained flame")

        rows.append({
            "investigation": "Saffire-II", "psi_id": "PSI-99", "test_id": f"{test_id} (1g)",
            "fuel": material, "fuel_phase": "solid",
            "o2_percent": None, "pressure_bar": None, "airflow_cm_s": None,
            "gravity": "normal gravity",
            "ignited": ignited_1g, "burn_time_s": None, "extinction_type": "",
            "outcome": outcome_1g, "notes": "; ".join(notes_1g),
        })
    return pd.DataFrame(rows, columns=COLUMNS)


# ================================================================ CFI-G (PSI-159)
QUICK_BURN_S = 10    # a self-extinguished CFI-G flame lasting LESS than this counts as "Went out quickly"


def cfig_outcome(hot_ignition, end, burn_time):
    """
    OUTCOME RULE (CFI-G normal flames), from 'Hot ignition', 'Self-ext or flow term', 'burn time (sec)':
      - Hot ignition 'No'                         -> "Didn't ignite"         (ignited = No)
      - Hot ignition 'Yes' + SE (self-extinguished):
            burn time < 10 s                      -> "Went out quickly"
            burn time >= 10 s                     -> "Burned, then went out"
      - Hot ignition 'Yes' + FT (flow terminated) -> "Kept burning"          (+ note "fuel flow cut by operators")
    Returns (outcome, ignited, extinction_type).
    """
    hot = hot_ignition.strip().lower()
    end = end.strip().upper()
    extinction = {"SE": "Self-extinguished", "FT": "Flow terminated"}.get(end, "")

    if hot == "no":
        return "Didn't ignite", "No", extinction
    if hot == "yes" and end == "FT":
        return "Kept burning", "Yes", extinction
    if hot == "yes" and end == "SE" and burn_time is not None:
        quick = burn_time < QUICK_BURN_S
        return ("Went out quickly" if quick else "Burned, then went out"), "Yes", extinction
    return "", "", extinction    # no rule matched: left empty on purpose


def clean_cfig():
    """
    Cool Flames Investigation with Gases, NORMAL flames only (fuel flows out of a
    spherical porous burner into an O2/N2 ambient), ISS microgravity, quiescent.
    (Inverse flames are in clean_cfig_inverse(): different setup, separate file.)

    Column mapping (raw -> common):
      Test                  -> test_id    (kept as written, e.g. '21088A1', '21088 B1')
      Fuel                  -> fuel       (e.g. '30% butane' = butane diluted to 30% in the fuel stream)
      (all gases)           -> fuel_phase = gas
      XO2 before test       -> o2_percent (ambient O2 mole fraction x 100: 0.3939 -> 39.39)
      approx p (bar)        -> pressure_bar
      (still chamber)       -> airflow_cm_s = 0  (+ note "still chamber (burner flow only)")
      (ISS)                 -> gravity = microgravity
      Hot ignition          -> ignited + outcome rule (contradictory rows, e.g. 21106 F4: outcome + ignited blank, FLAG note)
      burn time (sec)       -> burn_time_s
      Self-ext or flow term -> extinction_type (SE = Self-extinguished, FT = Flow terminated)
      Xf, mHC, Cool flame?, Comments -> notes ('Cool flame!' comments kept)
    """
    df = read_raw("PSI-159_CFI-G", "PSI-159_CFI-G_experiments_normal-flames.csv")
    rows = []
    for _, r in df.iterrows():
        test_id = fix_excel_id(r["Test"])
        if not test_id:                         # blank rows
            continue

        hot = r["Hot ignition"].strip()
        end = r["Self-ext or flow term"].strip().upper()
        burn_time = first_number(r["burn time (sec)"])
        outcome, ignited, extinction = cfig_outcome(hot, end, burn_time)
        o2_fraction = first_number(r["XO2 before test"])
        comment = r["Comments"].strip()

        notes = ["still chamber (burner flow only)",
                 f"Fuel mole fraction in burner stream (Xf): {r['Xf'].strip()}",
                 f"Fuel flow: {r['mHC (mg/s)'].strip()} mg/s"]
        if end == "FT":
            notes.append("fuel flow cut by operators")
        if r["Cool flame?"].strip():
            notes.append(f"Cool flame: {r['Cool flame?'].strip()}")
        if comment:
            notes.append(f"Comment: {comment}")
        if "direct cool" in comment.lower():
            notes.append("cool flame only, no hot flame (hidden risk)")
        # source contradicts itself: no hot ignition, yet it burned and the comment says 'hot flame'
        # -> outcome and ignited left blank
        if hot.lower() == "no" and burn_time:
            notes.append(f"FLAG: hot ignition 'No' but burn time {burn_time:g} s and end '{end}'; check source")
            outcome, ignited = "", ""

        rows.append({
            "investigation": "CFI-G", "psi_id": "PSI-159", "test_id": test_id,
            "fuel": r["Fuel"].strip(), "fuel_phase": "gas",
            "o2_percent": round(o2_fraction * 100, 2) if o2_fraction is not None else None,
            "pressure_bar": round(first_number(r["approx p (bar)"]), 3),
            "airflow_cm_s": 0, "gravity": "microgravity",       # still chamber: only the burner's own flow
            "ignited": ignited, "burn_time_s": burn_time, "extinction_type": extinction,
            "outcome": outcome, "notes": "; ".join(notes),
        })
    return pd.DataFrame(rows, columns=COLUMNS)


def clean_cfig_inverse():
    """
    CFI-G INVERSE flames: O2 flows OUT of the burner into a fuel/N2 ambient.
    XO2 here is the oxygen in the burner flow, NOT the room air, so it does not fit
    the common o2_percent column. Kept in its own file: data/clean/cfig_inverse.csv
    (+ inverse.js for the website). These are NASA's highest-oxygen microgravity tests (up to 85%).
    Blank rows (~860 at the end of the raw file) are skipped.
    """
    df = read_raw("PSI-159_CFI-G", "PSI-159_CFI-G_experiments_inverse-flames.csv")
    rows = []
    for _, r in df.iterrows():
        test_id = fix_excel_id(r["Test"])
        if not test_id:
            continue
        end = r["Self -ext or flow term"].strip().upper()
        o2 = first_number(r["XO2"])
        burn_time = first_number(r["burn time (sec)"])
        hot = r["Hot ignition"].strip().capitalize()
        # OUTCOME: same rule as the normal flames (cfig_outcome); "Flash" (a flash, no lasting flame) -> Went out quickly
        outcome = "Went out quickly" if hot == "Flash" else cfig_outcome(hot, end, burn_time)[0]
        rows.append({
            "investigation": "CFI-G", "psi_id": "PSI-159", "test_id": test_id,
            "day": r["Day"].strip(),
            "fuel": r["Fuel"].strip(),
            "ambient_fuel_fraction_before": first_number(r["Xf  before test"]),
            "ambient_fuel_fraction_after": first_number(r["Xf  after test"]),
            "burner_o2_percent": round(o2 * 100, 2) if o2 is not None else None,
            "pressure_bar": round(first_number(r["approx p (bar)"]), 3),
            "fuel_burn_rate_mg_s": first_number(r["HC burnrate (mg/s)"]),
            "o2_flow_mg_s": first_number(r["O2 flow rate (mg/s)"]),
            "adiabatic_flame_temp_k": first_number(r["Tad (K)"]),
            "hot_ignition": r["Hot ignition"].strip().capitalize(),      # Yes / No / Flash
            "burn_time_s": first_number(r["burn time (sec)"]),
            "extinction_type": {"SE": "Self-extinguished", "FT": "Flow terminated"}.get(end, ""),
            "flame_color": "" if r["Color"].strip() in ("", "-") else r["Color"].strip(),
            "comments": r["Comments"].strip(),
            "outcome": outcome,
        })
    return pd.DataFrame(rows)


# ================================================================ ACME BRE (PSI-20)
MONTHS = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7,
          "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
BRE_FUELS = {"C2H4": "ethylene", "CH4": "methane"}


def bre_fuel(text):
    """'100% C2H4' -> 'ethylene (100%)', '50% C2H4' -> 'ethylene (diluted to 50%)'."""
    m = re.match(r"\s*(\d+)\s*%\s*([A-Z0-9]+)", text)
    if not m:
        return text.strip()
    pct, formula = m.groups()
    name = BRE_FUELS.get(formula, formula)
    return f"{name} (100%)" if pct == "100" else f"{name} (diluted to {pct}%)"


def bre_o2_levels(text):
    """'21; 26.5; 40' -> [21, 26.5, 40]. Excel broke two cells: '3400%' = 34, '2100%' = 21."""
    levels = []
    for part in text.split(";"):
        part = part.strip()
        m = re.fullmatch(r"(\d+)00%", part)        # Excel turned 34 into 3400%
        value = float(m.group(1)) if m else first_number(part)
        if value is not None:
            levels.append(value)
    return levels


def clean_bre():
    """
    ACME Burning Rate Emulator: NASA's table is a DAILY SUMMARY, not one row per test:
      Year/Month/Date   -> date (YYYY-MM-DD)
      Burner Size (mm)  -> burner_mm
      Fuel Bottle       -> fuel ('100% C2H4' = pure ethylene, '50% C2H4' = diluted)
      Oxygen Conc       -> o2_levels (the levels used that day; ambient O2, diluted with N2), o2_min, o2_max
      Flames Ignited    -> flames_ignited (number of flames that ignited that day)
    Chamber pressures were varied but are not in the table. Burns gaseous fuel to emulate
    burning solids, in a still (quiescent) atmosphere.
    """
    df = read_raw("PSI-20_ACME-BRE", "PSI-20_ACME-BRE_experiments.csv")
    rows = []
    for _, r in df.iterrows():
        if not r["Year"].strip():
            continue
        month = MONTHS[r["Month"].strip().lower()[:3]]
        levels = bre_o2_levels(r["Oxygen Conc (percent)"])
        rows.append({
            "investigation": "ACME BRE", "psi_id": "PSI-20",
            "date": f"{int(r['Year']):04d}-{month:02d}-{int(r['Date']):02d}",
            "burner_mm": first_number(r["Burner Size (mm)"]),
            "fuel": bre_fuel(r["Fuel Bottle"]),
            "o2_levels": "; ".join(f"{v:g}" for v in levels),
            "o2_min": min(levels) if levels else None,
            "o2_max": max(levels) if levels else None,
            "flames_ignited": int(first_number(r["Flames Ignited"]) or 0),
        })
    return pd.DataFrame(rows)


# ================================================================ FLEX (PSI-69)
MMHG_TO_BAR = 1 / 750.06
FLEX_QUICK_S = 3     # an extinction faster than this counts as "Went out quickly"


def flex_number(text):
    """FLEX cells: '–' / '�' / blank = missing, '~6' = 6."""
    text = text.strip()
    if text in ("", "–", "-", "\ufffd"):
        return None
    return first_number(text)


def flex_outcome(test_end, burn_time):
    """
    OUTCOME RULE (FLEX), from 'Test end':
      - Completion -> "Kept burning"            (droplet burned until the fuel was fully consumed)
      - Extinction -> "Burned, then went out"   or "Went out quickly" if burn time < 3 s
      - Disruption -> "Burned, then went out"   (+ note "droplet disrupted")
    Returns (outcome, extinction_type).
    """
    end = test_end.strip().lower()
    if end == "completion":
        return "Kept burning", "Fuel consumed"
    if end == "extinction":
        quick = burn_time is not None and burn_time < FLEX_QUICK_S
        return ("Went out quickly" if quick else "Burned, then went out"), "Flame extinction"
    if end == "disruption":
        return "Burned, then went out", "Droplet disrupted"
    return "", ""


def clean_flex():
    """
    Flame Extinguishment Experiment: single fuel droplets burned in a closed
    chamber on the ISS (microgravity, still air), with N2 / CO2 / He diluents
    to study suppression.

    Column mapping (raw -> common):
      FLEX Identifier            -> test_id   (Test # kept in notes)
      Fuel                       -> fuel      (Methanol / Heptane)
      (droplets)                 -> fuel_phase = liquid
      O initial ambient ...      -> o2_percent   (O2 mole fraction x 100)
      Ambient pressure; mmHg     -> pressure_bar (mmHg / 750.06; 0 = missing)
      (still air)                -> airflow_cm_s = 0
      (ISS)                      -> gravity = microgravity
      Burn time; s               -> burn_time_s  ('~6' -> 6, noted as approximate)
      Test end                   -> outcome rule + extinction_type
      N2 / CO2 / He fractions    -> notes ("suppressant: CO2 30%" etc.)
      droplet + extinction diameter, burning rate, date -> notes
    Missing values: '–' (shows as '�' in UTF-8 tools) and blanks.
    """
    df = read_raw("PSI-69_FLEX", "PSI-69_FLEX_experiments.csv")
    o2_col = next(c for c in df.columns if c.startswith("O initial"))
    n2_col = next(c for c in df.columns if c.startswith("N initial"))
    co2_col = next(c for c in df.columns if c.startswith("CO initial"))
    he_col = next(c for c in df.columns if c.startswith("He initial"))

    rows = []
    for _, r in df.iterrows():
        test_id = fix_excel_id(r["FLEX Identifier"])
        if not test_id:
            continue

        burn_raw = r["Burn time; s"].strip()
        burn_time = flex_number(burn_raw)
        outcome, extinction = flex_outcome(r["Test end"], burn_time)

        pressure_mmhg = flex_number(r["Ambient pressure; mmHg"])
        if pressure_mmhg == 0:                       # 0 mmHg is not a real chamber pressure
            pressure_mmhg = None

        fractions = {name: flex_number(r[col]) for name, col in
                     [("O2", o2_col), ("N2", n2_col), ("CO2", co2_col), ("He", he_col)]}
        pct = lambda f: f"{f * 100:g}%"

        notes = [f"Test #{r['FLEX Test #'].strip()}", f"Date: {r['Test Date'].strip()}"]
        suppressants = [f"{name} {pct(fractions[name])}" for name in ("CO2", "He") if fractions[name]]
        if suppressants:
            notes.append("suppressant: " + ", ".join(suppressants))
        if fractions["N2"] is not None:
            notes.append(f"N2 {pct(fractions['N2'])}")
        notes.append(f"Droplet initial diameter: {r['Droplet initial diameter; mm'].strip() or 'n/a'} mm")
        notes.append(f"Flame extinction diameter: {r['Visible flame extinction diameter; mm'].strip() or 'n/a'} mm")
        notes.append(f"Burning rate: {r['Burning rate; mm'].strip() or 'n/a'}")
        if burn_raw.startswith("~"):
            notes.append(f"burn time approximate ({burn_raw})")
        if r["Ambient pressure; mmHg"].strip() == "0":
            notes.append("pressure listed as 0 in source (treated as missing)")
        if extinction == "Droplet disrupted":
            notes.append("droplet disrupted")

        rows.append({
            "investigation": "FLEX", "psi_id": "PSI-69", "test_id": test_id,
            "fuel": r["Fuel"].strip(), "fuel_phase": "liquid",
            "o2_percent": round(fractions["O2"] * 100, 2) if fractions["O2"] is not None else None,
            "pressure_bar": round(pressure_mmhg * MMHG_TO_BAR, 3) if pressure_mmhg else None,
            "airflow_cm_s": 0, "gravity": "microgravity",
            "ignited": "Yes", "burn_time_s": burn_time, "extinction_type": extinction,
            "outcome": outcome, "notes": "; ".join(notes),
        })
    return pd.DataFrame(rows, columns=COLUMNS)


# ================================================================ BASS-II (PSI-25)
def bass2_outcome(log):
    """
    OUTCOME RULE (BASS-II), keywords in the crew's flow log ('Fan display' + 'Air display'):
      - 'no ign' or 'would not stay lit'           -> "Didn't ignite"          (ignited = No)
      - 'ext' / 'extinguished' / 'blowoff'          -> "Burned, then went out"  (ignited = Yes)
            + note "extinguished when airflow changed"
      - anything else                               -> outcome left blank (not enough info)
    Returns (outcome, ignited, extinction_type).
    """
    text = log.lower()
    if "no ign" in text or "would not stay lit" in text:
        return "Didn't ignite", "No", ""
    if re.search(r"blow\s*off", text):
        return "Burned, then went out", "Yes", "Blowoff"
    if re.search(r"ext(inguish\w*)?\b|ext\s", text):
        return "Burned, then went out", "Yes", "Extinguished"
    return "", "", ""


# rows where the first number in 'Air display' is the fan reading, not the airflow;
# the real airflow is written later in the same cell
BASS2_AIRFLOW_FIX = {
    "O5b": 5,     # 'Air display: 49 5 cm/s'
    "O13a": 5,    # 'Air display: 49 44 42 41 41 40.5 (5 2 0)'
}


def clean_bass2():
    """
    Burning and Suppression of Solids II: small solid samples (PMMA films and rods,
    SIBAL cotton-fiberglass, Nomex) in a small flow duct in the ISS Microgravity
    Science Glovebox. The crew changed the airflow during each test to find the
    flow at which the flame went out.

    Column mapping (raw -> common):
      Test #                          -> test_id
      Fuel Sample Material            -> fuel  (free text, whitespace tidied, e.g. '2 cm SIBAL', '1/4" clear rod')
      (all solid samples)             -> fuel_phase = solid
      Calibrated initial O2 % by vol  -> o2_percent  (final O2 ignored: it has errors)
      (not reported)                  -> pressure_bar = empty
      Air display                     -> airflow_cm_s = first number (full sequence kept in notes)
      (ISS)                           -> gravity = microgravity
      Fan display / Air display text  -> outcome rule (keywords) + notes
    """
    df = read_raw("PSI-25_BASS-II", "PSI-25_BASS-II_experiments.csv")
    tidy = lambda t: re.sub(r"\s+", " ", t).strip()

    rows = []
    for _, r in df.iterrows():
        test_id = fix_excel_id(r["Test #"])
        if not test_id:
            continue

        fan, air = tidy(r["Fan display"]), tidy(r["Air display"])
        outcome, ignited, extinction = bass2_outcome(f"{fan} | {air}")

        # a few material cells also hold a crew comment, e.g. '2 cm Sibal moved igniter': move it to notes
        material = tidy(r["Fuel Sample Material"])
        comment = ""
        m = re.search(r"\s+(moved igniter|top side ign)$", material, re.I)
        if m:
            material, comment = material[:m.start()], m.group(1)

        notes = [f"Date: {r['Date'].strip()}", f"Air display: {air or 'n/a'}", f"Fan display: {fan or 'n/a'}"]
        if comment:
            notes.append(f"Comment: {comment}")
        if r["Flow restrictor"].strip():
            notes.append(f"Flow restrictor: {r['Flow restrictor'].strip()}")
        if outcome == "Burned, then went out":
            notes.append("extinguished when airflow changed")
        if not outcome:
            notes.append("outcome not stated in source")
        airflow = first_number(air) if air else None
        if test_id in BASS2_AIRFLOW_FIX:
            airflow = BASS2_AIRFLOW_FIX[test_id]
            notes.append(f"airflow {airflow} cm/s taken from the text (first number {first_number(air):g} is the fan reading)")

        rows.append({
            "investigation": "BASS-II", "psi_id": "PSI-25", "test_id": test_id,
            "fuel": material, "fuel_phase": "solid",
            "o2_percent": first_number(r["Calibrated  initial O2 % by vol"]),
            "pressure_bar": None,
            "airflow_cm_s": airflow,
            "gravity": "microgravity",
            "ignited": ignited, "burn_time_s": None, "extinction_type": extinction,
            "outcome": outcome, "notes": "; ".join(notes),
        })
    return pd.DataFrame(rows, columns=COLUMNS)


# ================================================================ website data
NUMBER_COLUMNS = ["o2_percent", "pressure_bar", "airflow_cm_s", "burn_time_s"]


def write_data_js(tests, path):
    """Write tests as  const TESTS = [...];  for the website (no server needed).
    Empty cells become null; number columns become numbers."""
    records = []
    for _, r in tests.iterrows():
        rec = {}
        for col in COLUMNS:
            v = r[col]
            if v is None or (isinstance(v, float) and pd.isna(v)) or v == "":
                rec[col] = None
            elif col in NUMBER_COLUMNS:
                rec[col] = float(v)
            else:
                rec[col] = str(v)
        records.append(rec)
    header = ("// GENERATED by scripts/clean_data.py from data/clean/tests.csv. Do not edit by hand.\n"
              "// Source: NASA Physical Sciences Informatics (PSI) experiment tables, cleaned.\n")
    path.write_text(header + "const TESTS = " + json.dumps(records, ensure_ascii=False, indent=1) + ";\n",
                    encoding="utf-8")


# ================================================================ SAME-R (PSI-101) -> detection.csv
# Smoke detection does not fit the burn-test schema (no ignition / outcome),
# so it gets its own table with its own columns.
DETECTION_COLUMNS = [
    "investigation", "psi_id", "test_id", "measurement", "parent_test", "sample_material",
    "description", "date", "inlet_velocity_cm_s", "heater_resistance_ratio",
    "duration_s", "primary_aging_time_s", "primary_mixing_time_s", "net_aging_time_s", "notes",
]
SAME_R_YEAR = 2010   # dates in the raw file lost their year (Excel '21-Jul'); metadata: Jul-Sep 2010


def same_r_date(text):
    """Excel turned '7/21/2010' into '21-Jul' (no year). -> '2010-07-21'."""
    m = re.fullmatch(r"(\d{1,2})-([A-Za-z]{3})", text.strip())
    if m and m.group(2).title() in MONTHS:
        return f"{SAME_R_YEAR}-{MONTHS[m.group(2).title()]:02d}-{int(m.group(1)):02d}"
    return text.strip()


def clean_same_r():
    """
    Smoke Aerosol Measurement Experiment - Reflight: spacecraft materials heated
    (not burned) to make smoke; the smoke particles were measured for smoke-detector design.

    Column mapping (raw -> detection.csv):
      SAME Test #            -> test_id
         'a' rows (e.g. '51a') are aged follow-up measurements of the same smoke sample:
         measurement = 'aged follow-up', parent_test = '51'; other rows: measurement = 'smoke generation'
      Sample Type            -> sample_material  (Kapton, Silicone, Lampwick, Pyrell, Teflon)
      Description            -> description      (whitespace tidied, wording kept)
      Date                   -> date             ('21-Jul' -> 2010-07-21; year from the metadata, Excel removed it)
      Inlet velocity (cm/s)  -> inlet_velocity_cm_s
      Rt/R0                  -> heater_resistance_ratio (heater wire resistance hot/cold, a proxy for heater temperature)
      Duration (sec)         -> duration_s
      Primary aging / mixing / Net aging time (sec) -> *_s   ('n/a' -> empty)
    """
    df = read_raw("PSI-101_SAME-R", "PSI-101_SAME-R_experiments.csv")
    num = lambda t: None if t.strip().lower() in ("", "n/a", "na", "-") else first_number(t)

    rows = []
    for _, r in df.iterrows():
        test_id = r["SAME Test #"].strip()
        if not test_id:
            continue
        aged = bool(re.fullmatch(r"\d+a", test_id))
        rows.append({
            "investigation": "SAME-R", "psi_id": "PSI-101", "test_id": test_id,
            "measurement": "aged follow-up" if aged else "smoke generation",
            "parent_test": test_id[:-1] if aged else "",
            "sample_material": r["Sample Type"].strip(),
            "description": re.sub(r"\s+", " ", r["Description"]).strip(),
            "date": same_r_date(r["Date"]),
            "inlet_velocity_cm_s": num(r["Inlet velocity (cm/s)"]),
            "heater_resistance_ratio": num(r["Rt/R0"]),
            "duration_s": num(r["Duration (sec)"]),
            "primary_aging_time_s": num(r["Primary aging time (sec)"]),
            "primary_mixing_time_s": num(r["Primary mixing time (sec)"]),
            "net_aging_time_s": num(r["Net aging time (sec)"]),
            "notes": "date year taken from metadata (Excel removed it)",
        })
    return pd.DataFrame(rows, columns=DETECTION_COLUMNS)


# ================================================================ BASS (PSI-26) -> bass_tests.csv
# The first BASS (2012-13). NASA's table lists only date, test numbers and the sample:
# no oxygen, airflow or outcome per test, so it is NOT in tests.csv / the "Will It Burn?" ranking.
BASS_COLUMNS = ["investigation", "psi_id", "test_id", "as_run_order", "date", "sample_number",
                "material", "shape", "sample_raw", "notes"]


def bass_material(text):
    """Raw sample name -> (material, shape). Unclear names are NOT guessed:
    '2 cm sphere' does not say what it is made of -> 'Material not stated'."""
    t = text.lower()
    if "pmma" in t:
        material = "PMMA (acrylic plastic)"
    elif "sibal" in t:
        material = "SIBAL (cotton-fiberglass fabric)"
    elif "nomex" in t:
        material = "Nomex fabric"
    elif "ultem" in t:
        material = "Ultem sheet"
    elif "wax" in t or "candle" in t:
        material = "Wax (candle or slab)"
    else:
        material = "Material not stated"
    if "sphere" in t:
        shape = "sphere"
    elif "slab" in t or "sheet" in t:
        shape = "slab / sheet"
    elif "candle" in t:
        shape = "candle"
    elif "sibal" in t or "nomex" in t:
        shape = "fabric strip"
    elif "pmma" in t:
        shape = "rod / cylinder (shape not stated)"
    else:
        shape = ""
    return material, shape


def bass_date(text):
    """'3/30/2012' -> '2012-03-30'. Two typos in the raw file:
    '6/29/`12' -> 2012-06-29, and '5/15/2103' -> 2013-05-15 (same GMT day 135 as the next rows, dated 5/15/2013)."""
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/`?(\d{2}|\d{4})", text.strip())
    if not m:
        return text.strip()
    year = int(m.group(3)) + (2000 if len(m.group(3)) == 2 else 0)
    if year == 2103:
        year = 2013
    return f"{year}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"


def clean_bass1():
    """
    Burning and Suppression of Solids (BASS), PSI-26. Column mapping (raw -> bass_tests.csv):
      Test #                -> test_id        (the planned test number, e.g. '53a')
      As Run Test #         -> as_run_order   (order in which tests were run)
      Date                  -> date           (YYYY-MM-DD; '6/29/`12' typo fixed)
      Sample #              -> sample_number
      Fuel Sample Material  -> sample_raw (as written), material + shape (grouped, see bass_material)
    Dropped: the row 'SOOT Cleaning' (8/3/2012, no test number): a maintenance step, not a test.
    Words like 'wake' and 'opposed flow' in the sample name are kept in notes.
    """
    df = read_raw("PSI-26_BASS", "PSI-26_BASS_experiments.csv")
    rows = []
    for _, r in df.iterrows():
        raw = re.sub(r"\s+", " ", r["Fuel Sample Material"]).strip()
        if raw.lower() == "soot cleaning":
            continue
        material, shape = bass_material(raw)
        notes = []
        if "wake" in raw.lower():
            notes.append("wake flame (burning behind another object)")
        if "oppos" in raw.lower():
            notes.append("opposed flow")
        if "`" in r["Date"] or "2103" in r["Date"]:
            notes.append("date typo in the raw file fixed")
        rows.append({
            "investigation": "BASS", "psi_id": "PSI-26",
            "test_id": r["Test #"].strip(), "as_run_order": first_number(r["As Run Test #"]),
            "date": bass_date(r["Date"]), "sample_number": r["Sample #"].strip(),
            "material": material, "shape": shape, "sample_raw": raw, "notes": "; ".join(notes),
        })
    df = pd.DataFrame(rows, columns=BASS_COLUMNS)
    # '2 cm sphere' rows: if the SAME sample number is named with its material on another row
    # (e.g. sample 26 = '2 cm pmma sphere'), use that material - NASA's own table says it, no guessing
    named = (df[df["material"] != "Material not stated"]
             .groupby("sample_number")["material"].agg(lambda m: m.unique().tolist()))
    for i, r in df[df["material"] == "Material not stated"].iterrows():
        known = named.get(r["sample_number"], [])
        if len(known) == 1:
            df.at[i, "material"] = known[0]
            df.at[i, "notes"] = "; ".join(filter(None, [r["notes"],
                f"material from other rows of sample #{r['sample_number']}"]))
    return df


# ================================================================ SPICE (PSI-107) -> spice_runs.csv
# Smoke Point In Co-flow Experiment: gas jet flames on the ISS, fuel flow raised until the flame
# starts to emit soot (the "smoke point"). No burn/no-burn outcome and no oxygen/pressure per run,
# so it is NOT in tests.csv / the "Will It Burn?" ranking.
SPICE_COLUMNS = ["investigation", "psi_id", "run", "gmt_day", "ignition_gmt", "flame_off_gmt",
                 "fuel", "nozzle_mm", "fuel_rate_sccm", "fuel_rate_mg_s", "hc_fuel_rate_mg_s",
                 "air_coflow_cm_s", "fuel_raw", "notes"]


def spice_fuel(text):
    """'75 % Propylene' / '75% Propylene' -> '75% propylene'; 'Ethylene' -> 'ethylene'."""
    t = re.sub(r"\s*%\s*", "% ", text.strip()).lower()
    return re.sub(r"\s+", " ", t)


def clean_spice():
    """
    SPICE, PSI-107. Column mapping (raw -> spice_runs.csv), values kept exactly as recorded:
      GMT date            -> gmt_day   (day of the year; the year is not given)
      GMT ignition / Flame Off -> ignition_gmt / flame_off_gmt
      Fuel                -> fuel ('75 % Propylene' and '75% Propylene' written the same way), fuel_raw
      Nozzle (mm)         -> nozzle_mm
      Fuel Rate (sccm / mg/s), HC Fuel Rate (mg/s) -> fuel_rate_sccm, fuel_rate_mg_s, hc_fuel_rate_mg_s
      Air Rate (cm/s)     -> air_coflow_cm_s (NASA's description: co-flow 5.4-65 cm/s; a few readings
                             fall outside that range, e.g. 66-85 or about 0 cm/s, and are kept as recorded)
    Each table row is one run (some rows repeat exactly; all are kept, numbered 1..N).
    """
    df = read_raw("PSI-107_SPICE", "PSI-107_SPICE_experiments.csv")
    num = lambda t: None if not str(t).strip() else first_number(t)
    rows = []
    for i, r in enumerate(df.to_dict("records"), start=1):
        air = num(r["Air Rate (cm/s)"])
        notes = "air speed outside NASA's stated 5.4-65 cm/s range" if air is not None and not (5.4 <= air <= 65) else ""
        rows.append({
            "investigation": "SPICE", "psi_id": "PSI-107", "run": i,
            "gmt_day": num(r["GMT date"]), "ignition_gmt": r["GMT ignition"].strip(),
            "flame_off_gmt": r["GMT  Flame Off"].strip(),
            "fuel": spice_fuel(r["Fuel"]), "nozzle_mm": num(r["Nozzle (mm)"]),
            "fuel_rate_sccm": num(r["Fuel Rate (sccm)"]), "fuel_rate_mg_s": num(r["Fuel Rate (mg/s)"]),
            "hc_fuel_rate_mg_s": num(r["HC Fuel Rate (mg/s)"]), "air_coflow_cm_s": air,
            "fuel_raw": r["Fuel"].strip(), "notes": notes,
        })
    return pd.DataFrame(rows, columns=SPICE_COLUMNS)


# ================================================================ investigations (metadata)
# folder in Dataset/  ->  investigation name used everywhere else (tests.csv, website)
INVESTIGATION_FOLDERS = {
    "Saffire-II": "PSI-99_SAFFIRE-II",
    "CFI-G": "PSI-159_CFI-G",
    "FLEX": "PSI-69_FLEX",
    "BASS-II": "PSI-25_BASS-II",
    "SAME-R": "PSI-101_SAME-R",
    "ACME BRE": "PSI-20_ACME-BRE",
    "BASS": "PSI-26_BASS",
    "SPICE": "PSI-107_SPICE",
}

# NASA fire-safety pillar for each investigation. NOT in the metadata: our own judgement.
PILLARS = {
    "Saffire-II": "Prevention",    # how fast large fires grow; flammability of real spacecraft materials
    "CFI-G": "Prevention",         # flammability limits of gases, incl. cool flames (hidden ignition hazard)
    "FLEX": "Suppression",         # putting out fuel droplets with CO2 / He / N2 diluents
    "BASS-II": "Prevention",       # material flammability & extinction limits vs airflow (NASA-STD-6001 gap)
    "SAME-R": "Detection",         # smoke particle sizes for smoke detectors
    "ACME BRE": "Prevention",      # flammability of (emulated) solid materials in still air
    "BASS": "Prevention",          # first BASS: flammability of real solid materials vs airflow (before BASS-II)
    "SPICE": "Detection",          # smoke point: when flames start to emit soot (smoke) -> what detectors must sense
}

INVESTIGATION_COLUMNS = [
    "investigation", "psi_id", "title", "doi", "objective", "approach", "hypothesis",
    "research_impacts", "start_date", "end_date", "platform", "pillar", "n_tests",
    "hardware", "hardware_link",
]


def read_metadata(folder):
    """Read an ISA-Tab i_Investigation.txt into {field name: first non-empty value}.
    Values can be quoted and span several lines, so use the csv module (tab separated)."""
    path = next((RAW / folder).glob("*_metadata.txt"))
    with open(path, encoding="utf-8-sig", newline="") as f:
        rows = list(csv.reader(f, delimiter="\t"))
    fields = {}
    for row in rows:
        if not row:
            continue
        values = [v for v in row[1:] if v.strip()]
        fields.setdefault(row[0].strip(), values[0] if values else "")
    return fields


def tidy_text(text):
    """Trim each line, drop empty lines, keep line breaks (some fields are numbered lists)."""
    lines = [re.sub(r"\s+", " ", line).strip() for line in str(text).splitlines()]
    return "\n".join(line for line in lines if line)


def iso_date(text):
    """'09-30-2016' (MM-DD-YYYY) -> '2016-09-30'. Empty stays empty."""
    m = re.fullmatch(r"(\d{2})-(\d{2})-(\d{4})", text.strip())
    return f"{m.group(3)}-{m.group(1)}-{m.group(2)}" if m else text.strip()


def build_investigations(tests, detection=None, bre=None, bass=None, spice=None):
    """
    One row per investigation, from its metadata file (i_Investigation.txt):
      Study Identifier              -> psi_id
      Study Title                   -> title
      Comment[DOI]                  -> doi   (the PSI dataset DOI, e.g. 10.60555/2chp-m469)
      Comment[Objective / Approach / Hypothesis / Research Impacts] -> text columns
      Comment[Investigation Start / End Date] -> start_date / end_date (YYYY-MM-DD)
      Comment[Flight Platform]      -> platform
      Comment[Experiment Hardware (Link)] -> hardware, hardware_link (first link only)
      PILLARS (above)               -> pillar
      rows in tests.csv / detection.csv -> n_tests
    """
    rows = []
    for name, folder in INVESTIGATION_FOLDERS.items():
        meta = read_metadata(folder)
        if name == "SAME-R":
            n_tests = len(detection) if detection is not None else None   # all SAME-R rows, incl. aged follow-ups
        elif name == "ACME BRE":
            n_tests = int(bre["flames_ignited"].sum()) if bre is not None else None   # flames ignited over all days
        elif name == "BASS":
            n_tests = len(bass) if bass is not None else None      # tests listed in NASA's table
        elif name == "SPICE":
            n_tests = len(spice) if spice is not None else None    # flame runs (rows) in NASA's table
        else:
            n_tests = int((tests["investigation"] == name).sum())
        rows.append({
            "investigation": name,
            "psi_id": meta.get("Study Identifier", ""),
            "title": tidy_text(meta.get("Study Title", "")),
            "doi": meta.get("Comment[DOI]", "").strip(),
            "objective": tidy_text(meta.get("Comment[Objective]", "")),
            "approach": tidy_text(meta.get("Comment[Approach]", "")),
            "hypothesis": tidy_text(meta.get("Comment[Hypothesis]", "")),
            "research_impacts": tidy_text(meta.get("Comment[Research Impacts]", "")),
            "start_date": iso_date(meta.get("Comment[Investigation Start Date]", "")),
            "end_date": iso_date(meta.get("Comment[Investigation End Date]", "")),
            "platform": meta.get("Comment[Flight Platform]", "").strip(),
            "hardware": tidy_text(meta.get("Comment[Experiment Hardware]", "")),
            "hardware_link": meta.get("Comment[Experiment Hardware Link]", "").split(",")[0].strip(),
            "pillar": PILLARS[name],
            "n_tests": n_tests,
        })
    df = pd.DataFrame(rows, columns=INVESTIGATION_COLUMNS)
    df["n_tests"] = df["n_tests"].astype("Int64")      # whole numbers
    return df


def write_js(records, var_name, path, source):
    """Write a list of dicts as  const NAME = [...];  (empty values -> null)."""
    def plain(v):
        if v is None or v is pd.NA or (isinstance(v, float) and pd.isna(v)) or v == "":
            return None
        return v.item() if hasattr(v, "item") else v        # numpy/pandas number -> plain Python number
    clean = [{k: plain(v) for k, v in rec.items()} for rec in records]
    header = (f"// GENERATED by scripts/clean_data.py from {source}. Do not edit by hand.\n"
              "// Source: NASA Physical Sciences Informatics (PSI), cleaned.\n")
    path.write_text(header + f"const {var_name} = " + json.dumps(clean, ensure_ascii=False, indent=1) + ";\n",
                    encoding="utf-8")


# ================================================================ original tables for the website
# investigation -> raw files in Dataset/ (CFI-G has two tables)
RAW_TABLE_FILES = {
    "Saffire-II": [("Tests", "PSI-99_SAFFIRE-II", "PSI-99_SAFFIRE-II_experiments.csv")],
    "CFI-G": [("Normal flames", "PSI-159_CFI-G", "PSI-159_CFI-G_experiments_normal-flames.csv"),
              ("Inverse flames", "PSI-159_CFI-G", "PSI-159_CFI-G_experiments_inverse-flames.csv")],
    "FLEX": [("Tests", "PSI-69_FLEX", "PSI-69_FLEX_experiments.csv")],
    "BASS-II": [("Tests", "PSI-25_BASS-II", "PSI-25_BASS-II_experiments.csv")],
    "SAME-R": [("Measurements", "PSI-101_SAME-R", "PSI-101_SAME-R_experiments.csv")],
    "ACME BRE": [("Daily summaries", "PSI-20_ACME-BRE", "PSI-20_ACME-BRE_experiments.csv")],
    "BASS": [("Tests", "PSI-26_BASS", "PSI-26_BASS_experiments.csv")],
    "SPICE": [("Flame runs", "PSI-107_SPICE", "PSI-107_SPICE_experiments.csv")],
}


def write_raw_tables_js(path):
    """Every original table as  { investigation: [ {label, file, columns, rows}, ... ] }, cells as text, unchanged
    (only completely empty rows are skipped)."""
    out = {}
    for name, tables in RAW_TABLE_FILES.items():
        out[name] = []
        for label, folder, filename in tables:
            df = read_raw(folder, filename)
            rows = [list(r) for r in df.itertuples(index=False) if any(str(v).strip() for v in r)]
            out[name].append({"label": label, "file": filename, "columns": list(df.columns), "rows": rows})
    header = ("// GENERATED by scripts/clean_data.py from the raw files in Dataset/ (unchanged). Do not edit by hand.\n"
              "// Source: NASA Physical Sciences Informatics (PSI) experiment tables, as published.\n")
    path.write_text(header + "const RAW_TABLES = " + json.dumps(out, ensure_ascii=False) + ";\n", encoding="utf-8")


# ================================================================ main
def main():
    tables = [
        clean_saffire2(),
        clean_cfig(),
        clean_flex(),
        clean_bass2(),
        # not in tests.csv: CFI-G inverse (own file + inverse.js), SAME-R (detection), ACME BRE (daily summary + bre.js),
        # BASS (bass.js) and SPICE (spice.js): no per-test conditions/outcomes
    ]
    tests = pd.concat(tables, ignore_index=True)

    # sanity check: outcome must be one of the four allowed values (or empty)
    bad = tests[~tests["outcome"].isin(OUTCOMES + [""])]
    if len(bad):
        raise ValueError(f"Unexpected outcome values:\n{bad[['investigation', 'test_id', 'outcome']]}")

    CLEAN.mkdir(parents=True, exist_ok=True)
    tests.to_csv(CLEAN / "tests.csv", index=False)
    print(f"Wrote {len(tests)} tests -> {CLEAN / 'tests.csv'}")

    # side tables that don't fit the common schema
    inverse = clean_cfig_inverse()
    inverse.to_csv(CLEAN / "cfig_inverse.csv", index=False)
    write_js(inverse.astype(object).to_dict("records"), "INVERSE_TESTS",
             JS_DATA / "inverse.js", "data/clean/cfig_inverse.csv")
    print(f"Wrote {len(inverse)} CFI-G inverse-flame tests -> {CLEAN / 'cfig_inverse.csv'} and inverse.js")

    bre = clean_bre()
    bre.to_csv(CLEAN / "bre_days.csv", index=False)
    write_js(bre.astype(object).to_dict("records"), "BRE_DAYS", JS_DATA / "bre.js", "data/clean/bre_days.csv")
    print(f"Wrote {len(bre)} ACME BRE days ({bre['flames_ignited'].sum()} flames) -> {CLEAN / 'bre_days.csv'} and bre.js")

    # website data (data.js next to index.html)
    write_data_js(tests, JS_DATA / "data.js")
    print(f"Wrote {len(tests)} tests -> {JS_DATA / 'data.js'}")

    # SAME-R smoke detection -> its own table
    detection = clean_same_r()
    detection.to_csv(CLEAN / "detection.csv", index=False)
    write_js(detection.astype(object).to_dict("records"), "DETECTION_TESTS",
             JS_DATA / "detection.js", "data/clean/detection.csv")
    print(f"Wrote {len(detection)} SAME-R measurements -> {CLEAN / 'detection.csv'} and detection.js")

    # BASS (first) and SPICE: tables without per-test conditions/outcomes -> own tables (cards only)
    bass = clean_bass1()
    bass.to_csv(CLEAN / "bass_tests.csv", index=False)
    write_js(bass.astype(object).to_dict("records"), "BASS_TESTS", JS_DATA / "bass.js", "data/clean/bass_tests.csv")
    print(f"Wrote {len(bass)} BASS tests -> {CLEAN / 'bass_tests.csv'} and bass.js")

    spice = clean_spice()
    spice.to_csv(CLEAN / "spice_runs.csv", index=False)
    write_js(spice.astype(object).to_dict("records"), "SPICE_RUNS", JS_DATA / "spice.js", "data/clean/spice_runs.csv")
    print(f"Wrote {len(spice)} SPICE flame runs -> {CLEAN / 'spice_runs.csv'} and spice.js")

    # the ORIGINAL NASA tables, unchanged, so the website can show them next to the cleaned ones
    write_raw_tables_js(JS_DATA / "raw_tables.js")
    print(f"Wrote the original NASA tables -> {JS_DATA / 'raw_tables.js'}")

    # investigations (metadata) -> csv + js for the website
    investigations = build_investigations(tests, detection, bre, bass, spice)
    investigations.to_csv(CLEAN / "investigations.csv", index=False)
    write_js(investigations.astype(object).to_dict("records"), "INVESTIGATIONS",
             JS_DATA / "investigations.js", "data/clean/investigations.csv")
    print(f"Wrote {len(investigations)} investigations -> {CLEAN / 'investigations.csv'} and investigations.js")
    return tests


if __name__ == "__main__":
    main()
