#!/usr/bin/env node
// Star alt/az oracle: USNO's celestial-navigation API (NOVAS apparent places,
// years 1800-2050) reports computed altitude `hc` and azimuth `zn` for the
// 57 navigational stars above the horizon at a site and instant, plus the
// refraction it would apply. SIMBAD supplies each star's ICRS J2000 position
// and proper motion, so derive.mjs can feed `starAltAz` the same catalog
// coordinates a consumer would and drop the fast movers the no-proper-motion
// contract cannot hold within tolerance. Network-only; run manually and
// commit raw + derived together.
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const RAW_DIR = new URL("../raw/stars/", import.meta.url);

export const SITES = [
  { slug: "victoria", lat: 48.4284, lon: -123.3656 },
  { slug: "s35", lat: -35, lon: -123.052 },
];
export const DATES = [
  "2026-03-20", "2026-06-21", "2026-09-23", "2026-12-21",
  "1999-01-17", "2050-06-21",
];
export const TIME = "06:00:00";

// USNO's labels for the 57 navigational stars, mapped to identifiers SIMBAD's
// name resolver accepts (its abbreviations and apostrophes do not resolve).
export const STAR_IDS = {
  "Acamar": "tet01 Eri", "Achernar": "alf Eri", "Acrux": "alf01 Cru", "Adhara": "eps CMa",
  "ALDEBARAN": "alf Tau", "Alioth": "eps UMa", "Alkaid": "eta UMa", "Al Na'ir": "alf Gru",
  "Alnilam": "eps Ori", "Alphard": "alf Hya", "Alphecca": "alf CrB", "Alpheratz": "alf And",
  "ALTAIR": "alf Aql", "Ankaa": "alf Phe", "ANTARES": "alf Sco", "ARCTURUS": "alf Boo",
  "Atria": "alf TrA", "Avior": "eps Car", "Bellatrix": "gam Ori", "BETELGEUSE": "alf Ori",
  "CANOPUS": "alf Car", "CAPELLA": "alf Aur", "DENEB": "alf Cyg", "Denebola": "bet Leo",
  "Diphda": "bet Cet", "Dubhe": "alf UMa", "Elnath": "bet Tau", "Eltanin": "gam Dra",
  "Enif": "eps Peg", "FOMALHAUT": "alf PsA", "Gacrux": "gam Cru", "Gienah": "gam Crv",
  "Hadar": "bet Cen", "Hamal": "alf Ari", "Kaus Aust.": "eps Sgr", "Kochab": "bet UMi",
  "Markab": "alf Peg", "Menkar": "alf Cet", "Menkent": "tet Cen", "Miaplacidus": "bet Car",
  "Mirfak": "alf Per", "Nunki": "sig Sgr", "Peacock": "alf Pav", "POLARIS": "alf UMi",
  "POLLUX": "bet Gem", "PROCYON": "alf CMi", "Rasalhague": "alf Oph", "REGULUS": "alf Leo",
  "RIGEL": "bet Ori", "Rigil Kent.": "alf Cen", "Sabik": "eta Oph", "Schedar": "alf Cas",
  "Shaula": "lam Sco", "SIRIUS": "alf CMa", "SPICA": "alf Vir", "Suhail": "lam Vel",
  "VEGA": "alf Lyr", "Zuben'ubi": "alf02 Lib",
};

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchText(name, url) {
  console.log(`fetching ${name} ...`);
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok) throw new Error(`request failed for ${name} (HTTP ${res.status}):\n${body.slice(0, 2000)}`);
  return body;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  const requests = {};

  for (const site of SITES) {
    for (const date of DATES) {
      const name = `celnav-${site.slug}-${date}`;
      const url = `https://aa.usno.navy.mil/api/celnav?date=${date}&time=${TIME}&coords=${site.lat},${site.lon}`;
      const parsed = JSON.parse(await fetchText(name, url)); // throws loudly on unexpected shape
      if (!parsed.properties?.data) throw new Error(`${name}: no data block:\n${JSON.stringify(parsed).slice(0, 500)}`);
      await writeFile(new URL(`${name}.json`, RAW_DIR), JSON.stringify(parsed, null, 2) + "\n");
      requests[name] = url;
      await sleep(1000); // be polite: ~1 req/s
    }
  }

  for (const [label, id] of Object.entries(STAR_IDS)) {
    const name = `simbad-${id.replace(/\s+/g, "-")}`;
    const url = `https://simbad.cds.unistra.fr/simbad/sim-id?Ident=${encodeURIComponent(id)}&output.format=ASCII`;
    const text = await fetchText(`${name} (${label})`, url);
    if (!/Coordinates\(ICRS,ep=J2000,eq=2000\)/.test(text)) throw new Error(`${name}: no ICRS J2000 coordinates:\n${text.slice(0, 500)}`);
    await writeFile(new URL(`${name}.txt`, RAW_DIR), text);
    requests[name] = url;
    await sleep(1000);
  }

  const retrieved = new Date().toISOString().slice(0, 10);
  await writeFile(
    new URL("retrieved.json", RAW_DIR),
    JSON.stringify({ retrieved, requests }, null, 2) + "\n",
  );
  console.log(`done — retrieved ${retrieved} (${Object.keys(requests).length} requests)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
