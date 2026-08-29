// L2 transform layer: Greenwich sidereal time, topocentric parallax (the
// observer's geocentric position via WGS-84 flattening), and atmospheric
// refraction — turning L1's geocentric equatorial vectors into what an
// observer on Earth's surface sees.
//
// Translated from the cosinekitty/astronomy upstream (pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts):
//   SiderealTime (era ~2014 + sidereal_time ~2031); the observer's geocentric
//   position (terra ~2147, geo_pos ~2236), which the topocentric path inside
//   Equator(body, date, observer, ofdate=true, aberration=true) (~2803: body
//   EQJ vector minus observer EQJ vector, then gyrate the difference to date)
//   consumes; Horizon (~2565), stopping short of its post-refraction ra/dec
//   refinement since this layer only needs az/alt; Refraction 'normal' (~7176).
//
// INTERNAL: not part of the curated public API (see index.ts) except
// sunAltAz/moonAltAz.

import { Observer, assertObserver, assertSupported } from './types.js';
import { ttDaysFromUt, utDays } from './time.js';
import {
    DEG2RAD, RAD2DEG, EARTH_EQUATORIAL_RADIUS_KM, EARTH_FLATTENING, EARTH_FLATTENING_SQUARED,
    KM_PER_AU, PrecessDirection, Vec3, earthTilt, equatorialFromVector, gyration
} from './nutation.js';
import { sunGeoVectorEqj } from './sun.js';
import { moonGeoVectorEqj } from './moon.js';

/** Topocentric horizontal position: azimuth from true north through east, altitude above the horizon. */
export interface AltAz { azDeg: number; altDeg: number; }

/**
 * INTERNAL: what {@link topoAltAzUnrefracted} already computes on the way to
 * az/alt. The L3 event layer needs all four from a single evaluation — the
 * local hour angle brackets each daily cycle's altitude extrema, and the
 * topocentric distance sets the Moon's semidiameter, hence its rise/set target.
 */
export interface TopoUnrefracted extends AltAz { hourAngleDeg: number; distanceAu: number; }

/** UPSTREAM: `era` (Earth Rotation Angle), astronomy.ts ~2014. */
function earthRotationAngleDeg(ut: number): number {
    const thet1 = 0.7790572732640 + 0.00273781191135448 * ut;
    const thet3 = ut % 1;
    let theta = 360 * ((thet1 + thet3) % 1);
    if (theta < 0)
        theta += 360;
    return theta;
}

/**
 * UPSTREAM: `sidereal_time`, astronomy.ts ~2031 — Greenwich Apparent Sidereal
 * Time (GAST). Returned in **degrees** [0, 360) rather than upstream's hours:
 * every caller in this port (terra/geo_pos, Horizon's spin angle) only ever
 * uses `15 * gastHours`, so upstream's final `/15` and each caller's `*15`
 * are folded into one multiply here — same value, one division dropped.
 */
export function siderealDeg(ut: number): number {
    const tt = ttDaysFromUt(ut);
    const t = tt / 36525;
    const eqeq = 15 * earthTilt(tt).ee;    // equation of the equinoxes
    const theta = earthRotationAngleDeg(ut);
    const st = eqeq + 0.014506 +
             (((( -    0.0000000368   * t
                  -    0.000029956  ) * t
                  -    0.00000044   ) * t
                  +    1.3915817    ) * t
                  + 4612.156534     ) * t;
    let gastDeg = (st / 3600 + theta) % 360;
    if (gastDeg < 0)
        gastDeg += 360;
    return gastDeg;
}

/**
 * UPSTREAM: `terra` (astronomy.ts ~2147 — position only; its velocity output
 * is for observer diurnal aberration, which this parallax-only path doesn't
 * need). Upstream's `geo_pos` (~2236) then gyrates this into EQJ so that
 * `Equator` can subtract it from the body's EQJ vector and gyrate the
 * difference back to date. Gyration is a rotation, so
 * `R(body − observer) === R·body − R·observer`, and `R` applied to the
 * observer's own inverse-gyration is the vector below: one precession and one
 * nutation per evaluation drop out of the inner loop of every event search.
 *
 * @returns geocentric position of the observer, in AU, true equator of date.
 */
function observerGeoVectorOfDate(gastDeg: number, observer: Observer): Vec3 {
    const phi = observer.latitudeDeg * DEG2RAD;
    const sinphi = Math.sin(phi);
    const cosphi = Math.cos(phi);
    const c = 1 / Math.hypot(cosphi, EARTH_FLATTENING * sinphi);
    const s = EARTH_FLATTENING_SQUARED * c;
    const htKm = (observer.elevationM ?? 0) / 1000;
    const ach = EARTH_EQUATORIAL_RADIUS_KM * c + htKm;
    const ash = EARTH_EQUATORIAL_RADIUS_KM * s + htKm;
    const stlocl = (gastDeg + observer.longitudeDeg) * DEG2RAD;
    const sinst = Math.sin(stlocl);
    const cosst = Math.cos(stlocl);
    return {
        x: ach * cosphi * cosst / KM_PER_AU,
        y: ach * cosphi * sinst / KM_PER_AU,
        z: ash * sinphi / KM_PER_AU
    };
}

/** UPSTREAM: `spin`, astronomy.ts ~2518 — rotate a horizontal-frame unit vector by sidereal angle. */
function spin(angleDeg: number, pos: Vec3): Vec3 {
    const angr = angleDeg * DEG2RAD;
    const c = Math.cos(angr);
    const s = Math.sin(angr);
    return { x: c * pos.x + s * pos.y, y: c * pos.y - s * pos.x, z: pos.z };
}

