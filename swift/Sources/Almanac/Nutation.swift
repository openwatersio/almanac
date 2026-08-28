import Foundation

// L1 frames layer: IAU 2000B nutation, mean obliquity, and the precession /
// nutation rotations that carry a vector between the J2000 mean equator (EQJ)
// and the true equator & equinox of date.
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts. Operation
// order and coefficient values are preserved verbatim so this agrees
// bit-for-bit with the TS port (typescript/src/nutation.ts).
//
// INTERNAL: not part of the curated public API (see Positions.swift).
//
// Deviation from TS: upstream's `e_tilt` (and the TS port) keep a one-entry
// module-level mutable cache (perf only, proven order-independent). Swift 6
// concurrency makes a mutable global awkward for no benefit here, so
// `earthTilt` below just recomputes every call — same math, same op order.

/** UPSTREAM: constants, astronomy.ts lines 42-72 and 123-140. */
let DEG2RAD = 0.017453292519943296
let RAD2DEG = 57.295779513082321
let ASEC2RAD = 4.848136811095359935899141e-6
private let ASEC180 = 180.0 * 60 * 60
private let ASEC360 = 2 * ASEC180
let PI2 = 2 * Double.pi
/** arcseconds per radian */
let ARC = 3600 * (180 / Double.pi)
let KM_PER_AU = 1.4959787069098932e8
let C_AUDAY = 173.1446326846693
let EARTH_EQUATORIAL_RADIUS_KM = 6378.1366
let EARTH_EQUATORIAL_RADIUS_AU = EARTH_EQUATORIAL_RADIUS_KM / KM_PER_AU

/** A Cartesian position in AU. */
struct Vec3 { var x: Double; var y: Double; var z: Double }

/** Equatorial direction + range derived from a `Vec3`. */
struct EquatorialFromVector { let raDeg: Double; let decDeg: Double; let distanceAu: Double }

/**
 * Direction of a frame rotation, matching upstream's `PrecessDirection` enum
 * (astronomy.ts ~line 1920): `into2000` takes EQJ → of-date, `from2000` the inverse.
 */
enum PrecessDirection { case into2000, from2000 }

/** UPSTREAM: `Frac`, astronomy.ts line 235. */
func frac(_ x: Double) -> Double {
    x - x.rounded(.down)
}

private struct NutationAngles { let dpsi: Double; let deps: Double }

/**
 * UPSTREAM: `iau2000b`, astronomy.ts lines 1392-1435. The IAU 2000B nutation
 * series truncated to its five largest terms; returns arcseconds.
 */
private func iau2000b(_ tt: Double) -> NutationAngles {
    func mod(_ x: Double) -> Double {
        x.truncatingRemainder(dividingBy: ASEC360) * ASEC2RAD
    }

    let t = tt / 36525
    let elp = mod(1287104.79305 + t*129596581.0481)
    let f   = mod(335779.526232 + t*1739527262.8478)
    let d   = mod(1072260.70369 + t*1602961601.2090)
    let om  = mod(450160.398036 - t*6962890.5431)

    var sarg = sin(om)
    var carg = cos(om)
    var dp = (-172064161.0 - 174666.0*t)*sarg + 33386.0*carg
    var de = (92052331.0 + 9086.0*t)*carg + 15377.0*sarg

    var arg = 2.0*(f - d + om)
    sarg = sin(arg)
    carg = cos(arg)
    dp += (-13170906.0 - 1675.0*t)*sarg - 13696.0*carg
    de += (5730336.0 - 3015.0*t)*carg - 4587.0*sarg

    arg = 2.0*(f + om)
    sarg = sin(arg)
    carg = cos(arg)
    dp += (-2276413.0 - 234.0*t)*sarg + 2796.0*carg
    de += (978459.0 - 485.0*t)*carg + 1374.0*sarg

    arg = 2.0*om
    sarg = sin(arg)
    carg = cos(arg)
    dp += (2074554.0 + 207.0*t)*sarg - 698.0*carg
    de += (-897492.0 + 470.0*t)*carg - 291.0*sarg

    sarg = sin(elp)
    carg = cos(elp)
    dp += (1475877.0 - 3633.0*t)*sarg + 11817.0*carg
    de += (73871.0 - 184.0*t)*carg - 1924.0*sarg

    return NutationAngles(
        dpsi: -0.000135 + (dp * 1.0e-7),
        deps: +0.000388 + (de * 1.0e-7)
    )
}

