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

/**
 * UPSTREAM: `SolarEclipseObscuration`, astronomy.ts ~8670, with its clamp:
 * "in marginal cases, we need to clamp obscuration to less than 1.0. This
 * function is never called for total eclipses, so it should never return 1.0."
 */
private func solarEclipseObscuration(_ hm: Vec3, _ lo: Vec3) -> Double {
    min(0.9999, discObscuration(hm, lo))
}

/** UPSTREAM: `ShadowDistanceSlope`, astronomy.ts ~8535, bound to `localMoonShadow`. */
private func localShadowSlope(_ ut: Double, _ observer: Observer) -> Double {
    let dt = 1.0 / 86400.0
    return (localMoonShadow(ut + dt, observer).r - localMoonShadow(ut - dt, observer).r) / dt
}

/**
 * UPSTREAM: `PeakLocalMoonShadow`, astronomy.ts ~8587 — the time near the
 * new moon when the Moon's shadow axis comes closest to the observer, i.e.
 * the ascending zero of the axis distance's time derivative.
 */
private func peakLocalMoonShadow(_ centerUt: Double, _ observer: Observer) -> ShadowInfo {
    // Use the same new-moon seed regardless of search direction or window.
    // Otherwise a ~1 ms root shift can lose/duplicate a peak when a caller
    // splits a range at a previously returned peak. Only unpruned moons pay
    // for this second phase search; its start is a fixed whole UT day.
    guard let newmoon = searchMoonPhase(0, floor(centerUt) - 1, 4) else {
        fatalError("almanac internal: cannot refine new moon")
    }
    guard let ut = search(
        { u in localShadowSlope(u, observer) }, newmoon - peakWindowDays, newmoon + peakWindowDays,
        shadowTolSeconds, iterLimit: shadowIterCap, what: "peak local moon shadow"
    ) else {
        fatalError("almanac internal: failed to find peak local Moon shadow time")
    }
    return localMoonShadow(ut, observer)
}

/**
 * UPSTREAM: `EclipseKindFromUmbra`, astronomy.ts ~8834 — a positive umbra
 * radius at the observer is a total eclipse, otherwise annular. The 14 m
 * bias is upstream's, added to match Espenak's classifications.
 */
private func eclipseKindFromUmbra(_ k: Double) -> SolarEclipseKind {
    (k > 0.014) ? .total : .annular
}

/** UPSTREAM: `local_partial_distance`, astronomy.ts ~9126. */
private func localPartialDistance(_ shadow: ShadowInfo) -> Double {
    shadow.p - shadow.r
}

/** UPSTREAM: `local_total_distance`, astronomy.ts ~9130 — `|k|`, because the umbra radius is negative for an annular eclipse. */
private func localTotalDistance(_ shadow: ShadowInfo) -> Double {
    abs(shadow.k) - shadow.r
}

/** UPSTREAM: `LocalEclipseTransition`, astronomy.ts ~9165 — the instant `f` crosses zero in `direction` inside `[t1, t2]`. */
private func localEclipseTransition(
    _ observer: Observer, _ direction: Double, _ f: (ShadowInfo) -> Double, _ t1: Double, _ t2: Double
) -> Double {
    guard let ut = search(
        { u in direction * f(localMoonShadow(u, observer)) }, t1, t2,
        shadowTolSeconds, iterLimit: shadowIterCap, what: "local eclipse transition"
    ) else {
        fatalError("almanac internal: local eclipse transition search failed")
    }
    return ut
}

/**
 * UPSTREAM: `SunAltitude`, astronomy.ts ~9181 — the refracted topocentric
 * altitude `sunAltAz` reports, without its interval assertion: a contact can
 * fall just outside the supported interval while its peak is inside.
 */
private func sunAltDegAt(_ d: Date, _ observer: Observer) -> Double {
    let ut = utDays(d)
    let alt = topoAltAzUnrefracted(sunGeoVectorEqj(ttDaysFromUt(ut)), ut, observer).altDeg
    return alt + refractionDeg(alt)
}

