// L3 solar eclipses anywhere on Earth: the Moon's shadow cone against the
// Earth's center at every new moon — greatest eclipse, how far the shadow
// axis passes from the center then, and where the axis meets the ground, with
// the kind and covered fraction a person standing there sees.
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts:
//   EARTH_MEAN_RADIUS_KM (142), MoonShadow (~8481), PeakMoonShadow (~8564),
//   GeoidIntersect (~8842) and SearchGlobalSolarEclipse (~8975).
// Constants and operation order are preserved so the Swift port can be a
// line-for-line translation.
//
// Four deliberate departures from upstream, all spec-driven:
//   - the new-moon probe is this package's `searchMoonPhase`, whose longitudes
//     are apparent rather than upstream's geometric (see events.ts). It only
//     seeds a ±0.03 d peak search, so the ~40 s difference cannot change a
//     result.
//   - previous and range searches, the fixed whole-UT-day new-moon seed and
//     the 100 ms same-eclipse band come from the lunar port (eclipse.ts);
//     upstream searches forward only.
//   - no twelve-new-moon scan limit: next/previous walk new moons to the
//     supported boundary, as the local search does (solar.ts).
//   - upstream's `Rotation_EQJ_EQD` matrix and its inverse are `gyration` in
//     each direction: the same precession and nutation, applied as two
//     rotations rather than one combined matrix.

import {
    assertSupported, assertSupportedWindowEnd, AlmanacOutOfRangeError, SUPPORTED_MIN, SUPPORTED_MAX
} from './types.js';
import { dateFromUt, ttDaysFromUt, utDays } from './time.js';
import {
    EARTH_EQUATORIAL_RADIUS_KM, EARTH_FLATTENING, EARTH_FLATTENING_SQUARED, KM_PER_AU, RAD2DEG,
    PrecessDirection, Vec3, gyration
} from './nutation.js';
import { moonGeoVectorEqj } from './moon.js';
import { sunGeoVectorEqj } from './sun.js';
import { siderealDeg } from './transforms.js';
import { MOON_MEAN_RADIUS_KM, search, searchMoonPhase } from './events.js';
import {
    ShadowInfo, calcShadow, moonEclipticLatitudeDeg,
    PRUNE_LATITUDE_DEG, SAME_ECLIPSE_MS, SHADOW_TOL_SECONDS, SHADOW_ITER_CAP
} from './eclipse.js';
import { SolarEclipseKind, MOON_POLAR_RADIUS_KM, eclipseKindFromUmbra, solarEclipseObscuration } from './solar.js';

/** A solar eclipse as the whole Earth sees it: greatest eclipse, and where the Moon's shadow axis meets the ground then. */
export interface GlobalSolarEclipse {
    /** Kind at the point where the shadow axis meets the ground; `partial` when the axis misses the Earth. */
    kind: SolarEclipseKind;
    /** Greatest eclipse: the instant the Moon's shadow axis passes closest to the Earth's center. */
    peak: Date;
    /** Distance from the shadow axis to the Earth's center at the peak, km. */
    axisDistanceKm: number;
    /** Geodetic latitude where the axis meets the ground at the peak, degrees; `null` for a partial eclipse. */
    latitudeDeg: number | null;
    /** Longitude where the axis meets the ground at the peak, degrees east in (−180, 180]; `null` for a partial eclipse. */
    longitudeDeg: number | null;
    /** Fraction of the Sun's disc area covered at that point; exactly 1 for a total eclipse; `null` for a partial eclipse. */
    obscuration: number | null;
}

/**
 * UPSTREAM: `EARTH_MEAN_RADIUS_KM`, astronomy.ts 142 — the geoid's mean
 * radius. A new moon is an eclipse when the Moon's penumbra reaches this
 * sphere. The lunar port's `EARTH_ECLIPSE_RADIUS_KM` (eclipse.ts) is a
 * different constant: it adds 88 km of atmosphere for the Earth's own shadow.
 */
