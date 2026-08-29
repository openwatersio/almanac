#!/usr/bin/env node
// Cross-port parity corpus: canonical inputs + quantized outputs that catch
// port drift below physical tolerances. Consumes the BUILT TS package
// (public API only -- `npm run build` in typescript/ first) and writes
// scaled-integer JSON under fixtures/parity/. Row order is fixed (ascending
// sample time / observer index / eclipse peak); provenance (the two ports'
// generating commit shas, passed as argv -- never exec'd, never compared)
// lands only in the uncompared meta.json.
//
// `--check` regenerates and compares against the committed files via a
// NEAR-EXACT structural (decoded, not byte) check -- this is the TS side's
// "regenerate candidate, compare to committed" half of the parity contract;
// the Swift side's half is ParityTests.swift's reproduction check. Same
// epsilons both sides: see the near-exact block below for why byte-exact
// doesn't hold even within one language.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
    sunPosition, moonPosition, sunAltAz, moonAltAz, moonIllumination,
    sunEvents, moonEvents, searchMoonPhases,
    nextLunarEclipse, lunarEclipseVisibility, AlmanacOutOfRangeError,
} from "../../typescript/dist/index.js";

const FIXTURES_DIR = new URL("../parity/", import.meta.url);

// ---------------------------------------------------------------- coverage

const DAY_MS = 86400000;
export const MIN_MS = Date.UTC(1950, 0, 1);
export const MAX_MS = Date.UTC(2101, 0, 1);
const SAMPLE_STEP_MS = 8 * DAY_MS;

/** Every 8 days over the full supported interval [1950-01-01, 2101-01-01). */
export function sampleTimesMs() {
    const out = [];
    for (let t = MIN_MS; t < MAX_MS; t += SAMPLE_STEP_MS) out.push(t);
    return out;
}

export const VICTORIA = { latitudeDeg: 48.4284, longitudeDeg: -123.3656 };
const N60 = { latitudeDeg: 60, longitudeDeg: -123.052 };
const EQUATOR = { latitudeDeg: 0, longitudeDeg: -123.052 };
export const OBSERVERS = [VICTORIA, N60, EQUATOR];

/** The 12 calendar-month windows of 2026, half-open. */
export function monthWindows2026() {
    const out = [];
    for (let m = 0; m < 12; m++) {
        out.push({ startMs: Date.UTC(2026, m, 1), endMs: Date.UTC(2026, m + 1, 1) });
    }
    return out;
}

export const PHASE_WINDOW_2026 = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2027, 0, 1) };

// -------------------------------------------------------------- quantizing

const ANGLE_SCALE = 1e6;      // degrees -> micro-degrees
const KM_SCALE = 1e3;         // km -> metres
const AU_SCALE = 1e9;         // AU -> nano-AU
const FRACTION_SCALE = 1e6;   // dimensionless ratios (illum fraction, phase, eclipse magnitudes)
const EVENT_TIME_QUANTUM_MS = 100;

const qAngle = (deg) => Math.round(deg * ANGLE_SCALE);
const qKm = (km) => Math.round(km * KM_SCALE);
const qAu = (au) => Math.round(au * AU_SCALE);
const qFrac = (x) => Math.round(x * FRACTION_SCALE);
/** Event/eclipse instants: quantized to 100 ms (consistent with the <1s root
 *  convergence). Position/illumination sample times are the exact input ms
 *  and are never passed through this. */
const qEventMs = (d) => Math.round(d.getTime() / EVENT_TIME_QUANTUM_MS) * EVENT_TIME_QUANTUM_MS;
const qNullableEventMs = (d) => (d === null ? null : qEventMs(d));

// ------------------------------------------------------------- corpus rows

function buildPositionsAltazIllumination() {
    const positions = [];
    const altaz = [];
    const illumination = [];
    for (const tMs of sampleTimesMs()) {
        const t = new Date(tMs);
        const sun = sunPosition(t);
        const moon = moonPosition(t);
        positions.push({
            tMs,
            sun: { raDeg: qAngle(sun.raDeg), decDeg: qAngle(sun.decDeg), distanceAu: qAu(sun.distanceAu) },
            moon: { raDeg: qAngle(moon.raDeg), decDeg: qAngle(moon.decDeg), distanceKm: qKm(moon.distanceKm) },
        });

        const sunAa = sunAltAz(t, VICTORIA);
        const moonAa = moonAltAz(t, VICTORIA);
        altaz.push({
            tMs,
            sun: { azDeg: qAngle(sunAa.azDeg), altDeg: qAngle(sunAa.altDeg) },
            moon: { azDeg: qAngle(moonAa.azDeg), altDeg: qAngle(moonAa.altDeg) },
        });

        const illum = moonIllumination(t);
        illumination.push({
            tMs,
            fraction: qFrac(illum.fraction),
            phaseAngleDeg: qAngle(illum.phaseAngleDeg),
            phase: qFrac(illum.phase),
            waxing: illum.waxing,
        });
    }
    return { positions, altaz, illumination };
}

