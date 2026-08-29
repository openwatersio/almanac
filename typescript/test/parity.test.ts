// Cross-port parity: recomputes the whole corpus from the BUILT package
// (fixtures/generate/parity.mjs imports typescript/dist, so `npm run build`
// must run before this suite) and compares it, field-wise at the corpus's
// own tolerances, against the committed fixtures/parity/*.json. Both sides
// are already scaled integers (see parity.mjs) -- comparing them directly is
// the "decoded structure" comparison the spec asks for; it never touches
// serializer bytes (key order, whitespace) because everything here is a
// parsed field, not file text.
//
// This test passes trivially today (same code that generated the fixture is
// recomputing it); its job is catching a FUTURE TS regression that drifts
// past the corpus's tolerance. The real cross-port event is Swift's
// ParityTests.swift agreeing with these same committed fixtures.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildCorpus } from '../../fixtures/generate/parity.mjs';

const load = (p: string) => JSON.parse(readFileSync(new URL(`../../fixtures/parity/${p}`, import.meta.url), 'utf8'));

const meta = load('meta.json');
const { scales, tolerances } = meta;
const TOL_ANGLE = Math.round(tolerances.angleDeg * scales.angleDeg);
const TOL_KM = Math.round(tolerances.distanceKm * scales.distanceKm);
const TOL_AU = Math.round(tolerances.distanceAu * scales.distanceAu);
const TOL_FRAC = Math.round(tolerances.fraction * scales.fraction);
const TOL_TIME_MS = tolerances.timeMs;

function near(actual: number, expected: number, tol: number, what: string) {
    expect(Math.abs(actual - expected), what).toBeLessThanOrEqual(tol);
}
function nearNullable(actual: number | null, expected: number | null, tol: number, what: string) {
    expect(actual === null, `${what}: null-ness`).toBe(expected === null);
    if (actual !== null && expected !== null) near(actual, expected, tol, what);
}

const fresh = buildCorpus();
const committed = {
    positions: load('positions.json'),
    altaz: load('altaz.json'),
    illumination: load('illumination.json'),
    events: load('events.json'),
    eclipses: load('eclipses.json'),
};

