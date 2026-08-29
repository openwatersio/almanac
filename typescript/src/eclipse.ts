// L3 lunar eclipses: the Earth's shadow cone against the Moon at every full
// moon — peak time, contact times, magnitudes, and whether an observer can see
// any of it.
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts:
//   CalcShadow (~8458), EarthShadow (~8470), ShadowDistanceSlope (~8535),
//   PeakEarthShadow (~8553), ShadowSemiDurationMinutes (~8603),
//   MoonEclipticLatitudeDegrees (~8616) and SearchLunarEclipse (~8710).
// Constants and operation order are preserved so the Swift port can be a
// line-for-line translation.
//
// Two deliberate departures from upstream, both spec-driven:
//   - the full-moon probe is this package's `searchMoonPhase`, whose longitudes
//     are apparent rather than upstream's geometric (see events.ts). It only
//     seeds a ±0.03 d peak search, so the ~40 s difference cannot change a
//     result.
//   - upstream reports semi-durations in minutes; the spec's public shape is
//     the contact instants themselves, and `obscuration` is not in it.

import {
    Observer, assertObserver, assertSupported, AlmanacOutOfRangeError, SUPPORTED_MAX
} from './types.js';
import { dateFromUt, ttDaysFromUt, utDays } from './time.js';
import { KM_PER_AU, RAD2DEG, Vec3 } from './nutation.js';
import { calcMoon, moonGeoVectorEqj } from './moon.js';
import { sunGeoVectorEqj } from './sun.js';
import { topoAltAzUnrefracted } from './transforms.js';
import { MOON_MEAN_RADIUS_KM, SUN_RADIUS_KM, search, searchMoonPhase } from './events.js';

/** A lunar eclipse: peak circumstances plus the contact instants around them. */
export interface LunarEclipse {
    /** `total` if the Moon is fully inside the umbra, `partial` if it touches
     *  the umbra at all, otherwise `penumbral`. */
    kind: 'penumbral' | 'partial' | 'total';
    /** Greatest eclipse — when the Moon's centre passes closest to the shadow axis. */
    peak: Date;
    /** Fraction of the Moon's diameter inside the umbra at peak; negative when the umbra is missed entirely. */
    magUmbral: number;
    /** Fraction of the Moon's diameter inside the penumbra at peak. */
    magPenumbral: number;
    /** First penumbral contact. */
    p1: Date;
    /** First umbral contact — `null` for a penumbral eclipse. */
    u1: Date | null;
    /** Start of totality — `null` unless the eclipse is total. */
    u2: Date | null;
    /** End of totality — `null` unless the eclipse is total. */
    u3: Date | null;
    /** Last umbral contact — `null` for a penumbral eclipse. */
    u4: Date | null;
    /** Last penumbral contact. */
    p4: Date;
}

/** Which of an eclipse's contacts happen with the Moon above the observer's horizon. */
export interface LunarEclipseVisibility {
    /** True when the Moon's centre is geometrically above the horizon at peak. */
    visibleAtPeak: boolean;
    /** Unrefracted topocentric altitude of the Moon's centre at peak, degrees. */
    moonGeometricAltAtPeakDeg: number;
    /** Per-contact horizon test; `null` exactly where the eclipse has no such contact. */
    contactsVisible: {
        p1: boolean; u1: boolean | null; u2: boolean | null;
        u3: boolean | null; u4: boolean | null; p4: boolean;
    };
}

/** UPSTREAM: `EARTH_MEAN_RADIUS_KM` + `EARTH_ATMOSPHERE_KM`, astronomy.ts 142-144.
 *  The 88 km of atmosphere is what makes the umbra match observed eclipse
 *  magnitudes; it is not the geometric Earth radius. */
const EARTH_ECLIPSE_RADIUS_KM = 6371.0 + 88.0;

/** UPSTREAM: `PruneLatitude`, inside `SearchLunarEclipse` — full-Moon ecliptic
 *  latitude above which no eclipse is possible. */
