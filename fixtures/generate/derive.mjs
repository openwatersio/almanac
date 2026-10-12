#!/usr/bin/env node
// Offline derive pipeline: parses the committed raw Horizons, USNO, and
// Espenak responses into the JSON fixtures Tasks 10-13 consume. Never
// touches the network — see refresh-horizons.mjs for that. `--check`
// re-derives and byte-compares against the committed derived files, failing
// loudly on drift.
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { SITES as STAR_SITES, DATES as STAR_DATES, TIME as STAR_TIME, STAR_IDS } from "./refresh-stars.mjs";
import { SOLAR_CASES, solarName, SEASON_YEARS, seasonsName } from "./refresh-usno.mjs";
import { PATHS as SEPATH_PATHS, pathName as sepathName } from "./refresh-sepath.mjs";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const RAW_DIR = new URL("../raw/horizons/", import.meta.url);
const USNO_RAW_DIR = new URL("../raw/usno/", import.meta.url);
const STARS_RAW_DIR = new URL("../raw/stars/", import.meta.url);
const ESPENAK_RAW_DIR = new URL("../raw/espenak/", import.meta.url);
const SEPATH_RAW_DIR = new URL("../raw/sepath/", import.meta.url);
const FIXTURES_DIR = new URL("../", import.meta.url);

const AU_KM = 1.495978707e8;
const TOLERANCE_ARCMIN = 1;

const VIC = { lat: 48.4284, lon: -123.3656 }; // Victoria BC
const N60 = { lat: 60, lon: -123.052 };
const TROPIC = { lat: 20, lon: -123.052 };
const POLAR = { lat: 70.5, lon: -123.052 };
const S88 = { lat: -88.5, lon: -123.052 };

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
// dropped deliberately, not silently — anything unrecognized throws. USNO
// lists a lower transit only when the body is above the horizon at it.
const USNO_SUN_MAP = {
  "Begin Civil Twilight": "civilDawn",
  Rise: "rise",
  "Upper Transit": "transit",
  "Lower Transit": "lowerTransit",
  Set: "set",
  "End Civil Twilight": "civilDusk",
};
const USNO_MOON_MAP = {
  Rise: "rise",
  "Upper Transit": "transit",
  "Lower Transit": "lowerTransit",
  Set: "set",
};
const USNO_IGNORED_PHEN = new Set([
  "Object continuously above the Horizon",
  "Object continuously below the Horizon",
  "Object continuously above the Twilight Limit",
  "Object continuously below the Twilight Limit",
]);

