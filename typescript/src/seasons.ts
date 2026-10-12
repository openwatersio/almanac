// L3 season search: the four instants a year when the Sun's apparent
// geocentric ecliptic longitude reaches 0°, 90°, 180° and 270°.
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts:
// `SearchSunLongitude` (~4787), whose `sun_offset` and 0.01 s `Search` are
// kept. Upstream's `Seasons(year)` (~6130) brackets each search from a fixed
// calendar date. Here the bracket is a cell of a fixed 80-day grid anchored at
// J2000, so every window that contains a season finds it from the same bracket
// and reports the same millisecond — the fixed-seed rule the eclipse searches
// follow. A cell spans under 90° of solar longitude, so it holds at most one
// quarter crossing.
//
// INTERNAL except `seasons`: not part of the curated public API (see index.ts).

import { assertSupported, assertSupportedWindowEnd } from './types.js';
import { utDays, ttDaysFromUt, dateFromUt } from './time.js';
import { sunEclipticLonDeg } from './illumination.js';
import { search, angleOffset, quantizedUt, assertReached } from './events.js';

/** The season the Sun's longitude starts: 0° March equinox, 90° June solstice, 180° September equinox, 270° December solstice. */
export type SeasonKind = 'marchEquinox' | 'juneSolstice' | 'septemberEquinox' | 'decemberSolstice';

/** An equinox or solstice. */
export interface SeasonEvent { time: Date; kind: SeasonKind; }

const SEASON_KINDS: readonly SeasonKind[] = ['marchEquinox', 'juneSolstice', 'septemberEquinox', 'decemberSolstice'];
/** Grid cell, in days since J2000 UT: under the 89-day shortest season, so a cell holds at most one crossing. */
const SEASON_CELL_DAYS = 80;

function sunLonDeg(ut: number): number {
    return sunEclipticLonDeg(ttDaysFromUt(ut));
}

/**
 * UPSTREAM: `SearchSunLongitude` on one grid cell `[t1, t2]`, with
 * `lon1 = sunLonDeg(t1)` already in hand. Returns the crossing of the next
 * multiple of 90° after `lon1`, or `null` when the cell ends before it.
 */
function searchSeasonInCell(t1: number, t2: number, lon1: number): { ut: number; quarter: number } | null {
    const quarter = (Math.floor(lon1 / 90) + 1) % 4;
    const targetLonDeg = 90 * quarter;
    const sunOffset = (ut: number) => angleOffset(sunLonDeg(ut) - targetLonDeg);
    if (sunOffset(t2) < 0) return null;
    const ut = search(sunOffset, t1, t2, 0.01, undefined, 'season search');
    assertReached(ut !== null, 'season search');
    return { ut: ut as number, quarter };
}

/**
 * The equinoxes and solstices within the half-open window `[startUtc, endUtc)`,
 * sorted ascending.
 *
 * A season starts the instant the Sun's apparent geocentric ecliptic longitude
 * reaches 0° (March equinox), 90° (June solstice), 180° (September equinox) or
 * 270° (December solstice). The names are months, not seasons, because the
 * same instant starts opposite seasons in the two hemispheres.
 */
export function seasons(startUtc: Date, endUtc: Date): SeasonEvent[] {
    assertSupported(startUtc);
    assertSupportedWindowEnd(endUtc);
    if (startUtc.getTime() >= endUtc.getTime()) return [];

    const startUt = utDays(startUtc);
    const endUt = utDays(endUtc);
    const events: SeasonEvent[] = [];

    let t1 = Math.floor(startUt / SEASON_CELL_DAYS) * SEASON_CELL_DAYS;
    let lon1 = sunLonDeg(t1);
    while (t1 < endUt) {
        const t2 = t1 + SEASON_CELL_DAYS;
        const found = searchSeasonInCell(t1, t2, lon1);
        if (found !== null) {
            const q = quantizedUt(found.ut);   // judge the half-open bounds on the reported instant, not the raw root
            if (q >= endUt) break;
            if (q >= startUt) events.push({ time: dateFromUt(found.ut), kind: SEASON_KINDS[found.quarter] });
        }
        t1 = t2;
        lon1 = sunLonDeg(t1);
    }
    return events;
}