function buildEvents() {
    const sunRows = [];
    const moonRows = [];
    for (let observerIdx = 0; observerIdx < OBSERVERS.length; observerIdx++) {
        const observer = OBSERVERS[observerIdx];
        for (const { startMs, endMs } of monthWindows2026()) {
            for (const e of sunEvents(new Date(startMs), new Date(endMs), observer)) {
                sunRows.push({ observerIdx, tMs: qEventMs(e.time), kind: e.kind });
            }
            for (const e of moonEvents(new Date(startMs), new Date(endMs), observer)) {
                moonRows.push({ observerIdx, tMs: qEventMs(e.time), kind: e.kind });
            }
        }
    }
    const phaseRows = searchMoonPhases(
        new Date(PHASE_WINDOW_2026.startMs), new Date(PHASE_WINDOW_2026.endMs)
    ).map((e) => ({ tMs: qEventMs(e.time), phase: e.phase }));

    return { observers: OBSERVERS, sunEvents: sunRows, moonEvents: moonRows, moonPhases: phaseRows };
}

function buildEclipses() {
    const found = [];
    let cursor = new Date(MIN_MS);
    for (;;) {
        let e;
        try {
            e = nextLunarEclipse(cursor);
        } catch (err) {
            if (err instanceof AlmanacOutOfRangeError) break;
            throw err;
        }
        found.push(e);
        cursor = e.peak;
    }

    const eclipses = found.map((e) => ({
        kind: e.kind,
        peakMs: qEventMs(e.peak),
        magUmbral: qFrac(e.magUmbral),
        magPenumbral: qFrac(e.magPenumbral),
        p1Ms: qEventMs(e.p1),
        u1Ms: qNullableEventMs(e.u1),
        u2Ms: qNullableEventMs(e.u2),
        u3Ms: qNullableEventMs(e.u3),
        u4Ms: qNullableEventMs(e.u4),
        p4Ms: qEventMs(e.p4),
        visibility: OBSERVERS.map((observer) => {
            const v = lunarEclipseVisibility(e, observer);
            return {
                visibleAtPeak: v.visibleAtPeak,
                moonGeometricAltAtPeakDeg: qAngle(v.moonGeometricAltAtPeakDeg),
                contactsVisible: { ...v.contactsVisible },
            };
        }),
    }));

    return { observers: OBSERVERS, eclipses };
}

function json(obj) {
    return JSON.stringify(obj, null, 2) + "\n";
}

function buildMeta(tsCommit, swiftCommit, files) {
    return json({
        source: "fixtures/generate/parity.mjs -- cross-port parity corpus, computed values only (no external reference)",
        generatedAt: new Date().toISOString(),
        tsCommit,
        swiftCommit,
        note: "Provenance only -- never compared. Scales/tolerances below are read by both ports' parity tests; changing them is a spec change, not a fixture regen.",
        scales: { angleDeg: ANGLE_SCALE, distanceKm: KM_SCALE, distanceAu: AU_SCALE, fraction: FRACTION_SCALE },
        tolerances: { angleDeg: 1e-5, distanceKm: 1e-2, distanceAu: 1e-8, fraction: 1e-5, timeMs: 100 },
        eventTimeQuantumMs: EVENT_TIME_QUANTUM_MS,
        counts: {
            samples: files.positions.length,
            sunEvents: files.events.sunEvents.length,
            moonEvents: files.events.moonEvents.length,
            moonPhases: files.events.moonPhases.length,
            eclipses: files.eclipses.eclipses.length,
        },
    });
}

export function buildCorpus() {
    const { positions, altaz, illumination } = buildPositionsAltazIllumination();
    const events = buildEvents();
    const eclipses = buildEclipses();
    return { positions, altaz, illumination, events, eclipses };
}

