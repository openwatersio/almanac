#!/usr/bin/env node
// Cross-port parity corpus: canonical inputs + quantized outputs that catch
// port drift below physical tolerances. Consumes the BUILT TS package
// (public API only -- `npm run build` in typescript/ first) and writes
// scaled-integer JSON under fixtures/parity/. Row order is fixed (ascending
// sample time / observer index / eclipse peak); provenance (the two ports'
// generating commit shas, passed as argv -- never exec'd, never compared)
// lands only in the uncompared meta.json.
//
// `--check` regenerates and byte-compares against the committed files (same
// pattern as derive.mjs) -- this is the TS side's "regenerate candidate,
// compare to committed" half of the parity contract; the Swift side's half
// is ParityTests.swift's reproduction check.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
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

function main() {
    const check = process.argv.includes("--check");
    const positionalArgs = process.argv.slice(2).filter((a) => a !== "--check");
    const [tsCommit = "unknown", swiftCommit = "unknown"] = positionalArgs;

    const files = buildCorpus();
    const out = {
        "positions.json": json(files.positions),
        "altaz.json": json(files.altaz),
        "illumination.json": json(files.illumination),
        "events.json": json(files.events),
        "eclipses.json": json(files.eclipses),
        "meta.json": buildMeta(tsCommit, swiftCommit, files),
    };

    let drift = false;
    for (const [rel, content] of Object.entries(out)) {
        const dest = new URL(rel, FIXTURES_DIR);
        if (rel === "meta.json") {
            // Provenance is never compared -- only ensure it exists.
            if (!check) writeFileSync(dest, content);
            else if (!existsSync(dest)) { console.error(`DRIFT: ${rel} (missing)`); drift = true; }
            continue;
        }
        if (!check) { writeFileSync(dest, content); continue; }
        if (!existsSync(dest) || readFileSync(dest, "utf8") !== content) {
            console.error(`DRIFT: ${rel}`);
            drift = true;
        }
    }

    if (check) {
        if (drift) {
            console.error("parity.mjs --check: drift between the TS-computed candidate and the committed parity corpus");
            process.exit(1);
        }
        console.log(`parity.mjs --check: clean (${Object.keys(out).length} files)`);
    } else {
        console.log(`parity.mjs: wrote ${Object.keys(out).length} files`);
    }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