const PRUNE_LATITUDE_DEG = 1.8;

/** Spec: the search gives up after two years. The catalog's longest gap between
 *  consecutive lunar eclipses over 1950-2100 is under a year. */
const SCAN_LIMIT_DAYS = 730;

/** Upstream's `PeakEarthShadow` window, in days, either side of the full moon. */
const PEAK_WINDOW_DAYS = 0.03;

/** Upstream's outermost `ShadowSemiDurationMinutes` window, in minutes. */
const PENUMBRAL_WINDOW_MINUTES = 200.0;

const MINUTES_PER_DAY = 24.0 * 60.0;

/** Root-finder tolerance for every shadow search, seconds — upstream's `Search` default. */
const SHADOW_TOL_SECONDS = 1;

/** UPSTREAM: `Search`'s default `iter_limit`. */
const SHADOW_ITER_CAP = 20;

/**
 * How close a candidate peak may sit to `after` and still be judged the same
 * eclipse, milliseconds.
 *
 * A peak is only reproducible to about a millisecond: the full-moon seed comes
 * from a root finder with a 0.1 s tolerance, and the ±0.03 d peak-shadow window
 * built around it therefore differs slightly between two calls that reach the
 * same eclipse from different starting times, which moves the interpolated root
 * by an observed ≤1 ms. A caller walking the catalog by feeding each peak back
 * in would otherwise re-find that eclipse whenever the second evaluation landed
 * a millisecond later.
 *
 * The band cuts both ways, and both are bounded:
 *   - it can never swallow a real eclipse — consecutive lunar eclipses are
 *     never less than a month apart, 25 million times this window;
 *   - it *can* skip an eclipse the caller genuinely wanted: `after` set inside
 *     the 100 ms before a peak returns the eclipse after it, not that one.
 *     That is the accepted cost, and 100 ms is its ceiling — against a peak
 *     model that agrees with the Espenak catalog to ~15 s, a caller cannot have
 *     meant a boundary that sharp.
 */
const SAME_ECLIPSE_MS = 100;

/**
 * UPSTREAM: `ShadowInfo` (astronomy.ts ~8445), reduced to what the lunar case
 * reads. Upstream's `target`/`dir` vectors are inputs kept for the solar-eclipse
 * paths this package does not implement, and its `time` is an `AstroTime`;
 * here the instant travels as days since J2000 UT, as everywhere in L3.
 */
interface ShadowInfo {
    /** Days since J2000 (UT). */
    ut: number;
    /** Shadow-axis parameter: distance to the shadow plane over the casting body's distance. */
    u: number;
    /** Distance from the Moon's centre to the shadow axis, km. */
    r: number;
    /** Umbra radius at the shadow plane, km. */
    k: number;
    /** Penumbra radius at the shadow plane, km. */
    p: number;
}

/** UPSTREAM: `CalcShadow`, astronomy.ts ~8458. */
function calcShadow(bodyRadiusKm: number, ut: number, target: Vec3, dir: Vec3): ShadowInfo {
    const u = (dir.x*target.x + dir.y*target.y + dir.z*target.z) / (dir.x*dir.x + dir.y*dir.y + dir.z*dir.z);
    const dx = (u * dir.x) - target.x;
    const dy = (u * dir.y) - target.y;
    const dz = (u * dir.z) - target.z;
    const r = KM_PER_AU * Math.hypot(dx, dy, dz);
    const k = +SUN_RADIUS_KM - (1.0 + u)*(SUN_RADIUS_KM - bodyRadiusKm);
    const p = -SUN_RADIUS_KM + (1.0 + u)*(SUN_RADIUS_KM + bodyRadiusKm);
    return { ut, u, r, k, p };
}

