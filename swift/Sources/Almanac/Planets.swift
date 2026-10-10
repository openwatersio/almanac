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

/// Geometric phase and approximate airless visual magnitude, plus apparent solar separation.
public struct PlanetIllumination: Sendable {
    public let fraction: Double; public let phaseAngleDeg: Double; public let magnitude: Double; public let elongationDeg: Double
    public init(fraction: Double, phaseAngleDeg: Double, magnitude: Double, elongationDeg: Double) {
        self.fraction = fraction; self.phaseAngleDeg = phaseAngleDeg; self.magnitude = magnitude; self.elongationDeg = elongationDeg
    }
}

// VisualMagnitude: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L4901.
private func visualMagnitude(_ planet: Planet, _ phase: Double, _ helioDist: Double, _ geoDist: Double) -> Double {
    var c0: Double, c1 = 0.0, c2 = 0.0, c3 = 0.0
    switch planet {
    case .mercury: c0 = -0.60; c1 = 4.98; c2 = -4.88; c3 = 3.02
    case .venus:
        if phase < 163.6 { c0 = -4.47; c1 = 1.03; c2 = 0.57; c3 = 0.13 }
        else { c0 = 0.98; c1 = -1.02 }
    case .mars: c0 = -1.52; c1 = 1.60
    case .jupiter: c0 = -9.40; c1 = 0.50
    case .uranus: c0 = -7.19; c1 = 0.25
    case .neptune: c0 = -6.87
    default: fatalError("unsupported planet in visualMagnitude")
    }
    let x = phase / 100
    var mag = c0 + x*(c1 + x*(c2 + x*c3))
    mag += 5*log10(helioDist*geoDist)
    return mag
}

// SaturnMagnitude: pinned astronomy.ts#L4927; Ecliptic: #L3013.
private func saturnMagnitude(_ phase: Double, _ helioDist: Double, _ geoDist: Double, _ gc: Vec3, _ tt: Double) -> Double {
    let ecl = eclipticToEquatorial(-earthTilt(tt).tobl, gyration(gc, tt, .from2000))
    let lat = RAD2DEG*atan2(ecl.z, hypot(ecl.x, ecl.y))
    var lon = RAD2DEG*atan2(ecl.y, ecl.x)
    if lon < 0 { lon += 360 }
    let ir = DEG2RAD*28.06, nr = DEG2RAD*(169.51 + (3.82e-5*tt))
    let tilt = asin(sin(DEG2RAD*lat)*cos(ir) - cos(DEG2RAD*lat)*sin(ir)*sin(DEG2RAD*lon-nr))
    let sinTilt = sin(abs(tilt))
    var mag = -9 + 0.044*phase
    mag += sinTilt*(-2.6 + 1.2*sinTilt)
    mag += 5*log10(helioDist*geoDist)
    return mag
}

// Illumination: pinned astronomy.ts#L5066; AngleFromSun: #L4869.
func planetIlluminationAtTT(_ planet: Planet, _ tt: Double) -> PlanetIllumination {
    let earth = earthHelioVector(tt), hc = planetHelioVector(planet, tt)
    let gc = Vec3(x: hc.x-earth.x, y: hc.y-earth.y, z: hc.z-earth.z)
    let phaseAngleDeg = angleBetweenDeg(gc, hc)
    let helioDist = (hc.x*hc.x + hc.y*hc.y + hc.z*hc.z).squareRoot()
    let geoDist = (gc.x*gc.x + gc.y*gc.y + gc.z*gc.z).squareRoot()
    let magnitude = planet == .saturn ? saturnMagnitude(phaseAngleDeg, helioDist, geoDist, gc, tt) : visualMagnitude(planet, phaseAngleDeg, helioDist, geoDist)
    return PlanetIllumination(fraction: (1+cos(DEG2RAD*phaseAngleDeg))/2, phaseAngleDeg: phaseAngleDeg, magnitude: magnitude,
        elongationDeg: angleBetweenDeg(sunGeoVectorEqj(tt), planetGeoVectorEqj(planet, tt)))
}

/// Approximate airless magnitude includes Saturn's rings; elongation is apparent separation from the Sun.
public func planetIllumination(_ planet: Planet, at time: Date) throws -> PlanetIllumination {
    try assertSkyPlanet(planet)
    let time = try normalized(time)
    try assertSupported(time)
    return planetIlluminationAtTT(planet, ttDays(time))
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
