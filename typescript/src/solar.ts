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