/**
 * UPSTREAM: `EarthShadow`, astronomy.ts ~8470 — the Earth's shadow cone
 * evaluated where the Moon is. `e = -s` is the path of sunlight through the
 * centre of the Earth; both vectors are EQJ, and `CalcShadow` only ever takes
 * dot products and a norm of them, so the frame cancels.
 */
function earthShadow(ut: number): ShadowInfo {
    const tt = ttDaysFromUt(ut);
    // Light-travel and aberration corrected vector from the Earth to the Sun.
    const s = sunGeoVectorEqj(tt);
    const e: Vec3 = { x: -s.x, y: -s.y, z: -s.z };
    // Geocentric moon.
    const m = moonGeoVectorEqj(tt);
    return calcShadow(EARTH_ECLIPSE_RADIUS_KM, ut, m, e);
}

/** UPSTREAM: `ShadowDistanceSlope`, astronomy.ts ~8535, bound to `EarthShadow`. */
function earthShadowSlope(ut: number): number {
    const dt = 1.0 / 86400.0;
    return (earthShadow(ut + dt).r - earthShadow(ut - dt).r) / dt;
}

/**
 * UPSTREAM: `PeakEarthShadow`, astronomy.ts ~8553 — greatest eclipse is where
 * the Moon-to-axis distance stops shrinking, i.e. the ascending zero of its
 * time derivative.
 */
function peakEarthShadow(centerUt: number): ShadowInfo {
    const ut = search(
        earthShadowSlope, centerUt - PEAK_WINDOW_DAYS, centerUt + PEAK_WINDOW_DAYS,
        SHADOW_TOL_SECONDS, SHADOW_ITER_CAP, 'peak earth shadow'
    );
    if (ut === null) throw new Error('almanac internal: failed to find peak Earth shadow time');
    return earthShadow(ut);
}

/**
 * UPSTREAM: `ShadowSemiDurationMinutes`, astronomy.ts ~8603 — searches
 * backwards and forwards from the peak for the crossings of `radiusLimitKm`,
 * then averages the two halves, so the contacts this package reports are
 * symmetric about the peak by construction (as upstream's are).
 */
function shadowSemiDurationMinutes(centerUt: number, radiusLimitKm: number, windowMinutes: number): number {
    const window = windowMinutes / MINUTES_PER_DAY;
    const t1 = search(ut => -(earthShadow(ut).r - radiusLimitKm), centerUt - window, centerUt,
                      SHADOW_TOL_SECONDS, SHADOW_ITER_CAP, 'shadow semiduration (before)');
    const t2 = search(ut => +(earthShadow(ut).r - radiusLimitKm), centerUt, centerUt + window,
                      SHADOW_TOL_SECONDS, SHADOW_ITER_CAP, 'shadow semiduration (after)');
    if (t1 === null || t2 === null) throw new Error('almanac internal: failed to find shadow semiduration');
    return (t2 - t1) * (MINUTES_PER_DAY / 2.0);   // convert days to minutes and average the semi-durations
}

/** UPSTREAM: `MoonEclipticLatitudeDegrees`, astronomy.ts ~8616. */
function moonEclipticLatitudeDeg(ut: number): number {
    return RAD2DEG * calcMoon(ttDaysFromUt(ut)).geoEclipLat;
}

/**
 * The first lunar eclipse whose peak falls strictly after `after`.
 *
 * Every full moon within the next two years is tested: the Moon's ecliptic
 * latitude prunes the ones no shadow can reach, and the rest get a peak-shadow
 * search. Magnitudes are the fraction of the Moon's diameter inside each
 * shadow at peak, so `magUmbral` goes negative when the umbra is missed and
 * above 1 for a total eclipse.
 *
 * @throws {AlmanacOutOfRangeError} if `after` is outside the supported
 *      interval, or if the next eclipse falls at or past the end of it.
 */
