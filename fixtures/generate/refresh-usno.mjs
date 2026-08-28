#!/usr/bin/env node
// Fetches the raw USNO Astronomical Applications API responses the derive
// pipeline works from (rise/set/twilight grid + moon phase catalog). This is
// the ONLY script that touches aa.usno.navy.mil — run it once, inspect the
// output, commit the raw .json files. derive.mjs never calls this.
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const RAW_DIR = new URL("../raw/usno/", import.meta.url);
const LON = -123.052;

// lats x dates grid
const LATS = [70.5, 60, 48.7621, 0, -35];
const DATES = [
  "2026-03-20", "2026-06-21", "2026-09-23", "2026-12-21",
  "2026-08-28", "1999-01-17", "2085-05-05",
];

// polar-day onset/offset windows at 70.5N only — grazing rise/set pairs
const POLAR_LAT = 70.5;
const POLAR_DATES = [
  "2026-05-14", "2026-05-15", "2026-05-16", "2026-05-17", "2026-05-18",
  "2026-07-27", "2026-07-28", "2026-07-29", "2026-07-30", "2026-07-31",
];

// moon phase catalog: regular spacing + both range boundaries, ~2y/block
const PHASE_STARTS = [
  "1950-01-01", "1975-01-01", "2000-01-01", "2026-01-01",
  "2050-01-01", "2075-01-01", "2098-06-01",
];

function latSlug(lat) {
  return (lat < 0 ? `neg${-lat}` : `${lat}`).replace(".", "p");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(name, url) {
  console.log(`fetching ${name} ...`);
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) throw new Error(`USNO request failed for ${name} (HTTP ${res.status}):\n${body.slice(0, 2000)}`);
  const parsed = JSON.parse(body); // throws loudly on unexpected shape
  await writeFile(new URL(`${name}.json`, RAW_DIR), JSON.stringify(parsed, null, 2) + "\n");
  return url;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  const requests = {};
  const jobs = [];

  for (const lat of LATS) {
    for (const date of DATES) {
      const name = `grid-${latSlug(lat)}-${date}`;
      const url = `https://aa.usno.navy.mil/api/rstt/oneday?date=${date}&coords=${lat},${LON}&tz=0`;
      jobs.push({ name, url });
    }
  }
  for (const date of POLAR_DATES) {
    const name = `grid-${latSlug(POLAR_LAT)}-${date}`;
    const url = `https://aa.usno.navy.mil/api/rstt/oneday?date=${date}&coords=${POLAR_LAT},${LON}&tz=0`;
    jobs.push({ name, url });
  }
  for (const start of PHASE_STARTS) {
    const name = `phases-${start}`;
    const url = `https://aa.usno.navy.mil/api/moon/phases/date?date=${start}&nump=99`;
    jobs.push({ name, url });
  }

  for (let i = 0; i < jobs.length; i++) {
    const { name, url } = jobs[i];
    requests[name] = await fetchJson(name, url);
    if (i < jobs.length - 1) await sleep(1000); // be polite: ~1 req/s
  }

  const retrieved = new Date().toISOString().slice(0, 10);
  await writeFile(
    new URL("retrieved.json", RAW_DIR),
    JSON.stringify({ retrieved, requests }, null, 2) + "\n",
  );
  console.log(`done — retrieved ${retrieved} (${jobs.length} requests)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