const EARTH_MEAN_RADIUS_KM = 6371.0;

/** Upstream's `PeakMoonShadow` window, in days, either side of the new moon. */
const PEAK_WINDOW_DAYS = 0.03;

/**
 * UPSTREAM: `MoonShadow`, astronomy.ts ~8481 — the Moon's shadow cone
 * evaluated at the Earth's center: the lunacentric Earth measured against the
 * heliocentric Moon. Both vectors are EQJ, and `calcShadow` only ever takes
 * dot products and norms of them, so the frame cancels.
 */
function moonShadow(ut: number): ShadowInfo {
    const tt = ttDaysFromUt(ut);
    // Light-travel and aberration corrected Sun.
    const s = sunGeoVectorEqj(tt);
    // Geocentric Moon.
    const m = moonGeoVectorEqj(tt);
    // Lunacentric Earth.
    const e: Vec3 = { x: -m.x, y: -m.y, z: -m.z };
    // Convert geocentric moon to heliocentric Moon.
    const hm: Vec3 = { x: m.x - s.x, y: m.y - s.y, z: m.z - s.z };
    return calcShadow(MOON_MEAN_RADIUS_KM, ut, e, hm);
}

/** UPSTREAM: `ShadowDistanceSlope`, astronomy.ts ~8535, bound to `MoonShadow`. */
function moonShadowSlope(ut: number): number {
    const dt = 1.0 / 86400.0;
    return (moonShadow(ut + dt).r - moonShadow(ut - dt).r) / dt;
}

/**
 * UPSTREAM: `PeakMoonShadow`, astronomy.ts ~8564 — greatest eclipse: the time
 * near the new moon when the Moon's shadow axis passes closest to the Earth's
 * center, i.e. the ascending zero of the axis distance's time derivative.
 */
function peakMoonShadow(centerUt: number): ShadowInfo {
    // Use the same new-moon seed regardless of search direction or window.
    // Otherwise a ~1 ms root shift can lose/duplicate a peak when a caller
    // splits a range at a previously returned peak. Only unpruned moons pay
    // for this second phase search; its start is a fixed whole UT day.
    const newmoon = searchMoonPhase(0, Math.floor(centerUt) - 1, 4);
    if (newmoon === null) throw new Error('almanac internal: cannot refine new moon');
    const ut = search(
        moonShadowSlope, newmoon - PEAK_WINDOW_DAYS, newmoon + PEAK_WINDOW_DAYS,
        SHADOW_TOL_SECONDS, SHADOW_ITER_CAP, 'peak moon shadow'
    );
    if (ut === null) throw new Error('almanac internal: failed to find peak Moon shadow time');
    return moonShadow(ut);
}

/**
 * UPSTREAM: `GeoidIntersect`, astronomy.ts ~8842 — where the shadow axis at
 * greatest eclipse meets the Earth's oblate geoid, and the kind and covered
 * fraction a person standing there sees. An axis that misses the geoid is a
 * partial eclipse with no ground point.
 */