// ------------------------------------------------------- near-exact check
//
// `--check` decodes the committed and freshly-computed corpora and compares
// them field-by-field, not byte-for-byte -- and not even at strict integer
// equality. The eclipse rows come from an iterative root search
// (nextLunarEclipse's bisection walk), which amplifies ULP-level Math.*
// differences across V8 versions/platforms (this repo generates locally on
// macOS; CI's `typescript` job runs Node 22 on ubuntu) into an occasional
// rounding-boundary flip in the least-significant scaled-integer digit or a
// single 100 ms time quantum. This is the same phenomenon the Swift port's
// ParityTests.swift already ratified an epsilon for in its
// `testExactReproduction` (reproScaleTol = 5 scaled units, reproTimeMs =
// 100 ms = one time quantum) -- measured there at 13 of ~50,000+ compared
// scaled ints (max drift 4 of 1e6 == 4e-6 deg) and 1 of ~2,000 compared
// event times (drift exactly one 100 ms quantum). REPRO_SCALE_TOL /
// REPRO_TIME_MS below reuse that same ratified value: 5 scaled units is
// ~5e-6 deg on the angle-scaled fields, ~2500x under the spec's physical
// parity tolerance of 1e-5 deg (`fixtures/parity/meta.json`'s
// `tolerances.angleDeg`), and 100 ms has no headroom to tighten further
// since event/eclipse instants are themselves quantized to
// EVENT_TIME_QUANTUM_MS. Exact-input sample times (`tMs` on
// positions/altaz/illumination) are never computed -- they're the loop
// index in `sampleTimesMs()` -- so they get no slack and must match
// exactly; row counts, shapes, kinds, and booleans are likewise exact.
const REPRO_SCALE_TOL = 5;
const REPRO_TIME_MS = 100;
const EXACT = "exact", SCALED = "scaled", TIME = "time";

const OBSERVER_SCHEMA = { latitudeDeg: EXACT, longitudeDeg: EXACT };
const ROW_SCHEMAS = {
    positions: {
        tMs: EXACT,
        sun: { raDeg: SCALED, decDeg: SCALED, distanceAu: SCALED },
        moon: { raDeg: SCALED, decDeg: SCALED, distanceKm: SCALED },
    },
    altaz: {
        tMs: EXACT,
        sun: { azDeg: SCALED, altDeg: SCALED },
        moon: { azDeg: SCALED, altDeg: SCALED },
    },
    illumination: { tMs: EXACT, fraction: SCALED, phaseAngleDeg: SCALED, phase: SCALED, waxing: EXACT },
    sunEvent: { observerIdx: EXACT, tMs: TIME, kind: EXACT },
    moonEvent: { observerIdx: EXACT, tMs: TIME, kind: EXACT },
    moonPhase: { tMs: TIME, phase: EXACT },
    eclipse: {
        kind: EXACT, peakMs: TIME, magUmbral: SCALED, magPenumbral: SCALED,
        p1Ms: TIME, u1Ms: TIME, u2Ms: TIME, u3Ms: TIME, u4Ms: TIME, p4Ms: TIME,
        visibility: [{
            visibleAtPeak: EXACT, moonGeometricAltAtPeakDeg: SCALED,
            contactsVisible: { p1: EXACT, u1: EXACT, u2: EXACT, u3: EXACT, u4: EXACT, p4: EXACT },
        }],
    },
};

/** Recursively compares `a` vs `b` against `schema` (object/array of schema,
 *  or a leaf kind), reporting into `ctx` -- never throws, records instead. */
function compareNode(path, schema, a, b, ctx) {
    if (Array.isArray(schema)) {
        if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
            ctx.fail(path, `row count ${a?.length} vs ${b?.length}`);
            return;
        }
        for (let i = 0; i < a.length; i++) compareNode(`${path}[${i}]`, schema[0], a[i], b[i], ctx);
        return;
    }
    if (schema && typeof schema === "object") {
        for (const key of Object.keys(schema)) compareNode(`${path}.${key}`, schema[key], a?.[key], b?.[key], ctx);
        return;
    }
    // Leaf: schema is EXACT | SCALED | TIME.
    if (a === null || b === null) {
        if (a !== b) ctx.fail(path, `null-ness: ${a} vs ${b}`);
        return;
    }
    if (schema === EXACT) {
        if (a !== b) ctx.fail(path, `${a} vs ${b}`);
        return;
    }
    const tol = schema === SCALED ? REPRO_SCALE_TOL : REPRO_TIME_MS;
    const drift = Math.abs(a - b);
    ctx.trackDrift(schema, path, drift);
    if (drift > tol) ctx.fail(path, `drift ${drift} > ${tol} (${a} vs ${b})`);
}