export function nextLunarEclipse(after: Date): LunarEclipse {
    assertSupported(after);
    const startUt = utDays(after);
    let fmUt = startUt;

    while (fmUt <= startUt + SCAN_LIMIT_DAYS) {
        // Search for the next full moon. Any eclipse will be near it.
        const fullmoon = searchMoonPhase(180, fmUt, 40);
        if (fullmoon === null) throw new Error('almanac internal: cannot find full moon');
        // UPSTREAM `SearchLunarEclipse`: step past this full moon before the
        // next probe, so the same one cannot be found twice.
        fmUt = fullmoon + 10;

        // Pruning: if the full Moon's ecliptic latitude is too large, a lunar
        // eclipse is not possible. Avoid needless work searching for the
        // minimum moon distance.
        if (Math.abs(moonEclipticLatitudeDeg(fullmoon)) >= PRUNE_LATITUDE_DEG) continue;

        // Search near the full moon for the time when the center of the Moon
        // is closest to the line passing through the centers of the Sun and Earth.
        const shadow = peakEarthShadow(fullmoon);
        if (shadow.r >= shadow.p + MOON_MEAN_RADIUS_KM) continue;   // not even penumbral
        // A full moon before `after` can still carry the eclipse the caller
        // already has; the spec's contract is strictly-later peaks.
        const peak = dateFromUt(shadow.ut);
        if (peak.getTime() <= after.getTime() + SAME_ECLIPSE_MS) continue;
        if (peak.getTime() >= SUPPORTED_MAX) throw new AlmanacOutOfRangeError();

        return buildEclipse(shadow, peak);
    }
    // Not an AlmanacOutOfRangeError: the interval is fine, the sky is not. The
    // longest real gap over 1950-2100 is 178 days, so exhausting 730 means the
    // shadow model is broken — an internal invariant, like every other
    // `almanac internal:` throw in this package.
    throw new Error(`almanac internal: no lunar eclipse within ${SCAN_LIMIT_DAYS} days of ${after.toISOString()}`);
}

/** UPSTREAM: the classification and semi-duration block of `SearchLunarEclipse`, astronomy.ts ~8730-8755. */
function buildEclipse(shadow: ShadowInfo, peak: Date): LunarEclipse {
    // This is at least a penumbral eclipse.
    let kind: LunarEclipse['kind'] = 'penumbral';
    let sdTotal = 0.0;
    let sdPartial = 0.0;
    const sdPenum = shadowSemiDurationMinutes(shadow.ut, shadow.p + MOON_MEAN_RADIUS_KM, PENUMBRAL_WINDOW_MINUTES);

    if (shadow.r < shadow.k + MOON_MEAN_RADIUS_KM) {
        // This is at least a partial eclipse.
        kind = 'partial';
        sdPartial = shadowSemiDurationMinutes(shadow.ut, shadow.k + MOON_MEAN_RADIUS_KM, sdPenum);

        if (shadow.r + MOON_MEAN_RADIUS_KM < shadow.k) {
            // This is a total eclipse.
            kind = 'total';
            sdTotal = shadowSemiDurationMinutes(shadow.ut, shadow.k - MOON_MEAN_RADIUS_KM, sdPartial);
        }
    }

    // Fraction of the Moon's diameter immersed in each shadow. Shadow radii,
    // axis distance and the Moon's radius all live in the same plane at the
    // Moon's distance, so the angles at that distance are these lengths over a
    // common divisor — it cancels, and the ratio is exact in km.
    const s = MOON_MEAN_RADIUS_KM;
    const magPenumbral = (shadow.p + s - shadow.r) / (2 * s);
    const magUmbral = (shadow.k + s - shadow.r) / (2 * s);

    const at = (offsetMinutes: number) => dateFromUt(shadow.ut + offsetMinutes / MINUTES_PER_DAY);
    const umbral = kind !== 'penumbral';
    const total = kind === 'total';

    return {
        kind,
        peak,
        magUmbral,
        magPenumbral,
        p1: at(-sdPenum),
        u1: umbral ? at(-sdPartial) : null,
        u2: total ? at(-sdTotal) : null,
        u3: total ? at(+sdTotal) : null,
        u4: umbral ? at(+sdPartial) : null,
        p4: at(+sdPenum)
    };
}

