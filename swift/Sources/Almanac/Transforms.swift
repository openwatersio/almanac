import Foundation

// L2 transform layer: Greenwich sidereal time, topocentric parallax (the
// observer's geocentric position via WGS-84 flattening), and atmospheric
// refraction — turning L1's geocentric equatorial vectors into what an
// observer on Earth's surface sees.
//
// Translated from the cosinekitty/astronomy upstream (pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts), same as
// the TS port (typescript/src/transforms.ts):
//   SiderealTime (era ~2014 + sidereal_time ~2031); the observer's geocentric
//   position (terra ~2147, geo_pos ~2236), which the topocentric path inside
//   Equator(body, date, observer, ofdate=true, aberration=true) (~2803: body
//   EQJ vector minus observer EQJ vector, then gyrate the difference to date)
//   consumes; Horizon (~2565), stopping short of its post-refraction ra/dec
//   refinement since this layer only needs az/alt; Refraction 'normal' (~7176).
//
// INTERNAL: not part of the curated public API (see Positions.swift) except
// sunAltAz/moonAltAz.

/// Topocentric horizontal position: azimuth from true north through east, altitude above the horizon.
public struct AltAz: Sendable { public let azDeg: Double; public let altDeg: Double }

/**
 * INTERNAL: what `topoAltAzUnrefracted` already computes on the way to
 * az/alt. The L3 event layer (Events.swift) needs all four from a single
 * evaluation — the local hour angle brackets each daily cycle's altitude
 * extrema, and the topocentric distance sets the Moon's semidiameter, hence
 * its rise/set target.
 */
struct TopoUnrefracted { let azDeg: Double; let altDeg: Double; let hourAngleDeg: Double; let distanceAu: Double }

/** UPSTREAM: `era` (Earth Rotation Angle), astronomy.ts ~2014. */
private func earthRotationAngleDeg(_ ut: Double) -> Double {
    let thet1 = 0.7790572732640 + 0.00273781191135448 * ut
    let thet3 = ut.truncatingRemainder(dividingBy: 1)
    var theta = 360 * (thet1 + thet3).truncatingRemainder(dividingBy: 1)
    if theta < 0 { theta += 360 }
    return theta
}

/**
 * UPSTREAM: `sidereal_time`, astronomy.ts ~2031 — Greenwich Apparent Sidereal
 * Time (GAST). Returned in **degrees** [0, 360) rather than upstream's hours:
 * every caller in this port (terra/geo_pos, Horizon's spin angle) only ever
 * uses `15 * gastHours`, so upstream's final `/15` and each caller's `*15`
 * are folded into one multiply here — same value, one division dropped.
 */
