import { type Planet, type Observer, assertPlanet, assertSupported, assertObserver } from './types.js';
import { ttDays, ttDaysFromUt, utDays } from './time.js';
import { gyration, PrecessDirection, equatorialFromVector } from './nutation.js';
import { planetHelioVector, planetGeoVectorEqj } from './planetModels.js';
import { type AltAz, topoAltAzUnrefracted, refract } from './transforms.js';

/** Geometric Sun-centered AU vector in the fixed J2000 mean equatorial frame. */
export interface HeliocentricPosition { xAu: number; yAu: number; zAu: number; }
/** Apparent geocentric position on the true equator and equinox of date. */
export interface PlanetPosition { raDeg: number; decDeg: number; distanceAu: number; }

/** INTERNAL: TT-labeled evidence bypasses the civil-time Delta-T conversion. */
export function planetApparentAtTT(planet: Planet, tt: number): PlanetPosition {
    const direction = equatorialFromVector(gyration(planetGeoVectorEqj(planet, tt), tt, PrecessDirection.From2000));
    // Aberration changes direction, not physical range; keep Earth at reception for distance.
    const range = planetGeoVectorEqj(planet, tt, false);
    return { raDeg: direction.raDeg, decDeg: direction.decDeg, distanceAu: Math.hypot(range.x, range.y, range.z) };
}

/** Geometric position at the requested instant; accepts Earth. */
export function planetHeliocentricPosition(planet: Planet, time: Date): HeliocentricPosition {
    assertPlanet(planet, true);
    assertSupported(time);
    const p = planetHelioVector(planet, ttDays(time));
    return { xAu: p.x, yAu: p.y, zAu: p.z };
}

/** Apparent geocentric position with light-time, aberration, precession, and nutation. */
export function planetPosition(planet: Planet, time: Date): PlanetPosition {
    assertPlanet(planet);
    assertSupported(time);
    return planetApparentAtTT(planet, ttDays(time));
}

/** Refracted topocentric position; altitude remains relative to the horizontal plane. */
export function planetAltAz(planet: Planet, time: Date, observer: Observer): AltAz {
    assertPlanet(planet);
    assertSupported(time);
    assertObserver(observer);
    const ut = utDays(time);
    return refract(topoAltAzUnrefracted(planetGeoVectorEqj(planet, ttDaysFromUt(ut)), ut, observer));
}
