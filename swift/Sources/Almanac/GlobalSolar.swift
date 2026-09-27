import Foundation

// L3 solar eclipses anywhere on Earth: the Moon's shadow cone against the
// Earth's center at every new moon — greatest eclipse, how far the shadow
// axis passes from the center then, and where the axis meets the ground, with
// the kind and covered fraction a person standing there sees.
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts:
//   EARTH_MEAN_RADIUS_KM (142), MoonShadow (~8481), PeakMoonShadow (~8564),
//   GeoidIntersect (~8842) and SearchGlobalSolarEclipse (~8975).
// Constants and operation order are preserved so this stays a line-for-line
// translation of typescript/src/globalSolar.ts.
//
// Four deliberate departures from upstream, all spec-driven:
//   - the new-moon probe is this package's `searchMoonPhase`, whose longitudes
//     are apparent rather than upstream's geometric (see Events.swift). It
//     only seeds a ±0.03 d peak search, so the ~40 s difference cannot change
//     a result.
//   - previous and range searches, the fixed whole-UT-day new-moon seed and
//     the 100 ms same-eclipse band come from the lunar port (Eclipse.swift);
//     upstream searches forward only.
//   - no twelve-new-moon scan limit: next/previous walk new moons to the
//     supported boundary, as the local search does (Solar.swift).
//   - upstream's `Rotation_EQJ_EQD` matrix and its inverse are `gyration` in
//     each direction: the same precession and nutation, applied as two
//     rotations rather than one combined matrix.

/// A solar eclipse as the whole Earth sees it: greatest eclipse, and where the Moon's shadow axis meets the ground then.
public struct GlobalSolarEclipse: Sendable {
    /// Kind at the point where the shadow axis meets the ground; `partial` when the axis misses the Earth.
    public let kind: SolarEclipseKind
    /// Greatest eclipse: the instant the Moon's shadow axis passes closest to the Earth's center.
    public let peak: Date
    /// Distance from the shadow axis to the Earth's center at the peak, km.
    public let axisDistanceKm: Double
    /// Geodetic latitude where the axis meets the ground at the peak, degrees; `nil` for a partial eclipse.
    public let latitudeDeg: Double?
    /// Longitude where the axis meets the ground at the peak, degrees east in (−180, 180]; `nil` for a partial eclipse.
    public let longitudeDeg: Double?
    /// Fraction of the Sun's disc area covered at that point; exactly 1 for a total eclipse; `nil` for a partial eclipse.
    public let obscuration: Double?

    public init(
        kind: SolarEclipseKind, peak: Date, axisDistanceKm: Double,
        latitudeDeg: Double?, longitudeDeg: Double?, obscuration: Double?
    ) {
        self.kind = kind; self.peak = peak; self.axisDistanceKm = axisDistanceKm
        self.latitudeDeg = latitudeDeg; self.longitudeDeg = longitudeDeg; self.obscuration = obscuration
    }
}

/**
 * UPSTREAM: `EARTH_MEAN_RADIUS_KM`, astronomy.ts 142 — the geoid's mean
 * radius. A new moon is an eclipse when the Moon's penumbra reaches this
 * sphere. The lunar port's `earthEclipseRadiusKm` (Eclipse.swift) is a
 * different constant: it adds 88 km of atmosphere for the Earth's own shadow.
 */
private let earthMeanRadiusKm = 6371.0

/** Upstream's `PeakMoonShadow` window, in days, either side of the new moon. */
private let peakWindowDays = 0.03

/**
 * UPSTREAM: `MoonShadow`, astronomy.ts ~8481 — the Moon's shadow cone
 * evaluated at the Earth's center: the lunacentric Earth measured against the
 * heliocentric Moon. Both vectors are EQJ, and `calcShadow` only ever takes
 * dot products and norms of them, so the frame cancels.
 */