/**
 * Trust boundary: `lunarEclipseVisibility` takes a plain object, which callers
 * can hand-build or round-trip through JSON. A contact out of order or missing
 * for its kind would otherwise produce a silently wrong visibility answer, so
 * the shape is checked before any of it is used.
 */
function assertLunarEclipse(e: LunarEclipse): void {
    if (e === null || typeof e !== 'object') throw new RangeError('eclipse must be an object');
    if (e.kind !== 'penumbral' && e.kind !== 'partial' && e.kind !== 'total')
        throw new RangeError(`unknown lunar eclipse kind: ${String(e.kind)}`);

    const umbral = e.kind !== 'penumbral';
    const total = e.kind === 'total';
    const expected: Record<string, boolean> = { u1: umbral, u2: total, u3: total, u4: umbral };
    for (const key of ['u1', 'u2', 'u3', 'u4'] as const) {
        const present = e[key] !== null && e[key] !== undefined;
        if (present !== expected[key])
            throw new RangeError(`${e.kind} lunar eclipse must ${expected[key] ? '' : 'not '}have ${key}`);
    }

    // Strictly ascending, skipping the absent ones. Strict is safe: the closest
    // two contacts of any eclipse over 1950-2100 are five minutes apart. The
    // third element marks the contacts every eclipse has, whatever its kind —
    // absent, they would otherwise slip through as `null` past a `boolean` type.
    const ordered: [string, Date | null, boolean][] = [
        ['p1', e.p1, true], ['u1', e.u1, false], ['u2', e.u2, false], ['peak', e.peak, true],
        ['u3', e.u3, false], ['u4', e.u4, false], ['p4', e.p4, true]
    ];
    let prevName = '';
    let prevMs = -Infinity;
    for (const [name, d, required] of ordered) {
        if (d == null) {
            if (required) throw new RangeError(`lunar eclipse ${name} is required`);
            continue;
        }
        const ms = d instanceof Date ? d.getTime() : NaN;
        if (!Number.isFinite(ms)) throw new RangeError(`lunar eclipse ${name} is not a valid Date`);
        if (ms <= prevMs) throw new RangeError(`lunar eclipse contacts out of order: ${prevName} not before ${name}`);
        prevName = name;
        prevMs = ms;
    }
}

/**
 * Whether an observer can see each phase of a lunar eclipse — purely geometric:
 * the Moon's unrefracted topocentric centre must be above the horizon. A lunar
 * eclipse looks the same from everywhere it is visible at all, so there is
 * nothing else to compute.
 *
 * `contactsVisible` is `null` exactly where `eclipse` has no such contact, so
 * its shape mirrors the eclipse's.
 *
 * @throws {RangeError} if `eclipse` is structurally invalid or `observer` is out of range.
 */
export function lunarEclipseVisibility(eclipse: LunarEclipse, observer: Observer): LunarEclipseVisibility {
    assertLunarEclipse(eclipse);
    assertObserver(observer);

    const altAt = (d: Date): number => {
        const ut = utDays(d);
        return topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer).altDeg;
    };
    // `== null` deliberately: the validator counts `undefined` as absent too,
    // so the reader must, or an `undefined` contact would reach `utDays` raw.
    const up = (d: Date | null): boolean | null => (d == null ? null : altAt(d) > 0);

    const peakAltDeg = altAt(eclipse.peak);
    return {
        visibleAtPeak: peakAltDeg > 0,
        moonGeometricAltAtPeakDeg: peakAltDeg,
        contactsVisible: {
            p1: up(eclipse.p1) as boolean,
            u1: up(eclipse.u1),
            u2: up(eclipse.u2),
            u3: up(eclipse.u3),
            u4: up(eclipse.u4),
            p4: up(eclipse.p4) as boolean
        }
    };
}
