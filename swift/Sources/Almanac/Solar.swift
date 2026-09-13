import Foundation

// L3 solar eclipses for one observer: the Moon's shadow cone against the
// observer at every new moon — the local peak, the contacts C1–C4 with the
// Sun's altitude at each, the covered fraction at peak, and the covered
// fraction of the Sun's disc at any instant.
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts:
//   AngleBetween (~256), geo_pos (~2236, in Transforms.swift),
//   LocalMoonShadow (~8494), PeakLocalMoonShadow (~8587), Obscuration (~8622),
//   SolarEclipseObscuration (~8670), EclipseKindFromUmbra (~8834),
//   local_partial_distance (~9126), local_total_distance (~9130),
//   LocalEclipse (~9137), LocalEclipseTransition (~9165), SunAltitude (~9181)
//   and SearchLocalSolarEclipse (~9211).
// Constants and operation order are preserved so this stays a line-for-line
// translation of typescript/src/solar.ts.
//
// Four deliberate departures from upstream, all spec-driven:
//   - the new-moon probe is this package's `searchMoonPhase`, whose longitudes
//     are apparent rather than upstream's geometric (see Events.swift). It
//     only seeds a ±0.2 d peak search, so the ~40 s difference cannot change
//     a result.
//   - previous and range searches, the fixed whole-UT-day new-moon seed and
//     the 100 ms same-eclipse band come from the lunar port (Eclipse.swift);
//     upstream searches forward only.
//   - the night filter also accepts the Sun above the horizon at the peak, not
//     only at C1 or C4, so a short polar day inside the eclipse is kept.
//   - no two-year scan limit: next/previous walk new moons to the supported
//     boundary. A place can go years without a visible solar eclipse, and a
//     pruned new moon costs one Moon evaluation.

/// How much of the Sun an observer sees covered: `partial` when the Moon never covers it, `annular` when the Moon sits inside the Sun's disc, `total` when it covers it.
public enum SolarEclipseKind: String, Sendable {
    case partial, annular, total
}

/// The Sun's refracted topocentric altitude at each contact, degrees; `nil` exactly where the eclipse has no such contact.
public struct SolarEclipseSunAltitudes: Sendable {
    public let c1: Double
    public let c2: Double?
    public let peak: Double
    public let c3: Double?
    public let c4: Double

    public init(c1: Double, c2: Double?, peak: Double, c3: Double?, c4: Double) {
        self.c1 = c1; self.c2 = c2; self.peak = peak; self.c3 = c3; self.c4 = c4
    }
}

/// A solar eclipse as one observer sees it: peak circumstances plus the contact instants around them.
public struct SolarEclipse: Sendable {
    public let kind: SolarEclipseKind
    /// Fraction of the Sun's disc area covered at peak; exactly 1 for a total eclipse.
    public let obscuration: Double
    /// First contact: the partial phase begins.
    public let c1: Date
    /// Second contact: the total or annular phase begins — `nil` for a partial eclipse.
    public let c2: Date?
    /// Closest approach of the Moon's shadow axis to the observer.
    public let peak: Date
    /// Third contact: the total or annular phase ends — `nil` for a partial eclipse.
    public let c3: Date?
    /// Fourth contact: the partial phase ends.
    public let c4: Date
    /// The number `sunAltAz` reports at each contact instant, so "above the horizon" agrees with the Sun a consumer draws.
    public let sunAltDeg: SolarEclipseSunAltitudes

    public init(
        kind: SolarEclipseKind, obscuration: Double,
        c1: Date, c2: Date?, peak: Date, c3: Date?, c4: Date, sunAltDeg: SolarEclipseSunAltitudes
    ) {
        self.kind = kind; self.obscuration = obscuration
        self.c1 = c1; self.c2 = c2; self.peak = peak; self.c3 = c3; self.c4 = c4; self.sunAltDeg = sunAltDeg
    }
}

/** UPSTREAM: `SUN_RADIUS_AU` and `MOON_POLAR_RADIUS_AU`, astronomy.ts 135 and 149-150. */
private let sunRadiusAu = sunRadiusKm / KM_PER_AU
private let moonPolarRadiusKm = 1736.0
private let moonPolarRadiusAu = moonPolarRadiusKm / KM_PER_AU

/** Upstream's `PeakLocalMoonShadow` window, in days, either side of the new moon. */
private let peakWindowDays = 0.2

/** Upstream's `LocalEclipse` windows, in days, either side of the peak. */
private let partialWindowDays = 0.2
private let totalWindowDays = 0.01

/**
 * UPSTREAM: `LocalMoonShadow`, astronomy.ts ~8494 — the Moon's shadow cone
 * evaluated at the observer: the lunacentric observer measured against the
 * heliocentric Moon. All three vectors are EQJ, and `calcShadow` only ever
 * takes dot products and norms of them, so the frame cancels.
 */
