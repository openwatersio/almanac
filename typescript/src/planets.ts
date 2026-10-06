import { type Planet, type Observer, assertPlanet, assertSupported, assertObserver } from './types.js';
import { ttDays, ttDaysFromUt, utDays } from './time.js';
import { gyration, PrecessDirection, equatorialFromVector, DEG2RAD, RAD2DEG, earthTilt, eclipticToEquatorial, type Vec3 } from './nutation.js';
import { planetHelioVector, planetGeoVectorEqj } from './planetModels.js';
import { type AltAz, topoAltAzUnrefracted, refract } from './transforms.js';
import { angleBetweenDeg } from './illumination.js';
import { earthHelioVector, sunGeoVectorEqj } from './sun.js';

/** Geometric Sun-centered AU vector in the fixed J2000 mean equatorial frame. */
export interface HeliocentricPosition { xAu: number; yAu: number; zAu: number; }
/** Apparent geocentric position on the true equator and equinox of date. */
export interface PlanetPosition { raDeg: number; decDeg: number; distanceAu: number; }
/** Geometric phase and approximate airless visual magnitude, plus apparent solar separation. */
export interface PlanetIllumination { fraction: number; phaseAngleDeg: number; magnitude: number; elongationDeg: number; }

// VisualMagnitude: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L4901.
function visualMagnitude(planet: Planet, phase: number, helioDist: number, geoDist: number): number {
    let c0: number, c1 = 0, c2 = 0, c3 = 0;
    switch (planet) {
        case 'mercury': c0 = -0.60; c1 = 4.98; c2 = -4.88; c3 = 3.02; break;
        case 'venus':
            if (phase < 163.6) { c0 = -4.47; c1 = 1.03; c2 = 0.57; c3 = 0.13; }
            else { c0 = 0.98; c1 = -1.02; }
            break;
        case 'mars': c0 = -1.52; c1 = 1.60; break;
        case 'jupiter': c0 = -9.40; c1 = 0.50; break;
        default: throw new Error('unsupported planet in visualMagnitude');
    }
    const x = phase / 100;
    let mag = c0 + x*(c1 + x*(c2 + x*c3));
    mag += 5*Math.log10(helioDist*geoDist);
    return mag;
}

// SaturnMagnitude: pinned astronomy.ts#L4927; Ecliptic: #L3013.
function saturnMagnitude(phase: number, helioDist: number, geoDist: number, gc: Vec3, tt: number): number {
    const ecl = eclipticToEquatorial(-earthTilt(tt).tobl, gyration(gc, tt, PrecessDirection.From2000));
    const lat = RAD2DEG*Math.atan2(ecl.z, Math.hypot(ecl.x, ecl.y));
    let lon = RAD2DEG*Math.atan2(ecl.y, ecl.x);
    if (lon < 0) lon += 360;
    const ir = DEG2RAD*28.06, nr = DEG2RAD*(169.51 + (3.82e-5*tt));
    const tilt = Math.asin(Math.sin(DEG2RAD*lat)*Math.cos(ir) - Math.cos(DEG2RAD*lat)*Math.sin(ir)*Math.sin(DEG2RAD*lon-nr));
    const sinTilt = Math.sin(Math.abs(tilt));
    let mag = -9 + 0.044*phase;
    mag += sinTilt*(-2.6 + 1.2*sinTilt);
    mag += 5*Math.log10(helioDist*geoDist);
    return mag;
}

// Illumination: pinned astronomy.ts#L5066; AngleFromSun: #L4869.
export function planetIlluminationAtTT(planet: Planet, tt: number): PlanetIllumination {
    const earth = earthHelioVector(tt), hc = planetHelioVector(planet, tt);
    const gc = { x: hc.x-earth.x, y: hc.y-earth.y, z: hc.z-earth.z };
    const phaseAngleDeg = angleBetweenDeg(gc, hc);
    const helioDist = Math.sqrt(hc.x*hc.x + hc.y*hc.y + hc.z*hc.z);
    const geoDist = Math.sqrt(gc.x*gc.x + gc.y*gc.y + gc.z*gc.z);
    const magnitude = planet === 'saturn' ? saturnMagnitude(phaseAngleDeg, helioDist, geoDist, gc, tt) : visualMagnitude(planet, phaseAngleDeg, helioDist, geoDist);
    return { fraction: (1+Math.cos(DEG2RAD*phaseAngleDeg))/2, phaseAngleDeg, magnitude,
        elongationDeg: angleBetweenDeg(sunGeoVectorEqj(tt), planetGeoVectorEqj(planet, tt)) };
}

/** Approximate airless magnitude includes Saturn's rings; elongation is apparent separation from the Sun. */
export function planetIllumination(planet: Planet, time: Date): PlanetIllumination {
    assertPlanet(planet);
    assertSupported(time);
    return planetIlluminationAtTT(planet, ttDays(time));
}

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
