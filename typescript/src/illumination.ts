// L1 moon illumination: phase angle / illuminated fraction (upstream
// `Illumination`, Body.Moon branch, astronomy.ts line ~5048) and phase
// (upstream `MoonPhase` = `PairLongitude(Moon, Sun)` / 360, astronomy.ts line
// ~5221), plus the Moon–Sun elongation both `phase` and the L3 phase search
// read — one definition, one implementation.
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts.
//
// INTERNAL: not part of the curated public API (see index.ts).

import { assertSupported } from './types.js';
import { ttDays } from './time.js';
import { DEG2RAD, PrecessDirection, RAD2DEG, Vec3, earthTilt, eclipticToEquatorial, gyration } from './nutation.js';
import { moonGeoVectorEqj } from './moon.js';
import { earthHelioVector, sunGeoVectorEqj } from './sun.js';

/** Moon illumination at an instant. `phase` is 0 at new moon, 0.5 at full. */
export interface MoonIllumination { fraction: number; phaseAngleDeg: number; phase: number; waxing: boolean; }

/** UPSTREAM: `AngleBetween`, astronomy.ts lines 256-273 — angle between two vectors, [0, 180]. */
function angleBetweenDeg(a: Vec3, b: Vec3): number {
    const aa = a.x * a.x + a.y * a.y + a.z * a.z;
    const bb = b.x * b.x + b.y * b.y + b.z * b.z;
    const dot = (a.x * b.x + a.y * b.y + a.z * b.z) / Math.sqrt(aa * bb);
    if (dot <= -1) return 180;
    if (dot >= 1) return 0;
    return RAD2DEG * Math.acos(dot);
}

/**
 * UPSTREAM: the `elon` half of `Ecliptic()` (astronomy.ts lines 3013-3030),
 * applied to a J2000 mean-equator (EQJ) vector: `gyration(..., From2000)`
 * reproduces `Ecliptic`'s precession+nutation-to-EQD step exactly, and
 * `eclipticToEquatorial` called with the negated obliquity performs the same
 * rotation as upstream's `RotateEquatorialToEcliptic` (its inverse).
 */
function eclipticLonOfDateDeg(eqj: Vec3, tt: number): number {
    const eqd = gyration(eqj, tt, PrecessDirection.From2000);
    const tobl = earthTilt(tt).tobl;
    const ecl = eclipticToEquatorial(-tobl, eqd);
    if (ecl.x === 0 && ecl.y === 0) return 0;
    let elon = RAD2DEG * Math.atan2(ecl.y, ecl.x);
    if (elon < 0) elon += 360;
    return elon;
}

/** UPSTREAM: `NormalizeLongitude`, astronomy.ts lines 4735-4739. */
function normalizeLongitude(lon: number): number {
    return ((lon % 360) + 360) % 360;
}

/**
 * INTERNAL: the Moon's apparent ecliptic longitude ahead of the Sun's, [0, 360)
 * — 0 at new moon, 180 at full. The single definition of lunar phase in this
 * package: `moonIllumination.phase` is this over 360, and `searchMoonPhases`
 * roots this against 0/90/180/270.
 *
 * UPSTREAM: `MoonPhase` = `PairLongitude(Moon, Sun)` (astronomy.ts ~5221,
 * ~4831) takes both longitudes from `GeoVector(body, t, aberration=false)`,
 * i.e. geometric directions. The spec's moon-phase definition is **apparent**
 * on both sides, matching the USNO/almanac definition of syzygy, so the Sun
 * here is the aberrated vector `sunPosition` returns. The Moon needs no such
 * change: aberration follows the observer's velocity *relative to the body* —
 * 30 km/s for the Sun (20.5″) against 1 km/s for the Moon (0.7″). That 20.5″ is
 * 40 s of elongation rate, and upstream's geometric convention sits exactly
 * that far off the USNO catalogue.
 */
export function moonPhaseDeg(tt: number): number {
    return normalizeLongitude(
        eclipticLonOfDateDeg(moonGeoVectorEqj(tt), tt) - eclipticLonOfDateDeg(sunGeoVectorEqj(tt), tt)
    );
}

/** INTERNAL: moon illumination for a TT instant. See {@link moonIllumination}. */
export function moonIlluminationAtTT(tt: number): MoonIllumination {
    // UPSTREAM `Illumination`, Body.Moon branch: gc = GeoMoon(time) (no
    // backdating/aberration — see moonGeoVectorEqj); hc = earth + gc.
    const gc = moonGeoVectorEqj(tt);
    const earth = earthHelioVector(tt);
    const hc: Vec3 = { x: earth.x + gc.x, y: earth.y + gc.y, z: earth.z + gc.z };

    const phaseAngleDeg = angleBetweenDeg(gc, hc);
    const fraction = (1 + Math.cos(DEG2RAD * phaseAngleDeg)) / 2;

    const phase = moonPhaseDeg(tt) / 360;
    return { fraction, phaseAngleDeg, phase, waxing: phase < 0.5 };
}

/**
 * Moon illumination at a given instant: the fraction of the visible disc lit
 * by the Sun, the phase angle it derives from (0 = full, 180 = new), and the
 * phase (0 = new, 0.5 = full, `waxing` = phase < 0.5).
 */
export function moonIllumination(time: Date): MoonIllumination {
    assertSupported(time);
    return moonIlluminationAtTT(ttDays(time));
}