private func moonShadow(_ ut: Double) -> ShadowInfo {
    let tt = ttDaysFromUt(ut)
    // Light-travel and aberration corrected Sun.
    let s = sunGeoVectorEqj(tt)
    // Geocentric Moon.
    let m = moonGeoVectorEqj(tt)
    // Lunacentric Earth.
    let e = Vec3(x: -m.x, y: -m.y, z: -m.z)
    // Convert geocentric moon to heliocentric Moon.
    let hm = Vec3(x: m.x - s.x, y: m.y - s.y, z: m.z - s.z)
    return calcShadow(moonMeanRadiusKm, ut, e, hm)
}

/** UPSTREAM: `ShadowDistanceSlope`, astronomy.ts ~8535, bound to `MoonShadow`. */
private func moonShadowSlope(_ ut: Double) -> Double {
    let dt = 1.0 / 86400.0
    return (moonShadow(ut + dt).r - moonShadow(ut - dt).r) / dt
}

/**
 * UPSTREAM: `PeakMoonShadow`, astronomy.ts ~8564 — greatest eclipse: the time
 * near the new moon when the Moon's shadow axis passes closest to the Earth's
 * center, i.e. the ascending zero of the axis distance's time derivative.
 */
private func peakMoonShadow(_ centerUt: Double) -> ShadowInfo {
    // Use the same new-moon seed regardless of search direction or window.
    // Otherwise a ~1 ms root shift can lose/duplicate a peak when a caller
    // splits a range at a previously returned peak. Only unpruned moons pay
    // for this second phase search; its start is a fixed whole UT day.
    guard let newmoon = searchMoonPhase(0, floor(centerUt) - 1, 4) else {
        fatalError("almanac internal: cannot refine new moon")
    }
    guard let ut = search(
        moonShadowSlope, newmoon - peakWindowDays, newmoon + peakWindowDays,
        shadowTolSeconds, iterLimit: shadowIterCap, what: "peak moon shadow"
    ) else {
        fatalError("almanac internal: failed to find peak Moon shadow time")
    }
    return moonShadow(ut)
}

/**
 * UPSTREAM: `GeoidIntersect`, astronomy.ts ~8842 — where the shadow axis at
 * greatest eclipse meets the Earth's oblate geoid, and the kind and covered
 * fraction a person standing there sees. An axis that misses the geoid is a
 * partial eclipse with no ground point.
 */
