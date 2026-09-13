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
