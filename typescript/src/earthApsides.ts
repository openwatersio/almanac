// SearchPlanetApsis (Earth), pinned Astronomy Engine 865d3da7d8112bbc7911238052c6af4aaf877181.
// Central difference in UT, orbital-period/6 brackets; fixed J2000 grid gives window-independent roots.
import { assertSupported, assertSupportedWindowEnd } from './types.js';
import { utDays, ttDaysFromUt, dateFromUt } from './time.js';
import { KM_PER_AU } from './nutation.js';
import { earthHelioDistance } from './sun.js';
import { search, quantizedUt, assertReached } from './events.js';

/** Closest approach or farthest remove of the Earth from the Sun's centre. */
export type EarthApsisKind = 'perihelion' | 'aphelion';

/** A terrestrial perihelion or aphelion, with the Sun–Earth centre distance there. */
export interface EarthApsis { time: Date; kind: EarthApsisKind; distanceKm: number; }

/** UPSTREAM: the central-difference half-width `dt` inside `SearchPlanetApsis`. */
const SLOPE_DT_DAYS = 0.001;
/** UPSTREAM: `increment` — the scan step, here also the grid cell in days since J2000 UT. */
const APSIS_CELL_DAYS = 365.256 / 6;

/** UPSTREAM: `positive_slope` — dr/dt in AU per day, by central difference. */
function distanceSlope(ut: number): number {
    const r1 = earthHelioDistance(ttDaysFromUt(ut - SLOPE_DT_DAYS / 2));
    const r2 = earthHelioDistance(ttDaysFromUt(ut + SLOPE_DT_DAYS / 2));
    return (r2 - r1) / SLOPE_DT_DAYS;
}

function negativeDistanceSlope(ut: number): number {
    return -distanceSlope(ut);
}

/**
 * UPSTREAM: the body of `SearchPlanetApsis`'s scan loop for one cell `[t1, t2]`
 * with the slopes `m1`, `m2` at its ends. A slope rising through zero is a
 * perihelion and falling through zero an aphelion. A zero exactly at a grid point
 * belongs to the cell it ends, so no apsis is reported twice.
 */
function searchApsisInCell(t1: number, t2: number, m1: number, m2: number): { ut: number; kind: EarthApsisKind } | null {
    if (m1 < 0 && m2 >= 0) {
        const ut = search(distanceSlope, t1, t2, 1, undefined, 'perihelion search');
        assertReached(ut !== null, 'perihelion search');
        return { ut: ut as number, kind: 'perihelion' };
    }
    if (m1 > 0 && m2 <= 0) {
        const ut = search(negativeDistanceSlope, t1, t2, 1, undefined, 'aphelion search');
        assertReached(ut !== null, 'aphelion search');
        return { ut: ut as number, kind: 'aphelion' };
    }
    return null;
}

/**
 * The Earth's perihelia and aphelia within the half-open window
 * `[startUtc, endUtc)`, sorted ascending, each with the heliocentric distance
 * at that instant.
 */
export function earthApsides(startUtc: Date, endUtc: Date): EarthApsis[] {
    assertSupported(startUtc);
    assertSupportedWindowEnd(endUtc);
    if (startUtc.getTime() >= endUtc.getTime()) return [];

    const startUt = utDays(startUtc);
    const endUt = utDays(endUtc);
    const events: EarthApsis[] = [];

    let cell = Math.floor(startUt / APSIS_CELL_DAYS);
    let t1 = cell * APSIS_CELL_DAYS;
    let m1 = distanceSlope(t1);
    while (t1 < endUt) {
        const t2 = (cell + 1) * APSIS_CELL_DAYS;
        const m2 = distanceSlope(t2);
        const found = searchApsisInCell(t1, t2, m1, m2);
        if (found !== null) {
            const q = quantizedUt(found.ut);   // judge the half-open bounds on the reported instant, not the raw root
            if (q >= endUt) break;
            if (q >= startUt) {
                events.push({
                    time: dateFromUt(found.ut), kind: found.kind,
                    distanceKm: earthHelioDistance(ttDaysFromUt(found.ut)) * KM_PER_AU
                });
            }
        }
        cell++;
        t1 = t2;
        m1 = m2;
    }
    return events;
}
