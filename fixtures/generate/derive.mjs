#!/usr/bin/env node
// Offline derive pipeline: parses the committed raw Horizons responses into
// the JSON fixtures Tasks 10-13 consume. Never touches the network — see
// refresh-horizons.mjs for that. `--check` re-derives and byte-compares
// against the committed derived files, failing loudly on drift.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const RAW_DIR = new URL("../raw/horizons/", import.meta.url);
const USNO_RAW_DIR = new URL("../raw/usno/", import.meta.url);
const FIXTURES_DIR = new URL("../", import.meta.url);

const AU_KM = 1.495978707e8;
const TOLERANCE_ARCMIN = 1;

const VIC = { lat: 48.4284, lon: -123.3656 }; // Victoria BC
const N60 = { lat: 60, lon: -123.052 };

// --- USNO event grid + phase catalog -------------------------------------

const USNO_LON = -123.052;
const USNO_LATS = [70.5, 60, 48.7621, 0, -35];
const USNO_DATES = [
  "2026-03-20", "2026-06-21", "2026-09-23", "2026-12-21",
  "2026-08-28", "1999-01-17", "2085-05-05",
];
const USNO_POLAR_LAT = 70.5;
const USNO_POLAR_DATES = [
  "2026-05-14", "2026-05-15", "2026-05-16", "2026-05-17", "2026-05-18",
  "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31",
];
const USNO_PHASE_STARTS = [
  "1950-01-01", "1975-01-01", "2000-01-01", "2026-01-01",
  "2050-01-01", "2075-01-01", "2098-06-01",
];

function usnoLatSlug(lat) {
  return (lat < 0 ? `neg${-lat}` : `${lat}`).replace(".", "p");
}

function rawUsno(name) {
  return JSON.parse(readFileSync(new URL(`${name}.json`, USNO_RAW_DIR), "utf8"));
}

// USNO reports each rise/set/twilight/transit instant as a free-text
// phenomenon label rather than a fixed code (the brief assumed 2-letter
// codes like "BC"/"R"/"U"/"S"/"EC" — the live API returns full phrases
// instead, e.g. "Begin Civil Twilight", "Rise"). Map the labels the grid
// schema cares about; everything else (lower transit, and the polar-day/
// polar-night "continuously above/below" markers, which carry no time) is
// dropped deliberately, not silently — anything unrecognized throws.
const USNO_SUN_MAP = {
  "Begin Civil Twilight": "civilDawn",
  Rise: "rise",
  "Upper Transit": "transit",
  Set: "set",
  "End Civil Twilight": "civilDusk",
};
const USNO_MOON_MAP = {
  Rise: "rise",
  "Upper Transit": "transit",
  Set: "set",
};
const USNO_IGNORED_PHEN = new Set([
  "Lower Transit",
  "Object continuously above the Horizon",
  "Object continuously below the Horizon",
  "Object continuously above the Twilight Limit",
  "Object continuously below the Twilight Limit",
]);

function usnoExtractPhen(entries, map, name) {
  const out = {};
  for (const { phen, time } of entries) {
    if (USNO_IGNORED_PHEN.has(phen)) continue; // e.g. "Lower Transit", polar continuously-above/below markers
    assert.ok(time != null, `${name}: unexpected no-time phenomenon "${phen}"`);
    const key = map[phen];
    assert.ok(key, `${name}: unmapped USNO phenomenon "${phen}"`);
    out[key] = time;
  }
  return out;
}