/** UPSTREAM: `LocalEclipse`, astronomy.ts ~9137 — contacts and kind around a peak the observer is inside the penumbra for. */
private func buildSolarEclipse(_ shadow: ShadowInfo, _ observer: Observer) throws -> SolarEclipse {
    let peakUt = shadow.ut
    let c1Ut = localEclipseTransition(observer, +1.0, localPartialDistance, peakUt - partialWindowDays, peakUt)
    let c4Ut = localEclipseTransition(observer, -1.0, localPartialDistance, peakUt, peakUt + partialWindowDays)
    var c2Ut: Double? = nil
    var c3Ut: Double? = nil
    let kind: SolarEclipseKind

    if shadow.r < abs(shadow.k) {     // take absolute value of 'k' to handle annular eclipses too.
        c2Ut = localEclipseTransition(observer, +1.0, localTotalDistance, peakUt - totalWindowDays, peakUt)
        c3Ut = localEclipseTransition(observer, -1.0, localTotalDistance, peakUt, peakUt + totalWindowDays)
        kind = eclipseKindFromUmbra(shadow.k)
    } else {
        kind = .partial
    }

    let obscuration = (kind == .total) ? 1.0 : solarEclipseObscuration(shadow.dir, shadow.target)

    // Altitudes come from the reported (TimeClip-truncated) instants, so
    // `sunAltAz(e.c1, observer: observer).altDeg == e.sunAltDeg.c1` exactly.
    let c1 = try normalized(dateFromUt(c1Ut))
    let c2 = try c2Ut.map { try normalized(dateFromUt($0)) }
    let peak = try normalized(dateFromUt(peakUt))
    let c3 = try c3Ut.map { try normalized(dateFromUt($0)) }
    let c4 = try normalized(dateFromUt(c4Ut))
    return SolarEclipse(
        kind: kind, obscuration: obscuration, c1: c1, c2: c2, peak: peak, c3: c3, c4: c4,
        sunAltDeg: SolarEclipseSunAltitudes(
            c1: sunAltDegAt(c1, observer), c2: c2.map { sunAltDegAt($0, observer) }, peak: sunAltDegAt(peak, observer),
            c3: c3.map { sunAltDegAt($0, observer) }, c4: sunAltDegAt(c4, observer))
    )
}

/**
 * The night filter: the Sun's centre must be above the horizon at C1, the
 * peak, or C4. Upstream tests only C1 and C4; the peak keeps a short polar day
 * inside the eclipse.
 * ponytail: three samples, not a sunrise search — a day that starts after C1
 * and ends before the peak still drops. Upgrade path: sunEvents over [c1, c4].
 */
private func seesAnyOfIt(_ e: SolarEclipse) -> Bool {
    e.sunAltDeg.c1 > 0.0 || e.sunAltDeg.peak > 0.0 || e.sunAltDeg.c4 > 0.0
}

/**
 * The first solar eclipse `observer` can see whose peak falls strictly after
 * `after`.
 *
 * Every new moon up to the end of the supported interval is tested: the
 * Moon's ecliptic latitude prunes the ones no shadow can reach, and the rest
 * get a peak-shadow search from the observer. An eclipse whose Sun is below
 * the horizon at C1, the peak, and C4 is skipped.
 *
 * - Throws: `AlmanacError.invalidArgument` if `after` is non-finite,
 *   `AlmanacError.outOfRange` if `after` is outside the supported interval or
 *   no visible eclipse remains before the end of it.
 */
public func nextSolarEclipse(after: Date, observer: Observer) throws -> SolarEclipse {
    try nearestSolarEclipse(after, 1, observer)
}

/**
 * The last solar eclipse `observer` can see whose peak falls strictly before
 * `before`, skipping peaks within 100 ms of it, just as `nextSolarEclipse`
 * does on the other side.
 *
 * - Throws: `AlmanacError.invalidArgument` if `before` is non-finite,
 *   `AlmanacError.outOfRange` if `before` is outside the supported interval or
 *   no visible eclipse remains after the start of it.
 */