/**
 * UPSTREAM: the topocentric path composed of `Equator(body, date, observer,
 * ofdate=true, aberration=true)` (astronomy.ts ~2803) followed by `Horizon`
 * (astronomy.ts ~2565), through its az/zd computation only — Horizon's
 * post-refraction ra/dec refinement branch produces topocentric ra/dec, which
 * this layer's callers (sunAltAz/moonAltAz) don't need.
 *
 * @param bodyEqj geocentric position of the body in AU, J2000 mean equator
 *      (EQJ) — i.e. `GeoVector`'s return, matching {@link sunGeoVectorEqj} /
 *      {@link moonGeoVectorEqj}, NOT the already-of-date vector
 *      {@link sunApparentAtTT}/{@link moonApparentAtTT} consume.
 * @param ut days since J2000 in UT — the event layer iterates in days, and
 *      `Date` round-trips are pure overhead on a search's inner loop.
 * @returns unrefracted topocentric azimuth/altitude, plus the local hour angle
 *      and topocentric distance the same evaluation already produced.
 */
export function topoAltAzUnrefracted(bodyEqj: Vec3, ut: number, observer: Observer): TopoUnrefracted {
    const tt = ttDaysFromUt(ut);
    const gast = siderealDeg(ut);

    const gcObserver = observerGeoVectorOfDate(gast, observer);
    const bodyOfDate = gyration(bodyEqj, tt, PrecessDirection.From2000);
    const datevect: Vec3 = {
        x: bodyOfDate.x - gcObserver.x,
        y: bodyOfDate.y - gcObserver.y,
        z: bodyOfDate.z - gcObserver.z
    };
    const { raDeg, decDeg, distanceAu } = equatorialFromVector(datevect);

    const sinlat = Math.sin(observer.latitudeDeg * DEG2RAD);
    const coslat = Math.cos(observer.latitudeDeg * DEG2RAD);
    const sinlon = Math.sin(observer.longitudeDeg * DEG2RAD);
    const coslon = Math.cos(observer.longitudeDeg * DEG2RAD);
    const sindc = Math.sin(decDeg * DEG2RAD);
    const cosdc = Math.cos(decDeg * DEG2RAD);
    // upstream's ra*HOUR2RAD === raDeg*DEG2RAD under this port's degrees-only RA convention.
    const sinra = Math.sin(raDeg * DEG2RAD);
    const cosra = Math.cos(raDeg * DEG2RAD);

    const uze: Vec3 = { x: coslat * coslon, y: coslat * sinlon, z: sinlat };
    const une: Vec3 = { x: -sinlat * coslon, y: -sinlat * sinlon, z: coslat };
    const uwe: Vec3 = { x: sinlon, y: -coslon, z: 0 };

    const spinAngle = -gast;
    const uz = spin(spinAngle, uze);
    const un = spin(spinAngle, une);
    const uw = spin(spinAngle, uwe);

    const p: Vec3 = { x: cosdc * cosra, y: cosdc * sinra, z: sindc };

    const pz = p.x * uz.x + p.y * uz.y + p.z * uz.z;
    const pn = p.x * un.x + p.y * un.y + p.z * un.z;
    const pw = p.x * uw.x + p.y * uw.y + p.z * uw.z;

    const proj = Math.hypot(pn, pw);
    let az: number;
    if (proj > 0) {
        az = -RAD2DEG * Math.atan2(pw, pn);
        if (az < 0)
            az += 360;
    } else {
        az = 0;
    }
    const zd = RAD2DEG * Math.atan2(proj, pz);

    let hourAngleDeg = (gast + observer.longitudeDeg - raDeg) % 360;
    if (hourAngleDeg < 0)
        hourAngleDeg += 360;

    return { azDeg: az, altDeg: 90 - zd, hourAngleDeg, distanceAu };
}

/**
 * UPSTREAM: `Refraction('normal', altitude)`, astronomy.ts ~7176 — the
 * Saemundsson/Meeus atmospheric-lift formula (JPL Horizons' algorithm per
 * upstream's comment), gradually reduced toward the nadir so a refracted
 * altitude never drops below -90.
 */
export function refractionDeg(altitudeDeg: number): number {
    if (altitudeDeg < -90.0 || altitudeDeg > 90.0)
        return 0.0;

    let hd = altitudeDeg;
    if (hd < -1.0)
        hd = -1.0;

    let refr = (1.02 / Math.tan((hd + 10.3 / (hd + 5.11)) * DEG2RAD)) / 60.0;

    if (altitudeDeg < -1.0) {
        // Gradually reduce refraction toward the nadir so we never get an
        // altitude angle less than -90 degrees.
        refr *= (altitudeDeg + 90.0) / 89.0;
    }

    return refr;
}

function refract(unrefracted: AltAz): AltAz {
    return { azDeg: unrefracted.azDeg, altDeg: unrefracted.altDeg + refractionDeg(unrefracted.altDeg) };
}

/**
 * Topocentric azimuth/altitude of the Sun — parallax (via the observer's
 * geocentric position, WGS-84 flattening, elevation) and atmospheric
 * refraction (upstream `'normal'` model) both applied.
 */
export function sunAltAz(time: Date, observer: Observer): AltAz {
    assertSupported(time);
    assertObserver(observer);
    const ut = utDays(time);
    return refract(topoAltAzUnrefracted(sunGeoVectorEqj(ttDaysFromUt(ut)), ut, observer));
}

/**
 * Topocentric azimuth/altitude of the Moon — parallax (via the observer's
 * geocentric position, WGS-84 flattening, elevation) and atmospheric
 * refraction (upstream `'normal'` model) both applied.
 */
export function moonAltAz(time: Date, observer: Observer): AltAz {
    assertSupported(time);
    assertObserver(observer);
    const ut = utDays(time);
    return refract(topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer));
}