function usnoExtractPhen(entries, map, name) {
  const out = {};
  for (const { phen, time } of entries) {
    if (USNO_IGNORED_PHEN.has(phen)) continue; // polar continuously-above/below markers
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

// --- USNO solar eclipse local circumstances --------------------------------

// Contact labels USNO uses. "Sunrise"/"Sunset" stand in for a contact below
// the horizon: that contact is absent from the fixture, and the test asserts
// the Sun is below the horizon at the contact the search computes.
const USNO_SOLAR_PHEN = {
  "Eclipse Begins": "c1",
  "Totality Begins": "c2",
  "Annularity Begins": "c2",
  "Maximum Eclipse": "peak",
  "Totality Ends": "c3",
  "Annularity Ends": "c3",
  "Eclipse Ends": "c4",
};
const USNO_SOLAR_HORIZON = new Set(["Sunrise", "Sunset"]);
const USNO_SOLAR_KIND = { Total: "total", Annular: "annular", Partial: "partial" };
const SOLAR_CONTACT_KEYS = ["c1", "c2", "peak", "c3", "c4"];

function deriveUsnoSolar(retrieved, requests) {
  const rows = SOLAR_CASES.map((c) => {
    const name = solarName(c);
    const data = rawUsno(name);
    const base = { eclipse: c.date, place: c.place, latitudeDeg: c.lat, longitudeDeg: c.lon };
    if (c.notVisible) {
      assert.match(data.error ?? "", /not visible/i, `${name}: expected USNO's not-visible error`);
      return { ...base, visible: false };
    }
    const p = data.properties;
    const kindMatch = p.description.match(/Sun in (Total|Annular|Partial) Eclipse/);
    assert.ok(kindMatch, `${name}: unrecognized description "${p.description}"`);
    const kind = USNO_SOLAR_KIND[kindMatch[1]];
    const obscMatch = p.obscuration.match(/^([\d.]+)%$/);
    assert.ok(obscMatch, `${name}: unrecognized obscuration "${p.obscuration}"`);

    const contacts = Object.fromEntries(SOLAR_CONTACT_KEYS.map((k) => [k, null]));
    for (const entry of p.local_data) {
      if (USNO_SOLAR_HORIZON.has(entry.phenomenon)) continue;
      const key = USNO_SOLAR_PHEN[entry.phenomenon];
      assert.ok(key, `${name}: unmapped USNO phenomenon "${entry.phenomenon}"`);
      assert.ok(Number(entry.day) === p.day || Number(entry.day) === p.day + 1,
        `${name}: contact day ${entry.day} is not the eclipse day or the day after`);
      // Entries carry their own UTC day: the Redding contacts fall on the day
      // after the requested date.
      const utc = new Date(`${p.year}-${pad2(p.month)}-${pad2(Number(entry.day))}T${entry.time}Z`);
      assert.ok(Number.isFinite(utc.getTime()), `${name}: unparseable time "${entry.time}"`);
      const sunAltDeg = entry.altitude === "----" ? null : Number(entry.altitude);
      contacts[key] = { utc: utc.toISOString(), sunAltDeg };
    }
    assert.ok(contacts.peak, `${name}: no Maximum Eclipse entry`);
    assert.equal(contacts.c2 !== null, kind !== "partial", `${name}: c2 presence disagrees with kind ${kind}`);
    assert.equal(contacts.c3 !== null, kind !== "partial", `${name}: c3 presence disagrees with kind ${kind}`);
    return {
      ...base, visible: true, kind,
      magnitude: Number(p.magnitude), obscuration: Number(obscMatch[1]) / 100,
      ...contacts,
    };
  });

  // self-checks: the shapes the tests rely on.
  const byName = Object.fromEntries(rows.map((r, i) => [SOLAR_CASES[i].slug, r]));
  assert.equal(byName.salem.kind, "total");
  assert.ok(byName.salem.c2 && byName.salem.c3, "salem: total eclipse needs c2 and c3");
  assert.equal(byName.toronto.c1, null, "toronto: USNO lists a sunrise in place of c1");
  assert.ok(byName.toronto.c4, "toronto: c4 present");
  assert.ok(byName.redding.peak.utc.startsWith("2012-05-21"), "redding: contacts fall on 2012-05-21 UTC");
  assert.equal(byName.perth.visible, false);
  assert.equal(byName.victoria.kind, "partial");

  return {
    "eclipses/solar-local.json": json(rows),
    solarLocalMeta: {
      source: "USNO Astronomical Applications API (aa.usno.navy.mil/api/eclipses/solar/date)",
      sourceVersion: rawUsno(solarName(SOLAR_CASES[0])).apiversion,
      retrieved,
      requests: SOLAR_CASES.map((c) => requests[solarName(c)]),
      servedYears: "2001-2026: the endpoint answers HTTP 500 for other eclipses despite advertising 1800-2050",
    },
  };
}

// --- Espenak lunar eclipse catalog + contacts -----------------------------

function rawEspenak(name) {
  return readFileSync(new URL(`${name}.html`, ESPENAK_RAW_DIR), "utf8");
}

const ESPENAK_KIND_MAP = { T: "total", P: "partial", N: "penumbral" };

function espenakCatalogFile(name) {
  const text = rawEspenak(name);
  const statedMatch = text.match(/Earth (?:will experience|experienced)\s+(\d+)\s+lunar eclipses/);
  assert.ok(statedMatch, `${name}: could not find the page's stated century total`);
  const statedTotal = Number(statedMatch[1]);

  const stripped = text.replace(/<[^>]+>/g, "");
  const rows = [];
  for (const line of stripped.split("\n")) {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length !== 18 || !/^\d{5}$/.test(tokens[0])) continue;
    rows.push(tokens);
  }
  // self-check: our fixed-width row parse must find exactly as many
  // eclipses as the page's own intro prose states for this century.
  assert.equal(rows.length, statedTotal, `${name}: parsed ${rows.length} rows, page states ${statedTotal}`);

  return rows.map((tokens) => {
    const [, year, monAbbr, day, time, deltaTStr, , , type, , , penMagStr, umMagStr] = tokens;
    const month = MONTHS[monAbbr];
    assert.ok(month, `${name}: unknown month abbreviation "${monAbbr}"`);
    const [hh, mm, ss] = time.split(":").map(Number);
    const tdMs = Date.UTC(Number(year), Number(month) - 1, Number(day), hh, mm, ss);
    const peakUtc = new Date(tdMs - Number(deltaTStr) * 1000).toISOString().replace(/\.\d+Z$/, "Z");
    const kind = ESPENAK_KIND_MAP[type[0]];
    assert.ok(kind, `${name}: unmapped eclipse type "${type}"`);
    const magUmbral = Number(umMagStr);
    const magPenumbral = Number(penMagStr);
    // kindFirm=false when the type-deciding (umbral) magnitude sits within
    // 0.05 of either type boundary: 0 (penumbral<->partial) or 1 (partial<->total).
    const kindFirm = Math.abs(magUmbral) > 0.05 && Math.abs(magUmbral - 1) > 0.05;
    return { year: Number(year), peakUtc, kind, magPenumbral, magUmbral, kindFirm };
  });
}

function deriveEspenakCatalog(retrieved, requests) {
  const all = [...espenakCatalogFile("LE1901-2000"), ...espenakCatalogFile("LE2001-2100")];
  const filtered = all
    .filter((e) => e.year >= 1950 && e.year <= 2100)
    .sort((a, b) => a.peakUtc.localeCompare(b.peakUtc))
    .map(({ year, ...rest }) => rest);

  // self-check: the 2026-08-28 regression case (just below the partial/total
  // boundary) parses as partial with umbral magnitude ~0.93.
  const aug28 = filtered.find((e) => e.peakUtc.startsWith("2026-08-28"));
  assert.ok(aug28, "espenak catalog: missing 2026-08-28 eclipse");
  assert.equal(aug28.kind, "partial", "espenak catalog: 2026-08-28 should be partial");
  assert.ok(Math.abs(aug28.magUmbral - 0.93) < 0.01,
    `espenak catalog: 2026-08-28 umbral magnitude should be ~0.93, got ${aug28.magUmbral}`);

  const perKind = { penumbral: 0, partial: 0, total: 0 };
  for (const e of filtered) perKind[e.kind]++;

  return {
    "eclipses/espenak-1950-2100.json": json(filtered),
    filteredMeta: {
      filteredCount: filtered.length,
      perKind,
      firstPeak: filtered[0].peakUtc,
      lastPeak: filtered.at(-1).peakUtc,
    },
  };
}

const ESPENAK_CONTACTS_SPEC = [
  { name: "contacts-2019", anchor: "LE2019Jan21T", eclipse: "2019-01-21" },
  { name: "contacts-2025", anchor: "LE2025Sep07T", eclipse: "2025-09-07" },
  { name: "contacts-2026", anchor: "LE2026Aug28P", eclipse: "2026-08-28" },
  { name: "contacts-2020", anchor: "LE2020Nov30N", eclipse: "2020-11-30" },
];
const ESPENAK_CONTACT_LABELS = [
  ["p1", "Penumbral Eclipse Begins"],
  ["u1", "Partial Eclipse Begins"],
  ["u2", "Total Eclipse Begins"],
  ["peak", "Greatest Eclipse"],
  ["u3", "Total Eclipse Ends"],
  ["u4", "Partial Eclipse Ends"],
  ["p4", "Penumbral Eclipse Ends"],
];
const ESPENAK_CONTACT_SHAPES = {
  "2019-01-21": ["p1", "u1", "u2", "peak", "u3", "u4", "p4"],
  "2025-09-07": ["p1", "u1", "u2", "peak", "u3", "u4", "p4"],
  "2026-08-28": ["p1", "u1", "peak", "u4", "p4"],
  "2020-11-30": ["p1", "peak", "p4"],
};

function deriveEspenakContacts(retrieved, requests) {
  const contacts = ESPENAK_CONTACTS_SPEC.map(({ name, anchor, eclipse }) => {
    const text = rawEspenak(name);
    const idPos = text.indexOf(`id="${anchor}"`);
    assert.ok(idPos !== -1, `${name}: anchor ${anchor} not found`);
    const nextHr = text.indexOf('<hr class="blue"', idPos + 1);
    const slice = nextHr === -1 ? text.slice(idPos) : text.slice(idPos, nextHr);

    const found = {};
    for (const [key, label] of ESPENAK_CONTACT_LABELS) {
      const re = new RegExp(`${label}:\\s+(\\d{2}:\\d{2})\\s+UT`);
      const m = slice.match(re);
      found[key] = m ? m[1] : null;
    }

    // Build ISO instants from the catalog date, rolling the UTC day forward
    // whenever a later-in-sequence contact's clock time is smaller than the
    // one before it (none of these four eclipses actually cross midnight,
    // but the eclipse can straddle it in general).
    const [y, mo, d] = eclipse.split("-").map(Number);
    let dayOffset = 0;
    let prevMinutes = -1;
    const record = { eclipse };
    for (const [key] of ESPENAK_CONTACT_LABELS) {
      const hhmm = found[key];
      if (hhmm == null) { record[key] = null; continue; }
      const [hh, mm] = hhmm.split(":").map(Number);
      const minutes = hh * 60 + mm;
      if (minutes < prevMinutes) dayOffset++;
      prevMinutes = minutes;
      record[key] = `${new Date(Date.UTC(y, mo - 1, d + dayOffset, hh, mm, 0)).toISOString().slice(0, 16)}Z`;
    }
    return record;
  });

  // self-check: each eclipse's contact keys are present/null exactly per
  // its kind's contact shape (total: all 7; partial: no u2/u3; penumbral:
  // only p1/peak/p4).
  for (const c of contacts) {
    const present = ESPENAK_CONTACT_SHAPES[c.eclipse];
    assert.ok(present, `espenak contacts: unexpected eclipse ${c.eclipse}`);
    for (const [key] of ESPENAK_CONTACT_LABELS) {
      assert.equal(c[key] != null, present.includes(key),
        `espenak contacts: ${c.eclipse} contact "${key}" presence mismatch`);
    }
  }

  return {
    "eclipses/contacts.json": json(contacts),
  };
}

// --- Espenak solar eclipse catalog ----------------------------------------

const ESPENAK_SOLAR_KIND_MAP = { T: "total", A: "annular", H: "hybrid", P: "partial" };
// Second character of the type column, per the catalog key: m middle of the
// Saros series, n/s central with no northern/southern limit, +/- NON-central
// with a northern/southern limit, 2/3 hybrid sub-types, b/e Saros begins/ends.
const ESPENAK_SOLAR_TYPE_FLAGS = new Set(["m", "n", "s", "+", "-", "2", "3", "b", "e"]);

function signedDeg(str, negativeLetter, name) {
  const m = str.match(/^(\d+)([NSEW])?$/);
  assert.ok(m, `${name}: unrecognized coordinate "${str}"`);
  return Number(m[1]) * (m[2] === negativeLetter ? -1 : 1);
}

function espenakSolarCatalogFile(name) {
  const text = rawEspenak(name);
  const statedMatch = text.match(/Earth (?:will experience|experienced)\s+(\d+)\s+solar eclipses/);
  assert.ok(statedMatch, `${name}: could not find the page's stated century total`);
  const statedTotal = Number(statedMatch[1]);

  const stripped = text.replace(/<[^>]+>/g, "");
  const rows = [];
  for (const line of stripped.split("\n")) {
    const tokens = line.trim().split(/\s+/);
    if (!/^\d{5}$/.test(tokens[0])) continue;
    // Total, annular and hybrid rows end with path width and central
    // duration; partial rows end at the Sun's altitude.
    if (tokens.length !== 17 && tokens.length !== 15) continue;
    rows.push(tokens);
  }
  assert.equal(rows.length, statedTotal, `${name}: parsed ${rows.length} rows, page states ${statedTotal}`);

  return rows.map((tokens) => {
    const [, year, monAbbr, day, time, deltaTStr, , , type, , gammaStr, magStr, latStr, lonStr, altStr, widthStr] = tokens;
    const month = MONTHS[monAbbr];
    assert.ok(month, `${name}: unknown month abbreviation "${monAbbr}"`);
    const [hh, mm, ss] = time.split(":").map(Number);
    const tdMs = Date.UTC(Number(year), Number(month) - 1, Number(day), hh, mm, ss);
    const peakUtc = new Date(tdMs - Number(deltaTStr) * 1000).toISOString().replace(/\.\d+Z$/, "Z");
    const kind = ESPENAK_SOLAR_KIND_MAP[type[0]];
    assert.ok(kind, `${name}: unmapped eclipse type "${type}"`);
    assert.ok(type.length === 1 || ESPENAK_SOLAR_TYPE_FLAGS.has(type[1]), `${name}: unknown type flag "${type}"`);
    const central = !/[+-]$/.test(type);
    // Non-central total/annular/hybrid rows (type ends in + or -) omit the
    // path width and central duration columns entirely — their umbral path
    // only grazes the Earth — so they share partial rows' 15-token shape.
    assert.equal(tokens.length, kind === "partial" || !central ? 15 : 17, `${name}: ${type} row at ${peakUtc} has ${tokens.length} tokens`);
    const pathWidthKm = kind === "partial" || !central || widthStr === "-" ? null : Number(widthStr);
    return {
      year: Number(year), peakUtc, kind, central,
      gamma: Number(gammaStr), magnitude: Number(magStr),
      latitudeDeg: signedDeg(latStr, "S", name), longitudeDeg: signedDeg(lonStr, "W", name),
      sunAltDeg: Number(altStr), pathWidthKm,
    };
  });
}

function deriveEspenakSolarCatalog(retrieved, requests) {
  const all = [...espenakSolarCatalogFile("SE1901-2000"), ...espenakSolarCatalogFile("SE2001-2100")];
  const filtered = all
    .filter((e) => e.year >= 1950 && e.year <= 2100)
    .sort((a, b) => a.peakUtc.localeCompare(b.peakUtc))
    .map(({ year, ...rest }) => rest);

  // self-checks against rows the tests lean on.
  const aug2017 = filtered.find((e) => e.peakUtc.startsWith("2017-08-21"));
  assert.ok(aug2017, "solar catalog: missing 2017-08-21");
  assert.deepEqual(
    [aug2017.kind, aug2017.central, aug2017.latitudeDeg, aug2017.longitudeDeg, aug2017.pathWidthKm],
    ["total", true, 37, -88, 115], "solar catalog: 2017-08-21 row");
  const apr2024 = filtered.find((e) => e.peakUtc.startsWith("2024-04-08"));
  assert.ok(apr2024 && apr2024.kind === "total" && apr2024.pathWidthKm === 198, "solar catalog: 2024-04-08 row");
  const mar1950 = filtered[0];
  assert.ok(mar1950.peakUtc.startsWith("1950-03-18") && mar1950.kind === "annular" && !mar1950.central, "solar catalog: 1950-03-18 is a non-central annular");
  assert.ok(filtered.length > 300, `solar catalog: expected over 300 rows, got ${filtered.length}`);

  const perKind = { partial: 0, annular: 0, total: 0, hybrid: 0 };
  for (const e of filtered) perKind[e.kind]++;

  return {
    "eclipses/solar-catalog.json": json(filtered),
    solarCatalogMeta: {
      source: "NASA/GSFC Five Millennium Catalog of Solar Eclipses (eclipse.gsfc.nasa.gov)",
      retrieved,
      requests: [requests["SE1901-2000"], requests["SE2001-2100"]],
      filteredCount: filtered.length,
      perKind,
      firstPeak: filtered[0].peakUtc,
      lastPeak: filtered.at(-1).peakUtc,
      note: "peakUtc is the catalog's TD of greatest eclipse minus its Delta-T column. latitudeDeg/longitudeDeg are the whole-degree coordinates of greatest eclipse, so an observer placed there sits up to ~80 km off the shadow axis. central is false when the type flag is + or -.",
    },
  };
}

// --- NASA/GSFC per-eclipse path tables (SEpath) ---------------------------

const SEPATH_STEP_SECONDS = 120;

function round6(x) {
  return Number(x.toFixed(6));
}

/** A path-table coordinate, degrees and hemisphere-suffixed minutes ("065", "13.5N"), as signed degrees. */
function sepathDeg(degStr, minStr, name) {
  const m = minStr.match(/^(\d+\.\d)([NSEW])$/);
  assert.ok(m && /^\d+$/.test(degStr), `${name}: unrecognized coordinate "${degStr} ${minStr}"`);
  const deg = Number(degStr) + Number(m[1]) / 60;
  return round6(m[2] === "S" || m[2] === "W" ? -deg : deg);
}

/** A central duration ("02m18.2s") in seconds. */
function sepathDuration(str, name) {
  const m = str.match(/^(\d+)m(\d+\.\d)s$/);
  assert.ok(m, `${name}: unrecognized duration "${str}"`);
  return round6(Number(m[1]) * 60 + Number(m[2]));
}

function sepathFile({ eclipse, kind }, name) {
  const html = readFileSync(new URL(`${name}.html`, SEPATH_RAW_DIR), "utf8");
  const text = html.replace(/<[^>]+>/g, "").replace(/&#176;/g, "°").replace(/&#39;/g, "'").replace(/&Delta;/g, "Δ");
  assert.ok(text.includes(`${SEPATH_STEP_SECONDS}-second intervals`), `${name}: not a ${SEPATH_STEP_SECONDS}-second table`);
  const dtMatch = text.replace(/\s+/g, " ").match(/ΔT = ([\d.]+) seconds/);
  assert.ok(dtMatch, `${name}: no Delta-T`);
  const ge = text.match(
    /Greatest Eclipse:\s+Time =\s+(\d{2}):(\d{2}):(\d{2}\.\d) UT\s+Lat =\s+(\d+)°(\d+\.\d)'([NS])\s+Long =\s+(\d+)°(\d+\.\d)'([EW])/);
  assert.ok(ge, `${name}: no greatest eclipse`);
  const [y, mo, d] = eclipse.split("-").map(Number);
  const geMs = Date.UTC(y, mo - 1, d, Number(ge[1]), Number(ge[2])) + Math.round(Number(ge[3]) * 1000);

  const limits = [];
  const centralLine = [];
  for (const line of text.split("\n")) {
    const tokens = line.trim().split(/\s+/);
    if (tokens[0] !== "Limits" && !/^\d{2}:\d{2}$/.test(tokens[0])) continue;
    // The central line is the four tokens before the diameter ratio; a
    // missing northern or southern limit is a pair of dashes before it.
    const ri = tokens.findIndex((t) => /^\d\.\d{3}$/.test(t));
    assert.ok(ri >= 5 && tokens.length === ri + 5, `${name}: unrecognized row "${line.trim()}"`);
    const latitudeDeg = sepathDeg(tokens[ri - 4], tokens[ri - 3], name);
    const longitudeDeg = sepathDeg(tokens[ri - 2], tokens[ri - 1], name);
    const diameterRatio = Number(tokens[ri]);
    assert.equal(diameterRatio > 1, kind === "total", `${name}: diameter ratio ${diameterRatio} for a ${kind} path`);
    if (tokens[0] === "Limits") {
      limits.push({ latitudeDeg, longitudeDeg });
      continue;
    }
    const [hh, mm] = tokens[0].split(":").map(Number);
    let ms = Date.UTC(y, mo - 1, d, hh, mm);
    // Rows carry clock times only; put each on the day that keeps it within
    // half a day of greatest eclipse.
    if (ms - geMs > 43200000) ms -= 86400000;
    else if (geMs - ms > 43200000) ms += 86400000;
    centralLine.push({
      utc: new Date(ms).toISOString(), latitudeDeg, longitudeDeg, diameterRatio,
      sunAltDeg: Number(tokens[ri + 1]), durationS: sepathDuration(tokens[ri + 4], name),
    });
  }

  // self-checks: two limits, a steady 120 s cadence, and greatest eclipse inside the timed rows.
  assert.equal(limits.length, 2, `${name}: expected the two Limits rows, found ${limits.length}`);
  assert.ok(centralLine.length >= 20, `${name}: only ${centralLine.length} timed rows`);
  for (let i = 1; i < centralLine.length; i++) {
    assert.equal(Date.parse(centralLine[i].utc) - Date.parse(centralLine[i - 1].utc), SEPATH_STEP_SECONDS * 1000,
      `${name}: row ${centralLine[i].utc} is not ${SEPATH_STEP_SECONDS} s after the one before it`);
  }
  assert.ok(geMs > Date.parse(centralLine[0].utc) && geMs < Date.parse(centralLine.at(-1).utc), `${name}: greatest eclipse outside the rows`);

  return {
    eclipse, kind, deltaTSeconds: Number(dtMatch[1]),
    greatestEclipse: {
      utc: new Date(geMs).toISOString(),
      latitudeDeg: sepathDeg(ge[4], `${ge[5]}${ge[6]}`, name),
      longitudeDeg: sepathDeg(ge[7], `${ge[8]}${ge[9]}`, name),
    },
    limits, centralLine,
  };
}

function deriveSepath(retrieved, requests) {
  const paths = SEPATH_PATHS.map((p) => sepathFile(p, sepathName(p)));
  // self-check against the table the issue quotes: 2026-08-12 peaks at 65°13.5'N 25°13.7'W.
  const aug2026 = paths.find((p) => p.eclipse === "2026-08-12");
  assert.deepEqual(
    [aug2026.greatestEclipse.utc, aug2026.greatestEclipse.latitudeDeg, aug2026.greatestEclipse.longitudeDeg, aug2026.deltaTSeconds],
    ["2026-08-12T17:45:53.800Z", 65.225, -25.228333, 71.4], "solar paths: 2026-08-12 greatest eclipse");
  return {
    "eclipses/solar-paths.json": json(paths),
    solarPathsMeta: {
      source: "NASA/GSFC eclipse path tables (eclipse.gsfc.nasa.gov/SEpath)",
      retrieved,
      requests: SEPATH_PATHS.map((p) => requests[sepathName(p)]),
      stepSeconds: SEPATH_STEP_SECONDS,
      note: "Each table's UT is its TD minus its own deltaTSeconds, a few seconds from the Espenak–Meeus value this package uses, so compare at the same TD. Coordinates are WGS 84; greatestEclipse is to 0.1 arcminute. limits holds the central line where the path meets the horizon at its start and end, whose times the tables do not give. durationS is the central duration at each row.",
    },
  };
}

function deriveSolar(usno, espenak, sepath) {
  const { "eclipses/solar-local.json": localJson, solarLocalMeta } = deriveUsnoSolar(usno.retrieved, usno.requests);
  const { "eclipses/solar-catalog.json": catalogJson, solarCatalogMeta } = deriveEspenakSolarCatalog(espenak.retrieved, espenak.requests);
  const { "eclipses/solar-paths.json": pathsJson, solarPathsMeta } = deriveSepath(sepath.retrieved, sepath.requests);
  return {
    "eclipses/solar-local.json": localJson,
    "eclipses/solar-catalog.json": catalogJson,
    "eclipses/solar-paths.json": pathsJson,
    "eclipses/solar-meta.json": json({ local: solarLocalMeta, catalog: solarCatalogMeta, paths: solarPathsMeta }),
  };
}

function deriveEspenak(retrieved, requests) {
  const { "eclipses/espenak-1950-2100.json": catalogJson, filteredMeta } = deriveEspenakCatalog(retrieved, requests);
  const { "eclipses/contacts.json": contactsJson } = deriveEspenakContacts(retrieved, requests);
  return {
    "eclipses/espenak-1950-2100.json": catalogJson,
    "eclipses/contacts.json": contactsJson,
    "eclipses/meta.json": json({
      source: "NASA/GSFC Five Millennium Catalog of Lunar Eclipses (eclipse.gsfc.nasa.gov)",
      retrieved,
      requests: [
        requests["LE1901-2000"], requests["LE2001-2100"],
        ...ESPENAK_CONTACTS_SPEC.map((c) => requests[c.name]),
      ],
      ...filteredMeta,
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

// Parses rows between $$SOE/$$EOE. The `time` field is whatever scale the
// request asked for (TIME_TYPE): UT for most files, TT for the coarse position
// runs -- callers label it. Horizons' az/el output inserts a 2-char
// solar/lunar presence flag between the date and the numeric columns (e.g.
// "*m", "Nm", " "); pulling floats out with a regex sidesteps that flag
// entirely instead of column-counting around it.
/** Each ephemeris line with its ISO instant and the text after the date. */
function parseRawLines(text) {
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
    rows.push({ time: `${y}-${month}-${d}T${hms}Z`, line: line.slice(m.index + full.length) });
  }
  return rows;
}

function parseRawRows(text) {
  return parseRawLines(text).map(({ time, line }) => ({
    time, nums: (line.match(/[+-]?\d+\.\d+(?:E[+-]?\d+)?/g) || []).map(Number),
  }));
}

function json(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

function byUtc(a, b) {
  return a.utc.localeCompare(b.utc);
}

function byTime(key) {
  return (a, b) => a[key].localeCompare(b[key]);
}

function derivePositions(dates, requests) {
  function sunFile(name, expectMin, expectExact, timeKey) {
    const rows = parseRawRows(raw(name))
      .map(({ time, nums }) => ({ [timeKey]: time, raDeg: nums[0], decDeg: nums[1], distanceAu: nums[2] }))
      .sort(byTime(timeKey));
    for (const r of rows) {
      const t = r[timeKey];
      assert.ok(r.decDeg >= -90 && r.decDeg <= 90, `${name}: decDeg out of range at ${t}`);
      assert.ok(r.raDeg >= 0 && r.raDeg <= 360, `${name}: raDeg out of range at ${t}`);
      assert.ok(r.distanceAu >= 0.98 && r.distanceAu <= 1.02, `${name}: distanceAu out of range at ${t}: ${r.distanceAu}`);
    }
    if (expectExact != null) assert.equal(rows.length, expectExact, `${name}: expected ${expectExact} rows, got ${rows.length}`);
    if (expectMin != null) assert.ok(rows.length >= expectMin, `${name}: expected >=${expectMin} rows, got ${rows.length}`);
    return rows;
  }

  function moonFile(name, expectMin, expectExact, timeKey) {
    const rows = parseRawRows(raw(name))
      .map(({ time, nums }) => ({
        [timeKey]: time, raDeg: nums[0], decDeg: nums[1], distanceKm: nums[3] * AU_KM, illumFraction: nums[2] / 100,
      }))
      .sort(byTime(timeKey));
    for (const r of rows) {
      const t = r[timeKey];
      assert.ok(r.decDeg >= -90 && r.decDeg <= 90, `${name}: decDeg out of range at ${t}`);
      assert.ok(r.raDeg >= 0 && r.raDeg <= 360, `${name}: raDeg out of range at ${t}`);
      assert.ok(r.illumFraction >= 0 && r.illumFraction <= 1, `${name}: illumFraction out of range at ${t}`);
      assert.ok(r.distanceKm >= 356000 && r.distanceKm <= 407000, `${name}: distanceKm out of range at ${t}: ${r.distanceKm}`);
    }
    if (expectExact != null) assert.equal(rows.length, expectExact, `${name}: expected ${expectExact} rows, got ${rows.length}`);
    if (expectMin != null) assert.ok(rows.length >= expectMin, `${name}: expected >=${expectMin} rows, got ${rows.length}`);
    return rows;
  }

  // Coarse files are TT-labeled (`tt`), dense files UT-labeled (`utc`) -- see
  // the note in positions/meta.json for why.
  const sunCoarse = sunFile("sun-coarse", 1830, null, "tt");
  const moonCoarse = moonFile("moon-coarse", 1830, null, "tt");
  const sunDense = sunFile("sun-dense", null, 745, "utc");
  const moonDense = moonFile("moon-dense", null, 745, "utc");

  for (const name of ["sun-coarse", "moon-coarse"]) {
    // self-check: the raw response really came back on the TT scale. A silently
    // ignored TIME_TYPE would otherwise mislabel UT rows as `tt`.
    assert.match(raw(name), /Date__\(TT\)__/, `${name}: raw response is not TT-labeled`);
  }
  assert.match(raw("sun-dense"), /Date__\(UT\)__/, "sun-dense: raw response is not UT-labeled");
  assert.match(raw("moon-dense"), /Date__\(UT\)__/, "moon-dense: raw response is not UT-labeled");

  for (const [name, rows] of [["sun-coarse", sunCoarse], ["moon-coarse", moonCoarse]]) {
    assert.equal(rows[0].tt.slice(0, 4), "1950", `${name}: does not start at 1950`);
    assert.equal(rows.at(-1).tt.slice(0, 4), "2100", `${name}: does not end at 2100`);
  }

  return {
    "positions/sun-coarse.json": json(sunCoarse),
    "positions/moon-coarse.json": json(moonCoarse),
    "positions/sun-dense.json": json(sunDense),
    "positions/moon-dense.json": json(moonDense),
    "positions/meta.json": json({
      source: "JPL Horizons API",
      sourceVersion: sourceVersion(raw("sun-coarse")),
      requests: withDates(["sun-coarse", "moon-coarse", "sun-dense", "moon-dense"], requests, dates),
      toleranceArcmin: TOLERANCE_ARCMIN,
      note: "Coarse rows carry `tt` (Terrestrial Time-labeled instants, requested with TIME_TYPE='TT'); dense rows carry `utc`. Horizons applies real historical delta-T but holds it fixed at its present value for future dates, so UT-labeled rows over 1950-2100 disagree with any real delta-T model (e.g. Espenak-Meeus) by up to ~136 s at 2100 - ~75 arcsec of lunar motion, well past the 1 arcmin tolerance. TT labeling removes the timescale from the comparison; consumers feed `tt` straight to a TT entry point instead of converting from UTC.",
    }),
  };
}

// --- Equation of time and Moon apsides (Horizons), seasons (USNO) ----------

const SOLAR_TIME_NAMES = ["sun-solar-time-1950", "sun-solar-time-2026", "sun-solar-time-2100"];
const RANGE_RATE_NAMES = ["moon-range-rate-1950", "moon-range-rate-2026", "moon-range-rate-2049"];

// Horizons quantity 34 prints local apparent solar time, in decimal hours
// under ANG_FORMAT=DEG, after the solar/lunar presence markers; at longitude 0
// it is UT plus the equation of time.
function deriveEquationOfTime(dates, urls) {
  const rows = [];
  for (const name of SOLAR_TIME_NAMES) {
    const text = raw(name);
    assert.match(text, /Date__\(UT\)__/, `${name}: raw response is not UT-labeled`);
    for (const { time, line } of parseRawLines(text)) {
      const solarHours = Number(line.trim().split(/\s+/).at(-1));
      assert.ok(Number.isFinite(solarHours) && solarHours >= 0 && solarHours < 24, `${name}: unparseable solar time in row: ${line}`);
      const utSeconds = Number(time.slice(11, 13)) * 3600 + Number(time.slice(14, 16)) * 60 + Number(time.slice(17, 19));
      let minutes = (solarHours * 3600 - utSeconds) / 60;
      if (minutes > 720) minutes -= 1440;
      if (minutes <= -720) minutes += 1440;
      assert.ok(Math.abs(minutes) < 17, `${name}: equation of time out of range at ${time}: ${minutes}`);
      rows.push({ utc: time, minutes: Number(minutes.toFixed(4)) });
    }
  }
  rows.sort(byUtc);
  assert.equal(rows.length, 366 + 1461 + 365, `equation of time: unexpected row count ${rows.length}`);
  // self-check: the four zero crossings of 2026 land in the months Meeus
  // tabulates (mid April, mid June, start of September, late December).
  const months2026 = [];
  const in2026 = rows.filter((r) => r.utc.startsWith("2026"));
  for (let i = 1; i < in2026.length; i++) {
    if (Math.sign(in2026[i].minutes) !== Math.sign(in2026[i - 1].minutes)) months2026.push(in2026[i].utc.slice(5, 7));
  }
  assert.deepEqual(months2026, ["04", "06", "09", "12"], `equation of time: zero crossings of 2026 in ${months2026}`);
  return {
    "equation-of-time/horizons-eot.json": json(rows),
    "equation-of-time/meta.json": json({
      source: "JPL Horizons API, quantity 34 (local apparent solar time) for an observer at latitude 0, longitude 0",
      sourceVersion: sourceVersion(raw(SOLAR_TIME_NAMES[0])),
      requests: withDates(SOLAR_TIME_NAMES, urls, dates),
      note: "minutes = apparent solar time minus UT, positive when a sundial is ahead of mean time; rounded to 1e-4 minute.",
    }),
  };
}

// Horizons quantity 20 prints geocentric range (AU) and range rate (km/s). A
// range rate rising through zero is a perigee and falling through zero an
// apogee; the hourly rows bracket each to the minute by linear interpolation,
// which is accurate because the rate crosses zero at its inflection. The
// distance is the nearest row's: within half an hour of an apsis the Moon's
// distance moves under a quarter of a kilometre.
function deriveMoonApsides(dates, urls) {
  const apsides = [];
  for (const name of RANGE_RATE_NAMES) {
    const text = raw(name);
    assert.match(text, /Date__\(UT\)__/, `${name}: raw response is not UT-labeled`);
    const rows = parseRawRows(text).map(({ time, nums }) => ({ ms: Date.parse(time), distanceKm: nums[0] * AU_KM, rateKmS: nums[1] }));
    assert.ok(rows.length > 4000, `${name}: expected hourly rows, got ${rows.length}`);
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i];
      assert.equal(b.ms - a.ms, 3600000, `${name}: rows are not hourly at ${new Date(b.ms).toISOString()}`);
      if (a.rateKmS === 0 || Math.sign(a.rateKmS) === Math.sign(b.rateKmS)) continue;
      const frac = -a.rateKmS / (b.rateKmS - a.rateKmS);
      const ms = Math.round(a.ms + frac * 3600000);
      const nearest = frac < 0.5 ? a : b;
      apsides.push({
        utc: new Date(ms).toISOString().replace(/\.\d+Z$/, "Z"),
        kind: b.rateKmS > 0 ? "perigee" : "apogee",
        distanceKm: Number(nearest.distanceKm.toFixed(1)),
      });
    }
  }
  apsides.sort(byUtc);
  // self-checks: kinds alternate, perigees lie in the perigee band and apogees
  // in the apogee band, and a year holds 13 or 14 of each.
  for (let i = 1; i < apsides.length; i++) {
    const gapDays = (Date.parse(apsides[i].utc) - Date.parse(apsides[i - 1].utc)) / 86400000;
    if (gapDays > 20) continue;   // the gap between two raw files
    assert.notEqual(apsides[i].kind, apsides[i - 1].kind, `apsides: kinds do not alternate at ${apsides[i].utc}`);
    // Evection swings the half anomalistic month between about 11.8 and 15.8 days.
    assert.ok(gapDays > 11 && gapDays < 17, `apsides: ${gapDays} days between apsides at ${apsides[i].utc}`);
  }
  for (const a of apsides) {
    const [lo, hi] = a.kind === "perigee" ? [356000, 371000] : [404000, 407000];
    assert.ok(a.distanceKm >= lo && a.distanceKm <= hi, `apsides: ${a.kind} distance ${a.distanceKm} at ${a.utc}`);
  }
  const in2026 = apsides.filter((a) => a.utc.startsWith("2026"));
  for (const kind of ["perigee", "apogee"]) {
    const n = in2026.filter((a) => a.kind === kind).length;
    assert.ok(n === 13 || n === 14, `apsides: 2026 holds ${n} ${kind}s`);
  }
  return {
    "apsides/horizons-apsides.json": json(apsides),
    "apsides/meta.json": json({
      source: "JPL Horizons API, quantity 20 (geocentric range and range rate of the Moon), hourly",
      sourceVersion: sourceVersion(raw(RANGE_RATE_NAMES[0])),
      requests: withDates(RANGE_RATE_NAMES, urls, dates),
      note: "Apsis instants are the linear interpolation of the hourly range rate through zero, to the second. distanceKm is the nearest hourly row's geocentric range. Windows end in 2049 so Horizons' frozen Delta-T stays within a few seconds of the Espenak-Meeus model.",
    }),
  };
}

const USNO_SEASON_KINDS = { 3: "marchEquinox", 6: "juneSolstice", 9: "septemberEquinox", 12: "decemberSolstice" };

function deriveUsnoSeasons(usno) {
  const seasons = [];
  for (const year of SEASON_YEARS) {
    const name = seasonsName(year);
    const data = rawUsno(name);
    assert.equal(data.year, year, `${name}: year mismatch`);
    const kinds = [];
    for (const p of data.data) {
      if (p.phenom === "Perihelion" || p.phenom === "Aphelion") continue;
      assert.ok(p.phenom === "Equinox" || p.phenom === "Solstice", `${name}: unmapped USNO phenomenon "${p.phenom}"`);
      const kind = USNO_SEASON_KINDS[p.month];
      assert.ok(kind, `${name}: ${p.phenom} in month ${p.month}`);
      assert.ok(/^\d{2}:\d{2}$/.test(p.time), `${name}: unparseable time "${p.time}"`);
      kinds.push(kind);
      seasons.push({ kind, utc: `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${p.time}Z` });
    }
    assert.deepEqual(kinds, Object.values(USNO_SEASON_KINDS), `${name}: expected four seasons in order, got ${kinds}`);
  }
  seasons.sort(byUtc);
  assert.equal(seasons.length, 4 * SEASON_YEARS.length, "seasons: unexpected row count");
  return {
    "seasons/usno-seasons.json": json(seasons),
    "seasons/meta.json": json({
      source: "USNO Astronomical Applications API (aa.usno.navy.mil/api/seasons)",
      sourceVersion: rawUsno(seasonsName(SEASON_YEARS[0])).apiversion,
      retrieved: usno.partial?.[seasonsName(SEASON_YEARS[0])] ?? usno.retrieved,
      requests: SEASON_YEARS.map((y) => usno.requests[seasonsName(y)]),
      note: "Minute-precision UT. Rows after 2050 inherit USNO's Delta-T projection, which diverges from Espenak-Meeus; tests quarantine them as they do the moon phases.",
    }),
  };
}

function deriveAltaz(dates, requests) {
  function altazFile(name, expectExact) {
    const rows = parseRawRows(raw(name))
      .map(({ time, nums }) => ({ utc: time, azDeg: nums[0], altDeg: nums[1] }))
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
    ["sun-airless-twilight-trop-mar", TROPIC],
    ["sun-airless-twilight-trop-jun", TROPIC],
    ["sun-airless-twilight-polar-feb", POLAR],
    ["sun-airless-twilight-polar-may", POLAR],
    ["sun-airless-twilight-polar-dec", POLAR],
  ];
  const twilightRows = twilightSpecs.flatMap(([name, s]) => {
    const rows = parseRawRows(raw(name)).map(({ time, nums }) => ({
      utc: time, azDeg: nums[0], altDeg: nums[1], siteLatDeg: s.lat, siteLonDeg: s.lon,
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

  const transitSpecs = [
    ["sun-hour-angle-vic", "sun", VIC], ["moon-hour-angle-vic", "moon", VIC],
    ["sun-hour-angle-s88", "sun", S88], ["moon-hour-angle-s88", "moon", S88],
  ];
  const transits = transitSpecs.map(([name, body, s]) => hourAngleTransits(name, body, s));
  const orientationSpecs = [
    ["moon-orientation-vic", "sun-orientation-vic", VIC],
    ["moon-orientation-polar", "sun-orientation-polar", POLAR],
  ];
  const orientation = orientationSpecs.flatMap(([moon, sun, s]) => moonOrientationRows(moon, sun, s));

  return {
    "altaz/sun-victoria-2026-03.json": json(sunVictoria),
    "altaz/moon-victoria-2026-03.json": json(moonVictoria),
    "altaz/sun-airless-twilight.json": json(twilightRows),
    "altaz/transits.json": json(transits),
    "altaz/moon-orientation.json": json(orientation),
    "altaz/meta.json": json({
      source: "JPL Horizons API",
      sourceVersion: sourceVersion(raw("sun-altaz-victoria")),
      requests: withDates([
        "sun-altaz-victoria", "moon-altaz-victoria",
        ...twilightSpecs.map(([n]) => n),
        ...transitSpecs.map(([n]) => n),
        ...orientationSpecs.flat().filter((n) => typeof n === "string"),
      ], requests, dates),
      toleranceArcmin: TOLERANCE_ARCMIN,
      transits: "Upper and lower transits interpolated linearly where the one-minute local apparent hour angle (quantity 42) crosses 0 h and 12 h; tolerance 60 seconds.",
      moonOrientation: "brightLimbDeg is the position angle of the Sun from the Moon on the true equator of date, from Horizons' apparent topocentric RA/Dec of both bodies (Meeus 48.5). Horizons' PsAng is measured from the ICRF north pole, so it is not compared directly; the same formula applied to the ICRF positions reproduces PsAng + 180 degrees, which derive.mjs asserts. parallacticDeg is the angle at the Moon between the celestial pole and the geodetic zenith, from Horizons' airless azimuth and elevation and the site latitude; derive.mjs asserts that the hour-angle formula on Horizons' hour angle and apparent declination agrees. Tolerance 1 arcminute; the bright limb adds the 8.8 arcsecond solar parallax over sin(elongation), because Almanac uses the geocentric Sun.",
    }),
  };
}

const D2R = Math.PI / 180;
const norm360 = (deg) => ((deg % 360) + 360) % 360;

// Upper transit where the hour angle rises through 0 h, lower where it wraps
// from +12 h to -12 h. Hour angles are unwrapped across the lower transit.
function hourAngleTransits(name, body, s) {
  const text = raw(name);
  assert.ok(/Date__\(UT\)__.*L_Ap_Hour_Ang/.test(text), `${name}: not a UT hour-angle grid`);
  const grid = parseRawRows(text);
  assert.equal(grid.length, 2881, `${name}: expected a two-day one-minute grid`);
  const out = [];
  for (let i = 1; i < grid.length; i++) {
    const ta = Date.parse(grid[i - 1].time), tb = Date.parse(grid[i].time);
    assert.equal(tb - ta, 60000, `${name}: grid step`);
    const ha = grid[i - 1].nums[0];
    let hb = grid[i].nums[0];
    assert.ok(Math.abs(ha) <= 12 && Math.abs(hb) <= 12, `${name}: hour angle out of range`);
    let level = 0, kind = "upper";
    if (hb - ha < -12) { hb += 24; level = 12; kind = "lower"; }
    if (!(ha < level && hb >= level)) continue;
    out.push({ utc: new Date(Math.round(ta + (tb - ta) * (level - ha) / (hb - ha))).toISOString(), kind });
  }
  assert.ok(out.some((e) => e.kind === "upper") && out.some((e) => e.kind === "lower"), `${name}: missing a transit kind`);
  return { body, observer: { latitudeDeg: s.lat, longitudeDeg: s.lon }, startUtc: grid[0].time, endUtc: grid.at(-1).time, transits: out };
}

/** Meeus 48.5: position angle of the Sun from the Moon, from north through east. */
function brightLimbDeg(moonRa, moonDec, sunRa, sunDec) {
  const dRa = (sunRa - moonRa) * D2R;
  return norm360(Math.atan2(
    Math.cos(sunDec * D2R) * Math.sin(dRa),
    Math.sin(sunDec * D2R) * Math.cos(moonDec * D2R) - Math.cos(sunDec * D2R) * Math.sin(moonDec * D2R) * Math.cos(dRa),
  ) / D2R);
}

function signed180(deg) {
  const x = norm360(deg);
  return x > 180 ? x - 360 : x;
}

function moonOrientationRows(moonName, sunName, s) {
  const moonText = raw(moonName), sunText = raw(sunName);
  assert.ok(/Date__\(UT\)__.*R\.A\._+\(ICRF\)_+DEC.*R\.A\._\(a-appar\)_DEC.*Azi_+\(a-app\)_+Elev.*S-O-T.*PsAng.*L_Ap_Hour_Ang/.test(moonText), `${moonName}: wrong columns`);
  assert.ok(/Date__\(UT\)__.*R\.A\._+\(ICRF\)_+DEC.*R\.A\._\(a-appar\)_DEC/.test(sunText), `${sunName}: wrong columns`);
  const moon = parseRawRows(moonText), sun = parseRawRows(sunText);
  assert.equal(moon.length, 745, `${moonName}: expected hourly rows over March 2026`);
  assert.equal(sun.length, moon.length, `${sunName}: row count differs from the Moon's`);
  const phi = s.lat * D2R;
  return moon.map((m, i) => {
    assert.equal(sun[i].time, m.time, `${sunName}: times differ at row ${i}`);
    assert.equal(m.nums.length, 10, `${moonName}: unexpected columns at ${m.time}`);
    const [raJ, decJ, ra, dec, azDeg, altDeg, elongationDeg, psAngDeg, , haHours] = m.nums;
    const [sunRaJ, sunDecJ, sunRa, sunDec] = sun[i].nums;
    // PsAng is the Sun-to-Moon direction on the ICRF sky: the bright limb in that frame, turned half a circle.
    const icrf = brightLimbDeg(raJ, decJ, sunRaJ, sunDecJ);
    assert.ok(Math.abs(signed180(icrf - psAngDeg - 180)) < 0.002 / Math.sin(elongationDeg * D2R),
      `${moonName}: ICRF bright limb ${icrf} disagrees with PsAng ${psAngDeg} at ${m.time}`);
    const a = azDeg * D2R, h = altDeg * D2R, d = dec * D2R;
    const parallacticDeg = Math.atan2(-Math.sin(a) * Math.cos(phi) * Math.cos(h), Math.sin(phi) - Math.sin(d) * Math.sin(h)) / D2R;
    const H = haHours * 15 * D2R;
    const fromHourAngle = Math.atan2(Math.sin(H), Math.tan(phi) * Math.cos(d) - Math.sin(d) * Math.cos(H)) / D2R;
    assert.ok(Math.abs(signed180(parallacticDeg - fromHourAngle)) < 0.01, `${moonName}: parallactic formulas disagree at ${m.time}`);
    return {
      utc: m.time, observer: { latitudeDeg: s.lat, longitudeDeg: s.lon }, elongationDeg, psAngDeg,
      brightLimbDeg: Number(brightLimbDeg(ra, dec, sunRa, sunDec).toFixed(6)),
      parallacticDeg: Number(parallacticDeg.toFixed(6)),
    };
  });
}

function derivePlanets(dates, requests) {
  const planets = ["mercury", "venus", "earth", "mars", "jupiter", "saturn", "uranus", "neptune"];
  const heliocentric = [], positions = [], altaz = [], illumination = [], events = [];
  const names = [];
  function rows(name, vector, expected) {
    names.push(name);
    const text = raw(name);
    if (vector) {
      assert.match(text, /Center body name: Sun \(10\)/, `${name}: not Sun-centered`);
      assert.match(text, /Output units\s+: AU-D/, `${name}: wrong vector units`);
      assert.match(text, /Output type\s+: GEOMETRIC cartesian states/, `${name}: corrected vector`);
      assert.match(text, /Reference frame\s+: ICRF/, `${name}: wrong vector frame`);
      assert.match(text, /Calendar Date \(TT \).*X,\s+Y,\s+Z,/, `${name}: wrong vector columns or time scale`);
    } else {
      assert.match(text, /Date__\(TT\)__.*R\.A\._\(a-appar\)_DEC\..*APmag.*Illu%.*delta.*S-O-T.*S-T-O/, `${name}: wrong observer columns or time scale`);
    }
    const parsed = parseRawRows(text);
    assert.ok(expected === 2 ? parsed.length === 2 : parsed.length >= 1830, `${name}: unexpected row count`);
    for (const row of parsed) {
      assert.equal(row.nums.length, vector ? 3 : 9, `${name}: unexpected numeric columns at ${row.time}`);
      assert.ok(row.nums.every(Number.isFinite), `${name}: non-finite value`);
    }
    return parsed;
  }
  for (const planet of planets) {
    const helio = [...rows(`planet-${planet}-helio`, true), ...rows(`planet-${planet}-helio-boundaries`, true, 2)];
    for (const { time, nums } of new Map(helio.map(r => [r.time, r])).values()) {
      heliocentric.push({ planet, tt: time, xAu: nums[0], yAu: nums[1], zAu: nums[2] });
    }
    if (planet === "earth") continue;
    const coarse = [...rows(`planet-${planet}-coarse`, false), ...rows(`planet-${planet}-boundaries`, false, 2)];
    for (const { time, nums } of new Map(coarse.map(r => [r.time, r])).values()) {
      assert.ok(nums[0] >= 0 && nums[0] <= 360 && Math.abs(nums[1]) <= 90 && nums[5] > 0, `${planet}: invalid position`);
      positions.push({ planet, tt: time, raDeg: nums[0], decDeg: nums[1], distanceAu: nums[5] });
      illumination.push({ planet, tt: time, magnitude: nums[2], fraction: nums[4]/100, elongationDeg: nums[7], phaseAngleDeg: nums[8] });
    }
    for (const mode of ["airless", "refracted"]) {
      const name = `planet-${planet}-${mode}`;
      names.push(name);
      const header = mode === "airless" ? /Date__\(UT\)__.*Azi_+\(a-app\)_+Elev/ : /Date__\(UT\)__.*Azi_+\(r-app\)_+Elev/;
      assert.ok(header.test(raw(name)), `${name}: wrong horizontal columns`);
      const track = parseRawRows(raw(name));
      assert.equal(track.length, 169, `${name}: unexpected row count`);
      for (const { time, nums } of track) {
        assert.equal(nums.length, 2, `${name}: unexpected numeric columns`);
        assert.ok(nums[0] >= 0 && nums[0] <= 360 && Math.abs(nums[1]) <= 90, `${name}: invalid horizontal position`);
        altaz.push({ planet, utc: time, mode, observer: { latitudeDeg: VIC.lat, longitudeDeg: VIC.lon }, azDeg: nums[0], altDeg: nums[1] });
      }
    }
  }
  for (const mode of ["airless", "refracted"]) {
    const name = `planet-venus-zenith-${mode}`;
    names.push(name);
    const track = parseRawRows(raw(name));
    assert.equal(track.length, 13, `${name}: unexpected zenith track count`);
    assert.ok(Math.max(...track.map(r => r.nums[1])) > 89, `${name}: track misses zenith`);
    for (const { time, nums } of track) {
      assert.equal(nums.length, 2, `${name}: unexpected zenith columns`);
      altaz.push({ planet: "venus", utc: time, mode, observer: { latitudeDeg: -2.4975, longitudeDeg: -104.0738 }, azDeg: nums[0], altDeg: nums[1] });
    }
  }
  const reference = JSON.parse(readFileSync(new URL("../raw/planet-photometry/reference.json", import.meta.url), "utf8"));
  assert.equal(reference.commit, "865d3da7d8112bbc7911238052c6af4aaf877181");
  for (const row of reference.rows) {
    assert.ok([row.fraction, row.phaseAngleDeg, row.magnitude, row.elongationDeg].every(Number.isFinite), "invalid pinned photometry");
  }
  const dips = JSON.parse(readFileSync(new URL("../raw/horizon/dip.json", import.meta.url), "utf8")).rows;
  for (const name of Object.keys(requests).filter(n => n.startsWith("planet-") && n.includes("-events-"))) {
    names.push(name);
    const params = new URL(requests[name]).searchParams;
    const [longitudeDeg, latitudeDeg, elevationKm] = params.get("SITE_COORD").replaceAll("'", "").split(",").map(Number);
    const observer = { latitudeDeg, longitudeDeg, elevationM: elevationKm*1000 };
    const heightAboveGroundM = name.endsWith("victoria") ? 100 : 0;
    const dip = heightAboveGroundM === 0 ? 0 : dips.find(r => r.observer.latitudeDeg === latitudeDeg && r.observer.elevationM === observer.elevationM && r.heightAboveGroundM === heightAboveGroundM)?.dipDeg;
    assert.ok(Number.isFinite(dip), `${name}: missing pinned horizon dip`);
    const target = dip - 34/60;
    const text = raw(name);
    assert.ok(/Date__\(UT\)__.*Azi_+\(a-app\)_+Elev/.test(text), `${name}: event grid is not airless UT`);
    const grid = parseRawRows(text);
    assert.equal(grid.length, 2881, `${name}: expected two-day one-minute grid`);
    const crossings = [];
    for (let i = 1; i < grid.length; i++) {
      const a = grid[i-1], b = grid[i], ta = Date.parse(a.time), tb = Date.parse(b.time);
      assert.equal(tb-ta, 60000, `${name}: grid step`);
      const fa = a.nums[1]-target, fb = b.nums[1]-target;
      if ((fa < 0) === (fb < 0)) continue;
      const ms = ta + (tb-ta)*(-fa)/(fb-fa);
      if (ms >= Date.parse(grid.at(-1).time)) continue;
      crossings.push({ utc: new Date(Math.round(ms)).toISOString(), kind: fb >= 0 ? "rise" : "set" });
    }
    events.push({ planet: name.split("-")[1], observer, heightAboveGroundM,
      startUtc: grid[0].time, endUtc: grid.at(-1).time, events: crossings });
  }
  assert.equal(events.length, 14, "expected seven midlatitude and seven polar grids");
  return {
    "planets/heliocentric.json": json(heliocentric),
    "planets/positions.json": json(positions),
    "planets/altaz.json": json(altaz),
    "planets/illumination.json": json(illumination),
    "planets/photometry-reference.json": json(reference),
    "planets/events.json": json(events),
    "planets/meta.json": json({ source: "JPL Horizons API", sourceVersion: sourceVersion(raw("planet-mercury-coarse")),
      requests: withDates(names, requests, dates),
      heliocentric: { center: "Sun", frame: "ICRF / J2000 mean equatorial", corrections: "NONE", timeScale: "TT", units: "AU", toleranceAu: 1e-3 },
      positions: { center: "Earth", frame: "true equator and equinox of date", timeScale: "TT", toleranceArcmin: 1, toleranceAu: 1e-3 },
      altaz: { timeScale: "UT", modes: ["AIRLESS", "REFRACTED"], toleranceArcmin: 1, refractedMinimumAltitudeDeg: 10 },
      illumination: { timeScale: "TT", fractionTolerance: 0.01, elongationToleranceArcmin: 1, magnitudeTolerance: 0.3,
        note: "JPL APmag and pinned VisualMagnitude differ for extreme Venus crescents: five rows at phase 173.8138–176.9577 degrees exceed 0.3 magnitudes, maximum 0.749544 at 2060-05-23. All raw and derived JPL rows are retained and checked for fraction/elongation. The pinned high-phase Venus branch (phase >= 163.6 degrees) is compared with pinned upstream photometry instead of treating its different model as compatible JPL magnitude evidence. Other planet magnitudes and lower-phase Venus remain within 0.3 of JPL. Current Horizons Saturn APmag includes rings under its documented Earth-observer conditions; the pinned source's comment claiming no rings is obsolete.",
        photometryReference: { source: reference.source, commit: reference.commit, modelSources: reference.modelSources, method: reference.method },
      },
      events: { timeScale: "UT", gridStepSeconds: 60, toleranceSeconds: 60, method: "Linear interpolation of committed JPL AIRLESS one-minute altitudes at pinned horizonDip minus 34/60 degrees; point centers, no semidiameter.",
        grazingCases: "grazing-cases.json contains model-selected inputs only, not expected outputs. Tests independently scan at one-minute steps to check solver completeness.",
      },
    }),
  };
}

// --- USNO celestial-navigation star alt/az + SIMBAD J2000 positions --------

// A star whose proper motion moves it more than this drifts past the 1 arcmin
// tolerance before 2050 from its J2000 catalog position, which is the
// no-proper-motion contract `starAltAz` makes; those stars are dropped here,
// not asserted loosely.
const STAR_MAX_PM_MAS_PER_YEAR = 300;

function rawStars(name) {
  return readFileSync(new URL(name, STARS_RAW_DIR), "utf8");
}

// SIMBAD's ASCII card: "Coordinates(ICRS,ep=J2000,eq=2000): 05 55 10.30536  +07 24 25.4304 ..."
// and "Proper motions: 27.54 11.30 ..." (mas/yr, RA already times cos dec).
function parseSimbad(id) {
  const text = rawStars(`simbad-${id.replace(/\s+/g, "-")}.txt`);
  const c = text.match(/Coordinates\(ICRS,ep=J2000,eq=2000\):\s+(\d+) (\d+) ([\d.]+)\s+([+-])(\d+) (\d+) ([\d.]+)/);
  assert.ok(c, `${id}: no ICRS J2000 coordinates`);
  const raDeg = 15 * (Number(c[1]) + Number(c[2]) / 60 + Number(c[3]) / 3600);
  const decDeg = (c[4] === "-" ? -1 : 1) * (Number(c[5]) + Number(c[6]) / 60 + Number(c[7]) / 3600);
  const pm = text.match(/Proper motions:\s+(-?[\d.]+) (-?[\d.]+)/);
  assert.ok(pm, `${id}: no proper motion`);
  const pmMasPerYear = Math.hypot(Number(pm[1]), Number(pm[2]));
  return { raDeg: Number(raDeg.toFixed(6)), decDeg: Number(decDeg.toFixed(6)), pmMasPerYear };
}

function deriveStars(retrieved, requests) {
  const catalog = Object.fromEntries(Object.entries(STAR_IDS).map(([label, id]) => [label, { id, ...parseSimbad(id) }]));
  const kept = Object.keys(catalog).filter((l) => catalog[l].pmMasPerYear <= STAR_MAX_PM_MAS_PER_YEAR);
  const dropped = Object.keys(catalog).filter((l) => !kept.includes(l));
  assert.ok(dropped.includes("ARCTURUS") && dropped.includes("SIRIUS"), "stars: the fast movers should be dropped");

  const rows = [];
  let apiversion;
  for (const site of STAR_SITES) {
    for (const date of STAR_DATES) {
      const name = `celnav-${site.slug}-${date}`;
      const raw = JSON.parse(rawStars(`${name}.json`));
      apiversion ??= raw.apiversion;
      const utc = `${date}T${STAR_TIME}Z`;
      for (const entry of raw.properties.data) {
        const star = catalog[entry.object];
        if (!star) continue; // Sun, Moon, planets, and the first point of Aries
        // A resolver mistake would put SIMBAD's star a sky away from USNO's.
        assert.ok(Math.abs(star.decDeg - entry.almanac_data.dec) < 1,
          `${name}: ${entry.object} dec ${entry.almanac_data.dec} vs SIMBAD ${star.id} ${star.decDeg}`);
        if (!kept.includes(entry.object)) continue;
        const { hc, zn } = entry.almanac_data;
        const refr = entry.altitude_corrections.refr; // sextant correction, negative: apparent = hc - refr
        assert.ok(refr <= 0 && refr > -1, `${name}: ${entry.object} refraction ${refr}`);
        rows.push({
          utc, latitudeDeg: site.lat, longitudeDeg: site.lon, star: entry.object,
          raDeg: star.raDeg, decDeg: star.decDeg,
          azDeg: zn, altDeg: Number((hc - refr).toFixed(6)),
        });
      }
    }
  }
  rows.sort((a, b) => a.utc.localeCompare(b.utc) || a.latitudeDeg - b.latitudeDeg || a.star.localeCompare(b.star));
  assert.ok(rows.length > 100, `stars: expected well over 100 rows, got ${rows.length}`);

  return {
    "altaz/stars-usno.json": json(rows),
    "altaz/stars-meta.json": json({
      source: "USNO Astronomical Applications API (aa.usno.navy.mil/api/celnav) apparent altitude/azimuth; SIMBAD ICRS J2000 positions and proper motions",
      sourceVersion: apiversion,
      retrieved,
      requests: Object.values(requests),
      toleranceArcmin: 1,
      altDeg: "USNO hc (unrefracted computed altitude) minus its refr sextant correction, i.e. refracted apparent altitude",
      maxProperMotionMasPerYear: STAR_MAX_PM_MAS_PER_YEAR,
      droppedForProperMotion: dropped,
    }),
  };
}

// Each Horizons request carries its own retrieval date, so a partial refresh
// cannot relabel files it did not fetch. Every raw response's header records
// when Horizons generated it, in Pasadena time, and the recorded UTC date must
// be that day or the next.
function horizonsRetrieval(requests) {
  const MONTH_NUMBERS = Object.fromEntries(Object.entries(MONTHS).map(([k, v]) => [k, Number(v)]));
  const rawNames = readdirSync(RAW_DIR).filter((f) => f.endsWith(".txt")).map((f) => f.slice(0, -4)).sort();
  assert.deepEqual(Object.keys(requests).sort(), rawNames, "horizons retrieved.json: requests and raw files differ");
  const urls = {}, dates = {};
  for (const [name, entry] of Object.entries(requests)) {
    assert.ok(typeof entry.url === "string" && /^\d{4}-\d{2}-\d{2}$/.test(entry.retrieved ?? ""), `${name}: retrieved.json needs a url and a retrieved date`);
    const m = raw(name).match(/Ephemeris \/ API_USER \w{3} (\w{3})\s+(\d+) [\d:]+ (\d{4})/);
    assert.ok(m, `${name}: no generation timestamp in the raw header`);
    const generated = Date.UTC(Number(m[3]), MONTH_NUMBERS[m[1]] - 1, Number(m[2]));
    const lag = (Date.parse(`${entry.retrieved}T00:00:00Z`) - generated) / 86400000;
    assert.ok(lag === 0 || lag === 1, `${name}: retrieved ${entry.retrieved} does not match the raw header's ${m.slice(1).join(" ")}`);
    urls[name] = entry.url;
    dates[name] = entry.retrieved;
  }
  return { urls, dates };
}

function withDates(names, urls, dates) {
  return names.map((n) => ({ url: urls[n], retrieved: dates[n] }));
}

function main() {
  const check = process.argv.includes("--check");
  const horizons = horizonsRetrieval(JSON.parse(readFileSync(new URL("retrieved.json", RAW_DIR), "utf8")).requests);
  const usno = JSON.parse(readFileSync(new URL("retrieved.json", USNO_RAW_DIR), "utf8"));
  const espenak = JSON.parse(readFileSync(new URL("retrieved.json", ESPENAK_RAW_DIR), "utf8"));
  const sepath = JSON.parse(readFileSync(new URL("retrieved.json", SEPATH_RAW_DIR), "utf8"));
  const stars = JSON.parse(readFileSync(new URL("retrieved.json", STARS_RAW_DIR), "utf8"));

  const files = {
    ...derivePositions(horizons.dates, horizons.urls),
    ...deriveAltaz(horizons.dates, horizons.urls),
    ...derivePlanets(horizons.dates, horizons.urls),
    ...deriveUsnoGrid(usno.retrieved, usno.requests),
    ...deriveUsnoPhases(usno.retrieved, usno.requests),
    ...deriveEquationOfTime(horizons.dates, horizons.urls),
    ...deriveMoonApsides(horizons.dates, horizons.urls),
    ...deriveUsnoSeasons(usno),
    ...deriveEspenak(espenak.retrieved, espenak.requests),
    ...deriveSolar(usno, espenak, sepath),
    ...deriveStars(stars.retrieved, stars.requests),
    ...deriveHorizon(),
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

function deriveHorizon() {
  const raw = JSON.parse(readFileSync(new URL('../raw/horizon/dip.json', import.meta.url), 'utf8'));
  assert.equal(raw.rows.length, 25);
  for (const row of raw.rows) assert.ok(Number.isFinite(row.dipDeg) && row.dipDeg <= 0);
  const { rows, sourceFunction, ...meta } = raw;
  return { 'horizon/dip.json': json(rows), 'horizon/meta.json': json(meta) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
