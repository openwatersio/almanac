// L1 frames layer: IAU 2000B nutation, mean obliquity, and the precession /
// nutation rotations that carry a vector between the J2000 mean equator (EQJ)
// and the true equator & equinox of date.
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts. Operation
// order and coefficient values are preserved verbatim so that a Swift port of
// this file agrees bit-for-bit.
//
// INTERNAL: not part of the curated public API (see index.ts).

/** UPSTREAM: constants, astronomy.ts lines 42-72 and 123-140. */
export const DEG2RAD = 0.017453292519943296;
export const RAD2DEG = 57.295779513082321;
export const ASEC2RAD = 4.848136811095359935899141e-6;
const ASEC180 = 180 * 60 * 60;
const ASEC360 = 2 * ASEC180;
export const PI2 = 2 * Math.PI;
/** arcseconds per radian */
export const ARC = 3600 * (180 / Math.PI);
export const KM_PER_AU = 1.4959787069098932e8;
export const C_AUDAY = 173.1446326846693;
export const EARTH_EQUATORIAL_RADIUS_KM = 6378.1366;
export const EARTH_EQUATORIAL_RADIUS_AU = EARTH_EQUATORIAL_RADIUS_KM / KM_PER_AU;
/** UPSTREAM: WGS-84 flattening, astronomy.ts lines 137-138 (terra, geo_pos). */
export const EARTH_FLATTENING = 0.996647180302104;
export const EARTH_FLATTENING_SQUARED = EARTH_FLATTENING * EARTH_FLATTENING;

/** A Cartesian position in AU. */
export interface Vec3 { x: number; y: number; z: number; }

/** Equatorial direction + range derived from a {@link Vec3}. */
export interface EquatorialFromVector { raDeg: number; decDeg: number; distanceAu: number; }

/**
 * Direction of a frame rotation, matching upstream's `PrecessDirection` enum
 * (astronomy.ts ~line 1920): `From2000` takes EQJ → of-date, `Into2000` the inverse.
 */
export enum PrecessDirection { Into2000 = 0, From2000 = 1 }

/** UPSTREAM: `Frac`, astronomy.ts line 235. */
export function frac(x: number): number {
    return x - Math.floor(x);
}

interface NutationAngles { dpsi: number; deps: number; }

/**
 * UPSTREAM: `iau2000b`, astronomy.ts lines 1392-1435. The IAU 2000B nutation
 * series truncated to its five largest terms; returns arcseconds.
 */
function iau2000b(tt: number): NutationAngles {
    function mod(x: number): number {
        return (x % ASEC360) * ASEC2RAD;
    }

    const t = tt / 36525;
    const elp = mod(1287104.79305 + t*129596581.0481);
    const f   = mod(335779.526232 + t*1739527262.8478);
    const d   = mod(1072260.70369 + t*1602961601.2090);
    const om  = mod(450160.398036 - t*6962890.5431);

    let sarg = Math.sin(om);
    let carg = Math.cos(om);
    let dp = (-172064161.0 - 174666.0*t)*sarg + 33386.0*carg;
    let de = (92052331.0 + 9086.0*t)*carg + 15377.0*sarg;

    let arg = 2.0*(f - d + om);
    sarg = Math.sin(arg);
    carg = Math.cos(arg);
    dp += (-13170906.0 - 1675.0*t)*sarg - 13696.0*carg;
    de += (5730336.0 - 3015.0*t)*carg - 4587.0*sarg;

    arg = 2.0*(f + om);
    sarg = Math.sin(arg);
    carg = Math.cos(arg);
    dp += (-2276413.0 - 234.0*t)*sarg + 2796.0*carg;
    de += (978459.0 - 485.0*t)*carg + 1374.0*sarg;

    arg = 2.0*om;
    sarg = Math.sin(arg);
    carg = Math.cos(arg);
    dp += (2074554.0 + 207.0*t)*sarg - 698.0*carg;
    de += (-897492.0 + 470.0*t)*carg - 291.0*sarg;

    sarg = Math.sin(elp);
    carg = Math.cos(elp);
    dp += (1475877.0 - 3633.0*t)*sarg + 11817.0*carg;
    de += (73871.0 - 184.0*t)*carg - 1924.0*sarg;

    return {
        dpsi: -0.000135 + (dp * 1.0e-7),
        deps: +0.000388 + (de * 1.0e-7)
    };
}

