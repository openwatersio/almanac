#!/usr/bin/env node
// Offline derive pipeline: parses the committed raw Horizons responses into
// the JSON fixtures Tasks 10-13 consume. Never touches the network — see
// refresh-horizons.mjs for that. `--check` re-derives and byte-compares
// against the committed derived files, failing loudly on drift.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const RAW_DIR = new URL("../raw/horizons/", import.meta.url);
const FIXTURES_DIR = new URL("../", import.meta.url);

const AU_KM = 1.495978707e8;
const TOLERANCE_ARCMIN = 1;

const VIC = { lat: 48.4284, lon: -123.3656 }; // Victoria BC
const N60 = { lat: 60, lon: -123.052 };

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
  const { retrieved, requests } = JSON.parse(readFileSync(new URL("retrieved.json", RAW_DIR), "utf8"));

  const files = { ...derivePositions(retrieved, requests), ...deriveAltaz(retrieved, requests) };

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
