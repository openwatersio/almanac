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

// Solar eclipse local circumstances: contacts, Sun altitudes, magnitude and
// obscuration for one place. The endpoint advertises 1800-2050 but answers
// HTTP 500 outside the eclipses of 2001-2026; every case sits inside that
// window. Perth is deliberately outside the 2024-04-08 visibility region:
// the API answers HTTP 400 with an error body, which is evidence the search
// must return nothing there.
export const SOLAR_CASES = [
  { date: "2017-08-21", slug: "salem", place: "Salem, Oregon", lat: 44.94, lon: -123.03 },
  { date: "2024-04-08", slug: "victoria", place: "Victoria, British Columbia", lat: 48.43, lon: -123.37 },
  { date: "2023-10-14", slug: "albuquerque", place: "Albuquerque, New Mexico", lat: 35.08, lon: -106.65 },
  { date: "2012-05-20", slug: "redding", place: "Redding, California", lat: 40.59, lon: -122.39 },
  { date: "2001-06-21", slug: "lusaka", place: "Lusaka, Zambia", lat: -15.4, lon: 28.3 },
  { date: "2021-06-10", slug: "toronto", place: "Toronto, Ontario", lat: 43.65, lon: -79.38 },
  { date: "2020-12-14", slug: "pucon", place: "Pucón, Chile", lat: -39.28, lon: -71.95 },
  { date: "2026-08-12", slug: "valencia", place: "Valencia, Spain", lat: 39.47, lon: -0.38 },
  { date: "2024-04-08", slug: "perth", place: "Perth, Australia", lat: -31.95, lon: 115.86, notVisible: true },
];

export function solarName(c) {
  return `solar-${c.date}-${c.slug}`;
}

function latSlug(lat) {
  return (lat < 0 ? `neg${-lat}` : `${lat}`).replace(".", "p");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchJson(name, url, { allowError = false } = {}) {
  console.log(`fetching ${name} ...`);
  const res = await fetch(url);
  const body = await res.text();
  const parsed = JSON.parse(body); // throws loudly on unexpected shape
  if (!res.ok && !(allowError && parsed.error)) {
    throw new Error(`USNO request failed for ${name} (HTTP ${res.status}):\n${body.slice(0, 2000)}`);
  }
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
  for (const c of SOLAR_CASES) {
    const url = `https://aa.usno.navy.mil/api/eclipses/solar/date?date=${c.date}&coords=${c.lat},${c.lon}&height=0`;
    jobs.push({ name: solarName(c), url, allowError: Boolean(c.notVisible) });
  }

  for (let i = 0; i < jobs.length; i++) {
    const { name, url, allowError } = jobs[i];
    requests[name] = await fetchJson(name, url, { allowError });
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
