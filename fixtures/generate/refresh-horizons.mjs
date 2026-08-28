#!/usr/bin/env node
// Fetches the raw JPL Horizons responses the derive pipeline works from.
// This is the ONLY script in fixtures/generate/ that touches the network —
// run it once, inspect the output, commit the raw .txt files. derive.mjs
// never calls this.
import { writeFile } from "node:fs/promises";
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

function geocentric(command, quantities, start, stop, step) {
  return {
    ...common,
    COMMAND: `'${command}'`,
    CENTER: "'500@399'",
    QUANTITIES: `'${quantities}'`,
    START_TIME: `'${start}'`,
    STOP_TIME: `'${stop}'`,
    STEP_SIZE: `'${step}'`,
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
  { name: "sun-coarse", params: geocentric("10", "2,20", "1950-01-01", "2100-12-31", "30d") },
  { name: "moon-coarse", params: geocentric("301", "2,10,20", "1950-01-01", "2100-12-31", "30d") },
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
  const requests = {};
  for (let i = 0; i < specs.length; i++) {
    const { name, params } = specs[i];
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
    if (i < specs.length - 1) await sleep(1000); // be polite: ~1 req/s
  }
  const retrieved = new Date().toISOString().slice(0, 10);
  await writeFile(
    new URL("retrieved.json", RAW_DIR),
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
