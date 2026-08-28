// L1 public positions: apparent geocentric Sun and Moon on the true equator and
// equinox of date.
//
// The composition chain mirrors the cosinekitty/astronomy upstream (pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181):
//   Sun:  GeoVector(Body.Sun, t, aberration=true) -> BackdatePosition ->
//         CorrectLightTravel over -HelioVector(Earth), then
//         Equator(ofdate=true) -> gyration(From2000) -> vector2radec.
//   Moon: GeoVector(Body.Moon, t) -> GeoMoon (MOON2, ecliptic of date ->
//         mean equator of date -> J2000), then the same
//         Equator(ofdate=true) gyration and vector2radec.
// Both are geocentric, so upstream's `gc_observer` term (Equator's topocentric
// parallax subtraction) is zero and drops out.

import { assertSupported } from './types.js';
import { ttDays } from './time.js';
import { KM_PER_AU, equatorialFromVector } from './nutation.js';
import { moonGeoVector } from './moon.js';
import { sunGeoVector } from './sun.js';

/** Apparent geocentric position of the Sun: equator of date, RA in [0, 360). */
export interface SunPosition { raDeg: number; decDeg: number; distanceAu: number; }

/** Apparent geocentric position of the Moon: equator of date, RA in [0, 360). */
export interface MoonPosition { raDeg: number; decDeg: number; distanceKm: number; }

/**
 * Apparent geocentric position of the Sun — right ascension and declination on
 * the true equator and equinox of date (precession, nutation and aberration
 * applied), plus the light-time-corrected distance in AU.
 */
export function sunPosition(time: Date): SunPosition {
    assertSupported(time);
    const { raDeg, decDeg, distanceAu } = equatorialFromVector(sunGeoVector(ttDays(time)));
    return { raDeg, decDeg, distanceAu };
}

/**
 * Apparent geocentric position of the Moon — right ascension and declination on
 * the true equator and equinox of date (precession and nutation applied), plus
 * the Earth-Moon centre distance in kilometres.
 */
export function moonPosition(time: Date): MoonPosition {
    assertSupported(time);
    const { raDeg, decDeg, distanceAu } = equatorialFromVector(moonGeoVector(ttDays(time)));
    return { raDeg, decDeg, distanceKm: distanceAu * KM_PER_AU };
}
