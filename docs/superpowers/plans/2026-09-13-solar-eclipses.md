# Solar Eclipses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an observer-bound solar eclipse search and an instantaneous obscuration query to both Almanac ports, with USNO and Espenak fixture evidence and a parity corpus.

**Architecture:** A new `solar.ts` / `Solar.swift` translates upstream Astronomy Engine's local solar eclipse path (observer-centred Moon shadow, peak search, contact transitions, two-disc obscuration) and reuses the lunar port's shadow helper, root finder, new-moon probe, and range-search structure. Fixtures land first because they are the oracle the tests run against; TypeScript leads and Swift follows function by function.

**Tech Stack:** TypeScript 7 with Vitest 5 (Node 22 via mise), Swift 6.1 with XCTest in release mode, Node scripts for fixtures, GitHub CI (`typescript`, `swift`, `fixtures` checks).

**Spec:** `docs/superpowers/specs/2026-09-13-solar-eclipses-design.md`

## Global Constraints

- Every behavior change lands in both ports in the same change series. TypeScript leads; Swift mirrors it function by function with the same structure and operation order.
- Astronomy is translated from Astronomy Engine at commit `865d3da7d8112bbc7911238052c6af4aaf877181`, `source/js/astronomy.ts`. A checkout of that file is at `/tmp/astronomy-865d3da/source/js/astronomy.ts` on this machine; cite the upstream function and approximate line above each translation.
- Public API: TypeScript exports only through `typescript/src/index.ts`; Swift's `PublicSurfaceTests.swift` must call every public symbol with plain `import Almanac`.
- Tolerances are normative: contacts C1 to C4 within 60 s, peak within 300 s, obscuration within 0.01, Sun altitude within 0.5° at C1 to C4 and 1.5° at the peak. Never loosen one to pass; a failure is a finding to report with numbers.
- Every returned instant is TimeClip-truncated to integer milliseconds. Swift must not use `floor`.
- Same-eclipse band 100 ms; new-moon prune 1.8° ecliptic latitude; peak window ±0.2 day; partial contact window ±0.2 day; total contact window ±0.01 day; kind bias 0.014 km.
- Root finders keep upstream's 1 s tolerance and 20-iteration cap; exhaustion throws an internal error.
- Prose in docs and comments is never hard-wrapped; durable docs describe current state only.
- Commit messages: imperative plain-language subject, body explains why, and end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. No session links.
- Run every command from the worktree root `/Users/clarkbw/src/openwaters/almanac-wt-solar-eclipses`. TypeScript commands run inside `typescript/` with `mise exec --`. Swift tests run in release mode: `mise exec -- swift test -c release`. If a Swift build appears to hang with no output, it is the keychain prompt on a fresh worktree; report it rather than waiting.

## File structure

| Path | Responsibility |
| --- | --- |
| `fixtures/generate/refresh-usno.mjs` | Adds the nine solar local-circumstance requests (network, run once). |
| `fixtures/generate/refresh-espenak.mjs` | Adds the two Five Millennium solar catalog pages (network, run once). |
| `fixtures/generate/derive.mjs` | Parses the raw solar responses into `eclipses/solar-local.json`, `eclipses/solar-catalog.json`, `eclipses/solar-meta.json`. |
| `fixtures/raw/usno/solar-*.json`, `fixtures/raw/espenak/SE*.html` | Verbatim upstream evidence. |
| `typescript/src/eclipse.ts` | Lunar eclipses; its `ShadowInfo`, `calcShadow`, prune constant, band constant, and root-finder settings become shared internals. |
| `typescript/src/transforms.ts` | Gains `observerGeoVectorEqj`, upstream's `geo_pos`. |
| `typescript/src/solar.ts` | The solar eclipse search and obscuration, public functions and internals. |
| `typescript/src/index.ts` | Allow-list gains the four functions and three types. |
| `typescript/test/solar.test.ts` | Fixture, semantics, and validation tests. |
| `swift/Sources/Almanac/Eclipse.swift`, `Transforms.swift` | The same internal widening as the TypeScript files. |
| `swift/Sources/Almanac/Solar.swift` | Line-for-line mirror of `solar.ts`. |
| `swift/Tests/AlmanacTests/SolarTests.swift`, `Helpers.swift`, `PublicSurfaceTests.swift` | Mirror of the TypeScript tests, a millisecond ISO parser, and public-surface coverage. |
| `fixtures/generate/parity.mjs`, `fixtures/parity/solar.json`, `swift/Tests/AlmanacTests/ParityTests.swift` | Cross-port corpus for the solar search and obscuration. |
| `docs/CONTRACT.md`, `docs/ROADMAP.md`, `README.md`, `typescript/package.json` | Public contract, scope, usage, and package description. |

---

### Task 1: Solar fixtures from USNO and Espenak

**Files:**
- Modify: `fixtures/generate/refresh-usno.mjs`
- Modify: `fixtures/generate/refresh-espenak.mjs`
- Modify: `fixtures/generate/derive.mjs`
- Create (by the scripts): `fixtures/raw/usno/solar-*.json`, `fixtures/raw/espenak/SE1901-2000.html`, `fixtures/raw/espenak/SE2001-2100.html`, `fixtures/eclipses/solar-local.json`, `fixtures/eclipses/solar-catalog.json`, `fixtures/eclipses/solar-meta.json`

**Interfaces:**
- Produces `fixtures/eclipses/solar-local.json`: an array of rows `{ eclipse: "YYYY-MM-DD", place, latitudeDeg, longitudeDeg, visible: boolean }` where visible rows also carry `kind: "partial" | "annular" | "total"`, `magnitude`, `obscuration` (a fraction in `[0, 1]`), and contacts `c1`, `c2`, `peak`, `c3`, `c4`, each `{ utc: "YYYY-MM-DDTHH:MM:SS.mmmZ", sunAltDeg: number | null }` or `null`.
- Produces `fixtures/eclipses/solar-catalog.json`: an array sorted by `peakUtc` of `{ peakUtc, kind: "partial" | "annular" | "total" | "hybrid", central: boolean, gamma, magnitude, latitudeDeg, longitudeDeg, sunAltDeg, pathWidthKm: number | null }` for every eclipse from 1950 through 2100.

- [ ] **Step 1: Add the solar requests to the USNO refresh script**

In `fixtures/generate/refresh-usno.mjs`, after `PHASE_STARTS`, add:

```js
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
```

Change `fetchJson` to accept the not-visible error body:

```js
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
```

Add the jobs after the phase jobs and pass the option through the loop:

```js
  for (const c of SOLAR_CASES) {
    const url = `https://aa.usno.navy.mil/api/eclipses/solar/date?date=${c.date}&coords=${c.lat},${c.lon}&height=0`;
    jobs.push({ name: solarName(c), url, allowError: Boolean(c.notVisible) });
  }

  for (let i = 0; i < jobs.length; i++) {
    const { name, url, allowError } = jobs[i];
    requests[name] = await fetchJson(name, url, { allowError });
    if (i < jobs.length - 1) await sleep(1000); // be polite: ~1 req/s
  }
```

- [ ] **Step 2: Add the solar catalog pages to the Espenak refresh script**

In `fixtures/generate/refresh-espenak.mjs`, extend `CATALOGS`:

```js
const CATALOGS = [
  { name: "LE1901-2000", url: `${BASE}/LEcat5/LE1901-2000.html` },
  { name: "LE2001-2100", url: `${BASE}/LEcat5/LE2001-2100.html` },
  { name: "SE1901-2000", url: `${BASE}/SEcat5/SE1901-2000.html` },
  { name: "SE2001-2100", url: `${BASE}/SEcat5/SE2001-2100.html` },
];
```

Update the header comment's first sentence to "the four Five Millennium Catalog century pages (lunar and solar)".

- [ ] **Step 3: Run both refresh scripts and inspect the diff**

Run:

```bash
mise exec -- node fixtures/generate/refresh-espenak.mjs
mise exec -- node fixtures/generate/refresh-usno.mjs
git status --short fixtures/raw
```

Expected: new files `fixtures/raw/espenak/SE1901-2000.html`, `fixtures/raw/espenak/SE2001-2100.html`, nine `fixtures/raw/usno/solar-*.json`, and both `retrieved.json` files updated with the new request URLs and today's date. Previously committed raw files may show byte changes if the upstream pages were re-served differently; run `git diff --stat fixtures/raw` and, if any previously committed raw file changed, restore it with `git checkout -- <file>` so this change carries only the solar evidence. Confirm `fixtures/raw/usno/solar-2024-04-08-perth.json` contains `"error": "Eclipse not visible from selected location. Please try another location."` and `solar-2021-06-10-toronto.json` contains a `"phenomenon": "Sunrise"` entry with `"altitude": "----"`.

- [ ] **Step 4: Write the derive self-check as a failing check**

Run `mise exec -- node fixtures/generate/derive.mjs --check`.

Expected: `derive.mjs --check: clean` and no mention of solar files, because nothing derives them yet. The next step makes the script produce them.

- [ ] **Step 5: Derive the solar fixtures**

In `fixtures/generate/derive.mjs`, import the case list at the top beside the stars import:

```js
import { SOLAR_CASES, solarName } from "./refresh-usno.mjs";
```

After `deriveUsnoPhases`, add:

```js
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
```

After `deriveEspenakContacts`, add the solar catalog parser:

```js
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
    assert.equal(tokens.length, kind === "partial" ? 15 : 17, `${name}: ${type} row at ${peakUtc} has ${tokens.length} tokens`);
    const central = !/[+-]$/.test(type);
    const pathWidthKm = kind === "partial" || widthStr === "-" ? null : Number(widthStr);
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

function deriveSolar(usno, espenak) {
  const { "eclipses/solar-local.json": localJson, solarLocalMeta } = deriveUsnoSolar(usno.retrieved, usno.requests);
  const { "eclipses/solar-catalog.json": catalogJson, solarCatalogMeta } = deriveEspenakSolarCatalog(espenak.retrieved, espenak.requests);
  return {
    "eclipses/solar-local.json": localJson,
    "eclipses/solar-catalog.json": catalogJson,
    "eclipses/solar-meta.json": json({ local: solarLocalMeta, catalog: solarCatalogMeta }),
  };
}
```

In `main()`, add to the `files` object after `deriveEspenak(...)`:

```js
    ...deriveSolar(usno, espenak),
```

Update the file's header comment so "Horizons responses" reads "Horizons, USNO, and Espenak responses".

- [ ] **Step 6: Generate and check**

Run:

```bash
mise exec -- node fixtures/generate/derive.mjs
mise exec -- node fixtures/generate/derive.mjs --check
head -c 1200 fixtures/eclipses/solar-local.json
node -e 'const c=require("./fixtures/eclipses/solar-catalog.json");console.log(c.length,c[0],c.at(-1))'
```

Expected: `derive.mjs: wrote N files` with N three higher than before, then `--check: clean`. The local file's first row is Salem with `kind: "total"` and five contacts; the catalog has over 300 rows starting 1950-03-18 and ending in 2100. If a self-check assertion fails, the raw page or response differs from what this plan expects: read the raw file and fix the parser, not the assertion.

- [ ] **Step 7: Commit**

```bash
git add fixtures
git commit -F - <<'EOF'
Add solar eclipse fixtures from USNO and the Espenak catalog

The local search needs an external oracle before either port exists. USNO's local circumstances give contacts, Sun altitudes, magnitude and obscuration for nine places, and the Five Millennium solar catalog gives every eclipse from 1950 through 2100 with its kind and the point of greatest eclipse. The USNO endpoint only answers for eclipses from 2001 through 2026, so the cases stay inside that window and the catalog covers the rest of the interval.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 2: TypeScript obscuration at an instant

**Files:**
- Modify: `typescript/src/eclipse.ts:108-137` (ShadowInfo and calcShadow), `typescript/src/eclipse.ts:75-106` (constants), `typescript/src/eclipse.ts:200-203` (moonEclipticLatitudeDeg)
- Modify: `typescript/src/transforms.ts` (after `observerGeoVectorOfDate`, line 101)
- Create: `typescript/src/solar.ts`
- Modify: `typescript/src/index.ts`
- Create: `typescript/test/solar.test.ts`

**Interfaces:**
- Consumes `fixtures/eclipses/solar-catalog.json` from Task 1.
- Produces `export function solarObscuration(time: Date, observer: Observer): number` in `solar.ts`, exported from `index.ts`.
- Produces internal `observerGeoVectorEqj(ut: number, observer: Observer): Vec3` in `transforms.ts`, and internal `localMoonShadow(ut, observer): ShadowInfo`, `discObscuration(hm: Vec3, lo: Vec3): number` in `solar.ts` that Task 3 builds on.
- Widens `eclipse.ts` exports: `ShadowInfo` (with `target: Vec3`, `dir: Vec3`), `calcShadow`, `moonEclipticLatitudeDeg`, `PRUNE_LATITUDE_DEG`, `SAME_ECLIPSE_MS`, `SHADOW_TOL_SECONDS`, `SHADOW_ITER_CAP`.

- [ ] **Step 1: Write the failing test**

Create `typescript/test/solar.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { solarObscuration, AlmanacOutOfRangeError } from '../src/index.js';
import type { Observer } from '../src/index.js';
import { SUPPORTED_MAX } from '../src/types.js';

const load = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/${p}`, import.meta.url), 'utf8'));

const DAY = 86400000;
const VICTORIA: Observer = { latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 0 };
/** A path at least this wide keeps the catalog's whole-degree observer inside it. */
const WIDE_PATH_KM = 200;

interface CatalogRow {
  peakUtc: string;
  kind: 'partial' | 'annular' | 'total' | 'hybrid';
  central: boolean;
  gamma: number;
  magnitude: number;
  latitudeDeg: number;
  longitudeDeg: number;
  sunAltDeg: number;
  pathWidthKm: number | null;
}

const catalog: CatalogRow[] = load('eclipses/solar-catalog.json');
const observerOf = (row: CatalogRow): Observer => ({ latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg });
const isWide = (row: CatalogRow) => row.pathWidthKm !== null && row.pathWidthKm >= WIDE_PATH_KM;