/** UPSTREAM: `mean_obliq`, astronomy.ts lines 1437-1447. Degrees. */
func meanObliquityDeg(_ tt: Double) -> Double {
    let t = tt / 36525
    let asec = (
        ((((-0.0000000434 * t
            - 0.000000576) * t
            + 0.00200340) * t
            - 0.0001831) * t
            - 46.836769) * t + 84381.406
    )
    return asec / 3600.0
}

/** UPSTREAM: `EarthTiltInfo`, astronomy.ts lines 1449-1457. dpsi/deps arcsec, mobl/tobl degrees. */
struct EarthTilt { let dpsi: Double; let deps: Double; let ee: Double; let mobl: Double; let tobl: Double }

/**
 * UPSTREAM: `e_tilt`, astronomy.ts lines 1460-1475 — minus its one-entry
 * cache (see the file-header deviation note): recomputed every call.
 */
func earthTilt(_ tt: Double) -> EarthTilt {
    let nut = iau2000b(tt)
    let meanOb = meanObliquityDeg(tt)
    let trueOb = meanOb + (nut.deps / 3600)
    return EarthTilt(
        dpsi: nut.dpsi,
        deps: nut.deps,
        ee: nut.dpsi * cos(meanOb * DEG2RAD) / 15,
        mobl: meanOb,
        tobl: trueOb
    )
}

/** Nutation in longitude and obliquity, in **degrees** (Tasks 12/14/16 consume this shape). */
func nutation(_ tt: Double) -> (dpsiDeg: Double, depsDeg: Double) {
    let tilt = earthTilt(tt)
    return (tilt.dpsi / 3600, tilt.deps / 3600)
}

/** UPSTREAM: `obl_ecl2equ_vec`, astronomy.ts lines 1477-1486. */
func eclipticToEquatorial(_ oblDegrees: Double, _ pos: Vec3) -> Vec3 {
    let obl = oblDegrees * DEG2RAD
    let cosObl = cos(obl)
    let sinObl = sin(obl)
    return Vec3(
        x: pos.x,
        y: pos.y*cosObl - pos.z*sinObl,
        z: pos.y*sinObl + pos.z*cosObl
    )
}

/** UPSTREAM: `rotate`, astronomy.ts lines 1928-1934 (note the transposed indexing). */
private func rotate(_ rot: [[Double]], _ vec: Vec3) -> Vec3 {
    Vec3(
        x: rot[0][0]*vec.x + rot[1][0]*vec.y + rot[2][0]*vec.z,
        y: rot[0][1]*vec.x + rot[1][1]*vec.y + rot[2][1]*vec.z,
        z: rot[0][2]*vec.x + rot[1][2]*vec.y + rot[2][2]*vec.z
    )
}

/** UPSTREAM: `precession_rot`, astronomy.ts lines 1946-2012. */
private func precessionRot(_ tt: Double, _ dir: PrecessDirection) -> [[Double]] {
    let t = tt / 36525

    var eps0 = 84381.406

    var psia = (((((-0.0000000951 * t
                    + 0.000132851) * t
                    - 0.00114045) * t
                    - 1.0790069) * t
                    + 5038.481507) * t)

    var omegaa = (((((0.0000003337 * t
                    - 0.000000467) * t
                    - 0.00772503) * t
                    + 0.0512623) * t
                    - 0.025754) * t + eps0)

    var chia = (((((-0.0000000560 * t
                    + 0.000170663) * t
                    - 0.00121197) * t
                    - 2.3814292) * t
                    + 10.556403) * t)

    eps0   *= ASEC2RAD
    psia   *= ASEC2RAD
    omegaa *= ASEC2RAD
    chia   *= ASEC2RAD

    let sa = sin(eps0)
    let ca = cos(eps0)
    let sb = sin(-psia)
    let cb = cos(-psia)
    let sc = sin(-omegaa)
    let cc = cos(-omegaa)
    let sd = sin(chia)
    let cd = cos(chia)

    let xx =  cd*cb - sb*sd*cc
    let yx =  cd*sb*ca + sd*cc*cb*ca - sa*sd*sc
    let zx =  cd*sb*sa + sd*cc*cb*sa + ca*sd*sc
    let xy = -sd*cb - sb*cd*cc
    let yy = -sd*sb * ca + cd*cc*cb*ca - sa*cd*sc
    let zy = -sd*sb * sa + cd*cc*cb*sa + ca*cd*sc
    let xz =  sb*sc
    let yz = -sc*cb * ca - sa*cc
    let zz = -sc*cb * sa + cc*ca

    if dir == .into2000 {
        // Perform rotation from epoch to J2000.0.
        return [
            [xx, yx, zx],
            [xy, yy, zy],
            [xz, yz, zz]
        ]
    }

    // Perform rotation from J2000.0 to epoch.
    return [
        [xx, xy, xz],
        [yx, yy, yz],
        [zx, zy, zz]
    ]
}