function deriveUsnoGrid(retrieved, requests) {
  const jobs = [];
  for (const lat of USNO_LATS) for (const date of USNO_DATES) jobs.push({ lat, date });
  for (const date of USNO_POLAR_DATES) jobs.push({ lat: USNO_POLAR_LAT, date });

  const grid = jobs.map(({ lat, date }) => {
    const name = `grid-${usnoLatSlug(lat)}-${date}`;
    const data = rawUsno(name).properties.data;
    return {
      date,
      latitudeDeg: lat,
      longitudeDeg: USNO_LON,
      sun: usnoExtractPhen(data.sundata, USNO_SUN_MAP, name),
      moon: usnoExtractPhen(data.moondata, USNO_MOON_MAP, name),
    };
  });
  grid.sort((a, b) => a.date.localeCompare(b.date) || b.latitudeDeg - a.latitudeDeg);
  assert.equal(grid.length, jobs.length, "usno grid: unexpected row count");

  // self-check: 70.5N is under midnight sun on 2026-06-21 — no sunrise/set,
  // but it still transits.
  const midnightSun = grid.find((e) => e.date === "2026-06-21" && e.latitudeDeg === 70.5);
  assert.ok(midnightSun, "usno grid: missing 70.5N 2026-06-21 entry");
  assert.ok(!("rise" in midnightSun.sun) && !("set" in midnightSun.sun),
    "usno grid: 70.5N 2026-06-21 should report no sun rise/set (midnight sun)");
  assert.ok("transit" in midnightSun.sun, "usno grid: 70.5N 2026-06-21 should still report sun transit");

  const gridRequests = jobs.map(({ lat, date }) => requests[`grid-${usnoLatSlug(lat)}-${date}`]);

  return {
    "events/usno-grid.json": json(grid),
    "events/meta.json": json({
      source: "USNO Astronomical Applications API (aa.usno.navy.mil/api/rstt/oneday)",
      sourceVersion: rawUsno(`grid-${usnoLatSlug(USNO_LATS[0])}-${USNO_DATES[0]}`).apiversion,
      retrieved,
      requests: gridRequests,
    }),
  };
}

