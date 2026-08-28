#!/usr/bin/env node
// Fetches the raw JPL Horizons responses the derive pipeline works from.
// This is the ONLY script in fixtures/generate/ that touches the network —
// run it once, inspect the output, commit the raw .txt files. derive.mjs
// never calls this.
import { writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const RAW_DIR = new URL("../raw/horizons/", import.meta.url);
const BASE = "https://ssd.jpl.nasa.gov/api/horizons.api";

const VIC = { lat: 48.4284, lon: -123.3656 }; // Victoria BC
const N60 = { lat: 60, lon: -123.052 };

const common = {
  format: "text",
  MAKE_EPHEM: "'YES'",
  EPHEM_TYPE: "'OBSERVER'",
  ANG_FORMAT: "'DEG'",
  TIME_DIGITS: "'SECONDS'",
};

// `timeType` selects the Horizons time scale for both the requested interval
// and the output date column. The coarse 1950-2100 position runs ask for TT:
// Horizons applies real historical delta-T but holds it fixed at its present
// value for future dates, so UT-labeled rows disagree with any real delta-T
// model by up to ~136 s at 2100 (~75" of lunar motion). TT takes the timescale
// out of the comparison. Everything else stays on UT, which is what an
// observer-facing fixture wants.
function geocentric(command, quantities, start, stop, step, timeType) {
  return {
    ...common,
    COMMAND: `'${command}'`,
    CENTER: "'500@399'",
    QUANTITIES: `'${quantities}'`,
    START_TIME: `'${start}'`,
    STOP_TIME: `'${stop}'`,
    STEP_SIZE: `'${step}'`,
    ...(timeType ? { TIME_TYPE: `'${timeType}'` } : {}),
  };
}

function site(command, quantities, start, stop, step, site, apparent) {
  return {
    ...common,
    COMMAND: `'${command}'`,
    CENTER: "'coord@399'",
    COORD_TYPE: "'GEODETIC'",
    SITE_COORD: `'${site.lon},${site.lat},0'`,
    QUANTITIES: `'${quantities}'`,
    START_TIME: `'${start}'`,
    STOP_TIME: `'${stop}'`,
    STEP_SIZE: `'${step}'`,
    APPARENT: `'${apparent}'`,
  };
}

const specs = [
  { name: "sun-coarse", params: geocentric("10", "2,20", "1950-01-01", "2100-12-31", "30d", "TT") },
  { name: "moon-coarse", params: geocentric("301", "2,10,20", "1950-01-01", "2100-12-31", "30d", "TT") },
  { name: "sun-dense", params: geocentric("10", "2,20", "2026-01-01", "2026-02-01", "1h") },
  { name: "moon-dense", params: geocentric("301", "2,10,20", "2026-01-01", "2026-02-01", "1h") },
  { name: "sun-altaz-victoria", params: site("10", "4,20", "2026-03-01", "2026-03-08", "1h", VIC, "REFRACTED") },
  { name: "moon-altaz-victoria", params: site("301", "4,20", "2026-03-01", "2026-03-08", "1h", VIC, "REFRACTED") },
  { name: "sun-airless-twilight-vic-mar", params: site("10", "4", "2026-03-20", "2026-03-22", "1m", VIC, "AIRLESS") },
  { name: "sun-airless-twilight-vic-dec", params: site("10", "4", "2026-12-20", "2026-12-22", "1m", VIC, "AIRLESS") },
  { name: "sun-airless-twilight-n60-mar", params: site("10", "4", "2026-03-20", "2026-03-22", "1m", N60, "AIRLESS") },
  { name: "sun-airless-twilight-n60-dec", params: site("10", "4", "2026-12-20", "2026-12-22", "1m", N60, "AIRLESS") },
];

function buildUrl(params) {
  const url = new URL(BASE);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  // Optional name arguments fetch a subset, e.g. `node refresh-horizons.mjs
  // sun-coarse moon-coarse`. retrieved.json is merged, never overwritten, so a
  // partial run leaves the other entries (and their derived fixtures) intact.
  const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const todo = only.length ? specs.filter((s) => only.includes(s.name)) : specs;
  const unknown = only.filter((n) => !specs.some((s) => s.name === n));
  if (unknown.length) throw new Error(`unknown spec name(s): ${unknown.join(", ")}`);

  const retrievedPath = new URL("retrieved.json", RAW_DIR);
  const prior = existsSync(retrievedPath)
    ? JSON.parse(readFileSync(retrievedPath, "utf8")).requests
    : {};
  const requests = { ...prior };
  for (let i = 0; i < todo.length; i++) {
    const { name, params } = todo[i];
    const url = buildUrl(params);
    console.log(`fetching ${name} ...`);
    const res = await fetch(url);
    const body = await res.text();
    if (!res.ok || !body.includes("$$SOE") || !body.includes("$$EOE")) {
      throw new Error(
        `Horizons request failed for ${name} (HTTP ${res.status}):\n${body.slice(0, 2000)}`,
      );
    }
    await writeFile(new URL(`${name}.txt`, RAW_DIR), body);
    requests[name] = url;
    if (i < todo.length - 1) await sleep(1000); // be polite: ~1 req/s
  }
  const retrieved = new Date().toISOString().slice(0, 10);
  await writeFile(
    retrievedPath,
    JSON.stringify({ retrieved, requests }, null, 2) + "\n",
  );
  console.log(`done — retrieved ${retrieved}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