function newCheckCtx() {
    const drift = new Map();
    const failures = [];
    return {
        drift, failures,
        fail: (path, msg) => failures.push({ path, msg }),
        trackDrift: (kind, path, amount) => {
            const field = path.replace(/\[\d+\]/g, "");
            const cur = drift.get(field);
            if (!cur || amount > cur.max) drift.set(field, { kind, max: amount });
        },
    };
}

/** Near-exact structural compare of one corpus file's fresh vs. committed
 *  (already-decoded) content. Returns a ctx with `.failures` (empty = pass)
 *  and `.drift` (per-field max drift, for diagnostics on failure). */
function checkFile(rel, fresh, committed) {
    const ctx = newCheckCtx();
    switch (rel) {
        case "positions.json": compareNode("positions", [ROW_SCHEMAS.positions], fresh, committed, ctx); break;
        case "altaz.json": compareNode("altaz", [ROW_SCHEMAS.altaz], fresh, committed, ctx); break;
        case "illumination.json": compareNode("illumination", [ROW_SCHEMAS.illumination], fresh, committed, ctx); break;
        case "events.json":
            compareNode("events.observers", [OBSERVER_SCHEMA], fresh.observers, committed.observers, ctx);
            compareNode("events.sunEvents", [ROW_SCHEMAS.sunEvent], fresh.sunEvents, committed.sunEvents, ctx);
            compareNode("events.moonEvents", [ROW_SCHEMAS.moonEvent], fresh.moonEvents, committed.moonEvents, ctx);
            compareNode("events.moonPhases", [ROW_SCHEMAS.moonPhase], fresh.moonPhases, committed.moonPhases, ctx);
            break;
        case "eclipses.json":
            compareNode("eclipses.observers", [OBSERVER_SCHEMA], fresh.observers, committed.observers, ctx);
            compareNode("eclipses.eclipses", [ROW_SCHEMAS.eclipse], fresh.eclipses, committed.eclipses, ctx);
            break;
        default: throw new Error(`checkFile: no schema for ${rel}`);
    }
    return ctx;
}

function reportDrift(rel, ctx) {
    console.error(`DRIFT: ${rel}`);
    if (ctx.drift.size) {
        console.error("  max drift by field:");
        for (const [field, info] of [...ctx.drift.entries()].sort((a, b) => b[1].max - a[1].max)) {
            console.error(`    ${field}: ${info.max} ${info.kind === TIME ? "ms" : "units"}`);
        }
    }
    console.error(`  first offending paths (${ctx.failures.length} total):`);
    for (const f of ctx.failures.slice(0, 5)) console.error(`    ${f.path}: ${f.msg}`);
}

function main() {
    const check = process.argv.includes("--check");
    const positionalArgs = process.argv.slice(2).filter((a) => a !== "--check");
    const [tsCommit = "unknown", swiftCommit = "unknown"] = positionalArgs;

    const files = buildCorpus();
    const raw = {
        "positions.json": files.positions,
        "altaz.json": files.altaz,
        "illumination.json": files.illumination,
        "events.json": files.events,
        "eclipses.json": files.eclipses,
    };
    const metaDest = new URL("meta.json", FIXTURES_DIR);

    if (!check) {
        for (const [rel, data] of Object.entries(raw)) writeFileSync(new URL(rel, FIXTURES_DIR), json(data));
        writeFileSync(metaDest, buildMeta(tsCommit, swiftCommit, files));
        console.log(`parity.mjs: wrote ${Object.keys(raw).length + 1} files`);
        return;
    }

    let drift = false;

    // Provenance is never compared -- only ensure it exists.
    if (!existsSync(metaDest)) { console.error("DRIFT: meta.json (missing)"); drift = true; }

    for (const [rel, fresh] of Object.entries(raw)) {
        const dest = new URL(rel, FIXTURES_DIR);
        if (!existsSync(dest)) { console.error(`DRIFT: ${rel} (missing)`); drift = true; continue; }
        const committed = JSON.parse(readFileSync(dest, "utf8"));
        const ctx = checkFile(rel, fresh, committed);
        if (ctx.failures.length) { reportDrift(rel, ctx); drift = true; }
    }

    if (drift) {
        console.error("parity.mjs --check: drift between the TS-computed candidate and the committed parity corpus");
        process.exit(1);
    }
    console.log(`parity.mjs --check: clean (${Object.keys(raw).length + 1} files, near-exact within ${REPRO_SCALE_TOL} scaled units / ${REPRO_TIME_MS} ms)`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
