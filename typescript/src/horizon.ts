import { Observer, assertObserver } from './types.js';
import { DEG2RAD, RAD2DEG, EARTH_FLATTENING, EARTH_EQUATORIAL_RADIUS_KM } from './nutation.js';

/** Apparent horizon altitude below the horizontal plane; eye height is measured above the unobstructed surface. */
export function horizonDip(observer: Observer, heightAboveGroundM: number): number {
    assertObserver(observer);
    const elevation = observer.elevationM ?? 0;
    const ground = elevation - heightAboveGroundM;
    if (!(heightAboveGroundM >= 0 && heightAboveGroundM <= 10000) || !(ground >= -500 && ground <= 10000))
        throw new RangeError('eye height or ground elevation out of range');
    if (heightAboveGroundM === 0) return 0;

    // Translated from HorizonDipAngle at cosinekitty/astronomy commit 865d3da7d8112bbc7911238052c6af4aaf877181.
    const phi = observer.latitudeDeg * DEG2RAD;
    const sinphi = Math.sin(phi);
    const cosphi = Math.cos(phi);
    const c = 1 / Math.hypot(cosphi, sinphi * EARTH_FLATTENING);
    const s = c * (EARTH_FLATTENING * EARTH_FLATTENING);
    const htKm = ground / 1000;
    const ach = EARTH_EQUATORIAL_RADIUS_KM * c + htKm;
    const ash = EARTH_EQUATORIAL_RADIUS_KM * s + htKm;
    const radiusM = 1000 * Math.hypot(ach * cosphi, ash * sinphi);
    const k = 0.175 * Math.pow(1 - (6.5e-3 / 283.15) * (elevation - (2 / 3) * heightAboveGroundM), 3.256);
    return RAD2DEG * -(Math.sqrt(2 * (1 - k) * heightAboveGroundM / radiusM) / (1 - k));
}