function geoidIntersect(shadow: ShadowInfo, peak: Date): GlobalSolarEclipse {
    let kind: SolarEclipseKind = 'partial';
    let latitudeDeg: number | null = null;      // left null for partial eclipses
    let longitudeDeg: number | null = null;     // left null for partial eclipses
    let obscuration: number | null = null;      // left null for partial eclipses

    // We want to calculate the intersection of the shadow axis with the Earth's geoid.
    // First we must convert EQJ (equator of J2000) coordinates to EQD (equator of date)
    // coordinates that are perfectly aligned with the Earth's equator at this
    // moment in time.
    const tt = ttDaysFromUt(shadow.ut);
    const vd = gyration(shadow.dir, tt, PrecessDirection.From2000);       // shadow-axis vector in equator-of-date coordinates
    const ed = gyration(shadow.target, tt, PrecessDirection.From2000);    // lunacentric Earth in equator-of-date coordinates

    // Convert all distances from AU to km.
    // But dilate the z-coordinates so that the Earth becomes a perfect sphere.
    // Then find the intersection of the vector with the sphere.
    // See p 184 in Montenbruck & Pfleger's "Astronomy on the Personal Computer", second edition.
    const v: Vec3 = { x: vd.x * KM_PER_AU, y: vd.y * KM_PER_AU, z: vd.z * (KM_PER_AU / EARTH_FLATTENING) };
    const e: Vec3 = { x: ed.x * KM_PER_AU, y: ed.y * KM_PER_AU, z: ed.z * (KM_PER_AU / EARTH_FLATTENING) };

    // Solve the quadratic equation that finds whether and where
    // the shadow axis intersects with the Earth in the dilated coordinate system.
    const R = EARTH_EQUATORIAL_RADIUS_KM;
    const A = v.x*v.x + v.y*v.y + v.z*v.z;
    const B = -2.0 * (v.x*e.x + v.y*e.y + v.z*e.z);
    const C = (e.x*e.x + e.y*e.y + e.z*e.z) - R*R;
    const radic = B*B - 4*A*C;

    if (radic > 0.0) {
        // Calculate the closer of the two intersection points.
        // This will be on the day side of the Earth.
        const u = (-B - Math.sqrt(radic)) / (2 * A);

        // Convert lunacentric dilated coordinates to geocentric coordinates.
        const px = u*v.x - e.x;
        const py = u*v.y - e.y;
        const pz = (u*v.z - e.z) * EARTH_FLATTENING;

        // Convert cartesian coordinates into geodetic latitude/longitude.
        const proj = Math.hypot(px, py) * EARTH_FLATTENING_SQUARED;
        if (proj == 0.0)
            latitudeDeg = (pz > 0.0) ? +90.0 : -90.0;
        else
            latitudeDeg = RAD2DEG * Math.atan(pz / proj);

        // Adjust longitude for Earth's rotation at the given UT. `siderealDeg`
        // is upstream's `15 * sidereal_time`, already in degrees.
        let lon = (RAD2DEG*Math.atan2(py, px) - siderealDeg(shadow.ut)) % 360.0;
        if (lon <= -180.0)
            lon += 360.0;
        else if (lon > +180.0)
            lon -= 360.0;
        longitudeDeg = lon;

        // We want to determine whether the observer sees a total eclipse or an annular eclipse.
        // Put the EQD geocentric coordinates of the observer back into AU, and
        // rotate them back to the EQJ system.
        const og = gyration({ x: px / KM_PER_AU, y: py / KM_PER_AU, z: pz / KM_PER_AU }, tt, PrecessDirection.Into2000);

        // Convert geocentric vector to lunacentric vector.
        const o: Vec3 = { x: og.x + shadow.target.x, y: og.y + shadow.target.y, z: og.z + shadow.target.z };

        // Recalculate the shadow using a vector from the Moon's center toward the observer.
        const surface = calcShadow(MOON_POLAR_RADIUS_KM, shadow.ut, o, shadow.dir);

        // If we did everything right, the shadow distance should be very close to zero.
        // That's because we already determined the observer 'o' is on the shadow axis!
        // Upstream's bound is 1e-9 km; exceeding it is an implementation failure.
        if (surface.r > 1.0e-9 || surface.r < 0.0)
            throw new Error(`almanac internal: unexpected shadow distance from geoid intersection = ${surface.r}`);

        kind = eclipseKindFromUmbra(surface.k);
        obscuration = (kind === 'total') ? 1.0 : solarEclipseObscuration(shadow.dir, o);
    }
    // Otherwise this is a partial solar eclipse, and an obscuration needs a
    // place: `solarEclipses` and `solarObscuration` take an observer.

    return { kind, peak, axisDistanceKm: shadow.r, latitudeDeg, longitudeDeg, obscuration };
}