/** UPSTREAM: `precession`, astronomy.ts lines 1936-1939. */
func precession(_ pos: Vec3, _ tt: Double, _ dir: PrecessDirection) -> Vec3 {
    rotate(precessionRot(tt, dir), pos)
}

/** UPSTREAM: `nutation_rot`, astronomy.ts lines 2175-2216. */
private func nutationRot(_ tt: Double, _ dir: PrecessDirection) -> [[Double]] {
    let tilt = earthTilt(tt)
    let oblm = tilt.mobl * DEG2RAD
    let oblt = tilt.tobl * DEG2RAD
    let psi  = tilt.dpsi * ASEC2RAD
    let cobm = cos(oblm)
    let sobm = sin(oblm)
    let cobt = cos(oblt)
    let sobt = sin(oblt)
    let cpsi = cos(psi)
    let spsi = sin(psi)

    let xx =  cpsi
    let yx = -spsi*cobm
    let zx = -spsi*sobm
    let xy =  spsi*cobt
    let yy =  cpsi*cobm*cobt + sobm*sobt
    let zy =  cpsi*sobm*cobt - cobm*sobt
    let xz =  spsi*sobt
    let yz =  cpsi*cobm*sobt - sobm*cobt
    let zz =  cpsi*sobm*sobt + cobm*cobt

    if dir == .from2000 {
        // convert J2000 to of-date
        return [
            [xx, xy, xz],
            [yx, yy, yz],
            [zx, zy, zz]
        ]
    }

    // convert of-date to J2000
    return [
        [xx, yx, zx],
        [xy, yy, zy],
        [xz, yz, zz]
    ]
}

/** UPSTREAM: `nutation`, astronomy.ts lines 2165-2168. */
func applyNutation(_ pos: Vec3, _ tt: Double, _ dir: PrecessDirection) -> Vec3 {
    rotate(nutationRot(tt, dir), pos)
}

/**
 * UPSTREAM: `gyration`, astronomy.ts lines 2218-2225. Precession and nutation
 * composed; the order flips with direction because they are mutual inverses.
 */
func gyration(_ pos: Vec3, _ tt: Double, _ dir: PrecessDirection) -> Vec3 {
    dir == .into2000 ?
        precession(applyNutation(pos, tt, dir), tt, dir) :
        applyNutation(precession(pos, tt, dir), tt, dir)
}

/**
 * UPSTREAM: `vector2radec`, astronomy.ts lines 2501-2516 — with right ascension
 * in degrees over [0, 360) rather than upstream's hours, per the spec's
 * Coordinate semantics.
 */
// Note: TS throws a plain Error here for the (x,y,z)==(0,0,0) case, uncaught
// by any caller. That's unreachable for real Sun/Moon output (never a zero
// vector), so this port uses fatalError rather than threading `throws`
// through every internal helper for a branch nothing exercises.
func equatorialFromVector(_ pos: Vec3) -> EquatorialFromVector {
    let xyproj = pos.x*pos.x + pos.y*pos.y
    let dist = (xyproj + pos.z*pos.z).squareRoot()
    if xyproj == 0 {
        if pos.z == 0 {
            fatalError("Indeterminate sky coordinates")
        }
        return EquatorialFromVector(raDeg: 0, decDeg: (pos.z < 0) ? -90 : +90, distanceAu: dist)
    }

    var raDeg = RAD2DEG * atan2(pos.y, pos.x)
    if raDeg < 0 { raDeg += 360 }
    let decDeg = RAD2DEG * atan2(pos.z, xyproj.squareRoot())
    return EquatorialFromVector(raDeg: raDeg, decDeg: decDeg, distanceAu: dist)
}