private func geoidIntersect(_ shadow: ShadowInfo, _ peak: Date) -> GlobalSolarEclipse {
    var kind: SolarEclipseKind = .partial
    var latitudeDeg: Double? = nil      // left nil for partial eclipses
    var longitudeDeg: Double? = nil     // left nil for partial eclipses
    var obscuration: Double? = nil      // left nil for partial eclipses

    // We want to calculate the intersection of the shadow axis with the Earth's geoid.
    // First we must convert EQJ (equator of J2000) coordinates to EQD (equator of date)
    // coordinates that are perfectly aligned with the Earth's equator at this
    // moment in time.
    let tt = ttDaysFromUt(shadow.ut)
    let vd = gyration(shadow.dir, tt, .from2000)       // shadow-axis vector in equator-of-date coordinates
    let ed = gyration(shadow.target, tt, .from2000)    // lunacentric Earth in equator-of-date coordinates

    // Convert all distances from AU to km.
    // But dilate the z-coordinates so that the Earth becomes a perfect sphere.
    // Then find the intersection of the vector with the sphere.
    // See p 184 in Montenbruck & Pfleger's "Astronomy on the Personal Computer", second edition.
    let v = Vec3(x: vd.x * KM_PER_AU, y: vd.y * KM_PER_AU, z: vd.z * (KM_PER_AU / EARTH_FLATTENING))
    let e = Vec3(x: ed.x * KM_PER_AU, y: ed.y * KM_PER_AU, z: ed.z * (KM_PER_AU / EARTH_FLATTENING))

    // Solve the quadratic equation that finds whether and where
    // the shadow axis intersects with the Earth in the dilated coordinate system.
    let R = EARTH_EQUATORIAL_RADIUS_KM
    let A = v.x*v.x + v.y*v.y + v.z*v.z
    let B = -2.0 * (v.x*e.x + v.y*e.y + v.z*e.z)
    let C = (e.x*e.x + e.y*e.y + e.z*e.z) - R*R
    let radic = B*B - 4*A*C

    if radic > 0.0 {
        // Calculate the closer of the two intersection points.
        // This will be on the day side of the Earth.
        let u = (-B - radic.squareRoot()) / (2 * A)

        // Convert lunacentric dilated coordinates to geocentric coordinates.
        let px = u*v.x - e.x
        let py = u*v.y - e.y
        let pz = (u*v.z - e.z) * EARTH_FLATTENING

        // Convert cartesian coordinates into geodetic latitude/longitude.
        let proj = (px*px + py*py).squareRoot() * EARTH_FLATTENING_SQUARED
        if proj == 0.0 {
            latitudeDeg = (pz > 0.0) ? +90.0 : -90.0
        } else {
            latitudeDeg = RAD2DEG * atan(pz / proj)
        }

        // Adjust longitude for Earth's rotation at the given UT. `siderealDeg`
        // is upstream's `15 * sidereal_time`, already in degrees.
        var lon = (RAD2DEG*atan2(py, px) - siderealDeg(shadow.ut)).truncatingRemainder(dividingBy: 360.0)
        if lon <= -180.0 {
            lon += 360.0
        } else if lon > +180.0 {
            lon -= 360.0
        }
        longitudeDeg = lon

        // We want to determine whether the observer sees a total eclipse or an annular eclipse.
        // Put the EQD geocentric coordinates of the observer back into AU, and
        // rotate them back to the EQJ system.
        let og = gyration(Vec3(x: px / KM_PER_AU, y: py / KM_PER_AU, z: pz / KM_PER_AU), tt, .into2000)

        // Convert geocentric vector to lunacentric vector.
        let o = Vec3(x: og.x + shadow.target.x, y: og.y + shadow.target.y, z: og.z + shadow.target.z)

        // Recalculate the shadow using a vector from the Moon's center toward the observer.
        let surface = calcShadow(moonPolarRadiusKm, shadow.ut, o, shadow.dir)

        // If we did everything right, the shadow distance should be very close to zero.
        // That's because we already determined the observer 'o' is on the shadow axis!
        // Upstream's bound is 1e-9 km; exceeding it is an implementation failure.
        if surface.r > 1.0e-9 || surface.r < 0.0 {
            fatalError("almanac internal: unexpected shadow distance from geoid intersection = \(surface.r)")
        }

        kind = eclipseKindFromUmbra(surface.k)
        obscuration = (kind == .total) ? 1.0 : solarEclipseObscuration(shadow.dir, o)
    }
    // Otherwise this is a partial solar eclipse, and an obscuration needs a
    // place: `solarEclipses` and `solarObscuration` take an observer.

    return GlobalSolarEclipse(
        kind: kind, peak: peak, axisDistanceKm: shadow.r,
        latitudeDeg: latitudeDeg, longitudeDeg: longitudeDeg, obscuration: obscuration
    )
}

/**
 * The first solar eclipse anywhere on Earth whose greatest eclipse falls
 * strictly after `after`.
 *
 * Every new moon up to the end of the supported interval is tested: the
 * Moon's ecliptic latitude prunes the ones no shadow can reach, and the rest
 * get a peak-shadow search against the Earth's center. A new moon is an
 * eclipse when the Moon's penumbra reaches the Earth.
 *
 * - Throws: `AlmanacError.invalidArgument` if `after` is non-finite,
 *   `AlmanacError.outOfRange` if `after` is outside the supported interval or
 *   no eclipse remains before the end of it.
 */
public func nextGlobalSolarEclipse(after: Date) throws -> GlobalSolarEclipse {
    try nearestGlobalSolarEclipse(after, 1)
}