/** UPSTREAM: `mean_obliq`, astronomy.ts lines 1437-1447. Degrees. */
export function meanObliquityDeg(tt: number): number {
    const t = tt / 36525;
    const asec = (
        (((( -  0.0000000434   * t
             -  0.000000576  ) * t
             +  0.00200340   ) * t
             -  0.0001831    ) * t
             - 46.836769     ) * t + 84381.406
    );
    return asec / 3600.0;
}

/** UPSTREAM: `EarthTiltInfo`, astronomy.ts lines 1449-1457. dpsi/deps arcsec, mobl/tobl degrees. */
export interface EarthTilt { dpsi: number; deps: number; ee: number; mobl: number; tobl: number; }

let cacheETilt: EarthTilt | undefined;
let cacheETiltTt = NaN;

/** UPSTREAM: `e_tilt`, astronomy.ts lines 1460-1475 (including its one-entry cache). */
export function earthTilt(tt: number): EarthTilt {
    if (!cacheETilt || !(Math.abs(cacheETiltTt - tt) <= 1.0e-6)) {
        const nut = iau2000b(tt);
        const meanOb = meanObliquityDeg(tt);
        const trueOb = meanOb + (nut.deps / 3600);
        cacheETiltTt = tt;
        cacheETilt = {
            dpsi: nut.dpsi,
            deps: nut.deps,
            ee: nut.dpsi * Math.cos(meanOb * DEG2RAD) / 15,
            mobl: meanOb,
            tobl: trueOb
        };
    }
    return cacheETilt;
}

/** Nutation in longitude and obliquity, in **degrees** (Tasks 12/14/16 consume this shape). */
export function nutation(tt: number): { dpsiDeg: number; depsDeg: number } {
    const tilt = earthTilt(tt);
    return { dpsiDeg: tilt.dpsi / 3600, depsDeg: tilt.deps / 3600 };
}

/** UPSTREAM: `obl_ecl2equ_vec`, astronomy.ts lines 1477-1486. */
export function eclipticToEquatorial(oblDegrees: number, pos: Vec3): Vec3 {
    const obl = oblDegrees * DEG2RAD;
    const cosObl = Math.cos(obl);
    const sinObl = Math.sin(obl);
    return {
        x: pos.x,
        y: pos.y*cosObl - pos.z*sinObl,
        z: pos.y*sinObl + pos.z*cosObl
    };
}

/** UPSTREAM: `rotate`, astronomy.ts lines 1928-1934 (note the transposed indexing). */
function rotate(rot: number[][], vec: Vec3): Vec3 {
    return {
        x: rot[0][0]*vec.x + rot[1][0]*vec.y + rot[2][0]*vec.z,
        y: rot[0][1]*vec.x + rot[1][1]*vec.y + rot[2][1]*vec.z,
        z: rot[0][2]*vec.x + rot[1][2]*vec.y + rot[2][2]*vec.z
    };
}

/** UPSTREAM: `precession_rot`, astronomy.ts lines 1946-2012. */
function precessionRot(tt: number, dir: PrecessDirection): number[][] {
    const t = tt / 36525;

    let eps0 = 84381.406;

    let psia   = (((((-    0.0000000951  * t
                      +    0.000132851 ) * t
                      -    0.00114045  ) * t
                      -    1.0790069   ) * t
                      + 5038.481507    ) * t);

    let omegaa = (((((+    0.0000003337  * t
                      -    0.000000467 ) * t
                      -    0.00772503  ) * t
                      +    0.0512623   ) * t
                      -    0.025754    ) * t + eps0);

    let chia   = (((((-    0.0000000560  * t
                      +    0.000170663 ) * t
                      -    0.00121197  ) * t
                      -    2.3814292   ) * t
                      +   10.556403    ) * t);

    eps0   *= ASEC2RAD;
    psia   *= ASEC2RAD;
    omegaa *= ASEC2RAD;
    chia   *= ASEC2RAD;

    const sa = Math.sin(eps0);
    const ca = Math.cos(eps0);
    const sb = Math.sin(-psia);
    const cb = Math.cos(-psia);
    const sc = Math.sin(-omegaa);
    const cc = Math.cos(-omegaa);
    const sd = Math.sin(chia);
    const cd = Math.cos(chia);

    const xx =  cd*cb - sb*sd*cc;
    const yx =  cd*sb*ca + sd*cc*cb*ca - sa*sd*sc;
    const zx =  cd*sb*sa + sd*cc*cb*sa + ca*sd*sc;
    const xy = -sd*cb - sb*cd*cc;
    const yy = -sd*sb * ca + cd*cc*cb*ca - sa*cd*sc;
    const zy = -sd*sb * sa + cd*cc*cb*sa + ca*cd*sc;
    const xz =  sb*sc;
    const yz = -sc*cb * ca - sa*cc;
    const zz = -sc*cb * sa + cc*ca;

    if (dir === PrecessDirection.Into2000) {
        // Perform rotation from epoch to J2000.0.
        return [
            [xx, yx, zx],
            [xy, yy, zy],
            [xz, yz, zz]
        ];
    }

    // Perform rotation from J2000.0 to epoch.
    return [
        [xx, xy, xz],
        [yx, yy, yz],
        [zx, zy, zz]
    ];
}

