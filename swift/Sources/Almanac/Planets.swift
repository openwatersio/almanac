import Foundation

/// Geometric Sun-centered AU vector in the fixed J2000 mean equatorial frame.
public struct HeliocentricPosition: Sendable {
    public let xAu: Double; public let yAu: Double; public let zAu: Double
    public init(xAu: Double, yAu: Double, zAu: Double) { self.xAu = xAu; self.yAu = yAu; self.zAu = zAu }
}

/// Apparent geocentric position on the true equator and equinox of date.
public struct PlanetPosition: Sendable {
    public let raDeg: Double; public let decDeg: Double; public let distanceAu: Double
    public init(raDeg: Double, decDeg: Double, distanceAu: Double) { self.raDeg = raDeg; self.decDeg = decDeg; self.distanceAu = distanceAu }
}

// TT-labeled evidence bypasses the civil-time Delta-T conversion.
func planetApparentAtTT(_ planet: Planet, _ tt: Double) -> PlanetPosition {
    let p = equatorialFromVector(gyration(planetGeoVectorEqj(planet, tt), tt, .from2000))
    // Aberration changes direction, not physical range; keep Earth at reception for distance.
    let range = planetGeoVectorEqj(planet, tt, aberration: false)
    return PlanetPosition(raDeg: p.raDeg, decDeg: p.decDeg, distanceAu: hypot(hypot(range.x, range.y), range.z))
}

/// Geometric position at the requested instant; accepts Earth.
public func planetHeliocentricPosition(_ planet: Planet, at time: Date) throws -> HeliocentricPosition {
    let time = try normalized(time)
    try assertSupported(time)
    let p = planetHelioVector(planet, ttDays(time))
    return HeliocentricPosition(xAu: p.x, yAu: p.y, zAu: p.z)
}

/// Apparent geocentric position with light-time, aberration, precession, and nutation.
public func planetPosition(_ planet: Planet, at time: Date) throws -> PlanetPosition {
    try assertSkyPlanet(planet)
    let time = try normalized(time)
    try assertSupported(time)
    return planetApparentAtTT(planet, ttDays(time))
}

/// Refracted topocentric position; altitude remains relative to the horizontal plane.
public func planetAltAz(_ planet: Planet, at time: Date, observer: Observer) throws -> AltAz {
    try assertSkyPlanet(planet)
    let time = try normalized(time)
    try assertSupported(time)
    let ut = utDays(time)
    return refract(topoAltAzUnrefracted(planetGeoVectorEqj(planet, ttDaysFromUt(ut)), ut, observer))
}
