#!/usr/bin/env node
// Fetches the raw NASA/GSFC per-eclipse path tables (the "SEpath" pages) the
// derive pipeline works from: the central line and the northern and southern
// limits every 120 seconds, the central line where the path meets the
// horizon at each end, and the instant and place of greatest eclipse to a
// tenth of an arcminute. This is the ONLY script that touches the SEpath
// pages; refresh-espenak.mjs fetches the catalogs. Run it once, inspect the
// output, commit the raw .html files. derive.mjs never calls this.
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const RAW_DIR = new URL("../raw/sepath/", import.meta.url);
const BASE = "https://eclipse.gsfc.nasa.gov/SEpath";

// Central eclipses whose paths a consumer asks about: the three recent North
// American paths, the 2026 path across Iceland and Spain, and the 2044 and
// 2045 paths whose greatest-eclipse points sit far from where they pass
// closest to the Pacific Northwest.
export const PATHS = [
  { eclipse: "2017-08-21", kind: "total", page: "SEpath2001/SE2017Aug21Tpath.html" },
  { eclipse: "2023-10-14", kind: "annular", page: "SEpath2001/SE2023Oct14Apath.html" },
  { eclipse: "2024-04-08", kind: "total", page: "SEpath2001/SE2024Apr08Tpath.html" },
  { eclipse: "2026-08-12", kind: "total", page: "SEpath2001/SE2026Aug12Tpath.html" },
  { eclipse: "2044-08-23", kind: "total", page: "SEpath2001/SE2044Aug23Tpath.html" },
  { eclipse: "2045-08-12", kind: "total", page: "SEpath2001/SE2045Aug12Tpath.html" },
];

export function pathName(p) {
  return `path-${p.eclipse}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchHtml(name, url) {
  console.log(`fetching ${name} ...`);
  const res = await fetch(url);
  const body = await res.text();
  if (!res.ok || body.length < 1000) {
    throw new Error(`SEpath request failed for ${name} (HTTP ${res.status}, ${body.length} bytes)`);
  }
  await writeFile(new URL(`${name}.html`, RAW_DIR), body);
  return url;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  const requests = {};
  for (let i = 0; i < PATHS.length; i++) {
    const name = pathName(PATHS[i]);
    requests[name] = await fetchHtml(name, `${BASE}/${PATHS[i].page}`);
    if (i < PATHS.length - 1) await sleep(1000); // be polite: ~1 req/s
  }

  const retrieved = new Date().toISOString().slice(0, 10);
  await writeFile(
    new URL("retrieved.json", RAW_DIR),
    JSON.stringify({
      retrieved,
      requests,
      paths: Object.fromEntries(PATHS.map((p) => [pathName(p), { eclipse: p.eclipse, kind: p.kind }])),
    }, null, 2) + "\n",
  );
  console.log(`done — retrieved ${retrieved} (${PATHS.length} requests)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
