import Foundation

// L1 public positions: apparent geocentric Sun and Moon on the true equator and
// equinox of date.
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
public struct SunPosition { public let raDeg: Double; public let decDeg: Double; public let distanceAu: Double }

/// Apparent geocentric position of the Moon: equator of date, RA in [0, 360).
public struct MoonPosition { public let raDeg: Double; public let decDeg: Double; public let distanceKm: Double }

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
    try assertSupported(time)
    return sunApparentAtTT(ttDays(time))
}

/**
 * Apparent geocentric position of the Moon — right ascension and declination on
 * the true equator and equinox of date (precession and nutation applied), plus
 * the Earth-Moon centre distance in kilometres.
 */
public func moonPosition(_ time: Date) throws -> MoonPosition {
    try assertSupported(time)
    return moonApparentAtTT(ttDays(time))
}