func localMoonShadow(_ ut: Double, _ observer: Observer) -> ShadowInfo {
    let tt = ttDaysFromUt(ut)
    // Observer's geocentric position.
    let pos = observerGeoVectorEqj(ut, observer)
    // Light-travel and aberration corrected Sun.
    let s = sunGeoVectorEqj(tt)
    // Geocentric Moon.
    let m = moonGeoVectorEqj(tt)
    // Lunacentric location of an observer on the Earth's surface.
    let o = Vec3(x: pos.x - m.x, y: pos.y - m.y, z: pos.z - m.z)
    // Convert geocentric moon to heliocentric Moon.
    let hm = Vec3(x: m.x - s.x, y: m.y - s.y, z: m.z - s.z)
    return calcShadow(moonMeanRadiusKm, ut, o, hm)
}

/** UPSTREAM: `AngleBetween`, astronomy.ts ~256 — degrees. */
private func angleBetweenDeg(_ a: Vec3, _ b: Vec3) -> Double {
    let aa = (a.x*a.x + a.y*a.y + a.z*a.z)
    if abs(aa) < 1.0e-8 { fatalError("almanac internal: AngleBetween first vector is too short") }
    let bb = (b.x*b.x + b.y*b.y + b.z*b.z)
    if abs(bb) < 1.0e-8 { fatalError("almanac internal: AngleBetween second vector is too short") }
    let dot = (a.x*b.x + a.y*b.y + a.z*b.z) / (aa * bb).squareRoot()
    if dot <= -1.0 { return 180 }
    if dot >= +1.0 { return 0 }
    return RAD2DEG * acos(dot)
}

/**
 * UPSTREAM: `Obscuration`, astronomy.ts ~8622 — the area of intersection of
 * two discs of radii `a` and `b` whose centres are `c` apart, divided by the
 * area of the first disc.
 */
private func discOverlap(_ a: Double, _ b: Double, _ c: Double) -> Double {
    if a <= 0.0 { fatalError("almanac internal: radius of first disc must be positive") }
    if b <= 0.0 { fatalError("almanac internal: radius of second disc must be positive") }
    if c < 0.0 { fatalError("almanac internal: distance between discs is not allowed to be negative") }

    if c >= a + b {
        // The discs are too far apart to have any overlapping area.
        return 0.0
    }

    if c == 0.0 {
        // The discs have a common center. Therefore, one disc is inside the other.
        return (a <= b) ? 1.0 : (b*b)/(a*a)
    }

    let x = (a*a - b*b + c*c) / (2*c)
    let radicand = a*a - x*x
    if radicand <= 0.0 {
        // The circumferences do not intersect, or are tangent.
        // We already ruled out the case of non-overlapping discs.
        // Therefore, one disc is inside the other.
        return (a <= b) ? 1.0 : (b*b)/(a*a)
    }

    // The discs overlap fractionally in a pair of lens-shaped areas.
    let y = radicand.squareRoot()

    // Return the overlapping fractional area.
    // There are two lens-shaped areas, one to the left of x, the other to the right of x.
    // Each part is calculated by subtracting a triangular area from a sector's area.
    let lens1 = a*a*acos(x/a) - x*y
    let lens2 = b*b*acos((c-x)/b) - (c-x)*y

    // Find the fractional area with respect to the first disc.
    return (lens1 + lens2) / (Double.pi*a*a)
}

/**
 * UPSTREAM: the body of `SolarEclipseObscuration`, astronomy.ts ~8670, before
 * its clamp — the fraction of the Sun's apparent disc the Moon covers for an
 * observer, from the heliocentric Moon `hm` and the lunacentric observer `lo`.
 */
func discObscuration(_ hm: Vec3, _ lo: Vec3) -> Double {
    // Find heliocentric observer.
    let ho = Vec3(x: hm.x + lo.x, y: hm.y + lo.y, z: hm.z + lo.z)
    // Calculate the apparent angular radius of the Sun for the observer.
    let sunRadius = asin(sunRadiusAu / (ho.x*ho.x + ho.y*ho.y + ho.z*ho.z).squareRoot())
    // Calculate the apparent angular radius of the Moon for the observer.
    let moonRadius = asin(moonPolarRadiusAu / (lo.x*lo.x + lo.y*lo.y + lo.z*lo.z).squareRoot())
    // Calculate the apparent angular separation between the Sun's center and the Moon's center.
    let sunMoonSeparation = angleBetweenDeg(lo, ho)
    // Find the fraction of the Sun's apparent disc area that is covered by the Moon.
    return discOverlap(sunRadius, moonRadius, sunMoonSeparation * DEG2RAD)
}

/**
 * The fraction of the Sun's disc area the Moon covers for `observer` at
 * `time`: 0 when the discs are apart, 1 in totality, the ratio of the disc
 * areas in annularity, and the lens overlap between. Purely geometric — it
 * does not test the horizon; a consumer that draws the Sun already knows
 * whether it is up.
 *
 * - Throws: `AlmanacError.invalidArgument` if `time` is non-finite,
 *   `AlmanacError.outOfRange` if `time` is outside the supported interval.
 */
public func solarObscuration(at time: Date, observer: Observer) throws -> Double {
    let time = try normalized(time)
    try assertSupported(time)
    let shadow = localMoonShadow(utDays(time), observer)
    return discObscuration(shadow.dir, shadow.target)
}
