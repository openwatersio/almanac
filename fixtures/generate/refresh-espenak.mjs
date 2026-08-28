#!/usr/bin/env node
// Fetches the raw NASA/GSFC Espenak eclipse pages the derive pipeline works
// from: the two Five Millennium Catalog century pages, plus four per-eclipse
// Observer's Handbook pages carrying named-contact times. This is the ONLY
// script that touches eclipse.gsfc.nasa.gov — run it once, inspect the
// output, commit the raw .html files. derive.mjs never calls this.
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const RAW_DIR = new URL("../raw/espenak/", import.meta.url);
const BASE = "https://eclipse.gsfc.nasa.gov";

// Catalog pages: fixed-width eclipse tables, one row per eclipse, each page
// states its own century total in the intro prose (self-check target).
const CATALOGS = [
  { name: "LE1901-2000", url: `${BASE}/LEcat5/LE1901-2000.html` },
  { name: "LE2001-2100", url: `${BASE}/LEcat5/LE2001-2100.html` },
];

// Per-eclipse contact pages: NASA's yearly "Observer's Handbook" (OH) pages
// carry a named-phase block per eclipse (Penumbral/Partial/Total Begins/Ends
// + Greatest Eclipse) — exactly the {p1,u1,u2,peak,u3,u4,p4} contact shape,
// with absent contacts omitted per kind (total has all 7, partial has
// p1/u1/peak/u4/p4, penumbral has only p1/peak/p4).
const CONTACTS = [
  { name: "contacts-2019", url: `${BASE}/OH/OH2019.html`, eclipse: "2019-01-21", kind: "total" },
  { name: "contacts-2025", url: `${BASE}/OH/OH2025.html`, eclipse: "2025-09-07", kind: "total" },
  { name: "contacts-2026", url: `${BASE}/OH/OH2026.html`, eclipse: "2026-08-28", kind: "partial" },
  { name: "contacts-2020", url: `${BASE}/OH/OH2020.html`, eclipse: "2020-11-30", kind: "penumbral" },
];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(name, url) {
  console.log(`fetching ${name} ...`);
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok || body.length < 1000) {
    throw new Error(`Espenak request failed for ${name} (HTTP ${res.status}, ${body.length} bytes)`);
  }
  await writeFile(new URL(`${name}.html`, RAW_DIR), body);
  return url;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  const requests = {};
  const jobs = [...CATALOGS, ...CONTACTS];

  for (let i = 0; i < jobs.length; i++) {
    const { name, url } = jobs[i];
    requests[name] = await fetchHtml(name, url);
    if (i < jobs.length - 1) await sleep(1000); // be polite: ~1 req/s
  }

  const retrieved = new Date().toISOString().slice(0, 10);
  await writeFile(
    new URL("retrieved.json", RAW_DIR),
    JSON.stringify({
      retrieved,
      requests,
      contacts: Object.fromEntries(CONTACTS.map((c) => [c.name, { eclipse: c.eclipse, kind: c.kind }])),
    }, null, 2) + "\n",
  );
  console.log(`done — retrieved ${retrieved} (${jobs.length} requests)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