const USNO_PHASE_MAP = {
  "New Moon": "new",
  "First Quarter": "firstQuarter",
  "Full Moon": "full",
  "Last Quarter": "lastQuarter",
};
const USNO_PHASE_CYCLE = ["new", "firstQuarter", "full", "lastQuarter"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function deriveUsnoPhases(retrieved, requests) {
  const blocks = USNO_PHASE_STARTS.map((start) => {
    const name = `phases-${start}`;
    const data = rawUsno(name);
    const entries = data.phasedata.map((p) => {
      const phase = USNO_PHASE_MAP[p.phase];
      assert.ok(phase, `${name}: unmapped USNO phase "${p.phase}"`);
      return { phase, utc: `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${p.time}Z` };
    });
    // self-check: phases alternate in the canonical new->1Q->full->3Q cycle
    for (let i = 1; i < entries.length; i++) {
      const wantIdx = (USNO_PHASE_CYCLE.indexOf(entries[i - 1].phase) + 1) % 4;
      assert.equal(entries[i].phase, USNO_PHASE_CYCLE[wantIdx],
        `${name}: phase cycle broken at ${entries[i].utc}`);
    }
    return entries;
  });

  const seen = new Set();
  const phases = blocks.flat().sort((a, b) => a.utc.localeCompare(b.utc)).filter((e) => {
    const k = `${e.utc}|${e.phase}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    "phases/usno-phases.json": json(phases),
    "phases/meta.json": json({
      source: "USNO Astronomical Applications API (aa.usno.navy.mil/api/moon/phases/date)",
      sourceVersion: rawUsno(`phases-${USNO_PHASE_STARTS[0]}`).apiversion,
      retrieved,
      requests: USNO_PHASE_STARTS.map((s) => requests[`phases-${s}`]),
    }),
  };
}

const MONTHS = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

function raw(name) {
  return readFileSync(new URL(`${name}.txt`, RAW_DIR), "utf8");
}

function sourceVersion(text) {
  return text.match(/API VERSION:\s*(\S+)/)?.[1] ?? "unknown";
}

// Parses rows between $$SOE/$$EOE. Horizons' az/el output inserts a 2-char
// solar/lunar presence flag between the date and the numeric columns (e.g.
// "*m", "Nm", " "); pulling floats out with a regex sidesteps that flag
// entirely instead of column-counting around it.
function parseRawRows(text) {
  const soe = text.indexOf("$$SOE");
  const eoe = text.indexOf("$$EOE");
  assert.ok(soe !== -1 && eoe !== -1, "missing $$SOE/$$EOE markers");
  const rows = [];
  for (const line of text.slice(soe + 5, eoe).split("\n")) {
    if (!line.trim()) continue;
    const m = line.match(/(\d{4})-([A-Za-z]{3})-(\d{2})\s+(\d{2}:\d{2}:\d{2})/);
    assert.ok(m, `unparseable row: ${line}`);
    const [full, y, mon, d, hms] = m;
    const month = MONTHS[mon];
    assert.ok(month, `unknown month in row: ${line}`);
    const utc = `${y}-${month}-${d}T${hms}Z`;
    const nums = (line.slice(m.index + full.length).match(/-?\d+\.\d+/g) || []).map(Number);
    rows.push({ utc, nums });
  }
  return rows;
}

function json(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

function byUtc(a, b) {
  return a.utc.localeCompare(b.utc);
}

function derivePositions(retrieved, requests) {
  function sunFile(name, expectMin, expectExact) {
    const rows = parseRawRows(raw(name))
      .map(({ utc, nums }) => ({ utc, raDeg: nums[0], decDeg: nums[1], distanceAu: nums[2] }))
      .sort(byUtc);
    for (const r of rows) {
      assert.ok(r.decDeg >= -90 && r.decDeg <= 90, `${name}: decDeg out of range at ${r.utc}`);
      assert.ok(r.raDeg >= 0 && r.raDeg <= 360, `${name}: raDeg out of range at ${r.utc}`);
      assert.ok(r.distanceAu >= 0.98 && r.distanceAu <= 1.02, `${name}: distanceAu out of range at ${r.utc}: ${r.distanceAu}`);
    }
    if (expectExact != null) assert.equal(rows.length, expectExact, `${name}: expected ${expectExact} rows, got ${rows.length}`);
    if (expectMin != null) assert.ok(rows.length >= expectMin, `${name}: expected >=${expectMin} rows, got ${rows.length}`);
    return rows;
  }

  function moonFile(name, expectMin, expectExact) {
    const rows = parseRawRows(raw(name))
      .map(({ utc, nums }) => ({
        utc, raDeg: nums[0], decDeg: nums[1], distanceKm: nums[3] * AU_KM, illumFraction: nums[2] / 100,
      }))
      .sort(byUtc);
    for (const r of rows) {
      assert.ok(r.decDeg >= -90 && r.decDeg <= 90, `${name}: decDeg out of range at ${r.utc}`);
      assert.ok(r.raDeg >= 0 && r.raDeg <= 360, `${name}: raDeg out of range at ${r.utc}`);
      assert.ok(r.illumFraction >= 0 && r.illumFraction <= 1, `${name}: illumFraction out of range at ${r.utc}`);
      assert.ok(r.distanceKm >= 356000 && r.distanceKm <= 407000, `${name}: distanceKm out of range at ${r.utc}: ${r.distanceKm}`);
    }
    if (expectExact != null) assert.equal(rows.length, expectExact, `${name}: expected ${expectExact} rows, got ${rows.length}`);
    if (expectMin != null) assert.ok(rows.length >= expectMin, `${name}: expected >=${expectMin} rows, got ${rows.length}`);
    return rows;
  }

  const sunCoarse = sunFile("sun-coarse", 1830);
  const moonCoarse = moonFile("moon-coarse", 1830);
  const sunDense = sunFile("sun-dense", null, 745);
  const moonDense = moonFile("moon-dense", null, 745);

  for (const [name, rows] of [["sun-coarse", sunCoarse], ["moon-coarse", moonCoarse]]) {
    assert.equal(rows[0].utc.slice(0, 4), "1950", `${name}: does not start at 1950`);
    assert.equal(rows.at(-1).utc.slice(0, 4), "2100", `${name}: does not end at 2100`);
  }

  return {
    "positions/sun-coarse.json": json(sunCoarse),
    "positions/moon-coarse.json": json(moonCoarse),
    "positions/sun-dense.json": json(sunDense),
    "positions/moon-dense.json": json(moonDense),
    "positions/meta.json": json({
      source: "JPL Horizons API",
      sourceVersion: sourceVersion(raw("sun-coarse")),
      retrieved,
      requests: ["sun-coarse", "moon-coarse", "sun-dense", "moon-dense"].map((n) => requests[n]),
      toleranceArcmin: TOLERANCE_ARCMIN,
    }),
  };
}

function deriveAltaz(retrieved, requests) {
  function altazFile(name, expectExact) {
    const rows = parseRawRows(raw(name))
      .map(({ utc, nums }) => ({ utc, azDeg: nums[0], altDeg: nums[1] }))
      .sort(byUtc);
    for (const r of rows) {
      assert.ok(r.azDeg >= 0 && r.azDeg <= 360, `${name}: azDeg out of range at ${r.utc}`);
      assert.ok(r.altDeg >= -90 && r.altDeg <= 90, `${name}: altDeg out of range at ${r.utc}`);
    }
    assert.equal(rows.length, expectExact, `${name}: expected ${expectExact} rows, got ${rows.length}`);
    return rows;
  }

  const sunVictoria = altazFile("sun-altaz-victoria", 169);
  const moonVictoria = altazFile("moon-altaz-victoria", 169);

  const twilightSpecs = [
    ["sun-airless-twilight-vic-mar", VIC],
    ["sun-airless-twilight-vic-dec", VIC],
    ["sun-airless-twilight-n60-mar", N60],
    ["sun-airless-twilight-n60-dec", N60],
  ];
  const twilightRows = twilightSpecs.flatMap(([name, s]) => {
    const rows = parseRawRows(raw(name)).map(({ utc, nums }) => ({
      utc, azDeg: nums[0], altDeg: nums[1], siteLatDeg: s.lat, siteLonDeg: s.lon,
    }));
    assert.equal(rows.length, 2881, `${name}: expected 2881 rows, got ${rows.length}`);
    for (const r of rows) {
      assert.ok(r.azDeg >= 0 && r.azDeg <= 360, `${name}: azDeg out of range at ${r.utc}`);
      assert.ok(r.altDeg >= -90 && r.altDeg <= 90, `${name}: altDeg out of range at ${r.utc}`);
    }
    return rows;
  });
  twilightRows.sort((a, b) => a.siteLatDeg - b.siteLatDeg || a.siteLonDeg - b.siteLonDeg || byUtc(a, b));
  assert.equal(twilightRows.length, twilightSpecs.length * 2881, "sun-airless-twilight: row count mismatch after merge");

  return {
    "altaz/sun-victoria-2026-03.json": json(sunVictoria),
    "altaz/moon-victoria-2026-03.json": json(moonVictoria),
    "altaz/sun-airless-twilight.json": json(twilightRows),
    "altaz/meta.json": json({
      source: "JPL Horizons API",
      sourceVersion: sourceVersion(raw("sun-altaz-victoria")),
      retrieved,
      requests: [
        "sun-altaz-victoria", "moon-altaz-victoria",
        "sun-airless-twilight-vic-mar", "sun-airless-twilight-vic-dec",
        "sun-airless-twilight-n60-mar", "sun-airless-twilight-n60-dec",
      ].map((n) => requests[n]),
      toleranceArcmin: TOLERANCE_ARCMIN,
    }),
  };
}

function main() {
  const check = process.argv.includes("--check");
  const horizons = JSON.parse(readFileSync(new URL("retrieved.json", RAW_DIR), "utf8"));
  const usno = JSON.parse(readFileSync(new URL("retrieved.json", USNO_RAW_DIR), "utf8"));

  const files = {
    ...derivePositions(horizons.retrieved, horizons.requests),
    ...deriveAltaz(horizons.retrieved, horizons.requests),
    ...deriveUsnoGrid(usno.retrieved, usno.requests),
    ...deriveUsnoPhases(usno.retrieved, usno.requests),
  };

  let drift = false;
  for (const [rel, content] of Object.entries(files)) {
    const dest = new URL(rel, FIXTURES_DIR);
    if (!check) {
      writeFileSync(dest, content);
      continue;
    }
    if (!existsSync(dest) || readFileSync(dest, "utf8") !== content) {
      console.error(`DRIFT: ${rel}`);
      drift = true;
    }
  }

  if (check) {
    if (drift) {
      console.error("derive.mjs --check: drift detected between raw and committed derived fixtures");
      process.exit(1);
    }
    console.log(`derive.mjs --check: clean (${Object.keys(files).length} files, offline)`);
  } else {
    console.log(`derive.mjs: wrote ${Object.keys(files).length} files`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