describe('parity corpus: TS recompute vs committed', () => {
    it('positions match at the angle/distance tolerance, every 8 days 1950-2100', () => {
        expect(fresh.positions.length).toBe(committed.positions.length);
        for (let i = 0; i < fresh.positions.length; i++) {
            const a = fresh.positions[i];
            const b = committed.positions[i];
            expect(a.tMs).toBe(b.tMs);
            near(a.sun.raDeg, b.sun.raDeg, TOL_ANGLE, `positions[${i}] sun.raDeg`);
            near(a.sun.decDeg, b.sun.decDeg, TOL_ANGLE, `positions[${i}] sun.decDeg`);
            near(a.sun.distanceAu, b.sun.distanceAu, TOL_AU, `positions[${i}] sun.distanceAu`);
            near(a.moon.raDeg, b.moon.raDeg, TOL_ANGLE, `positions[${i}] moon.raDeg`);
            near(a.moon.decDeg, b.moon.decDeg, TOL_ANGLE, `positions[${i}] moon.decDeg`);
            near(a.moon.distanceKm, b.moon.distanceKm, TOL_KM, `positions[${i}] moon.distanceKm`);
        }
    });

    it('altaz (Victoria) matches at the angle tolerance, every 8 days 1950-2100', () => {
        expect(fresh.altaz.length).toBe(committed.altaz.length);
        for (let i = 0; i < fresh.altaz.length; i++) {
            const a = fresh.altaz[i];
            const b = committed.altaz[i];
            expect(a.tMs).toBe(b.tMs);
            near(a.sun.azDeg, b.sun.azDeg, TOL_ANGLE, `altaz[${i}] sun.azDeg`);
            near(a.sun.altDeg, b.sun.altDeg, TOL_ANGLE, `altaz[${i}] sun.altDeg`);
            near(a.moon.azDeg, b.moon.azDeg, TOL_ANGLE, `altaz[${i}] moon.azDeg`);
            near(a.moon.altDeg, b.moon.altDeg, TOL_ANGLE, `altaz[${i}] moon.altDeg`);
        }
    });

    it('moon illumination matches at the angle/fraction tolerance, every 8 days 1950-2100', () => {
        expect(fresh.illumination.length).toBe(committed.illumination.length);
        for (let i = 0; i < fresh.illumination.length; i++) {
            const a = fresh.illumination[i];
            const b = committed.illumination[i];
            expect(a.tMs).toBe(b.tMs);
            near(a.fraction, b.fraction, TOL_FRAC, `illumination[${i}] fraction`);
            near(a.phaseAngleDeg, b.phaseAngleDeg, TOL_ANGLE, `illumination[${i}] phaseAngleDeg`);
            near(a.phase, b.phase, TOL_FRAC, `illumination[${i}] phase`);
            expect(a.waxing, `illumination[${i}] waxing`).toBe(b.waxing);
        }
    });

    it('sunEvents/moonEvents/searchMoonPhases match at the time tolerance, monthly 2026, 3 observers', () => {
        expect(fresh.events.observers).toEqual(committed.events.observers);
        expect(fresh.events.sunEvents.length).toBe(committed.events.sunEvents.length);
        expect(fresh.events.moonEvents.length).toBe(committed.events.moonEvents.length);
        expect(fresh.events.moonPhases.length).toBe(committed.events.moonPhases.length);
        for (let i = 0; i < fresh.events.sunEvents.length; i++) {
            const a = fresh.events.sunEvents[i];
            const b = committed.events.sunEvents[i];
            expect(a.observerIdx).toBe(b.observerIdx);
            expect(a.kind).toBe(b.kind);
            near(a.tMs, b.tMs, TOL_TIME_MS, `sunEvents[${i}]`);
        }
        for (let i = 0; i < fresh.events.moonEvents.length; i++) {
            const a = fresh.events.moonEvents[i];
            const b = committed.events.moonEvents[i];
            expect(a.observerIdx).toBe(b.observerIdx);
            expect(a.kind).toBe(b.kind);
            near(a.tMs, b.tMs, TOL_TIME_MS, `moonEvents[${i}]`);
        }
        for (let i = 0; i < fresh.events.moonPhases.length; i++) {
            const a = fresh.events.moonPhases[i];
            const b = committed.events.moonPhases[i];
            expect(a.phase).toBe(b.phase);
            near(a.tMs, b.tMs, TOL_TIME_MS, `moonPhases[${i}]`);
        }
    });

    it('lunar eclipses + lunarEclipseVisibility match at tolerance, all 1950-2100', () => {
        expect(fresh.eclipses.observers).toEqual(committed.eclipses.observers);
        expect(fresh.eclipses.eclipses.length).toBe(committed.eclipses.eclipses.length);
        for (let i = 0; i < fresh.eclipses.eclipses.length; i++) {
            const a = fresh.eclipses.eclipses[i];
            const b = committed.eclipses.eclipses[i];
            expect(a.kind, `eclipses[${i}] kind`).toBe(b.kind);
            near(a.peakMs, b.peakMs, TOL_TIME_MS, `eclipses[${i}] peakMs`);
            near(a.magUmbral, b.magUmbral, TOL_FRAC, `eclipses[${i}] magUmbral`);
            near(a.magPenumbral, b.magPenumbral, TOL_FRAC, `eclipses[${i}] magPenumbral`);
            nearNullable(a.p1Ms, b.p1Ms, TOL_TIME_MS, `eclipses[${i}] p1Ms`);
            nearNullable(a.u1Ms, b.u1Ms, TOL_TIME_MS, `eclipses[${i}] u1Ms`);
            nearNullable(a.u2Ms, b.u2Ms, TOL_TIME_MS, `eclipses[${i}] u2Ms`);
            nearNullable(a.u3Ms, b.u3Ms, TOL_TIME_MS, `eclipses[${i}] u3Ms`);
            nearNullable(a.u4Ms, b.u4Ms, TOL_TIME_MS, `eclipses[${i}] u4Ms`);
            nearNullable(a.p4Ms, b.p4Ms, TOL_TIME_MS, `eclipses[${i}] p4Ms`);
            for (let o = 0; o < a.visibility.length; o++) {
                const va = a.visibility[o];
                const vb = b.visibility[o];
                expect(va.visibleAtPeak, `eclipses[${i}] visibility[${o}] visibleAtPeak`).toBe(vb.visibleAtPeak);
                near(va.moonGeometricAltAtPeakDeg, vb.moonGeometricAltAtPeakDeg, TOL_ANGLE,
                    `eclipses[${i}] visibility[${o}] moonGeometricAltAtPeakDeg`);
                for (const key of ['p1', 'u1', 'u2', 'u3', 'u4', 'p4'] as const) {
                    expect(va.contactsVisible[key], `eclipses[${i}] visibility[${o}] contactsVisible.${key}`)
                        .toBe(vb.contactsVisible[key]);
                }
            }
        }
    });
});