public func previousSolarEclipse(before: Date, observer: Observer) throws -> SolarEclipse {
    try nearestSolarEclipse(before, -1, observer)
}

/// Solar eclipses `observer` can see with peaks in `[from, to)`, sorted ascending. Contacts may fall outside the window.
public func solarEclipses(from startUtc: Date, to endUtc: Date, observer: Observer) throws -> [SolarEclipse] {
    let startUtc = try normalized(startUtc)
    let endUtc = try normalized(endUtc)
    try assertSupported(startUtc)
    try assertSupportedWindowEnd(endUtc)
    return try scanSolarEclipses((startUtc.timeIntervalSince1970 * 1000).rounded(), (endUtc.timeIntervalSince1970 * 1000).rounded(), 1, firstOnly: false, observer)
}

private func nearestSolarEclipse(_ anchor: Date, _ direction: Double, _ observer: Observer) throws -> SolarEclipse {
    let anchor = try normalized(anchor)
    try assertSupported(anchor)
    let ms = (anchor.timeIntervalSince1970 * 1000).rounded()
    let minMs = supportedMin.timeIntervalSince1970 * 1000
    let maxMs = supportedMax.timeIntervalSince1970 * 1000
    // No scan limit: walk to the supported boundary. A place can go years
    // without a visible solar eclipse, and a pruned new moon is cheap.
    let startMs = direction > 0 ? ms + sameEclipseMs + 1 : minMs
    let endMs = direction > 0 ? maxMs : ms - sameEclipseMs
    let found = try scanSolarEclipses(startMs, endMs, direction, firstOnly: true, observer)
    if let first = found.first { return first }
    throw AlmanacError.outOfRange
}

private func scanSolarEclipses(_ startMs: Double, _ endMs: Double, _ direction: Double, firstOnly: Bool, _ observer: Observer) throws -> [SolarEclipse] {
    var found: [SolarEclipse] = []
    if startMs >= endMs { return found }
    // Peak and new moon differ by up to the peak window. Include the entire
    // margin at both ends, then apply the caller's bounds to the reported peak.
    let startUt = utDays(Date(timeIntervalSince1970: startMs / 1000)) - peakWindowDays
    let endUt = utDays(Date(timeIntervalSince1970: endMs / 1000)) + peakWindowDays
    var nmUt = direction > 0 ? startUt : endUt
    let limitUt = direction > 0 ? endUt : startUt

    while direction * (limitUt - nmUt) > 0 {
        guard let newmoon = searchMoonPhase(0, nmUt, direction * min(40, abs(limitUt - nmUt))) else { break }
        // UPSTREAM `SearchLocalSolarEclipse`: step past this new moon before
        // the next probe, so the same one cannot be found twice.
        nmUt = newmoon + direction * 10

        // Pruning: if the new moon's ecliptic latitude is too large, a solar
        // eclipse is not possible.
        if abs(moonEclipticLatitudeDeg(newmoon)) >= pruneLatitudeDeg { continue }

        // Search near the new moon for the time when the observer is closest
        // to the line passing through the centers of the Sun and Moon.
        let shadow = peakLocalMoonShadow(newmoon, observer)
        if shadow.r >= shadow.p { continue }   // the observer never enters the penumbra
        let peak = try normalized(dateFromUt(shadow.ut))
        let peakMs = (peak.timeIntervalSince1970 * 1000).rounded()
        if peakMs < startMs || peakMs >= endMs { continue }

        // This is at least a partial solar eclipse for the observer.
        let eclipse = try buildSolarEclipse(shadow, observer)
        // Ignore any eclipse that happens completely at night.
        if !seesAnyOfIt(eclipse) { continue }
        found.append(eclipse)
        if firstOnly { break }
    }
    return found
}
