import Foundation

// L1 moon illumination: phase angle / illuminated fraction (upstream
// `Illumination`, Body.Moon branch, astronomy.ts line ~5048) and phase
// (upstream `MoonPhase` = `PairLongitude(Moon, Sun)` / 360, astronomy.ts line
// ~5221).
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts, mirroring
// the TS port (typescript/src/illumination.ts).

/// Moon illumination at an instant. `phase` is 0 at new moon, 0.5 at full.
public struct MoonIllumination {
    public let fraction: Double
    public let phaseAngleDeg: Double
    public let phase: Double
    public let waxing: Bool
}

/** UPSTREAM: `AngleBetween`, astronomy.ts lines 256-273 — angle between two vectors, [0, 180]. */
private func angleBetweenDeg(_ a: Vec3, _ b: Vec3) -> Double {
    let aa = a.x * a.x + a.y * a.y + a.z * a.z
    let bb = b.x * b.x + b.y * b.y + b.z * b.z
    let dot = (a.x * b.x + a.y * b.y + a.z * b.z) / (aa * bb).squareRoot()
    if dot <= -1 { return 180 }
    if dot >= 1 { return 0 }
    return RAD2DEG * acos(dot)
}

/**
 * UPSTREAM: the `elon` half of `Ecliptic()` (astronomy.ts lines 3013-3030),
 * applied to a J2000 mean-equator (EQJ) vector: `gyration(..., .from2000)`
 * reproduces `Ecliptic`'s precession+nutation-to-EQD step exactly, and
 * `eclipticToEquatorial` called with the negated obliquity performs the same
 * rotation as upstream's `RotateEquatorialToEcliptic` (its inverse).
 */
private func eclipticLonOfDateDeg(_ eqj: Vec3, _ tt: Double) -> Double {
    let eqd = gyration(eqj, tt, .from2000)
    let tobl = earthTilt(tt).tobl
    let ecl = eclipticToEquatorial(-tobl, eqd)
    if ecl.x == 0 && ecl.y == 0 { return 0 }
    var elon = RAD2DEG * atan2(ecl.y, ecl.x)
    if elon < 0 { elon += 360 }
    return elon
}

/** UPSTREAM: `NormalizeLongitude`, astronomy.ts lines 4735-4739. */
private func normalizeLongitude(_ lon: Double) -> Double {
    (lon.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
}

/** INTERNAL: moon illumination for a TT instant. See `moonIllumination`. */
func moonIlluminationAtTT(_ tt: Double) -> MoonIllumination {
    // UPSTREAM `Illumination`, Body.Moon branch: gc = GeoMoon(time) (no
    // backdating/aberration — see moonGeoVectorEqj); hc = earth + gc.
    let gc = moonGeoVectorEqj(tt)
    let earth = earthHelioVector(tt)
    let hc = Vec3(x: earth.x + gc.x, y: earth.y + gc.y, z: earth.z + gc.z)

    let phaseAngleDeg = angleBetweenDeg(gc, hc)
    let fraction = (1 + cos(DEG2RAD * phaseAngleDeg)) / 2

    // UPSTREAM `MoonPhase` = `PairLongitude(Moon, Sun)` / 360.
    // `GeoVector(body, time, aberration: false)`: the Moon is unaffected by
    // the flag (moonGeoVectorEqj above); the Sun reduces to
    // -earthHelioVector(tt) because HelioVector(Sun, t) is always the origin,
    // so BackdatePosition's aberration=false branch (a fixed, non-backdated
    // observer position) never iterates.
    let sunEqj = Vec3(x: -earth.x, y: -earth.y, z: -earth.z)
    let moonLonDeg = eclipticLonOfDateDeg(gc, tt)
    let sunLonDeg = eclipticLonOfDateDeg(sunEqj, tt)
    let phase = normalizeLongitude(moonLonDeg - sunLonDeg) / 360

    return MoonIllumination(fraction: fraction, phaseAngleDeg: phaseAngleDeg, phase: phase, waxing: phase < 0.5)
}

/**
 * Moon illumination at a given instant: the fraction of the visible disc lit
 * by the Sun, the phase angle it derives from (0 = full, 180 = new), and the
 * phase (0 = new, 0.5 = full, `waxing` = phase < 0.5).
 */
public func moonIllumination(_ time: Date) throws -> MoonIllumination {
    try assertSupported(time)
    return moonIlluminationAtTT(ttDays(time))
}