/** UPSTREAM: `precession`, astronomy.ts lines 1936-1939. */
export function precession(pos: Vec3, tt: number, dir: PrecessDirection): Vec3 {
    return rotate(precessionRot(tt, dir), pos);
}

/** UPSTREAM: `nutation_rot`, astronomy.ts lines 2175-2216. */
function nutationRot(tt: number, dir: PrecessDirection): number[][] {
    const tilt = earthTilt(tt);
    const oblm = tilt.mobl * DEG2RAD;
    const oblt = tilt.tobl * DEG2RAD;
    const psi  = tilt.dpsi * ASEC2RAD;
    const cobm = Math.cos(oblm);
    const sobm = Math.sin(oblm);
    const cobt = Math.cos(oblt);
    const sobt = Math.sin(oblt);
    const cpsi = Math.cos(psi);
    const spsi = Math.sin(psi);

    const xx =  cpsi;
    const yx = -spsi*cobm;
    const zx = -spsi*sobm;
    const xy =  spsi*cobt;
    const yy =  cpsi*cobm*cobt + sobm*sobt;
    const zy =  cpsi*sobm*cobt - cobm*sobt;
    const xz =  spsi*sobt;
    const yz =  cpsi*cobm*sobt - sobm*cobt;
    const zz =  cpsi*sobm*sobt + cobm*cobt;

    if (dir === PrecessDirection.From2000) {
        // convert J2000 to of-date
        return [
            [xx, xy, xz],
            [yx, yy, yz],
            [zx, zy, zz]
        ];
    }

    // convert of-date to J2000
    return [
        [xx, yx, zx],
        [xy, yy, zy],
        [xz, yz, zz]
    ];
}

/** UPSTREAM: `nutation`, astronomy.ts lines 2165-2168. */
export function applyNutation(pos: Vec3, tt: number, dir: PrecessDirection): Vec3 {
    return rotate(nutationRot(tt, dir), pos);
}

/**
 * UPSTREAM: `gyration`, astronomy.ts lines 2218-2225. Precession and nutation
 * composed; the order flips with direction because they are mutual inverses.
 */
export function gyration(pos: Vec3, tt: number, dir: PrecessDirection): Vec3 {
    return (dir === PrecessDirection.Into2000) ?
        precession(applyNutation(pos, tt, dir), tt, dir) :
        applyNutation(precession(pos, tt, dir), tt, dir);
}

/**
 * UPSTREAM: `vector2radec`, astronomy.ts lines 2501-2516 — with right ascension
 * in degrees over [0, 360) rather than upstream's hours, per the spec's
 * Coordinate semantics.
 */
export function equatorialFromVector(pos: Vec3): EquatorialFromVector {
    const xyproj = pos.x*pos.x + pos.y*pos.y;
    const dist = Math.sqrt(xyproj + pos.z*pos.z);
    if (xyproj === 0) {
        if (pos.z === 0)
            throw new Error('Indeterminate sky coordinates');
        return { raDeg: 0, decDeg: (pos.z < 0) ? -90 : +90, distanceAu: dist };
    }

    let raDeg = RAD2DEG * Math.atan2(pos.y, pos.x);
    if (raDeg < 0)
        raDeg += 360;
    const decDeg = RAD2DEG * Math.atan2(pos.z, Math.sqrt(xyproj));
    return { raDeg, decDeg, distanceAu: dist };
}