/**
 * The last solar eclipse anywhere on Earth whose greatest eclipse falls
 * strictly before `before`, skipping peaks within 100 ms of it, just as
 * `nextGlobalSolarEclipse` does on the other side.
 *
 * - Throws: `AlmanacError.invalidArgument` if `before` is non-finite,
 *   `AlmanacError.outOfRange` if `before` is outside the supported interval or
 *   no eclipse remains after the start of it.
 */
public func previousGlobalSolarEclipse(before: Date) throws -> GlobalSolarEclipse {
    try nearestGlobalSolarEclipse(before, -1)
}

/// Solar eclipses anywhere on Earth with greatest eclipse in `[from, to)`, sorted ascending.
public func globalSolarEclipses(from startUtc: Date, to endUtc: Date) throws -> [GlobalSolarEclipse] {
    let startUtc = try normalized(startUtc)
    let endUtc = try normalized(endUtc)
    try assertSupported(startUtc)
    try assertSupportedWindowEnd(endUtc)
    return try scanGlobalSolarEclipses((startUtc.timeIntervalSince1970 * 1000).rounded(), (endUtc.timeIntervalSince1970 * 1000).rounded(), 1, firstOnly: false)
}

private func nearestGlobalSolarEclipse(_ anchor: Date, _ direction: Double) throws -> GlobalSolarEclipse {
    let anchor = try normalized(anchor)
    try assertSupported(anchor)
    let ms = (anchor.timeIntervalSince1970 * 1000).rounded()
    let minMs = supportedMin.timeIntervalSince1970 * 1000
    let maxMs = supportedMax.timeIntervalSince1970 * 1000
    // No scan limit: walk to the supported boundary, as the local search does.
    // At least two solar eclipses happen every year, so only the last and
    // first few months of the interval walk far, and a pruned new moon is cheap.
    let startMs = direction > 0 ? ms + sameEclipseMs + 1 : minMs
    let endMs = direction > 0 ? maxMs : ms - sameEclipseMs
    let found = try scanGlobalSolarEclipses(startMs, endMs, direction, firstOnly: true)
    if let first = found.first { return first }
    throw AlmanacError.outOfRange
}

private func scanGlobalSolarEclipses(_ startMs: Double, _ endMs: Double, _ direction: Double, firstOnly: Bool) throws -> [GlobalSolarEclipse] {
    var found: [GlobalSolarEclipse] = []
    if startMs >= endMs { return found }
    // Peak and new moon differ by up to the peak window. Include the entire
    // margin at both ends, then apply the caller's bounds to the reported peak.
    let startUt = utDays(Date(timeIntervalSince1970: startMs / 1000)) - peakWindowDays
    let endUt = utDays(Date(timeIntervalSince1970: endMs / 1000)) + peakWindowDays
    var nmUt = direction > 0 ? startUt : endUt
    let limitUt = direction > 0 ? endUt : startUt

    while direction * (limitUt - nmUt) > 0 {
        guard let newmoon = searchMoonPhase(0, nmUt, direction * min(40, abs(limitUt - nmUt))) else { break }
        // UPSTREAM `SearchGlobalSolarEclipse`: step past this new moon before
        // the next probe, so the same one cannot be found twice.
        nmUt = newmoon + direction * 10

        // Pruning: if the new moon's ecliptic latitude is too large, a solar
        // eclipse is not possible.
        if abs(moonEclipticLatitudeDeg(newmoon)) >= pruneLatitudeDeg { continue }

        // Search near the new moon for the time when the center of the Earth
        // is closest to the line passing through the centers of the Sun and Moon.
        let shadow = peakMoonShadow(newmoon)
        if shadow.r >= shadow.p + earthMeanRadiusKm { continue }   // the penumbra misses the Earth
        let peak = try normalized(dateFromUt(shadow.ut))
        let peakMs = (peak.timeIntervalSince1970 * 1000).rounded()
        if peakMs < startMs || peakMs >= endMs { continue }

        // This is at least a partial solar eclipse visible somewhere on Earth.
        // Try to find an intersection between the shadow axis and the Earth's oblate geoid.
        found.append(geoidIntersect(shadow, peak))
        if firstOnly { break }
    }
    return found
}