describe('solarObscuration at the point of greatest eclipse', () => {
  it('covers 1950-2100', () => {
    expect(catalog.length).toBeGreaterThan(300);
    expect(catalog[0].peakUtc.startsWith('1950')).toBe(true);
    expect(catalog[catalog.length - 1].peakUtc.startsWith('2100')).toBe(true);
  });

  it('matches every catalog row\'s kind', () => {
    const bad: string[] = [];
    for (const row of catalog) {
      const obs = solarObscuration(new Date(row.peakUtc), observerOf(row));
      const wide = isWide(row);
      let ok: boolean;
      if (row.kind === 'partial') ok = obs > 0;
      else if (row.kind === 'annular') ok = wide ? Math.abs(obs - row.magnitude ** 2) <= 0.01 : obs >= row.magnitude ** 2 - 0.1;
      else ok = wide ? obs === 1 : obs >= 0.9;   // total and hybrid
      if (!ok) bad.push(`${row.peakUtc} ${row.kind}${wide ? '' : ' (narrow)'}: obscuration ${obs.toFixed(4)}, magnitude ${row.magnitude}`);
    }
    expect(bad).toEqual([]);
  });

  it('is zero a day away from any eclipse', () => {
    expect(solarObscuration(new Date('2026-01-15T20:00:00Z'), VICTORIA)).toBe(0);
  });

  it('validates its inputs', () => {
    expect(() => solarObscuration(new Date(SUPPORTED_MAX), VICTORIA)).toThrow(AlmanacOutOfRangeError);
    expect(() => solarObscuration(new Date(NaN), VICTORIA)).toThrow(RangeError);
    expect(() => solarObscuration(new Date('2026-01-15T20:00:00Z'), { latitudeDeg: 91, longitudeDeg: 0 })).toThrow(RangeError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd typescript && mise exec -- npx vitest run test/solar.test.ts`

Expected: FAIL, the import of `solarObscuration` from `../src/index.js` has no such export.

- [ ] **Step 3: Widen the lunar internals**

In `typescript/src/eclipse.ts` replace the `ShadowInfo` block (lines 108 to 137) with:

```ts
/**
 * UPSTREAM: `ShadowInfo` (astronomy.ts ~8445). `target` and `dir` are the
 * inputs `CalcShadow` measured from: the lunar case passes the geocentric
 * Moon against the Sun-to-Earth line, the solar case (solar.ts) the
 * lunacentric observer against the heliocentric Moon, and the obscuration
 * path reads them back. Upstream's `time` is an `AstroTime`; here the instant
 * travels as days since J2000 UT, as everywhere in L3.
 * INTERNAL: exported for `solar.ts`, not part of the public API.
 */
export interface ShadowInfo {
    /** Days since J2000 (UT). */
    ut: number;
    /** Shadow-axis parameter: distance to the shadow plane over the casting body's distance. */
    u: number;
    /** Distance from `target` to the shadow axis, km. */
    r: number;
    /** Umbra radius at the shadow plane, km. */
    k: number;
    /** Penumbra radius at the shadow plane, km. */
    p: number;
    /** The point measured from, AU. */
    target: Vec3;
    /** The shadow axis, AU. */
    dir: Vec3;
}

/** UPSTREAM: `CalcShadow`, astronomy.ts ~8458. INTERNAL, shared with solar.ts. */
export function calcShadow(bodyRadiusKm: number, ut: number, target: Vec3, dir: Vec3): ShadowInfo {
    const u = (dir.x*target.x + dir.y*target.y + dir.z*target.z) / (dir.x*dir.x + dir.y*dir.y + dir.z*dir.z);
    const dx = (u * dir.x) - target.x;
    const dy = (u * dir.y) - target.y;
    const dz = (u * dir.z) - target.z;
    const r = KM_PER_AU * Math.hypot(dx, dy, dz);
    const k = +SUN_RADIUS_KM - (1.0 + u)*(SUN_RADIUS_KM - bodyRadiusKm);
    const p = -SUN_RADIUS_KM + (1.0 + u)*(SUN_RADIUS_KM + bodyRadiusKm);
    return { ut, u, r, k, p, target, dir };
}
```

Export the shared constants by adding `export` in front of `PRUNE_LATITUDE_DEG`, `SHADOW_TOL_SECONDS`, `SHADOW_ITER_CAP`, and `SAME_ECLIPSE_MS`, and in front of `function moonEclipticLatitudeDeg`. Append "INTERNAL: shared with solar.ts." to each of those four constants' doc comments and to `moonEclipticLatitudeDeg`'s.

In `typescript/src/transforms.ts`, after `observerGeoVectorOfDate` (line 101), add:

```ts
/**
 * UPSTREAM: `geo_pos`, astronomy.ts ~2236 — the observer's geocentric
 * position in AU on the J2000 mean equator: `terra`'s of-date vector
 * gyrated into J2000. The topocentric path below avoids this rotation; the
 * solar-eclipse layer needs it because it subtracts the observer from a
 * geocentric Moon that stays in EQJ.
 * INTERNAL: exported for `solar.ts`, not part of the public API.
 */
export function observerGeoVectorEqj(ut: number, observer: Observer): Vec3 {
    return gyration(observerGeoVectorOfDate(siderealDeg(ut), observer), ttDaysFromUt(ut), PrecessDirection.Into2000);
}
```

- [ ] **Step 4: Write `solar.ts` with the obscuration path**

Create `typescript/src/solar.ts`:

```ts
// L3 solar eclipses for one observer: the Moon's shadow cone against the
// observer at every new moon — the local peak, the contacts C1–C4 with the
// Sun's altitude at each, the covered fraction at peak, and the covered
// fraction of the Sun's disc at any instant.
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts:
//   AngleBetween (~256), geo_pos (~2236, in transforms.ts),
//   LocalMoonShadow (~8494), PeakLocalMoonShadow (~8587), Obscuration (~8622),
//   SolarEclipseObscuration (~8670), EclipseKindFromUmbra (~8834),
//   local_partial_distance (~9126), local_total_distance (~9130),
//   LocalEclipse (~9137), LocalEclipseTransition (~9165), SunAltitude (~9181)
//   and SearchLocalSolarEclipse (~9211).
// Constants and operation order are preserved so the Swift port can be a
// line-for-line translation.
//
// Four deliberate departures from upstream, all spec-driven:
//   - the new-moon probe is this package's `searchMoonPhase`, whose longitudes
//     are apparent rather than upstream's geometric (see events.ts). It only
//     seeds a ±0.2 d peak search, so the ~40 s difference cannot change a
//     result.
//   - previous and range searches, the fixed whole-UT-day new-moon seed and
//     the 100 ms same-eclipse band come from the lunar port (eclipse.ts);
//     upstream searches forward only.
//   - the night filter also accepts the Sun above the horizon at the peak, not
//     only at C1 or C4, so a short polar day inside the eclipse is kept.
//   - no two-year scan limit: next/previous walk new moons to the supported
//     boundary. A place can go years without a visible solar eclipse, and a
//     pruned new moon costs one Moon evaluation.

import {
    Observer, assertObserver, assertSupported, assertSupportedWindowEnd,
    AlmanacOutOfRangeError, SUPPORTED_MIN, SUPPORTED_MAX
} from './types.js';
import { dateFromUt, ttDaysFromUt, utDays } from './time.js';
import { DEG2RAD, KM_PER_AU, RAD2DEG, Vec3 } from './nutation.js';
import { moonGeoVectorEqj } from './moon.js';
import { sunGeoVectorEqj } from './sun.js';
import { observerGeoVectorEqj, refractionDeg, topoAltAzUnrefracted } from './transforms.js';
import { MOON_MEAN_RADIUS_KM, SUN_RADIUS_KM, search, searchMoonPhase } from './events.js';
import {
    ShadowInfo, calcShadow, moonEclipticLatitudeDeg,
    PRUNE_LATITUDE_DEG, SAME_ECLIPSE_MS, SHADOW_TOL_SECONDS, SHADOW_ITER_CAP
} from './eclipse.js';

/** How much of the Sun an observer sees covered: `partial` when the Moon never covers it, `annular` when the Moon sits inside the Sun's disc, `total` when it covers it. */
export type SolarEclipseKind = 'partial' | 'annular' | 'total';

/** The Sun's refracted topocentric altitude at each contact, degrees; `null` exactly where the eclipse has no such contact. */
export interface SolarEclipseSunAltitudes {
    c1: number; c2: number | null; peak: number; c3: number | null; c4: number;
}

/** A solar eclipse as one observer sees it: peak circumstances plus the contact instants around them. */
export interface SolarEclipse {
    kind: SolarEclipseKind;
    /** Fraction of the Sun's disc area covered at peak; exactly 1 for a total eclipse. */
    obscuration: number;
    /** First contact: the partial phase begins. */
    c1: Date;
    /** Second contact: the total or annular phase begins — `null` for a partial eclipse. */
    c2: Date | null;
    /** Closest approach of the Moon's shadow axis to the observer. */
    peak: Date;
    /** Third contact: the total or annular phase ends — `null` for a partial eclipse. */
    c3: Date | null;
    /** Fourth contact: the partial phase ends. */
    c4: Date;
    /** The number `sunAltAz` reports at each contact instant, so "above the horizon" agrees with the Sun a consumer draws. */
    sunAltDeg: SolarEclipseSunAltitudes;
}

/** UPSTREAM: `SUN_RADIUS_AU` and `MOON_POLAR_RADIUS_AU`, astronomy.ts 135 and 149-150. */
const SUN_RADIUS_AU = SUN_RADIUS_KM / KM_PER_AU;
const MOON_POLAR_RADIUS_KM = 1736.0;
const MOON_POLAR_RADIUS_AU = MOON_POLAR_RADIUS_KM / KM_PER_AU;

/** Upstream's `PeakLocalMoonShadow` window, in days, either side of the new moon. */
const PEAK_WINDOW_DAYS = 0.2;

/** Upstream's `LocalEclipse` windows, in days, either side of the peak. */
const PARTIAL_WINDOW_DAYS = 0.2;
const TOTAL_WINDOW_DAYS = 0.01;

/**
 * UPSTREAM: `LocalMoonShadow`, astronomy.ts ~8494 — the Moon's shadow cone
 * evaluated at the observer: the lunacentric observer measured against the
 * heliocentric Moon. All three vectors are EQJ, and `calcShadow` only ever
 * takes dot products and norms of them, so the frame cancels.
 */
function localMoonShadow(ut: number, observer: Observer): ShadowInfo {
    const tt = ttDaysFromUt(ut);
    // Observer's geocentric position.
    const pos = observerGeoVectorEqj(ut, observer);
    // Light-travel and aberration corrected Sun.
    const s = sunGeoVectorEqj(tt);
    // Geocentric Moon.
    const m = moonGeoVectorEqj(tt);
    // Lunacentric location of an observer on the Earth's surface.
    const o: Vec3 = { x: pos.x - m.x, y: pos.y - m.y, z: pos.z - m.z };
    // Convert geocentric moon to heliocentric Moon.
    const hm: Vec3 = { x: m.x - s.x, y: m.y - s.y, z: m.z - s.z };
    return calcShadow(MOON_MEAN_RADIUS_KM, ut, o, hm);
}

/** UPSTREAM: `AngleBetween`, astronomy.ts ~256 — degrees. */
function angleBetweenDeg(a: Vec3, b: Vec3): number {
    const aa = (a.x*a.x + a.y*a.y + a.z*a.z);
    if (Math.abs(aa) < 1.0e-8) throw new Error('almanac internal: AngleBetween first vector is too short');
    const bb = (b.x*b.x + b.y*b.y + b.z*b.z);
    if (Math.abs(bb) < 1.0e-8) throw new Error('almanac internal: AngleBetween second vector is too short');
    const dot = (a.x*b.x + a.y*b.y + a.z*b.z) / Math.sqrt(aa * bb);
    if (dot <= -1.0) return 180;
    if (dot >= +1.0) return 0;
    return RAD2DEG * Math.acos(dot);
}

/**
 * UPSTREAM: `Obscuration`, astronomy.ts ~8622 — the area of intersection of
 * two discs of radii `a` and `b` whose centres are `c` apart, divided by the
 * area of the first disc.
 */
function discOverlap(a: number, b: number, c: number): number {
    if (a <= 0.0) throw new Error('almanac internal: radius of first disc must be positive');
    if (b <= 0.0) throw new Error('almanac internal: radius of second disc must be positive');
    if (c < 0.0) throw new Error('almanac internal: distance between discs is not allowed to be negative');

    if (c >= a + b) {
        // The discs are too far apart to have any overlapping area.
        return 0.0;
    }

    if (c == 0.0) {
        // The discs have a common center. Therefore, one disc is inside the other.
        return (a <= b) ? 1.0 : (b*b)/(a*a);
    }

    const x = (a*a - b*b + c*c) / (2*c);
    const radicand = a*a - x*x;
    if (radicand <= 0.0) {
        // The circumferences do not intersect, or are tangent.
        // We already ruled out the case of non-overlapping discs.
        // Therefore, one disc is inside the other.
        return (a <= b) ? 1.0 : (b*b)/(a*a);
    }

    // The discs overlap fractionally in a pair of lens-shaped areas.
    const y = Math.sqrt(radicand);

    // Return the overlapping fractional area.
    // There are two lens-shaped areas, one to the left of x, the other to the right of x.
    // Each part is calculated by subtracting a triangular area from a sector's area.
    const lens1 = a*a*Math.acos(x/a) - x*y;
    const lens2 = b*b*Math.acos((c-x)/b) - (c-x)*y;

    // Find the fractional area with respect to the first disc.
    return (lens1 + lens2) / (Math.PI*a*a);
}

/**
 * UPSTREAM: the body of `SolarEclipseObscuration`, astronomy.ts ~8670, before
 * its clamp — the fraction of the Sun's apparent disc the Moon covers for an
 * observer, from the heliocentric Moon `hm` and the lunacentric observer `lo`.
 */
function discObscuration(hm: Vec3, lo: Vec3): number {
    // Find heliocentric observer.
    const ho: Vec3 = { x: hm.x + lo.x, y: hm.y + lo.y, z: hm.z + lo.z };
    // Calculate the apparent angular radius of the Sun for the observer.
    const sunRadius = Math.asin(SUN_RADIUS_AU / Math.hypot(ho.x, ho.y, ho.z));
    // Calculate the apparent angular radius of the Moon for the observer.
    const moonRadius = Math.asin(MOON_POLAR_RADIUS_AU / Math.hypot(lo.x, lo.y, lo.z));
    // Calculate the apparent angular separation between the Sun's center and the Moon's center.
    const sunMoonSeparation = angleBetweenDeg(lo, ho);
    // Find the fraction of the Sun's apparent disc area that is covered by the Moon.
    return discOverlap(sunRadius, moonRadius, sunMoonSeparation * DEG2RAD);
}

/**
 * The fraction of the Sun's disc area the Moon covers for `observer` at
 * `time`: 0 when the discs are apart, 1 in totality, the ratio of the disc
 * areas in annularity, and the lens overlap between. Purely geometric — it
 * does not test the horizon; a consumer that draws the Sun already knows
 * whether it is up.
 *
 * @throws {AlmanacOutOfRangeError} if `time` is outside the supported interval.
 * @throws {RangeError} if `time` is invalid or `observer` is out of range.
 */
export function solarObscuration(time: Date, observer: Observer): number {
    assertSupported(time);
    assertObserver(observer);
    const shadow = localMoonShadow(utDays(time), observer);
    return discObscuration(shadow.dir, shadow.target);
}
```

- [ ] **Step 5: Export it**

In `typescript/src/index.ts` append:

```ts
export type { SolarEclipse, SolarEclipseKind, SolarEclipseSunAltitudes } from './solar.js';
export { solarObscuration } from './solar.js';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd typescript && mise exec -- npm run build && mise exec -- npx vitest run test/solar.test.ts`

Expected: PASS, four tests. If the catalog test lists rows, read them: a wide total row reporting less than 1 means the observer vector or the disc geometry is off; a partial row at 0 means the sign of `o` or `hm` is flipped. The existing `eclipse.test.ts` must still pass: `mise exec -- npx vitest run test/eclipse.test.ts`.

- [ ] **Step 7: Commit**

```bash
git add typescript/src typescript/test/solar.test.ts
git commit -F - <<'EOF'
Report the fraction of the Sun the Moon covers for an observer

solarObscuration is what the Slackwater sky darkens with during an eclipse, and it is the first half of the solar port: the observer-centred shadow geometry and the two-disc overlap, checked at the point of greatest eclipse of every catalog row from 1950 through 2100. The lunar file's shadow helper regains upstream's target and dir fields so both eclipse layers share it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 3: TypeScript solar eclipse search

**Files:**
- Modify: `typescript/src/solar.ts`
- Modify: `typescript/src/index.ts`
- Modify: `typescript/test/solar.test.ts`

**Interfaces:**
- Consumes `fixtures/eclipses/solar-local.json` and `solar-catalog.json` from Task 1, `localMoonShadow` and `discObscuration` from Task 2.
- Produces `nextSolarEclipse(after: Date, observer: Observer): SolarEclipse`, `previousSolarEclipse(before: Date, observer: Observer): SolarEclipse`, `solarEclipses(startUtc: Date, endUtc: Date, observer: Observer): SolarEclipse[]`.

- [ ] **Step 1: Write the failing tests**

Replace the import lines at the top of `typescript/test/solar.test.ts` with:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  nextSolarEclipse, previousSolarEclipse, solarEclipses, solarObscuration, sunAltAz, AlmanacOutOfRangeError
} from '../src/index.js';
import type { Observer, SolarEclipse } from '../src/index.js';
import { SUPPORTED_MIN, SUPPORTED_MAX } from '../src/types.js';
```

After the `catalog` constants add:

```ts
const SEC = 1000;
const CONTACT_KEYS = ['c1', 'c2', 'peak', 'c3', 'c4'] as const;

interface Contact { utc: string; sunAltDeg: number | null }
interface LocalRow {
  eclipse: string; place: string; latitudeDeg: number; longitudeDeg: number; visible: boolean;
  kind?: 'partial' | 'annular' | 'total'; magnitude?: number; obscuration?: number;
  c1?: Contact | null; c2?: Contact | null; peak?: Contact; c3?: Contact | null; c4?: Contact | null;
}
const local: LocalRow[] = load('eclipses/solar-local.json');

/** The window `[eclipse day − 1, eclipse day + 2)` a USNO case lives in. */
function windowOf(row: LocalRow): [Date, Date] {
  const day = Date.parse(`${row.eclipse}T00:00:00Z`);
  return [new Date(day - DAY), new Date(day + 2 * DAY)];
}
```

Then append these suites after the obscuration suite:

```ts
describe('local circumstances vs USNO', () => {
  for (const row of local) {
    const observer: Observer = { latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg };
    const found = solarEclipses(...windowOf(row), observer);
    const label = `${row.eclipse} ${row.place}`;

    if (!row.visible) {
      it(`${label}: nothing to see`, () => expect(found).toEqual([]));
      continue;
    }

    it(`${label}: one ${row.kind} eclipse`, () => {
      expect(found.map(e => e.peak.toISOString())).toHaveLength(1);
      expect(found[0].kind).toBe(row.kind);
    });

    it(`${label}: contacts within 60 s, peak within 5 min, altitudes within 0.5° and 1.5°`, () => {
      const e = found[0];
      for (const k of CONTACT_KEYS) {
        const want = row[k];
        if (want == null) {
          // c2/c3 absent for a partial; c1/c4 absent when USNO listed a
          // sunrise or sunset instead, which means the Sun was down at ours.
          if (k === 'c2' || k === 'c3') expect(e[k], `${k} should be absent`).toBeNull();
          else expect(e.sunAltDeg[k], `${k} should be below the horizon`).toBeLessThan(0);
          continue;
        }
        const got = e[k];
        expect(got, `${k} should be present`).not.toBeNull();
        const err = Math.abs(got!.getTime() - Date.parse(want.utc)) / SEC;
        expect(err, `${k} off by ${err.toFixed(1)} s`).toBeLessThanOrEqual(k === 'peak' ? 300 : 60);
        if (want.sunAltDeg !== null) {
          const altErr = Math.abs(e.sunAltDeg[k]! - want.sunAltDeg);
          expect(altErr, `${k} altitude off by ${altErr.toFixed(2)}°`).toBeLessThanOrEqual(k === 'peak' ? 1.5 : 0.5);
        }
      }
    });

    it(`${label}: obscuration within 0.01`, () => {
      const err = Math.abs(found[0].obscuration - row.obscuration!);
      expect(err, `obscuration off by ${err.toFixed(4)}`).toBeLessThanOrEqual(0.01);
    });
  }
});

describe('the search vs the catalog, from the point of greatest eclipse', () => {
  it('finds every central total, annular and hybrid eclipse with the right kind', () => {
    const bad: string[] = [];
    for (const row of catalog) {
      if (row.kind === 'partial' || !row.central) continue;
      const peakMs = Date.parse(row.peakUtc);
      const found = solarEclipses(new Date(peakMs - DAY), new Date(peakMs + DAY), observerOf(row));
      if (found.length !== 1) { bad.push(`${row.peakUtc}: ${found.length} eclipses`); continue; }
      const e = found[0];
      const dt = Math.abs(e.peak.getTime() - peakMs) / SEC;
      if (dt > 300) bad.push(`${row.peakUtc}: peak off by ${dt.toFixed(0)} s`);
      const wide = isWide(row);
      const wanted: string[] = row.kind === 'hybrid' ? ['total', 'annular'] : [row.kind];
      if (!wide) wanted.push('partial');
      if (!wanted.includes(e.kind)) bad.push(`${row.peakUtc}: kind ${e.kind}, catalog ${row.kind}${wide ? '' : ' (narrow path)'}`);
      const altErr = Math.abs(e.sunAltDeg.peak - row.sunAltDeg);
      if (altErr > 2) bad.push(`${row.peakUtc}: peak altitude ${e.sunAltDeg.peak.toFixed(1)}, catalog ${row.sunAltDeg}`);
    }
    expect(bad).toEqual([]);
  });

  it('drops an eclipse the antipode could only see through the Earth', () => {
    // Under |gamma| 0.2 the antipode's axis distance (2·gamma·R) is inside the
    // penumbra, so only the night filter can exclude it.
    const rows = catalog.filter(r => r.central && r.kind !== 'partial' && Math.abs(r.gamma) < 0.2);
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) {
      const antipode: Observer = {
        latitudeDeg: -row.latitudeDeg,
        longitudeDeg: row.longitudeDeg > 0 ? row.longitudeDeg - 180 : row.longitudeDeg + 180
      };
      const peakMs = Date.parse(row.peakUtc);
      expect(solarObscuration(new Date(peakMs), antipode), `${row.peakUtc} antipode obscuration`).toBeGreaterThan(0);
      expect(solarEclipses(new Date(peakMs - DAY), new Date(peakMs + DAY), antipode), `${row.peakUtc} antipode search`).toEqual([]);
    }
  });
});

describe('search semantics from Victoria', () => {
  /** Every eclipse Victoria can see, 1950-2100, by repeated next. */
  const walk: SolarEclipse[] = (() => {
    const found: SolarEclipse[] = [];
    let cursor = new Date(SUPPORTED_MIN);
    for (;;) {
      let e: SolarEclipse;
      try { e = nextSolarEclipse(cursor, VICTORIA); } catch (err) {
        if (err instanceof AlmanacOutOfRangeError) break;
        throw err;
      }
      found.push(e);
      cursor = e.peak;
    }
    return found;
  })();

  it('sees a few dozen eclipses in 151 years, strictly ascending', () => {
    expect(walk.length).toBeGreaterThan(30);
    for (let i = 1; i < walk.length; i++)
      expect(walk[i].peak.getTime()).toBeGreaterThan(walk[i - 1].peak.getTime());
  });

  it('finds the same eclipses backward and in one range, including contacts', () => {
    const backward: SolarEclipse[] = [];
    let cursor = new Date(SUPPORTED_MAX - 1);
    for (let i = 0; i <= walk.length; i++) {
      try {
        const e = previousSolarEclipse(cursor, VICTORIA);
        expect(e.peak.getTime()).toBeLessThan(cursor.getTime());
        backward.push(e);
        cursor = e.peak;
      } catch (err) {
        if (err instanceof AlmanacOutOfRangeError) break;
        throw err;
      }
    }
    const range = solarEclipses(new Date(SUPPORTED_MIN), new Date(SUPPORTED_MAX), VICTORIA);
    expect(backward.reverse()).toEqual(walk);
    expect(range).toEqual(walk);
  });

  it('includes each returned peak at the range start and excludes it at the end', () => {
    for (const e of walk) {
      const at = e.peak.getTime();
      expect(solarEclipses(new Date(at), new Date(at + 1), VICTORIA).map(x => x.peak.getTime()), e.peak.toISOString()).toEqual([at]);
      expect(solarEclipses(new Date(at - 1), new Date(at), VICTORIA), e.peak.toISOString()).toEqual([]);
    }
  });

  it('pins the same-eclipse band at 100 ms either side of the anchor', () => {
    const e = walk.find(x => x.peak.getTime() > Date.UTC(2000, 0, 1))!;
    const at = e.peak.getTime();
    expect(nextSolarEclipse(new Date(at - 100), VICTORIA).peak.getTime()).toBeGreaterThan(at);
    expect(nextSolarEclipse(new Date(at - 101), VICTORIA).peak.getTime()).toBe(at);
    expect(previousSolarEclipse(new Date(at + 100), VICTORIA).peak.getTime()).toBeLessThan(at);
    expect(previousSolarEclipse(new Date(at + 101), VICTORIA).peak.getTime()).toBe(at);
  });

  it('reports contacts in order, integer milliseconds, with the altitude sunAltAz gives', () => {
    for (const e of walk) {
      const order = [e.c1, e.c2, e.peak, e.c3, e.c4].filter((d): d is Date => d !== null);
      for (let i = 1; i < order.length; i++) expect(order[i].getTime()).toBeGreaterThan(order[i - 1].getTime());
      for (const d of order) expect(Number.isInteger(d.getTime())).toBe(true);
      expect((e.c2 === null) === (e.kind === 'partial')).toBe(true);
      expect((e.c3 === null) === (e.kind === 'partial')).toBe(true);
      expect(e.sunAltDeg.c1).toBe(sunAltAz(e.c1, VICTORIA).altDeg);
      expect(e.sunAltDeg.peak).toBe(sunAltAz(e.peak, VICTORIA).altDeg);
      expect(e.sunAltDeg.c4).toBe(sunAltAz(e.c4, VICTORIA).altDeg);
      expect(e.sunAltDeg.c1 > 0 || e.sunAltDeg.peak > 0 || e.sunAltDeg.c4 > 0).toBe(true);
      if (e.kind === 'total') expect(e.obscuration).toBe(1);
      else expect(e.obscuration).toBeGreaterThan(0);
      if (e.kind !== 'total') expect(e.obscuration).toBeLessThan(1);
    }
  });

  it('obscuration at an instant agrees with the peak and reaches 1 in totality', () => {
    const victoria2024 = local.find(r => r.place.startsWith('Victoria'))!;
    const e = solarEclipses(...windowOf(victoria2024), { latitudeDeg: victoria2024.latitudeDeg, longitudeDeg: victoria2024.longitudeDeg })[0];
    expect(Math.abs(solarObscuration(e.peak, { latitudeDeg: victoria2024.latitudeDeg, longitudeDeg: victoria2024.longitudeDeg }) - e.obscuration)).toBeLessThan(1e-6);

    const salem = local.find(r => r.place.startsWith('Salem'))!;
    const salemObserver: Observer = { latitudeDeg: salem.latitudeDeg, longitudeDeg: salem.longitudeDeg };
    const t = solarEclipses(...windowOf(salem), salemObserver)[0];
    const mid = new Date((t.c2!.getTime() + t.c3!.getTime()) / 2);
    expect(solarObscuration(mid, salemObserver)).toBe(1);
    expect(solarObscuration(new Date(t.c1.getTime() - 60 * SEC), salemObserver)).toBe(0);
  });

  it('validates inputs before returning an empty window and reaches the boundary as out-of-range', () => {
    const from = new Date('2026-09-01T00:00:00Z'), to = new Date('2026-09-10T12:00:00Z');
    expect(solarEclipses(from, to, VICTORIA)).toEqual([]);
    expect(solarEclipses(to, from, VICTORIA)).toEqual([]);
    expect(() => solarEclipses(to, from, { latitudeDeg: 91, longitudeDeg: 0 })).toThrow(RangeError);
    expect(() => solarEclipses(new Date(NaN), to, VICTORIA)).toThrow(RangeError);
    expect(() => solarEclipses(from, new Date(NaN), VICTORIA)).toThrow(RangeError);
    expect(() => solarEclipses(new Date(SUPPORTED_MIN - 1), to, VICTORIA)).toThrow(AlmanacOutOfRangeError);
    expect(() => solarEclipses(from, new Date(SUPPORTED_MAX + 1), VICTORIA)).toThrow(AlmanacOutOfRangeError);
    expect(() => nextSolarEclipse(new Date(NaN), VICTORIA)).toThrow(RangeError);
    expect(() => nextSolarEclipse(from, { latitudeDeg: 0, longitudeDeg: 181 })).toThrow(RangeError);
    expect(() => nextSolarEclipse(new Date(Date.parse(catalog[catalog.length - 1].peakUtc) + DAY), VICTORIA)).toThrow(AlmanacOutOfRangeError);
    expect(() => previousSolarEclipse(new Date(Date.parse(catalog[0].peakUtc) - DAY), VICTORIA)).toThrow(AlmanacOutOfRangeError);
    expect(() => previousSolarEclipse(new Date(SUPPORTED_MAX), VICTORIA)).toThrow(AlmanacOutOfRangeError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd typescript && mise exec -- npx vitest run test/solar.test.ts`

Expected: FAIL, `solarEclipses` and the others are not exported.

- [ ] **Step 3: Implement the search**

In `typescript/src/solar.ts`, after `discObscuration`, add:

```ts
/**
 * UPSTREAM: `SolarEclipseObscuration`, astronomy.ts ~8670, with its clamp:
 * "in marginal cases, we need to clamp obscuration to less than 1.0. This
 * function is never called for total eclipses, so it should never return 1.0."
 */
function solarEclipseObscuration(hm: Vec3, lo: Vec3): number {
    return Math.min(0.9999, discObscuration(hm, lo));
}

/** UPSTREAM: `ShadowDistanceSlope`, astronomy.ts ~8535, bound to `localMoonShadow`. */
function localShadowSlope(ut: number, observer: Observer): number {
    const dt = 1.0 / 86400.0;
    return (localMoonShadow(ut + dt, observer).r - localMoonShadow(ut - dt, observer).r) / dt;
}

/**
 * UPSTREAM: `PeakLocalMoonShadow`, astronomy.ts ~8587 — the time near the
 * new moon when the Moon's shadow axis comes closest to the observer, i.e.
 * the ascending zero of the axis distance's time derivative.
 */
function peakLocalMoonShadow(centerUt: number, observer: Observer): ShadowInfo {
    // Use the same new-moon seed regardless of search direction or window.
    // Otherwise a ~1 ms root shift can lose/duplicate a peak when a caller
    // splits a range at a previously returned peak. Only unpruned moons pay
    // for this second phase search; its start is a fixed whole UT day.
    const newmoon = searchMoonPhase(0, Math.floor(centerUt) - 1, 4);
    if (newmoon === null) throw new Error('almanac internal: cannot refine new moon');
    const ut = search(
        u => localShadowSlope(u, observer), newmoon - PEAK_WINDOW_DAYS, newmoon + PEAK_WINDOW_DAYS,
        SHADOW_TOL_SECONDS, SHADOW_ITER_CAP, 'peak local moon shadow'
    );
    if (ut === null) throw new Error('almanac internal: failed to find peak local Moon shadow time');
    return localMoonShadow(ut, observer);
}

/**
 * UPSTREAM: `EclipseKindFromUmbra`, astronomy.ts ~8834 — a positive umbra
 * radius at the observer is a total eclipse, otherwise annular. The 14 m
 * bias is upstream's, added to match Espenak's classifications.
 */
function eclipseKindFromUmbra(k: number): SolarEclipseKind {
    return (k > 0.014) ? 'total' : 'annular';
}

/** UPSTREAM: `local_partial_distance`, astronomy.ts ~9126. */
function localPartialDistance(shadow: ShadowInfo): number {
    return shadow.p - shadow.r;
}

/** UPSTREAM: `local_total_distance`, astronomy.ts ~9130 — `|k|`, because the umbra radius is negative for an annular eclipse. */
function localTotalDistance(shadow: ShadowInfo): number {
    return Math.abs(shadow.k) - shadow.r;
}

/** UPSTREAM: `LocalEclipseTransition`, astronomy.ts ~9165 — the instant `func` crosses zero in `direction` inside `[t1, t2]`. */
function localEclipseTransition(
    observer: Observer, direction: 1 | -1, func: (shadow: ShadowInfo) => number, t1: number, t2: number
): number {
    const ut = search(
        u => direction * func(localMoonShadow(u, observer)), t1, t2,
        SHADOW_TOL_SECONDS, SHADOW_ITER_CAP, 'local eclipse transition'
    );
    if (ut === null) throw new Error('almanac internal: local eclipse transition search failed');
    return ut;
}

/**
 * UPSTREAM: `SunAltitude`, astronomy.ts ~9181 — the refracted topocentric
 * altitude `sunAltAz` reports, without its interval assertion: a contact can
 * fall just outside the supported interval while its peak is inside.
 */
function sunAltDegAt(d: Date, observer: Observer): number {
    const ut = utDays(d);
    const alt = topoAltAzUnrefracted(sunGeoVectorEqj(ttDaysFromUt(ut)), ut, observer).altDeg;
    return alt + refractionDeg(alt);
}

/** UPSTREAM: `LocalEclipse`, astronomy.ts ~9137 — contacts and kind around a peak the observer is inside the penumbra for. */
function buildSolarEclipse(shadow: ShadowInfo, observer: Observer): SolarEclipse {
    const peakUt = shadow.ut;
    const c1Ut = localEclipseTransition(observer, 1, localPartialDistance, peakUt - PARTIAL_WINDOW_DAYS, peakUt);
    const c4Ut = localEclipseTransition(observer, -1, localPartialDistance, peakUt, peakUt + PARTIAL_WINDOW_DAYS);
    let c2Ut: number | null = null;
    let c3Ut: number | null = null;
    let kind: SolarEclipseKind;

    if (shadow.r < Math.abs(shadow.k)) {     // take absolute value of 'k' to handle annular eclipses too.
        c2Ut = localEclipseTransition(observer, 1, localTotalDistance, peakUt - TOTAL_WINDOW_DAYS, peakUt);
        c3Ut = localEclipseTransition(observer, -1, localTotalDistance, peakUt, peakUt + TOTAL_WINDOW_DAYS);
        kind = eclipseKindFromUmbra(shadow.k);
    } else {
        kind = 'partial';
    }

    const obscuration = (kind === 'total') ? 1.0 : solarEclipseObscuration(shadow.dir, shadow.target);

    // Altitudes come from the reported (TimeClip-truncated) instants, so
    // `sunAltAz(e.c1, observer).altDeg === e.sunAltDeg.c1` exactly.
    const c1 = dateFromUt(c1Ut);
    const c2 = c2Ut === null ? null : dateFromUt(c2Ut);
    const peak = dateFromUt(peakUt);
    const c3 = c3Ut === null ? null : dateFromUt(c3Ut);
    const c4 = dateFromUt(c4Ut);
    const alt = (d: Date | null): number | null => (d === null ? null : sunAltDegAt(d, observer));
    return {
        kind, obscuration, c1, c2, peak, c3, c4,
        sunAltDeg: { c1: alt(c1) as number, c2: alt(c2), peak: alt(peak) as number, c3: alt(c3), c4: alt(c4) as number }
    };
}

/**
 * The night filter: the Sun's centre must be above the horizon at C1, the
 * peak, or C4. Upstream tests only C1 and C4; the peak keeps a short polar day
 * inside the eclipse.
 * ponytail: three samples, not a sunrise search — a day that starts after C1
 * and ends before the peak still drops. Upgrade path: sunEvents over [c1, c4].
 */
function seesAnyOfIt(e: SolarEclipse): boolean {
    return e.sunAltDeg.c1 > 0.0 || e.sunAltDeg.peak > 0.0 || e.sunAltDeg.c4 > 0.0;
}

/**
 * The first solar eclipse `observer` can see whose peak falls strictly after
 * `after`.
 *
 * Every new moon up to the end of the supported interval is tested: the
 * Moon's ecliptic latitude prunes the ones no shadow can reach, and the rest
 * get a peak-shadow search from the observer. An eclipse whose Sun is below
 * the horizon at C1, the peak, and C4 is skipped.
 *
 * @throws {AlmanacOutOfRangeError} if `after` is outside the supported
 *      interval, or if no visible eclipse remains before the end of it.
 * @throws {RangeError} if `after` is invalid or `observer` is out of range.
 */
export function nextSolarEclipse(after: Date, observer: Observer): SolarEclipse {
    return nearestSolarEclipse(after, 1, observer);
}

/**
 * The last solar eclipse `observer` can see whose peak falls strictly before
 * `before`, skipping peaks within 100 ms of it, just as `nextSolarEclipse`
 * does on the other side.
 *
 * @throws {AlmanacOutOfRangeError} if `before` is outside the supported
 *      interval, or if no visible eclipse remains after the start of it.
 * @throws {RangeError} if `before` is invalid or `observer` is out of range.
 */
export function previousSolarEclipse(before: Date, observer: Observer): SolarEclipse {
    return nearestSolarEclipse(before, -1, observer);
}

/** Solar eclipses `observer` can see with peaks in `[startUtc, endUtc)`, sorted ascending. Contacts may fall outside the window. */
export function solarEclipses(startUtc: Date, endUtc: Date, observer: Observer): SolarEclipse[] {
    assertSupported(startUtc);
    assertSupportedWindowEnd(endUtc);
    assertObserver(observer);
    return scanSolarEclipses(startUtc.getTime(), endUtc.getTime(), 1, false, observer);
}

function nearestSolarEclipse(anchor: Date, direction: 1 | -1, observer: Observer): SolarEclipse {
    assertSupported(anchor);
    assertObserver(observer);
    const ms = anchor.getTime();
    // No scan limit: walk to the supported boundary. A place can go years
    // without a visible solar eclipse, and a pruned new moon is cheap.
    const startMs = direction > 0 ? ms + SAME_ECLIPSE_MS + 1 : SUPPORTED_MIN;
    const endMs = direction > 0 ? SUPPORTED_MAX : ms - SAME_ECLIPSE_MS;
    const found = scanSolarEclipses(startMs, endMs, direction, true, observer);
    if (found.length) return found[0];
    throw new AlmanacOutOfRangeError();
}

function scanSolarEclipses(startMs: number, endMs: number, direction: 1 | -1, firstOnly: boolean, observer: Observer): SolarEclipse[] {
    const found: SolarEclipse[] = [];
    if (startMs >= endMs) return found;
    // Peak and new moon differ by up to the peak window. Include the entire
    // margin at both ends, then apply the caller's bounds to the reported peak.
    const startUt = utDays(new Date(startMs)) - PEAK_WINDOW_DAYS;
    const endUt = utDays(new Date(endMs)) + PEAK_WINDOW_DAYS;
    let nmUt = direction > 0 ? startUt : endUt;
    const limitUt = direction > 0 ? endUt : startUt;

    while (direction * (limitUt - nmUt) > 0) {
        const newmoon = searchMoonPhase(0, nmUt, direction * Math.min(40, Math.abs(limitUt - nmUt)));
        if (newmoon === null) break;
        // UPSTREAM `SearchLocalSolarEclipse`: step past this new moon before
        // the next probe, so the same one cannot be found twice.
        nmUt = newmoon + direction * 10;

        // Pruning: if the new moon's ecliptic latitude is too large, a solar
        // eclipse is not possible.
        if (Math.abs(moonEclipticLatitudeDeg(newmoon)) >= PRUNE_LATITUDE_DEG) continue;

        // Search near the new moon for the time when the observer is closest
        // to the line passing through the centers of the Sun and Moon.
        const shadow = peakLocalMoonShadow(newmoon, observer);
        if (shadow.r >= shadow.p) continue;   // the observer never enters the penumbra
        const peak = dateFromUt(shadow.ut);
        if (peak.getTime() < startMs || peak.getTime() >= endMs) continue;

        // This is at least a partial solar eclipse for the observer.
        const eclipse = buildSolarEclipse(shadow, observer);
        // Ignore any eclipse that happens completely at night.
        if (!seesAnyOfIt(eclipse)) continue;
        found.push(eclipse);
        if (firstOnly) break;
    }
    return found;
}
```

In `typescript/src/index.ts` change the solar export line to:

```ts
export { nextSolarEclipse, previousSolarEclipse, solarEclipses, solarObscuration } from './solar.js';
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd typescript && mise exec -- npm run build && mise exec -- npx vitest run test/solar.test.ts`

Expected: PASS. Read any USNO failure's message before touching code: a contact off by more than 60 s at every case means a systematic model or time-scale difference and is a finding for the PR; a single case off means that case's parsing. If the Toronto case fails on `c1 should be below the horizon`, check `sunAltDegAt` uses the refracted altitude.

- [ ] **Step 5: Run the whole TypeScript suite**

Run: `cd typescript && mise exec -- npm test`

Expected: all files pass; the solar file adds well under a minute.

- [ ] **Step 6: Commit**

```bash
git add typescript/src typescript/test/solar.test.ts
git commit -F - <<'EOF'
Find the solar eclipses an observer can see, with contacts and Sun altitudes

Next, previous, and range searches walk new moons with the lunar port's fixed seed and same-eclipse band, take upstream's observer-centred peak and contact searches, and drop eclipses the Sun is below the horizon for at C1, the peak, and C4. The searches walk to the supported boundary instead of a two-year limit because a place can go years without a visible eclipse. USNO local circumstances and the catalog's greatest-eclipse points are the evidence.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 4: Swift obscuration at an instant

**Files:**
- Modify: `swift/Sources/Almanac/Eclipse.swift:132-161` (ShadowInfo and calcShadow), `swift/Sources/Almanac/Eclipse.swift:99-130` (constants), `swift/Sources/Almanac/Eclipse.swift:229-232` (moonEclipticLatitudeDeg)
- Modify: `swift/Sources/Almanac/Transforms.swift` (after `observerGeoVectorOfDate`)
- Create: `swift/Sources/Almanac/Solar.swift`
- Modify: `swift/Tests/AlmanacTests/Helpers.swift`
- Create: `swift/Tests/AlmanacTests/SolarTests.swift`

**Interfaces:**
- Produces `public func solarObscuration(at time: Date, observer: Observer) throws -> Double`.
- Produces internal `observerGeoVectorEqj(_ ut: Double, _ observer: Observer) -> Vec3`, `localMoonShadow(_ ut: Double, _ observer: Observer) -> ShadowInfo`, `discObscuration(_ hm: Vec3, _ lo: Vec3) -> Double` for Task 5.
- Widens `Eclipse.swift`: `ShadowInfo` (internal, with `target`, `dir`), `calcShadow`, `moonEclipticLatitudeDeg`, `pruneLatitudeDeg`, `sameEclipseMs`, `shadowTolSeconds`, `shadowIterCap` become internal.

- [ ] **Step 1: Write the failing test**

Add to `swift/Tests/AlmanacTests/Helpers.swift`:

```swift
// solar-local.json instants carry milliseconds ("...T17:41:00.800Z"), which
// ISO8601DateFormatter's default options reject.
func utcMs(_ iso: String) -> Date {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: iso)!
}
```

Create `swift/Tests/AlmanacTests/SolarTests.swift`:

```swift
import XCTest
@testable import Almanac

/// Mirrors typescript/test/solar.test.ts: same fixtures, same tolerances.
/// The TS input-validation cases for an invalid observer have no Swift
/// counterpart: `Observer`'s throwing initializer already refuses one.
final class SolarTests: XCTestCase {
    static let victoria = try! Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 0)
    static let day = 86400.0
    /// A path at least this wide keeps the catalog's whole-degree observer inside it.
    static let widePathKm = 200.0

    struct CatalogRow: Decodable {
        let peakUtc: String
        let kind: String
        let central: Bool
        let gamma: Double
        let magnitude: Double
        let latitudeDeg: Double
        let longitudeDeg: Double
        let sunAltDeg: Double
        let pathWidthKm: Double?
        var observer: Observer { try! Observer(latitudeDeg: latitudeDeg, longitudeDeg: longitudeDeg) }
        var wide: Bool { pathWidthKm.map { $0 >= SolarTests.widePathKm } ?? false }
    }

    static func loadCatalog() throws -> [CatalogRow] {
        let url = fixturesURL().appendingPathComponent("eclipses").appendingPathComponent("solar-catalog.json")
        return try JSONDecoder().decode([CatalogRow].self, from: Data(contentsOf: url))
    }
    static let catalog: [CatalogRow] = try! loadCatalog()

    // --------------------------------------- solarObscuration at greatest eclipse

    func testCatalogCovers1950To2100() {
        XCTAssertGreaterThan(Self.catalog.count, 300)
        XCTAssertTrue(Self.catalog.first!.peakUtc.hasPrefix("1950"))
        XCTAssertTrue(Self.catalog.last!.peakUtc.hasPrefix("2100"))
    }

    func testObscurationAtGreatestEclipseMatchesEveryCatalogKind() throws {
        var bad: [String] = []
        for row in Self.catalog {
            let obs = try solarObscuration(at: utc(row.peakUtc), observer: row.observer)
            let ok: Bool
            switch row.kind {
            case "partial": ok = obs > 0
            case "annular": ok = row.wide ? abs(obs - row.magnitude * row.magnitude) <= 0.01 : obs >= row.magnitude * row.magnitude - 0.1
            default: ok = row.wide ? obs == 1 : obs >= 0.9   // total and hybrid
            }
            if !ok { bad.append("\(row.peakUtc) \(row.kind)\(row.wide ? "" : " (narrow)"): obscuration \(obs), magnitude \(row.magnitude)") }
        }
        XCTAssertEqual(bad, [])
    }

    func testObscurationIsZeroADayFromAnyEclipse() throws {
        XCTAssertEqual(try solarObscuration(at: utc("2026-01-15T20:00:00Z"), observer: Self.victoria), 0)
    }

    func testObscurationValidatesItsInputs() {
        XCTAssertThrowsError(try solarObscuration(at: supportedMax, observer: Self.victoria)) {
            XCTAssertEqual($0 as? AlmanacError, .outOfRange)
        }
        XCTAssertThrowsError(try solarObscuration(at: Date(timeIntervalSince1970: .nan), observer: Self.victoria)) { error in
            guard case AlmanacError.invalidArgument = error else { return XCTFail("expected invalidArgument, got \(error)") }
        }
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `mise exec -- swift test -c release --filter SolarTests 2>&1 | tail -20`

Expected: a compile error, `solarObscuration` is undefined.

- [ ] **Step 3: Widen the lunar internals**

In `swift/Sources/Almanac/Eclipse.swift` replace the `ShadowInfo` block (lines 132 to 161) with:

```swift
/**
 * UPSTREAM: `ShadowInfo` (astronomy.ts ~8445). `target` and `dir` are the
 * inputs `CalcShadow` measured from: the lunar case passes the geocentric
 * Moon against the Sun-to-Earth line, the solar case (Solar.swift) the
 * lunacentric observer against the heliocentric Moon, and the obscuration
 * path reads them back. Upstream's `time` is an `AstroTime`; here the instant
 * travels as days since J2000 UT, as everywhere in L3.
 * INTERNAL, shared with Solar.swift — not `private`.
 */
struct ShadowInfo {
    /** Days since J2000 (UT). */
    let ut: Double
    /** Shadow-axis parameter: distance to the shadow plane over the casting body's distance. */
    let u: Double
    /** Distance from `target` to the shadow axis, km. */
    let r: Double
    /** Umbra radius at the shadow plane, km. */
    let k: Double
    /** Penumbra radius at the shadow plane, km. */
    let p: Double
    /** The point measured from, AU. */
    let target: Vec3
    /** The shadow axis, AU. */
    let dir: Vec3
}

/** UPSTREAM: `CalcShadow`, astronomy.ts ~8458. INTERNAL, shared with Solar.swift. */
func calcShadow(_ bodyRadiusKm: Double, _ ut: Double, _ target: Vec3, _ dir: Vec3) -> ShadowInfo {
    let u = (dir.x*target.x + dir.y*target.y + dir.z*target.z) / (dir.x*dir.x + dir.y*dir.y + dir.z*dir.z)
    let dx = (u * dir.x) - target.x
    let dy = (u * dir.y) - target.y
    let dz = (u * dir.z) - target.z
    let r = KM_PER_AU * (dx*dx + dy*dy + dz*dz).squareRoot()
    let k = sunRadiusKm - (1.0 + u)*(sunRadiusKm - bodyRadiusKm)
    let p = -sunRadiusKm + (1.0 + u)*(sunRadiusKm + bodyRadiusKm)
    return ShadowInfo(ut: ut, u: u, r: r, k: k, p: p, target: target, dir: dir)
}
```

Drop `private` from `pruneLatitudeDeg`, `shadowTolSeconds`, `shadowIterCap`, `sameEclipseMs`, and `func moonEclipticLatitudeDeg`, appending "INTERNAL, shared with Solar.swift — not `private`." to each doc comment.

In `swift/Sources/Almanac/Transforms.swift`, after `observerGeoVectorOfDate`, add:

```swift
/**
 * UPSTREAM: `geo_pos`, astronomy.ts ~2236 — the observer's geocentric
 * position in AU on the J2000 mean equator: `terra`'s of-date vector
 * gyrated into J2000. The topocentric path below avoids this rotation; the
 * solar-eclipse layer needs it because it subtracts the observer from a
 * geocentric Moon that stays in EQJ.
 * INTERNAL, shared with Solar.swift — not `private`.
 */
func observerGeoVectorEqj(_ ut: Double, _ observer: Observer) -> Vec3 {
    gyration(observerGeoVectorOfDate(siderealDeg(ut), observer), ttDaysFromUt(ut), .into2000)
}
```

- [ ] **Step 4: Write `Solar.swift` with the obscuration path**

Create `swift/Sources/Almanac/Solar.swift`:

```swift
import Foundation

// L3 solar eclipses for one observer: the Moon's shadow cone against the
// observer at every new moon — the local peak, the contacts C1–C4 with the
// Sun's altitude at each, the covered fraction at peak, and the covered
// fraction of the Sun's disc at any instant.
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts:
//   AngleBetween (~256), geo_pos (~2236, in Transforms.swift),
//   LocalMoonShadow (~8494), PeakLocalMoonShadow (~8587), Obscuration (~8622),
//   SolarEclipseObscuration (~8670), EclipseKindFromUmbra (~8834),
//   local_partial_distance (~9126), local_total_distance (~9130),
//   LocalEclipse (~9137), LocalEclipseTransition (~9165), SunAltitude (~9181)
//   and SearchLocalSolarEclipse (~9211).
// Constants and operation order are preserved so this stays a line-for-line
// translation of typescript/src/solar.ts.
//
// Four deliberate departures from upstream, all spec-driven:
//   - the new-moon probe is this package's `searchMoonPhase`, whose longitudes
//     are apparent rather than upstream's geometric (see Events.swift). It
//     only seeds a ±0.2 d peak search, so the ~40 s difference cannot change
//     a result.
//   - previous and range searches, the fixed whole-UT-day new-moon seed and
//     the 100 ms same-eclipse band come from the lunar port (Eclipse.swift);
//     upstream searches forward only.
//   - the night filter also accepts the Sun above the horizon at the peak, not
//     only at C1 or C4, so a short polar day inside the eclipse is kept.
//   - no two-year scan limit: next/previous walk new moons to the supported
//     boundary. A place can go years without a visible solar eclipse, and a
//     pruned new moon costs one Moon evaluation.

/// How much of the Sun an observer sees covered: `partial` when the Moon never covers it, `annular` when the Moon sits inside the Sun's disc, `total` when it covers it.
public enum SolarEclipseKind: String, Sendable {
    case partial, annular, total
}

/// The Sun's refracted topocentric altitude at each contact, degrees; `nil` exactly where the eclipse has no such contact.
public struct SolarEclipseSunAltitudes: Sendable {
    public let c1: Double
    public let c2: Double?
    public let peak: Double
    public let c3: Double?
    public let c4: Double

    public init(c1: Double, c2: Double?, peak: Double, c3: Double?, c4: Double) {
        self.c1 = c1; self.c2 = c2; self.peak = peak; self.c3 = c3; self.c4 = c4
    }
}

/// A solar eclipse as one observer sees it: peak circumstances plus the contact instants around them.
public struct SolarEclipse: Sendable {
    public let kind: SolarEclipseKind
    /// Fraction of the Sun's disc area covered at peak; exactly 1 for a total eclipse.
    public let obscuration: Double
    /// First contact: the partial phase begins.
    public let c1: Date
    /// Second contact: the total or annular phase begins — `nil` for a partial eclipse.
    public let c2: Date?
    /// Closest approach of the Moon's shadow axis to the observer.
    public let peak: Date
    /// Third contact: the total or annular phase ends — `nil` for a partial eclipse.
    public let c3: Date?
    /// Fourth contact: the partial phase ends.
    public let c4: Date
    /// The number `sunAltAz` reports at each contact instant, so "above the horizon" agrees with the Sun a consumer draws.
    public let sunAltDeg: SolarEclipseSunAltitudes

    public init(
        kind: SolarEclipseKind, obscuration: Double,
        c1: Date, c2: Date?, peak: Date, c3: Date?, c4: Date, sunAltDeg: SolarEclipseSunAltitudes
    ) {
        self.kind = kind; self.obscuration = obscuration
        self.c1 = c1; self.c2 = c2; self.peak = peak; self.c3 = c3; self.c4 = c4; self.sunAltDeg = sunAltDeg
    }
}

/** UPSTREAM: `SUN_RADIUS_AU` and `MOON_POLAR_RADIUS_AU`, astronomy.ts 135 and 149-150. */
private let sunRadiusAu = sunRadiusKm / KM_PER_AU
private let moonPolarRadiusKm = 1736.0
private let moonPolarRadiusAu = moonPolarRadiusKm / KM_PER_AU

/** Upstream's `PeakLocalMoonShadow` window, in days, either side of the new moon. */
private let peakWindowDays = 0.2

/** Upstream's `LocalEclipse` windows, in days, either side of the peak. */
private let partialWindowDays = 0.2
private let totalWindowDays = 0.01

/**
 * UPSTREAM: `LocalMoonShadow`, astronomy.ts ~8494 — the Moon's shadow cone
 * evaluated at the observer: the lunacentric observer measured against the
 * heliocentric Moon. All three vectors are EQJ, and `calcShadow` only ever
 * takes dot products and norms of them, so the frame cancels.
 */
func localMoonShadow(_ ut: Double, _ observer: Observer) -> ShadowInfo {
    let tt = ttDaysFromUt(ut)
    // Observer's geocentric position.
    let pos = observerGeoVectorEqj(ut, observer)
    // Light-travel and aberration corrected Sun.
    let s = sunGeoVectorEqj(tt)
    // Geocentric Moon.
    let m = moonGeoVectorEqj(tt)
    // Lunacentric location of an observer on the Earth's surface.
    let o = Vec3(x: pos.x - m.x, y: pos.y - m.y, z: pos.z - m.z)
    // Convert geocentric moon to heliocentric Moon.
    let hm = Vec3(x: m.x - s.x, y: m.y - s.y, z: m.z - s.z)
    return calcShadow(moonMeanRadiusKm, ut, o, hm)
}

/** UPSTREAM: `AngleBetween`, astronomy.ts ~256 — degrees. */
private func angleBetweenDeg(_ a: Vec3, _ b: Vec3) -> Double {
    let aa = (a.x*a.x + a.y*a.y + a.z*a.z)
    if abs(aa) < 1.0e-8 { fatalError("almanac internal: AngleBetween first vector is too short") }
    let bb = (b.x*b.x + b.y*b.y + b.z*b.z)
    if abs(bb) < 1.0e-8 { fatalError("almanac internal: AngleBetween second vector is too short") }
    let dot = (a.x*b.x + a.y*b.y + a.z*b.z) / (aa * bb).squareRoot()
    if dot <= -1.0 { return 180 }
    if dot >= +1.0 { return 0 }
    return RAD2DEG * acos(dot)
}

/**
 * UPSTREAM: `Obscuration`, astronomy.ts ~8622 — the area of intersection of
 * two discs of radii `a` and `b` whose centres are `c` apart, divided by the
 * area of the first disc.
 */
private func discOverlap(_ a: Double, _ b: Double, _ c: Double) -> Double {
    if a <= 0.0 { fatalError("almanac internal: radius of first disc must be positive") }
    if b <= 0.0 { fatalError("almanac internal: radius of second disc must be positive") }
    if c < 0.0 { fatalError("almanac internal: distance between discs is not allowed to be negative") }

    if c >= a + b {
        // The discs are too far apart to have any overlapping area.
        return 0.0
    }

    if c == 0.0 {
        // The discs have a common center. Therefore, one disc is inside the other.
        return (a <= b) ? 1.0 : (b*b)/(a*a)
    }

    let x = (a*a - b*b + c*c) / (2*c)
    let radicand = a*a - x*x
    if radicand <= 0.0 {
        // The circumferences do not intersect, or are tangent.
        // We already ruled out the case of non-overlapping discs.
        // Therefore, one disc is inside the other.
        return (a <= b) ? 1.0 : (b*b)/(a*a)
    }

    // The discs overlap fractionally in a pair of lens-shaped areas.
    let y = radicand.squareRoot()

    // Return the overlapping fractional area.
    // There are two lens-shaped areas, one to the left of x, the other to the right of x.
    // Each part is calculated by subtracting a triangular area from a sector's area.
    let lens1 = a*a*acos(x/a) - x*y
    let lens2 = b*b*acos((c-x)/b) - (c-x)*y

    // Find the fractional area with respect to the first disc.
    return (lens1 + lens2) / (Double.pi*a*a)
}

/**
 * UPSTREAM: the body of `SolarEclipseObscuration`, astronomy.ts ~8670, before
 * its clamp — the fraction of the Sun's apparent disc the Moon covers for an
 * observer, from the heliocentric Moon `hm` and the lunacentric observer `lo`.
 */
func discObscuration(_ hm: Vec3, _ lo: Vec3) -> Double {
    // Find heliocentric observer.
    let ho = Vec3(x: hm.x + lo.x, y: hm.y + lo.y, z: hm.z + lo.z)
    // Calculate the apparent angular radius of the Sun for the observer.
    let sunRadius = asin(sunRadiusAu / (ho.x*ho.x + ho.y*ho.y + ho.z*ho.z).squareRoot())
    // Calculate the apparent angular radius of the Moon for the observer.
    let moonRadius = asin(moonPolarRadiusAu / (lo.x*lo.x + lo.y*lo.y + lo.z*lo.z).squareRoot())
    // Calculate the apparent angular separation between the Sun's center and the Moon's center.
    let sunMoonSeparation = angleBetweenDeg(lo, ho)
    // Find the fraction of the Sun's apparent disc area that is covered by the Moon.
    return discOverlap(sunRadius, moonRadius, sunMoonSeparation * DEG2RAD)
}

/**
 * The fraction of the Sun's disc area the Moon covers for `observer` at
 * `time`: 0 when the discs are apart, 1 in totality, the ratio of the disc
 * areas in annularity, and the lens overlap between. Purely geometric — it
 * does not test the horizon; a consumer that draws the Sun already knows
 * whether it is up.
 *
 * - Throws: `AlmanacError.invalidArgument` if `time` is non-finite,
 *   `AlmanacError.outOfRange` if `time` is outside the supported interval.
 */
public func solarObscuration(at time: Date, observer: Observer) throws -> Double {
    let time = try normalized(time)
    try assertSupported(time)
    let shadow = localMoonShadow(utDays(time), observer)
    return discObscuration(shadow.dir, shadow.target)
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `mise exec -- swift test -c release --filter SolarTests 2>&1 | tail -20`

Expected: 4 tests pass. Then `mise exec -- swift test -c release --filter EclipseTests 2>&1 | tail -5` still passes.

- [ ] **Step 6: Commit**

```bash
git add swift
git commit -F - <<'EOF'
Port solarObscuration to Swift

Function by function from solar.ts, with the shadow helper widened the same way so both eclipse layers share it.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 5: Swift solar eclipse search and public surface

**Files:**
- Modify: `swift/Sources/Almanac/Solar.swift`
- Modify: `swift/Tests/AlmanacTests/SolarTests.swift`
- Modify: `swift/Tests/AlmanacTests/PublicSurfaceTests.swift`

**Interfaces:**
- Produces `public func nextSolarEclipse(after: Date, observer: Observer) throws -> SolarEclipse`, `public func previousSolarEclipse(before: Date, observer: Observer) throws -> SolarEclipse`, `public func solarEclipses(from startUtc: Date, to endUtc: Date, observer: Observer) throws -> [SolarEclipse]`.

- [ ] **Step 1: Write the failing tests**

Add inside `SolarTests` after the catalog loader:

```swift
    struct Contact: Decodable { let utc: String; let sunAltDeg: Double? }
    struct LocalRow: Decodable {
        let eclipse: String; let place: String; let latitudeDeg: Double; let longitudeDeg: Double; let visible: Bool
        let kind: String?; let magnitude: Double?; let obscuration: Double?
        let c1: Contact?; let c2: Contact?; let peak: Contact?; let c3: Contact?; let c4: Contact?
        var observer: Observer { try! Observer(latitudeDeg: latitudeDeg, longitudeDeg: longitudeDeg) }
        /// The window `[eclipse day − 1, eclipse day + 2)` a USNO case lives in.
        var window: (Date, Date) {
            let day = utc("\(eclipse)T00:00:00Z")
            return (day.addingTimeInterval(-SolarTests.day), day.addingTimeInterval(2 * SolarTests.day))
        }
    }
    static func loadLocal() throws -> [LocalRow] {
        let url = fixturesURL().appendingPathComponent("eclipses").appendingPathComponent("solar-local.json")
        return try JSONDecoder().decode([LocalRow].self, from: Data(contentsOf: url))
    }
    static let local: [LocalRow] = try! loadLocal()

    /// Every eclipse Victoria can see, 1950-2100, by repeated next.
    static let walk: [SolarEclipse] = {
        var found: [SolarEclipse] = []
        var cursor = supportedMin
        while true {
            do {
                let e = try nextSolarEclipse(after: cursor, observer: victoria)
                found.append(e)
                cursor = e.peak
            } catch AlmanacError.outOfRange {
                break
            } catch {
                fatalError("unexpected error in solar eclipse walk: \(error)")
            }
        }
        return found
    }()

    static func ms(_ d: Date) -> Double { (d.timeIntervalSince1970 * 1000).rounded() }
    static func date(ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }
```

Append these test methods:

```swift
    // ------------------------------------------- local circumstances vs USNO

    func testUsnoCases() throws {
        for row in Self.local {
            let (from, to) = row.window
            let found = try solarEclipses(from: from, to: to, observer: row.observer)
            let label = "\(row.eclipse) \(row.place)"
            guard row.visible else {
                XCTAssertTrue(found.isEmpty, "\(label): nothing to see")
                continue
            }
            XCTAssertEqual(found.count, 1, "\(label): one eclipse")
            guard let e = found.first else { continue }
            XCTAssertEqual(e.kind.rawValue, row.kind, label)
            let pairs: [(String, Contact?, Date?, Double?)] = [
                ("c1", row.c1, e.c1, e.sunAltDeg.c1), ("c2", row.c2, e.c2, e.sunAltDeg.c2), ("peak", row.peak, e.peak, e.sunAltDeg.peak),
                ("c3", row.c3, e.c3, e.sunAltDeg.c3), ("c4", row.c4, e.c4, e.sunAltDeg.c4)
            ]
            for (k, want, got, gotAlt) in pairs {
                guard let want else {
                    // c2/c3 absent for a partial; c1/c4 absent when USNO listed a
                    // sunrise or sunset instead, which means the Sun was down at ours.
                    if k == "c2" || k == "c3" { XCTAssertNil(got, "\(label) \(k) should be absent") }
                    else { XCTAssertLessThan(gotAlt!, 0, "\(label) \(k) should be below the horizon") }
                    continue
                }
                guard let got, let gotAlt else { XCTFail("\(label) \(k) should be present"); continue }
                let err = abs(got.timeIntervalSince(utcMs(want.utc)))
                XCTAssertLessThanOrEqual(err, k == "peak" ? 300 : 60, "\(label) \(k) off by \(err) s")
                if let wantAlt = want.sunAltDeg {
                    XCTAssertLessThanOrEqual(abs(gotAlt - wantAlt), k == "peak" ? 1.5 : 0.5, "\(label) \(k) altitude")
                }
            }
            XCTAssertLessThanOrEqual(abs(e.obscuration - row.obscuration!), 0.01, "\(label) obscuration")
        }
    }

    // ------------------------------------------------ the search vs the catalog

    func testFindsEveryCentralEclipseFromItsGreatestEclipsePoint() throws {
        var bad: [String] = []
        for row in Self.catalog where row.kind != "partial" && row.central {
            let peak = utc(row.peakUtc)
            let found = try solarEclipses(from: peak.addingTimeInterval(-Self.day), to: peak.addingTimeInterval(Self.day), observer: row.observer)
            guard found.count == 1, let e = found.first else { bad.append("\(row.peakUtc): \(found.count) eclipses"); continue }
            let dt = abs(e.peak.timeIntervalSince(peak))
            if dt > 300 { bad.append("\(row.peakUtc): peak off by \(dt) s") }
            var wanted = row.kind == "hybrid" ? ["total", "annular"] : [row.kind]
            if !row.wide { wanted.append("partial") }
            if !wanted.contains(e.kind.rawValue) { bad.append("\(row.peakUtc): kind \(e.kind.rawValue), catalog \(row.kind)\(row.wide ? "" : " (narrow path)")") }
            if abs(e.sunAltDeg.peak - row.sunAltDeg) > 2 { bad.append("\(row.peakUtc): peak altitude \(e.sunAltDeg.peak), catalog \(row.sunAltDeg)") }
        }
        XCTAssertEqual(bad, [])
    }

    func testDropsAnEclipseTheAntipodeCouldOnlySeeThroughTheEarth() throws {
        // Under |gamma| 0.2 the antipode's axis distance (2·gamma·R) is inside
        // the penumbra, so only the night filter can exclude it.
        let rows = Self.catalog.filter { $0.central && $0.kind != "partial" && abs($0.gamma) < 0.2 }
        XCTAssertGreaterThan(rows.count, 10)
        for row in rows {
            let antipode = try Observer(
                latitudeDeg: -row.latitudeDeg,
                longitudeDeg: row.longitudeDeg > 0 ? row.longitudeDeg - 180 : row.longitudeDeg + 180)
            let peak = utc(row.peakUtc)
            XCTAssertGreaterThan(try solarObscuration(at: peak, observer: antipode), 0, "\(row.peakUtc) antipode obscuration")
            XCTAssertTrue(try solarEclipses(from: peak.addingTimeInterval(-Self.day), to: peak.addingTimeInterval(Self.day), observer: antipode).isEmpty, "\(row.peakUtc) antipode search")
        }
    }

    // ------------------------------------------------- search semantics

    func testVictoriaSeesAFewDozenStrictlyAscending() {
        XCTAssertGreaterThan(Self.walk.count, 30)
        for i in 1..<Self.walk.count { XCTAssertGreaterThan(Self.walk[i].peak, Self.walk[i - 1].peak) }
    }

    static func assertSame(_ a: SolarEclipse, _ b: SolarEclipse, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(a.kind, b.kind, file: file, line: line)
        XCTAssertEqual(a.obscuration, b.obscuration, file: file, line: line)
        XCTAssertEqual(a.c1, b.c1, file: file, line: line); XCTAssertEqual(a.c2, b.c2, file: file, line: line)
        XCTAssertEqual(a.peak, b.peak, file: file, line: line)
        XCTAssertEqual(a.c3, b.c3, file: file, line: line); XCTAssertEqual(a.c4, b.c4, file: file, line: line)
        XCTAssertEqual(a.sunAltDeg.c1, b.sunAltDeg.c1, file: file, line: line); XCTAssertEqual(a.sunAltDeg.c2, b.sunAltDeg.c2, file: file, line: line)
        XCTAssertEqual(a.sunAltDeg.peak, b.sunAltDeg.peak, file: file, line: line)
        XCTAssertEqual(a.sunAltDeg.c3, b.sunAltDeg.c3, file: file, line: line); XCTAssertEqual(a.sunAltDeg.c4, b.sunAltDeg.c4, file: file, line: line)
    }

    func testBackwardAndRangeSearchesFindTheSameEclipses() throws {
        var backward: [SolarEclipse] = []
        var cursor = supportedMax.addingTimeInterval(-0.001)
        for _ in 0...Self.walk.count {
            do {
                let e = try previousSolarEclipse(before: cursor, observer: Self.victoria)
                XCTAssertLessThan(e.peak, cursor)
                backward.append(e)
                cursor = e.peak
            } catch AlmanacError.outOfRange { break }
        }
        let range = try solarEclipses(from: supportedMin, to: supportedMax, observer: Self.victoria)
        for found in [Array(backward.reversed()), range] {
            XCTAssertEqual(found.count, Self.walk.count)
            for (e, want) in zip(found, Self.walk) { Self.assertSame(e, want) }
        }
    }

    func testRangeIncludesEachPeakAtStartAndExcludesItAtEnd() throws {
        for e in Self.walk {
            let ms = Self.ms(e.peak)
            XCTAssertEqual(try solarEclipses(from: e.peak, to: Self.date(ms: ms + 1), observer: Self.victoria).map(\.peak), [e.peak], "\(e.peak)")
            XCTAssertTrue(try solarEclipses(from: Self.date(ms: ms - 1), to: e.peak, observer: Self.victoria).isEmpty, "\(e.peak)")
        }
    }

    func testPinsTheSameEclipseBandAt100Ms() throws {
        let e = Self.walk.first { $0.peak > utc("2000-01-01T00:00:00Z") }!
        let ms = Self.ms(e.peak)
        XCTAssertGreaterThan(try nextSolarEclipse(after: Self.date(ms: ms - 100), observer: Self.victoria).peak, e.peak)
        XCTAssertEqual(try nextSolarEclipse(after: Self.date(ms: ms - 101), observer: Self.victoria).peak, e.peak)
        XCTAssertLessThan(try previousSolarEclipse(before: Self.date(ms: ms + 100), observer: Self.victoria).peak, e.peak)
        XCTAssertEqual(try previousSolarEclipse(before: Self.date(ms: ms + 101), observer: Self.victoria).peak, e.peak)
    }

    func testContactsInOrderIntegerMsWithSunAltAzAltitudes() throws {
        for e in Self.walk {
            let order = [e.c1, e.c2, e.peak, e.c3, e.c4].compactMap { $0 }
            for i in 1..<order.count { XCTAssertGreaterThan(order[i], order[i - 1]) }
            for d in order {
                let ms = d.timeIntervalSince1970 * 1000
                XCTAssertEqual(ms, ms.rounded(), accuracy: 1e-6)
            }
            XCTAssertEqual(e.c2 == nil, e.kind == .partial)
            XCTAssertEqual(e.c3 == nil, e.kind == .partial)
            XCTAssertEqual(e.sunAltDeg.c1, try sunAltAz(e.c1, observer: Self.victoria).altDeg)
            XCTAssertEqual(e.sunAltDeg.peak, try sunAltAz(e.peak, observer: Self.victoria).altDeg)
            XCTAssertEqual(e.sunAltDeg.c4, try sunAltAz(e.c4, observer: Self.victoria).altDeg)
            XCTAssertTrue(e.sunAltDeg.c1 > 0 || e.sunAltDeg.peak > 0 || e.sunAltDeg.c4 > 0)
            if e.kind == .total { XCTAssertEqual(e.obscuration, 1) } else {
                XCTAssertGreaterThan(e.obscuration, 0); XCTAssertLessThan(e.obscuration, 1)
            }
        }
    }

    func testObscurationAtAnInstantAgreesWithThePeakAndReachesOneInTotality() throws {
        let victoria2024 = Self.local.first { $0.place.hasPrefix("Victoria") }!
        var (from, to) = victoria2024.window
        let e = try solarEclipses(from: from, to: to, observer: victoria2024.observer)[0]
        XCTAssertEqual(try solarObscuration(at: e.peak, observer: victoria2024.observer), e.obscuration, accuracy: 1e-6)

        let salem = Self.local.first { $0.place.hasPrefix("Salem") }!
        (from, to) = salem.window
        let t = try solarEclipses(from: from, to: to, observer: salem.observer)[0]
        let mid = Date(timeIntervalSince1970: (t.c2!.timeIntervalSince1970 + t.c3!.timeIntervalSince1970) / 2)
        XCTAssertEqual(try solarObscuration(at: mid, observer: salem.observer), 1)
        XCTAssertEqual(try solarObscuration(at: t.c1.addingTimeInterval(-60), observer: salem.observer), 0)
    }

    func testValidatesBeforeEmptyWindowAndReachesBoundaryAsOutOfRange() throws {
        let from = utc("2026-09-01T00:00:00Z"), to = utc("2026-09-10T12:00:00Z")
        XCTAssertTrue(try solarEclipses(from: from, to: to, observer: Self.victoria).isEmpty)
        XCTAssertTrue(try solarEclipses(from: to, to: from, observer: Self.victoria).isEmpty)
        let nan = Date(timeIntervalSince1970: .nan)
        for query in [
            { _ = try solarEclipses(from: nan, to: to, observer: Self.victoria) },
            { _ = try solarEclipses(from: from, to: nan, observer: Self.victoria) },
            { _ = try nextSolarEclipse(after: nan, observer: Self.victoria) }
        ] {
            XCTAssertThrowsError(try query()) { error in
                guard case AlmanacError.invalidArgument = error else { return XCTFail("expected invalidArgument, got \(error)") }
            }
        }
        for query in [
            { _ = try solarEclipses(from: supportedMin.addingTimeInterval(-0.001), to: to, observer: Self.victoria) },
            { _ = try solarEclipses(from: from, to: supportedMax.addingTimeInterval(0.001), observer: Self.victoria) },
            { _ = try nextSolarEclipse(after: utc(Self.catalog.last!.peakUtc).addingTimeInterval(Self.day), observer: Self.victoria) },
            { _ = try previousSolarEclipse(before: utc(Self.catalog.first!.peakUtc).addingTimeInterval(-Self.day), observer: Self.victoria) },
            { _ = try previousSolarEclipse(before: supportedMax, observer: Self.victoria) }
        ] {
            XCTAssertThrowsError(try query()) { XCTAssertEqual($0 as? AlmanacError, .outOfRange) }
        }
    }
```

In `swift/Tests/AlmanacTests/PublicSurfaceTests.swift` add:

```swift
    func testSolarEclipse() throws {
        let observer = try Observer(latitudeDeg: 44.94, longitudeDeg: -123.03)
        let e: SolarEclipse = try nextSolarEclipse(after: Date(timeIntervalSince1970: 1_500_000_000), observer: observer) // 2017-07-14
        let previous: SolarEclipse = try previousSolarEclipse(before: e.peak, observer: observer)
        let range: [SolarEclipse] = try solarEclipses(from: previous.peak, to: e.peak, observer: observer)
        XCTAssertEqual(range.map(\.peak), [previous.peak])
        _ = (e.obscuration, e.c1, e.c2, e.peak, e.c3, e.c4)
        let alt: SolarEclipseSunAltitudes = e.sunAltDeg
        _ = (alt.c1, alt.c2, alt.peak, alt.c3, alt.c4)
        let kinds: [SolarEclipseKind] = [.partial, .annular, .total]
        XCTAssertEqual(kinds.map { $0.rawValue }, ["partial", "annular", "total"])
        XCTAssertTrue(kinds.contains(e.kind))

        let covered: Double = try solarObscuration(at: e.peak, observer: observer)
        XCTAssertFalse(covered.isNaN)

        // Construct both via their public inits — proves the inits themselves
        // are public, which a `@testable` test would not catch.
        let handAlt = SolarEclipseSunAltitudes(c1: 10, c2: nil, peak: 20, c3: nil, c4: 30)
        let hand = SolarEclipse(kind: .partial, obscuration: 0.5, c1: e.c1, c2: nil, peak: e.peak, c3: nil, c4: e.c4, sunAltDeg: handAlt)
        XCTAssertEqual(hand.kind, .partial)
        XCTAssertNil(hand.sunAltDeg.c2)
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `mise exec -- swift test -c release --filter "SolarTests|PublicSurfaceTests" 2>&1 | tail -20`

Expected: compile errors, the search functions are undefined.

- [ ] **Step 3: Implement the search**

Append to `swift/Sources/Almanac/Solar.swift`:

```swift
/**
 * UPSTREAM: `SolarEclipseObscuration`, astronomy.ts ~8670, with its clamp:
 * "in marginal cases, we need to clamp obscuration to less than 1.0. This
 * function is never called for total eclipses, so it should never return 1.0."
 */
private func solarEclipseObscuration(_ hm: Vec3, _ lo: Vec3) -> Double {
    min(0.9999, discObscuration(hm, lo))
}

/** UPSTREAM: `ShadowDistanceSlope`, astronomy.ts ~8535, bound to `localMoonShadow`. */
private func localShadowSlope(_ ut: Double, _ observer: Observer) -> Double {
    let dt = 1.0 / 86400.0
    return (localMoonShadow(ut + dt, observer).r - localMoonShadow(ut - dt, observer).r) / dt
}

/**
 * UPSTREAM: `PeakLocalMoonShadow`, astronomy.ts ~8587 — the time near the
 * new moon when the Moon's shadow axis comes closest to the observer, i.e.
 * the ascending zero of the axis distance's time derivative.
 */
private func peakLocalMoonShadow(_ centerUt: Double, _ observer: Observer) -> ShadowInfo {
    // Use the same new-moon seed regardless of search direction or window.
    // Otherwise a ~1 ms root shift can lose/duplicate a peak when a caller
    // splits a range at a previously returned peak. Only unpruned moons pay
    // for this second phase search; its start is a fixed whole UT day.
    guard let newmoon = searchMoonPhase(0, floor(centerUt) - 1, 4) else {
        fatalError("almanac internal: cannot refine new moon")
    }
    guard let ut = search(
        { u in localShadowSlope(u, observer) }, newmoon - peakWindowDays, newmoon + peakWindowDays,
        shadowTolSeconds, iterLimit: shadowIterCap, what: "peak local moon shadow"
    ) else {
        fatalError("almanac internal: failed to find peak local Moon shadow time")
    }
    return localMoonShadow(ut, observer)
}

/**
 * UPSTREAM: `EclipseKindFromUmbra`, astronomy.ts ~8834 — a positive umbra
 * radius at the observer is a total eclipse, otherwise annular. The 14 m
 * bias is upstream's, added to match Espenak's classifications.
 */
private func eclipseKindFromUmbra(_ k: Double) -> SolarEclipseKind {
    (k > 0.014) ? .total : .annular
}

/** UPSTREAM: `local_partial_distance`, astronomy.ts ~9126. */
private func localPartialDistance(_ shadow: ShadowInfo) -> Double {
    shadow.p - shadow.r
}

/** UPSTREAM: `local_total_distance`, astronomy.ts ~9130 — `|k|`, because the umbra radius is negative for an annular eclipse. */
private func localTotalDistance(_ shadow: ShadowInfo) -> Double {
    abs(shadow.k) - shadow.r
}

/** UPSTREAM: `LocalEclipseTransition`, astronomy.ts ~9165 — the instant `f` crosses zero in `direction` inside `[t1, t2]`. */
private func localEclipseTransition(
    _ observer: Observer, _ direction: Double, _ f: (ShadowInfo) -> Double, _ t1: Double, _ t2: Double
) -> Double {
    guard let ut = search(
        { u in direction * f(localMoonShadow(u, observer)) }, t1, t2,
        shadowTolSeconds, iterLimit: shadowIterCap, what: "local eclipse transition"
    ) else {
        fatalError("almanac internal: local eclipse transition search failed")
    }
    return ut
}

/**
 * UPSTREAM: `SunAltitude`, astronomy.ts ~9181 — the refracted topocentric
 * altitude `sunAltAz` reports, without its interval assertion: a contact can
 * fall just outside the supported interval while its peak is inside.
 */
private func sunAltDegAt(_ d: Date, _ observer: Observer) -> Double {
    let ut = utDays(d)
    let alt = topoAltAzUnrefracted(sunGeoVectorEqj(ttDaysFromUt(ut)), ut, observer).altDeg
    return alt + refractionDeg(alt)
}

/** UPSTREAM: `LocalEclipse`, astronomy.ts ~9137 — contacts and kind around a peak the observer is inside the penumbra for. */
private func buildSolarEclipse(_ shadow: ShadowInfo, _ observer: Observer) throws -> SolarEclipse {
    let peakUt = shadow.ut
    let c1Ut = localEclipseTransition(observer, +1.0, localPartialDistance, peakUt - partialWindowDays, peakUt)
    let c4Ut = localEclipseTransition(observer, -1.0, localPartialDistance, peakUt, peakUt + partialWindowDays)
    var c2Ut: Double? = nil
    var c3Ut: Double? = nil
    let kind: SolarEclipseKind

    if shadow.r < abs(shadow.k) {     // take absolute value of 'k' to handle annular eclipses too.
        c2Ut = localEclipseTransition(observer, +1.0, localTotalDistance, peakUt - totalWindowDays, peakUt)
        c3Ut = localEclipseTransition(observer, -1.0, localTotalDistance, peakUt, peakUt + totalWindowDays)
        kind = eclipseKindFromUmbra(shadow.k)
    } else {
        kind = .partial
    }

    let obscuration = (kind == .total) ? 1.0 : solarEclipseObscuration(shadow.dir, shadow.target)

    // Altitudes come from the reported (TimeClip-truncated) instants, so
    // `sunAltAz(e.c1, observer: observer).altDeg == e.sunAltDeg.c1` exactly.
    let c1 = try normalized(dateFromUt(c1Ut))
    let c2 = try c2Ut.map { try normalized(dateFromUt($0)) }
    let peak = try normalized(dateFromUt(peakUt))
    let c3 = try c3Ut.map { try normalized(dateFromUt($0)) }
    let c4 = try normalized(dateFromUt(c4Ut))
    return SolarEclipse(
        kind: kind, obscuration: obscuration, c1: c1, c2: c2, peak: peak, c3: c3, c4: c4,
        sunAltDeg: SolarEclipseSunAltitudes(
            c1: sunAltDegAt(c1, observer), c2: c2.map { sunAltDegAt($0, observer) }, peak: sunAltDegAt(peak, observer),
            c3: c3.map { sunAltDegAt($0, observer) }, c4: sunAltDegAt(c4, observer))
    )
}

/**
 * The night filter: the Sun's centre must be above the horizon at C1, the
 * peak, or C4. Upstream tests only C1 and C4; the peak keeps a short polar day
 * inside the eclipse.
 * ponytail: three samples, not a sunrise search — a day that starts after C1
 * and ends before the peak still drops. Upgrade path: sunEvents over [c1, c4].
 */
private func seesAnyOfIt(_ e: SolarEclipse) -> Bool {
    e.sunAltDeg.c1 > 0.0 || e.sunAltDeg.peak > 0.0 || e.sunAltDeg.c4 > 0.0
}

/**
 * The first solar eclipse `observer` can see whose peak falls strictly after
 * `after`.
 *
 * Every new moon up to the end of the supported interval is tested: the
 * Moon's ecliptic latitude prunes the ones no shadow can reach, and the rest
 * get a peak-shadow search from the observer. An eclipse whose Sun is below
 * the horizon at C1, the peak, and C4 is skipped.
 *
 * - Throws: `AlmanacError.invalidArgument` if `after` is non-finite,
 *   `AlmanacError.outOfRange` if `after` is outside the supported interval or
 *   no visible eclipse remains before the end of it.
 */
public func nextSolarEclipse(after: Date, observer: Observer) throws -> SolarEclipse {
    try nearestSolarEclipse(after, 1, observer)
}

/**
 * The last solar eclipse `observer` can see whose peak falls strictly before
 * `before`, skipping peaks within 100 ms of it, just as `nextSolarEclipse`
 * does on the other side.
 *
 * - Throws: `AlmanacError.invalidArgument` if `before` is non-finite,
 *   `AlmanacError.outOfRange` if `before` is outside the supported interval or
 *   no visible eclipse remains after the start of it.
 */
public func previousSolarEclipse(before: Date, observer: Observer) throws -> SolarEclipse {
    try nearestSolarEclipse(before, -1, observer)
}

/// Solar eclipses `observer` can see with peaks in `[from, to)`, sorted ascending. Contacts may fall outside the window.
public func solarEclipses(from startUtc: Date, to endUtc: Date, observer: Observer) throws -> [SolarEclipse] {
    let startUtc = try normalized(startUtc)
    let endUtc = try normalized(endUtc)
    try assertSupported(startUtc)
    try assertSupportedWindowEnd(endUtc)
    return try scanSolarEclipses((startUtc.timeIntervalSince1970 * 1000).rounded(), (endUtc.timeIntervalSince1970 * 1000).rounded(), 1, firstOnly: false, observer)
}

private func nearestSolarEclipse(_ anchor: Date, _ direction: Double, _ observer: Observer) throws -> SolarEclipse {
    let anchor = try normalized(anchor)
    try assertSupported(anchor)
    let ms = (anchor.timeIntervalSince1970 * 1000).rounded()
    let minMs = supportedMin.timeIntervalSince1970 * 1000
    let maxMs = supportedMax.timeIntervalSince1970 * 1000
    // No scan limit: walk to the supported boundary. A place can go years
    // without a visible solar eclipse, and a pruned new moon is cheap.
    let startMs = direction > 0 ? ms + sameEclipseMs + 1 : minMs
    let endMs = direction > 0 ? maxMs : ms - sameEclipseMs
    let found = try scanSolarEclipses(startMs, endMs, direction, firstOnly: true, observer)
    if let first = found.first { return first }
    throw AlmanacError.outOfRange
}

private func scanSolarEclipses(_ startMs: Double, _ endMs: Double, _ direction: Double, firstOnly: Bool, _ observer: Observer) throws -> [SolarEclipse] {
    var found: [SolarEclipse] = []
    if startMs >= endMs { return found }
    // Peak and new moon differ by up to the peak window. Include the entire
    // margin at both ends, then apply the caller's bounds to the reported peak.
    let startUt = utDays(Date(timeIntervalSince1970: startMs / 1000)) - peakWindowDays
    let endUt = utDays(Date(timeIntervalSince1970: endMs / 1000)) + peakWindowDays
    var nmUt = direction > 0 ? startUt : endUt
    let limitUt = direction > 0 ? endUt : startUt

    while direction * (limitUt - nmUt) > 0 {
        guard let newmoon = searchMoonPhase(0, nmUt, direction * min(40, abs(limitUt - nmUt))) else { break }
        // UPSTREAM `SearchLocalSolarEclipse`: step past this new moon before
        // the next probe, so the same one cannot be found twice.
        nmUt = newmoon + direction * 10

        // Pruning: if the new moon's ecliptic latitude is too large, a solar
        // eclipse is not possible.
        if abs(moonEclipticLatitudeDeg(newmoon)) >= pruneLatitudeDeg { continue }

        // Search near the new moon for the time when the observer is closest
        // to the line passing through the centers of the Sun and Moon.
        let shadow = peakLocalMoonShadow(newmoon, observer)
        if shadow.r >= shadow.p { continue }   // the observer never enters the penumbra
        let peak = try normalized(dateFromUt(shadow.ut))
        let peakMs = (peak.timeIntervalSince1970 * 1000).rounded()
        if peakMs < startMs || peakMs >= endMs { continue }

        // This is at least a partial solar eclipse for the observer.
        let eclipse = try buildSolarEclipse(shadow, observer)
        // Ignore any eclipse that happens completely at night.
        if !seesAnyOfIt(eclipse) { continue }
        found.append(eclipse)
        if firstOnly { break }
    }
    return found
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `mise exec -- swift test -c release --filter "SolarTests|PublicSurfaceTests" 2>&1 | tail -30`

Expected: all pass. A Swift-only failure where TypeScript passed means an operation-order difference; diff the two files function by function.

- [ ] **Step 5: Run the full Swift suite**

Run: `mise exec -- swift test -c release 2>&1 | tail -5`

Expected: all tests pass. ParityTests still passes because it has no solar rows yet.

- [ ] **Step 6: Commit**

```bash
git add swift
git commit -F - <<'EOF'
Port the solar eclipse search to Swift

Function by function from solar.ts, with the public surface test proving every new symbol and init is public.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 6: Parity corpus for the solar search and obscuration

**Files:**
- Modify: `fixtures/generate/parity.mjs`
- Create (by the script): `fixtures/parity/solar.json`; regenerated `fixtures/parity/meta.json`
- Modify: `swift/Tests/AlmanacTests/ParityTests.swift`

**Interfaces:**
- Produces `fixtures/parity/solar.json`: `{ observers, eclipses: [{ observerIdx, kind, obscuration, c1Ms, c2Ms, peakMs, c3Ms, c4Ms, sunAltDeg: { c1, c2, peak, c3, c4 } }], obscuration: [{ observerIdx, tMs, value }] }` with fractions scaled by 1e6, angles by 1e6, and instants quantized to 100 ms.

- [ ] **Step 1: Extend the corpus generator**

In `fixtures/generate/parity.mjs`, add `solarEclipses, solarObscuration` to the import from `../../typescript/dist/index.js`. After `PHASE_WINDOW_2026` add:

```js
/** solarObscuration sampled every two minutes through two Victoria partials: 2024-04-08 (17%) and 2017-08-21 (deep). */
export const OBSCURATION_TRACKS = [
    { observerIdx: 0, startMs: Date.UTC(2024, 3, 8, 17, 30), endMs: Date.UTC(2024, 3, 8, 19, 30), stepMs: 120000 },
    { observerIdx: 0, startMs: Date.UTC(2017, 7, 21, 16, 0), endMs: Date.UTC(2017, 7, 21, 18, 30), stepMs: 120000 },
];
```

After `buildEclipses` add:

```js
function buildSolar() {
    // Solar eclipses are observer-bound: every observer gets the full range.
    // The solar tests prove next/previous walks reproduce it exactly.
    const eclipses = [];
    for (let observerIdx = 0; observerIdx < OBSERVERS.length; observerIdx++) {
        for (const e of solarEclipses(new Date(MIN_MS), new Date(MAX_MS), OBSERVERS[observerIdx])) {
            eclipses.push({
                observerIdx,
                kind: e.kind,
                obscuration: qFrac(e.obscuration),
                c1Ms: qEventMs(e.c1),
                c2Ms: qNullableEventMs(e.c2),
                peakMs: qEventMs(e.peak),
                c3Ms: qNullableEventMs(e.c3),
                c4Ms: qEventMs(e.c4),
                sunAltDeg: {
                    c1: qAngle(e.sunAltDeg.c1),
                    c2: e.sunAltDeg.c2 === null ? null : qAngle(e.sunAltDeg.c2),
                    peak: qAngle(e.sunAltDeg.peak),
                    c3: e.sunAltDeg.c3 === null ? null : qAngle(e.sunAltDeg.c3),
                    c4: qAngle(e.sunAltDeg.c4),
                },
            });
        }
    }
    const obscuration = [];
    for (const { observerIdx, startMs, endMs, stepMs } of OBSCURATION_TRACKS) {
        for (let tMs = startMs; tMs <= endMs; tMs += stepMs) {
            obscuration.push({ observerIdx, tMs, value: qFrac(solarObscuration(new Date(tMs), OBSERVERS[observerIdx])) });
        }
    }
    return { observers: OBSERVERS, eclipses, obscuration };
}
```

In `buildMeta`'s `counts` add `solarEclipses: files.solar.eclipses.length, obscurationSamples: files.solar.obscuration.length`. In `buildCorpus` add `const solar = buildSolar();` and return it. In `ROW_SCHEMAS` add:

```js
    solarEclipse: {
        observerIdx: EXACT, kind: EXACT, obscuration: SCALED,
        c1Ms: TIME, c2Ms: TIME, peakMs: TIME, c3Ms: TIME, c4Ms: TIME,
        sunAltDeg: { c1: SCALED, c2: SCALED, peak: SCALED, c3: SCALED, c4: SCALED },
    },
    obscuration: { observerIdx: EXACT, tMs: EXACT, value: SCALED },
```

In `checkFile` add:

```js
        case "solar.json":
            compareNode("solar.observers", [OBSERVER_SCHEMA], fresh.observers, committed.observers, ctx);
            compareNode("solar.eclipses", [ROW_SCHEMAS.solarEclipse], fresh.eclipses, committed.eclipses, ctx);
            compareNode("solar.obscuration", [ROW_SCHEMAS.obscuration], fresh.obscuration, committed.obscuration, ctx);
            break;
```

In `main`'s `raw` map add `"solar.json": files.solar`. Update the header comment's coverage sentence to mention "every solar eclipse each observer can see 1950-2100, and obscuration through two Victoria partials".

- [ ] **Step 2: Generate and check from TypeScript**

Run:

```bash
(cd typescript && mise exec -- npm run build)
mise exec -- node fixtures/generate/parity.mjs "$(git rev-parse HEAD)" "$(git rev-parse HEAD)"
mise exec -- node fixtures/generate/parity.mjs --check HEAD HEAD
node -e 'const s=require("./fixtures/parity/solar.json");console.log(s.eclipses.length,s.obscuration.length,s.eclipses[0])'
```

Expected: `parity.mjs: wrote 7 files`, then `--check: clean`, then over 100 solar rows and 137 obscuration samples. The other five corpus files should be unchanged apart from `meta.json`; confirm with `git status --short fixtures/parity`.

- [ ] **Step 3: Write the failing Swift parity check**

In `swift/Tests/AlmanacTests/ParityTests.swift`, after `EclipsesFile`, add:

```swift
    struct SolarAltRow: Codable, Equatable { let c1: Int; let c2: Int?; let peak: Int; let c3: Int?; let c4: Int }
    struct SolarEclipseRow: Codable {
        let observerIdx: Int; let kind: String; let obscuration: Int
        let c1Ms: Int64; let c2Ms: Int64?; let peakMs: Int64; let c3Ms: Int64?; let c4Ms: Int64
        let sunAltDeg: SolarAltRow
    }
    struct ObscurationRow: Codable { let observerIdx: Int; let tMs: Int64; let value: Int }
    struct SolarFile: Codable { let observers: [ObserverRow]; let eclipses: [SolarEclipseRow]; let obscuration: [ObscurationRow] }
```

Add `let solar: SolarFile` to `Corpus`. After `betelgeuse` add:

```swift
    /// solarObscuration sampled every two minutes through two Victoria partials: 2024-04-08 (17%) and 2017-08-21 (deep).
    static let obscurationTracks: [(observerIdx: Int, startMs: Int64, endMs: Int64, stepMs: Int64)] = [
        (0, 1_712_597_400_000, 1_712_604_600_000, 120_000),   // 2024-04-08T17:30Z ... 19:30Z
        (0, 1_503_331_200_000, 1_503_340_200_000, 120_000),   // 2017-08-21T16:00Z ... 18:30Z
    ]
```

In `buildCorpus`, before `return Corpus(...)`, add:

```swift
        // Solar eclipses are observer-bound: every observer gets the full range.
        var solarRows: [SolarEclipseRow] = []
        for (idx, observer) in observers.enumerated() {
            for e in try solarEclipses(from: dateFromMs(minMs), to: dateFromMs(maxMs), observer: observer) {
                solarRows.append(SolarEclipseRow(
                    observerIdx: idx, kind: e.kind.rawValue, obscuration: qScaled(e.obscuration, scales.fraction),
                    c1Ms: qEventMs(e.c1), c2Ms: qEventMsOpt(e.c2), peakMs: qEventMs(e.peak), c3Ms: qEventMsOpt(e.c3), c4Ms: qEventMs(e.c4),
                    sunAltDeg: SolarAltRow(
                        c1: qScaled(e.sunAltDeg.c1, scales.angleDeg), c2: e.sunAltDeg.c2.map { qScaled($0, scales.angleDeg) },
                        peak: qScaled(e.sunAltDeg.peak, scales.angleDeg), c3: e.sunAltDeg.c3.map { qScaled($0, scales.angleDeg) },
                        c4: qScaled(e.sunAltDeg.c4, scales.angleDeg))))
            }
        }
        var obscurationRows: [ObscurationRow] = []
        for track in obscurationTracks {
            var tMs = track.startMs
            while tMs <= track.endMs {
                let value = try solarObscuration(at: dateFromMs(tMs), observer: observers[track.observerIdx])
                obscurationRows.append(ObscurationRow(observerIdx: track.observerIdx, tMs: tMs, value: qScaled(value, scales.fraction)))
                tMs += track.stepMs
            }
        }
        let solar = SolarFile(observers: observerRows, eclipses: solarRows, obscuration: obscurationRows)
```

and pass `solar: solar` to `Corpus(...)`. Add `static let committedSolar: SolarFile = try! load(SolarFile.self, "solar.json")` beside the other committed loads.

In `testTolerant`, add a `nearOpt` helper beside `nearMsOpt`:

```swift
        func nearOpt(_ a: Int?, _ b: Int?, _ t: Int, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
            XCTAssertEqual(a == nil, b == nil, "\(what): null-ness", file: file, line: line)
            if let a, let b { near(a, b, t, what, file: file, line: line) }
        }
```

and at the end of the method:

```swift
        XCTAssertEqual(fresh.solar.observers, Self.committedSolar.observers)
        XCTAssertEqual(fresh.solar.eclipses.count, Self.committedSolar.eclipses.count)
        for (a, b) in zip(fresh.solar.eclipses, Self.committedSolar.eclipses) {
            XCTAssertEqual(a.observerIdx, b.observerIdx, "solar observerIdx @\(a.peakMs)")
            XCTAssertEqual(a.kind, b.kind, "solar kind @\(a.peakMs)")
            near(a.obscuration, b.obscuration, tolFrac, "solar obscuration @\(a.peakMs)")
            nearMs(a.c1Ms, b.c1Ms, "solar c1Ms @\(a.peakMs)")
            nearMsOpt(a.c2Ms, b.c2Ms, "solar c2Ms @\(a.peakMs)")
            nearMs(a.peakMs, b.peakMs, "solar peakMs @\(a.peakMs)")
            nearMsOpt(a.c3Ms, b.c3Ms, "solar c3Ms @\(a.peakMs)")
            nearMs(a.c4Ms, b.c4Ms, "solar c4Ms @\(a.peakMs)")
            near(a.sunAltDeg.c1, b.sunAltDeg.c1, tolAngle, "solar sunAltDeg.c1 @\(a.peakMs)")
            nearOpt(a.sunAltDeg.c2, b.sunAltDeg.c2, tolAngle, "solar sunAltDeg.c2 @\(a.peakMs)")
            near(a.sunAltDeg.peak, b.sunAltDeg.peak, tolAngle, "solar sunAltDeg.peak @\(a.peakMs)")
            nearOpt(a.sunAltDeg.c3, b.sunAltDeg.c3, tolAngle, "solar sunAltDeg.c3 @\(a.peakMs)")
            near(a.sunAltDeg.c4, b.sunAltDeg.c4, tolAngle, "solar sunAltDeg.c4 @\(a.peakMs)")
        }
        XCTAssertEqual(fresh.solar.obscuration.count, Self.committedSolar.obscuration.count)
        for (a, b) in zip(fresh.solar.obscuration, Self.committedSolar.obscuration) {
            XCTAssertEqual(a.observerIdx, b.observerIdx)
            XCTAssertEqual(a.tMs, b.tMs)
            near(a.value, b.value, tolFrac, "obscuration @\(a.tMs)")
        }
```

In `testExactReproduction`, beside its `nearMsOpt` helper add:

```swift
        func nearOpt(_ a: Int?, _ b: Int?, _ what: String, file: StaticString = #filePath, line: UInt = #line) {
            XCTAssertEqual(a == nil, b == nil, "\(what): null-ness", file: file, line: line)
            if let a, let b { near(a, b, what, file: file, line: line) }
        }
```

after the other `roundTrip` calls add `let solar = try roundTrip(fresh.solar, "solar.json")`, and at the end of the method append:

```swift
        XCTAssertEqual(solar.observers, Self.committedSolar.observers)
        XCTAssertEqual(solar.eclipses.count, Self.committedSolar.eclipses.count)
        for (a, b) in zip(solar.eclipses, Self.committedSolar.eclipses) {
            XCTAssertEqual(a.observerIdx, b.observerIdx, "solar observerIdx @\(a.peakMs)")
            XCTAssertEqual(a.kind, b.kind, "solar kind @\(a.peakMs)")
            near(a.obscuration, b.obscuration, "solar obscuration @\(a.peakMs)")
            nearMs(a.c1Ms, b.c1Ms, "solar c1Ms @\(a.peakMs)")
            nearMsOpt(a.c2Ms, b.c2Ms, "solar c2Ms @\(a.peakMs)")
            nearMs(a.peakMs, b.peakMs, "solar peakMs @\(a.peakMs)")
            nearMsOpt(a.c3Ms, b.c3Ms, "solar c3Ms @\(a.peakMs)")
            nearMs(a.c4Ms, b.c4Ms, "solar c4Ms @\(a.peakMs)")
            near(a.sunAltDeg.c1, b.sunAltDeg.c1, "solar sunAltDeg.c1 @\(a.peakMs)")
            nearOpt(a.sunAltDeg.c2, b.sunAltDeg.c2, "solar sunAltDeg.c2 @\(a.peakMs)")
            near(a.sunAltDeg.peak, b.sunAltDeg.peak, "solar sunAltDeg.peak @\(a.peakMs)")
            nearOpt(a.sunAltDeg.c3, b.sunAltDeg.c3, "solar sunAltDeg.c3 @\(a.peakMs)")
            near(a.sunAltDeg.c4, b.sunAltDeg.c4, "solar sunAltDeg.c4 @\(a.peakMs)")
        }
        XCTAssertEqual(solar.obscuration.count, Self.committedSolar.obscuration.count)
        for (a, b) in zip(solar.obscuration, Self.committedSolar.obscuration) {
            XCTAssertEqual(a.observerIdx, b.observerIdx)
            XCTAssertEqual(a.tMs, b.tMs)
            near(a.value, b.value, "obscuration @\(a.tMs)")
        }
```

- [ ] **Step 4: Run the Swift parity test**

Run: `mise exec -- swift test -c release --filter ParityTests 2>&1 | tail -20`

Expected: both parity tests pass. A drift beyond 5 scaled units or 100 ms on a solar field is a port difference: compare the two ports' functions in the order the failure names.

- [ ] **Step 5: Run every check the CI runs**

```bash
(
  cd typescript
  mise exec -- npm run build
  mise exec -- npm test
  mise exec -- npm audit
  mise exec -- npm pack --dry-run
)
mise exec -- swift test -c release
mise exec -- node fixtures/generate/derive.mjs --check
mise exec -- node fixtures/generate/parity.mjs --check HEAD HEAD
mise exec -- node --test benchmarks/compare.test.mjs
git status --short
```

Expected: everything passes, and `git status` shows only intended files (the `npm pack --dry-run` staging copies `README.md`, `LICENSE`, `NOTICE` inside `typescript/`; do not commit those, `git checkout -- typescript/README.md typescript/LICENSE typescript/NOTICE` if they appear, or confirm they are ignored).

- [ ] **Step 6: Commit**

```bash
git add fixtures/generate/parity.mjs fixtures/parity swift/Tests/AlmanacTests/ParityTests.swift
git commit -F - <<'EOF'
Add the solar search and obscuration to the parity corpus

Both ports must reproduce the same solar circumstances for the three fixed observers across the supported interval, and the same obscuration curve through two Victoria partials, within the corpus's existing near-exact tolerance.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
```

---

### Task 7: Contract, roadmap, README, and PR body

**Files:**
- Modify: `docs/CONTRACT.md`
- Modify: `docs/ROADMAP.md`
- Modify: `README.md`
- Modify: `typescript/package.json`

- [ ] **Step 1: Contract**

In `docs/CONTRACT.md`:

Line 16 becomes: `- Events: root finding over the position and transform layers for rise, set, twilight, transit, phase, lunar eclipse, and solar eclipse searches.`

Line 18 gains a sentence: `Solar eclipses are found from an observer's distance to the Moon's shadow axis at each new moon.`

After the lunar visibility bullet (line 39) add:

```markdown
- Solar eclipse circumstances are observer-bound. The peak is the closest approach of the Moon's shadow axis to the observer, not greatest eclipse. The Sun's altitude at each contact is the refracted topocentric value `sunAltAz` reports for that instant. An eclipse whose Sun is below the horizon at C1, the peak, and C4 is not returned. `solarObscuration` is purely geometric and does not test the horizon.
```

After the `lunarEclipseVisibility` table row add:

```markdown
| `nextSolarEclipse(after, observer)` | Instant and observer | The solar eclipse the observer can see strictly after the anchor, or the out-of-range outcome. |
| `previousSolarEclipse(before, observer)` | Instant and observer | The solar eclipse the observer can see strictly before the anchor, or the out-of-range outcome. |
| `solarEclipses(startUtc, endUtc, observer)` | Half-open window and observer | Every solar eclipse the observer can see whose peak is in the window, sorted by peak. Contacts may extend outside the window. |
| `solarObscuration(time, observer)` | Instant and observer | Fraction of the Sun's disc area the Moon covers, in `[0, 1]`. |
```

After the lunar shape paragraph (line 61) add:

```markdown
A solar eclipse has `kind`, `obscuration`, `c1`, `c2`, `peak`, `c3`, `c4`, and `sunAltDeg`. Kind is `partial`, `annular`, or `total`; C1, peak, and C4 are always present, and C2 and C3 are present only for annular and total eclipses. `sunAltDeg` carries the Sun's altitude at each contact with the same presence pattern. `obscuration` is the fraction of the Sun's disc area covered at the peak, exactly 1 for a total eclipse.
```

In the shared-behavior table, after the `Search anchor` row add:

```markdown
| Solar eclipse scan | Next and previous solar eclipse searches walk new moons to the supported boundary, then return the out-of-range outcome. |
```

After the `lunarEclipses` paragraph (line 80) add:

```markdown
`solarEclipses` returns every eclipse the observer can see whose peak is in `[startUtc, endUtc)`. Candidate peaks use a fixed whole-UT-day new-moon seed, so adjacent ranges can split at a returned peak without losing or duplicating it. The same-eclipse band and the bounded root finders apply as for lunar eclipses.
```

In the evidence list, after the contact fixtures bullet add:

```markdown
- Solar eclipse local circumstances (kind, contacts, Sun altitudes, obscuration) use the USNO Astronomical Applications API for eclipses from 2001 through 2026, the years that endpoint serves.
- Solar eclipse kinds, peaks, and obscuration at the point of greatest eclipse use the Espenak Five Millennium Catalog of Solar Eclipses across the supported interval, with the observer placed at the catalog's whole-degree coordinates.
```

In the tolerance table add:

```markdown
| Solar eclipse contacts C1 to C4 | 60 seconds |
| Solar eclipse peak | 5 minutes |
| Solar eclipse obscuration | 0.01 |
| Sun altitude at C1 to C4 | 0.5° |
| Sun altitude at the peak | 1.5° |
```

After the Delta-T paragraph (line 105) add:

```markdown
The solar eclipse peak is looser than its contacts because the axis-distance curve is flat at its minimum, so the root of its derivative is ill-conditioned, while the contacts are steep crossings. The catalog's whole-degree coordinates alone move the local peak by up to about 3 minutes. The altitude at the peak inherits that time tolerance.
```

- [ ] **Step 2: Roadmap**

In `docs/ROADMAP.md`, after the lunar eclipse bullet under Included add:

```markdown
- Solar eclipse next, previous, and range searches for an observer, including eclipse kind, contact times with the Sun's altitude at each, peak obscuration, and the fraction of the Sun's disc covered at any instant.
```

Replace the first Boundaries bullet with:

```markdown
- The global solar eclipse search (the peak instant with no observer, and where the shadow axis meets the surface), path classification, eclipse magnitude, and safe-viewing guidance remain outside the public API until a consumer needs them.
```

- [ ] **Step 3: README and package description**

In `README.md`, line 3: replace "lunar eclipses," with "lunar eclipses, solar eclipses for an observer,". In the TypeScript usage block, after the lunar `console.log` line add:

```ts
const solar = nextSolarEclipse(new Date(), observer);
console.log(solar.kind, solar.peak, solar.obscuration, solar.sunAltDeg.peak);
console.log(solarObscuration(solar.peak, observer));   // fraction of the Sun's disc covered, 0 to 1
```

and add `nextSolarEclipse, solarObscuration` to that block's import. In the Swift usage block, after the lunar `print` line add:

```swift
let solar = try nextSolarEclipse(after: Date(), observer: observer)
print(solar.kind, solar.peak, solar.obscuration, solar.sunAltDeg.peak)
print(try solarObscuration(at: solar.peak, observer: observer))   // fraction of the Sun's disc covered, 0 to 1
```

In the "Eclipse searches" section, after the Swift block, add:

```markdown
Solar eclipses are searched for an observer, because their contacts only exist for a place: `nextSolarEclipse(after, observer)`, `previousSolarEclipse(before, observer)`, and `solarEclipses(startUtc, endUtc, observer)`. Eclipses the Sun is below the horizon for throughout are not returned.
```

In `typescript/package.json`, set `"description": "Offline sun & moon engine: positions, rise/set, moon phase, lunar and solar eclipses."` and add `"solar-eclipse"` after `"lunar-eclipse"` in `keywords`.

- [ ] **Step 4: Check and commit**

Run `mise exec -- node fixtures/generate/derive.mjs --check` (docs do not affect it, but the pack step below reads README) and `(cd typescript && mise exec -- npm pack --dry-run)`; expected: both succeed, and the pack output lists `README.md`. Then:

```bash
git add docs/CONTRACT.md docs/ROADMAP.md README.md typescript/package.json
git commit -F - <<'EOF'
Document solar eclipses in the contract, roadmap, and README

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
EOF
git push
```

- [ ] **Step 5: Update the pull request body**

Measure the fixture residuals once, without committing the probe: in `typescript/`, run a one-off script against the built package that loops over the USNO cases and prints the worst contact error in seconds, the worst peak error, the worst obscuration error, and the worst altitude error, for example:

```bash
cd typescript && mise exec -- node --input-type=module -e '
import { solarEclipses } from "./dist/index.js";
import { readFileSync } from "node:fs";
const rows = JSON.parse(readFileSync("../fixtures/eclipses/solar-local.json", "utf8")).filter(r => r.visible);
let worst = { contact: 0, peak: 0, obscuration: 0, alt: 0 };
for (const r of rows) {
  const day = Date.parse(r.eclipse + "T00:00:00Z");
  const e = solarEclipses(new Date(day - 86400000), new Date(day + 2 * 86400000), { latitudeDeg: r.latitudeDeg, longitudeDeg: r.longitudeDeg })[0];
  for (const k of ["c1", "c2", "peak", "c3", "c4"]) {
    if (!r[k] || !e[k]) continue;
    const dt = Math.abs(e[k].getTime() - Date.parse(r[k].utc)) / 1000;
    if (k === "peak") worst.peak = Math.max(worst.peak, dt); else worst.contact = Math.max(worst.contact, dt);
    if (r[k].sunAltDeg !== null) worst.alt = Math.max(worst.alt, Math.abs(e.sunAltDeg[k] - r[k].sunAltDeg));
  }
  worst.obscuration = Math.max(worst.obscuration, Math.abs(e.obscuration - r.obscuration));
}
console.log(worst);'
```

Then edit the pull request body with `gh pr edit 24 --body-file -`: keep the opening two paragraphs, tick every checklist item, and add a paragraph before the checklist giving those four numbers against their tolerances (60 s, 300 s, 0.01, 0.5° and 1.5°). If any residual sits within a quarter of its tolerance, say so. Keep the closing benchmark paragraph and the generated-with line.

Then mark the PR ready for review: `gh pr ready 24`.
