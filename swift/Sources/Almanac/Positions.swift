import Foundation

// L1 public positions: apparent geocentric Sun, Moon and fixed stars on the true
// equator and equinox of date.
//
// The composition chain mirrors the cosinekitty/astronomy upstream (pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181), same as the TS port
// (typescript/src/positions.ts):
//   Sun:  GeoVector(Body.Sun, t, aberration=true) -> BackdatePosition ->
//         CorrectLightTravel over -HelioVector(Earth), then
//         Equator(ofdate=true) -> gyration(From2000) -> vector2radec.
//   Moon: GeoVector(Body.Moon, t) -> GeoMoon (MOON2, ecliptic of date ->
//         mean equator of date -> J2000), then the same
//         Equator(ofdate=true) gyration and vector2radec.
// Both are geocentric, so upstream's `gc_observer` term (Equator's topocentric
// parallax subtraction) is zero and drops out.

/// Apparent geocentric position of the Sun: equator of date, RA in [0, 360).
public struct SunPosition: Sendable { public let raDeg: Double; public let decDeg: Double; public let distanceAu: Double }

/// Apparent geocentric position of the Moon: equator of date, RA in [0, 360).
public struct MoonPosition: Sendable { public let raDeg: Double; public let decDeg: Double; public let distanceKm: Double }

/// Apparent geocentric position of a fixed star: equator of date, RA in [0, 360).
public struct StarPosition: Sendable { public let raDeg: Double; public let decDeg: Double }

/**
 * INTERNAL: apparent Sun for a TT instant, expressed as days since the J2000
 * epoch in Terrestrial Time. This is the entry point the TT-labeled position
 * fixtures compare against — going through `sunPosition` would first convert
 * UTC → TT with a ΔT model, putting a timescale approximation between the
 * ephemeris and the reference data.
 */
func sunApparentAtTT(_ tt: Double) -> SunPosition {
    let v = equatorialFromVector(sunGeoVector(tt))
    return SunPosition(raDeg: v.raDeg, decDeg: v.decDeg, distanceAu: v.distanceAu)
}

/** INTERNAL: apparent Moon for a TT instant. See `sunApparentAtTT`. */
func moonApparentAtTT(_ tt: Double) -> MoonPosition {
    let v = equatorialFromVector(moonGeoVector(tt))
    return MoonPosition(raDeg: v.raDeg, decDeg: v.decDeg, distanceKm: v.distanceAu * KM_PER_AU)
}

/**
 * Apparent geocentric position of the Sun — right ascension and declination on
 * the true equator and equinox of date (precession, nutation and aberration
 * applied), plus the light-time-corrected distance in AU.
 */
public func sunPosition(_ time: Date) throws -> SunPosition {
    let time = try normalized(time)
    try assertSupported(time)
    return sunApparentAtTT(ttDays(time))
}

/**
 * Apparent geocentric position of the Moon — right ascension and declination on
 * the true equator and equinox of date (precession and nutation applied), plus
 * the Earth-Moon centre distance in kilometres.
 */
public func moonPosition(_ time: Date) throws -> MoonPosition {
    let time = try normalized(time)
    try assertSupported(time)
    return moonApparentAtTT(ttDays(time))
}

/**
 * Apparent geocentric position of a fixed star from its J2000 (ICRS) catalog
 * right ascension and declination, both in degrees — right ascension and
 * declination on the true equator and equinox of date, with annual
 * aberration, precession and nutation applied. Proper motion and stellar
 * parallax are not applied.
 *
 * UPSTREAM: `Equator(star, date, observer, ofdate=true, aberration=true)`
 * (astronomy.ts ~2803) with the geocentric observer term dropped.
 */
public func starPosition(raDeg: Double, decDeg: Double, at time: Date) throws -> StarPosition {
    let time = try normalized(time)
    try assertSupported(time)
    try assertStarCatalog(raDeg, decDeg)
    let tt = ttDays(time)
    let v = equatorialFromVector(gyration(starGeoVectorEqj(raDeg, decDeg, tt), tt, .from2000))
    return StarPosition(raDeg: v.raDeg, decDeg: v.decDeg)
}

/**
 * INTERNAL: equation of time for a TT instant, in minutes. Not from upstream:
 * Meeus, *Astronomical Algorithms*, formula 28.1, `E = L0 − 0.0057183° − α +
 * Δψ cos ε`, with `L0` the Sun's mean longitude from formula 28.2 and `α` the
 * apparent right ascension `sunApparentAtTT` already computes. The constant
 * is aberration plus the FK5 correction; `Δψ cos ε` moves `L0` from the mean
 * equinox to the true one `α` is measured from.
 */
func equationOfTimeAtTT(_ tt: Double) -> Double {
    let tau = tt / 365250
    let l0 = 280.4664567 + tau * (360007.6982779 + tau * (0.03032028
        + tau * (1 / 49931 + tau * (-1 / 15300 + tau * (-1 / 2000000)))))
    let tilt = earthTilt(tt)
    let nutationRaDeg = (tilt.dpsi / 3600) * cos(tilt.tobl * DEG2RAD)
    var e = l0 - 0.0057183 - sunApparentAtTT(tt).raDeg + nutationRaDeg
    e = (e.truncatingRemainder(dividingBy: 360) + 540).truncatingRemainder(dividingBy: 360) - 180   // (−180, 180]
    return e * 4                        // 360° of right ascension is 1440 minutes
}

/**
 * Equation of time: apparent solar time minus mean solar time, in minutes.
 * Positive when a sundial runs ahead of the clock; about +16.4 at the start
 * of November and −14.2 in mid February.
 */
public func equationOfTime(_ time: Date) throws -> Double {
    let time = try normalized(time)
    try assertSupported(time)
    return equationOfTimeAtTT(ttDays(time))
}