/**
 * The first solar eclipse anywhere on Earth whose greatest eclipse falls
 * strictly after `after`.
 *
 * Every new moon up to the end of the supported interval is tested: the
 * Moon's ecliptic latitude prunes the ones no shadow can reach, and the rest
 * get a peak-shadow search against the Earth's center. A new moon is an
 * eclipse when the Moon's penumbra reaches the Earth.
 *
 * @throws {AlmanacOutOfRangeError} if `after` is outside the supported
 *      interval, or if no eclipse remains before the end of it.
 * @throws {RangeError} if `after` is invalid.
 */
export function nextGlobalSolarEclipse(after: Date): GlobalSolarEclipse {
    return nearestGlobalSolarEclipse(after, 1);
}

/**
 * The last solar eclipse anywhere on Earth whose greatest eclipse falls
 * strictly before `before`, skipping peaks within 100 ms of it, just as
 * `nextGlobalSolarEclipse` does on the other side.
 *
 * @throws {AlmanacOutOfRangeError} if `before` is outside the supported
 *      interval, or if no eclipse remains after the start of it.
 * @throws {RangeError} if `before` is invalid.
 */
export function previousGlobalSolarEclipse(before: Date): GlobalSolarEclipse {
    return nearestGlobalSolarEclipse(before, -1);
}

/** Solar eclipses anywhere on Earth with greatest eclipse in `[startUtc, endUtc)`, sorted ascending. */
export function globalSolarEclipses(startUtc: Date, endUtc: Date): GlobalSolarEclipse[] {
    assertSupported(startUtc);
    assertSupportedWindowEnd(endUtc);
    return scanGlobalSolarEclipses(startUtc.getTime(), endUtc.getTime(), 1, false);
}

function nearestGlobalSolarEclipse(anchor: Date, direction: 1 | -1): GlobalSolarEclipse {
    assertSupported(anchor);
    const ms = anchor.getTime();
    // No scan limit: walk to the supported boundary, as the local search does.
    // At least two solar eclipses happen every year, so only the last and
    // first few months of the interval walk far, and a pruned new moon is cheap.
    const startMs = direction > 0 ? ms + SAME_ECLIPSE_MS + 1 : SUPPORTED_MIN;
    const endMs = direction > 0 ? SUPPORTED_MAX : ms - SAME_ECLIPSE_MS;
    const found = scanGlobalSolarEclipses(startMs, endMs, direction, true);
    if (found.length) return found[0];
    throw new AlmanacOutOfRangeError();
}

function scanGlobalSolarEclipses(startMs: number, endMs: number, direction: 1 | -1, firstOnly: boolean): GlobalSolarEclipse[] {
    const found: GlobalSolarEclipse[] = [];
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
        // UPSTREAM `SearchGlobalSolarEclipse`: step past this new moon before
        // the next probe, so the same one cannot be found twice.
        nmUt = newmoon + direction * 10;

        // Pruning: if the new moon's ecliptic latitude is too large, a solar
        // eclipse is not possible.
        if (Math.abs(moonEclipticLatitudeDeg(newmoon)) >= PRUNE_LATITUDE_DEG) continue;

        // Search near the new moon for the time when the center of the Earth
        // is closest to the line passing through the centers of the Sun and Moon.
        const shadow = peakMoonShadow(newmoon);
        if (shadow.r >= shadow.p + EARTH_MEAN_RADIUS_KM) continue;   // the penumbra misses the Earth
        const peak = dateFromUt(shadow.ut);
        if (peak.getTime() < startMs || peak.getTime() >= endMs) continue;

        // This is at least a partial solar eclipse visible somewhere on Earth.
        // Try to find an intersection between the shadow axis and the Earth's oblate geoid.
        found.push(geoidIntersect(shadow, peak));
        if (firstOnly) break;
    }
    return found;
}
