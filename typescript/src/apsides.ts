// L3 lunar apsides: perigee and apogee, the zeros of the Moon's radial
// velocity, from the MOON2 distance the position layer already evaluates.
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts:
// `SearchLunarApsis` (~6534) — its central-difference `distance_slope`, its
// five-day scan, its sign-change classification, and the `Search` it hands
// each bracket to. Upstream scans forward from the caller's instant and
// `NextLunarApsis` (~6621) chains from the last result; here the five-day scan
// points are a fixed grid anchored at J2000, so every window that contains an
// apsis finds it from the same bracket and reports the same millisecond — the
// fixed-seed rule the eclipse searches follow. Apsides are at least 11.8 days
// apart, so a cell holds at most one.
//
// INTERNAL except `moonApsides`: not part of the curated public API (see index.ts).

import { assertSupported, assertSupportedWindowEnd } from './types.js';
import { utDays, ttDaysFromUt, dateFromUt } from './time.js';
import { KM_PER_AU } from './nutation.js';
import { calcMoon } from './moon.js';
import { search, quantizedUt, assertReached } from './events.js';

/** Closest approach or farthest remove of the Moon from the Earth's centre. */
export type MoonApsisKind = 'perigee' | 'apogee';

/** A lunar perigee or apogee, with the Earth–Moon centre distance there. */
export interface MoonApsis { time: Date; kind: MoonApsisKind; distanceKm: number; }

/** UPSTREAM: the central-difference half-width `dt` inside `SearchLunarApsis`. */
const SLOPE_DT_DAYS = 0.001;
/** UPSTREAM: `increment` — the scan step, here also the grid cell in days since J2000 UT. */
const APSIS_CELL_DAYS = 5;

/** UPSTREAM: `distance_slope` — dr/dt in AU per day, by central difference. */
function distanceSlope(ut: number): number {
    const tt = ttDaysFromUt(ut);
    const r1 = calcMoon(tt - SLOPE_DT_DAYS / 2).distanceAu;
    const r2 = calcMoon(tt + SLOPE_DT_DAYS / 2).distanceAu;
    return (r2 - r1) / SLOPE_DT_DAYS;
}

function negativeDistanceSlope(ut: number): number {
    return -distanceSlope(ut);
}

/**
 * UPSTREAM: the body of `SearchLunarApsis`'s scan loop for one cell `[t1, t2]`
 * with the slopes `m1`, `m2` at its ends. A slope rising through zero is a
 * perigee and falling through zero an apogee. A zero exactly at a grid point
 * belongs to the cell it ends, so no apsis is reported twice.
 */
function searchApsisInCell(t1: number, t2: number, m1: number, m2: number): { ut: number; kind: MoonApsisKind } | null {
    if (m1 < 0 && m2 >= 0) {
        const ut = search(distanceSlope, t1, t2, 1, undefined, 'perigee search');
        assertReached(ut !== null, 'perigee search');
        return { ut: ut as number, kind: 'perigee' };
    }
    if (m1 > 0 && m2 <= 0) {
        const ut = search(negativeDistanceSlope, t1, t2, 1, undefined, 'apogee search');
        assertReached(ut !== null, 'apogee search');
        return { ut: ut as number, kind: 'apogee' };
    }
    return null;
}

/**
 * The Moon's perigees and apogees within the half-open window
 * `[startUtc, endUtc)`, sorted ascending, each with the geocentric distance
 * at that instant.
 */
export function moonApsides(startUtc: Date, endUtc: Date): MoonApsis[] {
    assertSupported(startUtc);
    assertSupportedWindowEnd(endUtc);
    if (startUtc.getTime() >= endUtc.getTime()) return [];

    const startUt = utDays(startUtc);
    const endUt = utDays(endUtc);
    const events: MoonApsis[] = [];

    let t1 = Math.floor(startUt / APSIS_CELL_DAYS) * APSIS_CELL_DAYS;
    let m1 = distanceSlope(t1);
    while (t1 < endUt) {
        const t2 = t1 + APSIS_CELL_DAYS;
        const m2 = distanceSlope(t2);
        const found = searchApsisInCell(t1, t2, m1, m2);
        if (found !== null) {
            const q = quantizedUt(found.ut);   // judge the half-open bounds on the reported instant, not the raw root
            if (q >= endUt) break;
            if (q >= startUt) {
                events.push({
                    time: dateFromUt(found.ut), kind: found.kind,
                    distanceKm: calcMoon(ttDaysFromUt(found.ut)).distanceAu * KM_PER_AU
                });
            }
        }
        t1 = t2;
        m1 = m2;
    }
    return events;
}