func siderealDeg(_ ut: Double) -> Double {
    let tt = ttDaysFromUt(ut)
    let t = tt / 36525
    let eqeq = 15 * earthTilt(tt).ee    // equation of the equinoxes
    let theta = earthRotationAngleDeg(ut)
    let poly = ((((-0.0000000368 * t
                   - 0.000029956) * t
                   - 0.00000044) * t
                   + 1.3915817) * t
                   + 4612.156534) * t
    let st = eqeq + 0.014506 + poly
    var gastDeg = (st / 3600 + theta).truncatingRemainder(dividingBy: 360)
    if gastDeg < 0 { gastDeg += 360 }
    return gastDeg
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
 * Returns geocentric position of the observer, in AU, true equator of date.
 */
private func observerGeoVectorOfDate(_ gastDeg: Double, _ observer: Observer) -> Vec3 {
    let phi = observer.latitudeDeg * DEG2RAD
    let sinphi = sin(phi)
    let cosphi = cos(phi)
    let c = 1 / (cosphi*cosphi + (EARTH_FLATTENING*sinphi)*(EARTH_FLATTENING*sinphi)).squareRoot()
    let s = EARTH_FLATTENING_SQUARED * c
    let htKm = observer.elevationM / 1000
    let ach = EARTH_EQUATORIAL_RADIUS_KM * c + htKm
    let ash = EARTH_EQUATORIAL_RADIUS_KM * s + htKm
    let stlocl = (gastDeg + observer.longitudeDeg) * DEG2RAD
    let sinst = sin(stlocl)
    let cosst = cos(stlocl)
    return Vec3(
        x: ach * cosphi * cosst / KM_PER_AU,
        y: ach * cosphi * sinst / KM_PER_AU,
        z: ash * sinphi / KM_PER_AU
    )
}

/** UPSTREAM: `spin`, astronomy.ts ~2518 — rotate a horizontal-frame unit vector by sidereal angle. */
private func spin(_ angleDeg: Double, _ pos: Vec3) -> Vec3 {
    let angr = angleDeg * DEG2RAD
    let c = cos(angr)
    let s = sin(angr)
    return Vec3(x: c*pos.x + s*pos.y, y: c*pos.y - s*pos.x, z: pos.z)
}

/**
 * UPSTREAM: the topocentric path composed of `Equator(body, date, observer,
 * ofdate=true, aberration=true)` (astronomy.ts ~2803) followed by `Horizon`
 * (astronomy.ts ~2565), through its az/zd computation only — Horizon's
 * post-refraction ra/dec refinement branch produces topocentric ra/dec, which
 * this layer's callers (sunAltAz/moonAltAz) don't need.
 *
 * `bodyEqj` is the geocentric position of the body in AU, J2000 mean equator
 * (EQJ) — i.e. `GeoVector`'s return, matching `sunGeoVectorEqj` /
 * `moonGeoVectorEqj`, NOT the already-of-date vector `sunApparentAtTT`/
 * `moonApparentAtTT` consume. `ut` is days since J2000 in UT — the event
 * layer iterates in days, and `Date` round-trips are pure overhead on a
 * search's inner loop.
 *
 * Returns unrefracted topocentric azimuth/altitude, plus the local hour angle
 * and topocentric distance the same evaluation already produced.
 */
func topoAltAzUnrefracted(_ bodyEqj: Vec3, _ ut: Double, _ observer: Observer) -> TopoUnrefracted {
    let tt = ttDaysFromUt(ut)
    let gast = siderealDeg(ut)

    let gcObserver = observerGeoVectorOfDate(gast, observer)
    let bodyOfDate = gyration(bodyEqj, tt, .from2000)
    let datevect = Vec3(
        x: bodyOfDate.x - gcObserver.x,
        y: bodyOfDate.y - gcObserver.y,
        z: bodyOfDate.z - gcObserver.z
    )
    let radec = equatorialFromVector(datevect)

    let sinlat = sin(observer.latitudeDeg * DEG2RAD)
    let coslat = cos(observer.latitudeDeg * DEG2RAD)
    let sinlon = sin(observer.longitudeDeg * DEG2RAD)
    let coslon = cos(observer.longitudeDeg * DEG2RAD)
    let sindc = sin(radec.decDeg * DEG2RAD)
    let cosdc = cos(radec.decDeg * DEG2RAD)
    // upstream's ra*HOUR2RAD === raDeg*DEG2RAD under this port's degrees-only RA convention.
    let sinra = sin(radec.raDeg * DEG2RAD)
    let cosra = cos(radec.raDeg * DEG2RAD)

    let uze = Vec3(x: coslat*coslon, y: coslat*sinlon, z: sinlat)
    let une = Vec3(x: -sinlat*coslon, y: -sinlat*sinlon, z: coslat)
    let uwe = Vec3(x: sinlon, y: -coslon, z: 0)

    let spinAngle = -gast
    let uz = spin(spinAngle, uze)
    let un = spin(spinAngle, une)
    let uw = spin(spinAngle, uwe)

    let p = Vec3(x: cosdc*cosra, y: cosdc*sinra, z: sindc)

    let pz = p.x*uz.x + p.y*uz.y + p.z*uz.z
    let pn = p.x*un.x + p.y*un.y + p.z*un.z
    let pw = p.x*uw.x + p.y*uw.y + p.z*uw.z

    let proj = (pn*pn + pw*pw).squareRoot()
    var az: Double
    if proj > 0 {
        az = -RAD2DEG * atan2(pw, pn)
        if az < 0 { az += 360 }
    } else {
        az = 0
    }
    let zd = RAD2DEG * atan2(proj, pz)

    var hourAngleDeg = (gast + observer.longitudeDeg - radec.raDeg).truncatingRemainder(dividingBy: 360)
    if hourAngleDeg < 0 { hourAngleDeg += 360 }

    return TopoUnrefracted(azDeg: az, altDeg: 90 - zd, hourAngleDeg: hourAngleDeg, distanceAu: radec.distanceAu)
}

/**
 * UPSTREAM: `Refraction('normal', altitude)`, astronomy.ts ~7176 — the
 * Saemundsson/Meeus atmospheric-lift formula (JPL Horizons' algorithm per
 * upstream's comment), gradually reduced toward the nadir so a refracted
 * altitude never drops below -90.
 */
func refractionDeg(_ altitudeDeg: Double) -> Double {
    if altitudeDeg < -90.0 || altitudeDeg > 90.0 { return 0.0 }

    var hd = altitudeDeg
    if hd < -1.0 { hd = -1.0 }

    var refr = (1.02 / tan((hd + 10.3 / (hd + 5.11)) * DEG2RAD)) / 60.0

    if altitudeDeg < -1.0 {
        // Gradually reduce refraction toward the nadir so we never get an
        // altitude angle less than -90 degrees.
        refr *= (altitudeDeg + 90.0) / 89.0
    }

    return refr
}

private func refract(_ unrefracted: TopoUnrefracted) -> AltAz {
    AltAz(azDeg: unrefracted.azDeg, altDeg: unrefracted.altDeg + refractionDeg(unrefracted.altDeg))
}

/**
 * Topocentric azimuth/altitude of the Sun — parallax (via the observer's
 * geocentric position, WGS-84 flattening, elevation) and atmospheric
 * refraction (upstream `'normal'` model) both applied.
 */
public func sunAltAz(_ time: Date, observer: Observer) throws -> AltAz {
    let time = try normalized(time)
    try assertSupported(time)
    let ut = utDays(time)
    return refract(topoAltAzUnrefracted(sunGeoVectorEqj(ttDaysFromUt(ut)), ut, observer))
}

/**
 * Topocentric azimuth/altitude of the Moon — parallax (via the observer's
 * geocentric position, WGS-84 flattening, elevation) and atmospheric
 * refraction (upstream `'normal'` model) both applied.
 */
public func moonAltAz(_ time: Date, observer: Observer) throws -> AltAz {
    let time = try normalized(time)
    try assertSupported(time)
    let ut = utDays(time)
    return refract(topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer))
}
