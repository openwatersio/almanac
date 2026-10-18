// SearchPlanetApsis (Earth), pinned Astronomy Engine 865d3da7d8112bbc7911238052c6af4aaf877181.
// Central difference in UT, orbital-period/6 brackets; fixed J2000 grid gives window-independent roots.
import Foundation

/// Closest approach or farthest remove of the Earth from the Sun's centre.
public enum EarthApsisKind: String, Sendable { case perihelion, aphelion }

/// A terrestrial perihelion or aphelion, with the Sun–Earth centre distance there.
public struct EarthApsis: Sendable { public let time: Date; public let kind: EarthApsisKind; public let distanceKm: Double }

/// UPSTREAM: the central-difference half-width `dt` inside `SearchPlanetApsis`.
private let slopeDtDays = 0.001
/// UPSTREAM: `increment` — the scan step, here also the grid cell in days since J2000 UT.
private let apsisCellDays = 365.256 / 6.0

/// UPSTREAM: `positive_slope` — dr/dt in AU per day, by central difference.
private func distanceSlope(_ ut: Double) -> Double {
    let r1 = earthHelioDistance(ttDaysFromUt(ut - slopeDtDays / 2))
    let r2 = earthHelioDistance(ttDaysFromUt(ut + slopeDtDays / 2))
    return (r2 - r1) / slopeDtDays
}

private func negativeDistanceSlope(_ ut: Double) -> Double {
    -distanceSlope(ut)
}

/**
 * UPSTREAM: the body of `SearchPlanetApsis`'s scan loop for one cell `[t1, t2]`
 * with the slopes `m1`, `m2` at its ends. A slope rising through zero is a
 * perihelion and falling through zero an aphelion. A zero exactly at a grid point
 * belongs to the cell it ends, so no apsis is reported twice.
 */
private func searchApsisInCell(_ t1: Double, _ t2: Double, _ m1: Double, _ m2: Double) -> (ut: Double, kind: EarthApsisKind)? {
    if m1 < 0 && m2 >= 0 {
        let result = search(distanceSlope, t1, t2, 1, what: "perihelion search")
        assertReached(result != nil, "perihelion search")
        guard let ut = result else { return nil }
        return (ut, .perihelion)
    }
    if m1 > 0 && m2 <= 0 {
        let result = search(negativeDistanceSlope, t1, t2, 1, what: "aphelion search")
        assertReached(result != nil, "aphelion search")
        guard let ut = result else { return nil }
        return (ut, .aphelion)
    }
    return nil
}

/**
 * The Earth's perihelia and aphelia within the half-open window `[from, to)`,
 * sorted ascending, each with the heliocentric distance at that instant.
 */
public func earthApsides(from startUtc: Date, to endUtc: Date) throws -> [EarthApsis] {
    let startUtc = try normalized(startUtc)
    let endUtc = try normalized(endUtc)
    try assertSupported(startUtc)
    try assertSupportedWindowEnd(endUtc)
    if startUtc >= endUtc { return [] }

    let startUt = utDays(startUtc)
    let endUt = utDays(endUtc)
    var events: [EarthApsis] = []

    var cell = (startUt / apsisCellDays).rounded(.down)
    var t1 = cell * apsisCellDays
    var m1 = distanceSlope(t1)
    while t1 < endUt {
        let t2 = (cell + 1) * apsisCellDays
        let m2 = distanceSlope(t2)
        if let found = searchApsisInCell(t1, t2, m1, m2) {
            let q = quantizedUt(found.ut)   // judge the half-open bounds on the reported instant, not the raw root
            if q >= endUt { break }
            if q >= startUt {
                events.append(EarthApsis(
                    time: try normalized(dateFromUt(found.ut)), kind: found.kind,
                    distanceKm: earthHelioDistance(ttDaysFromUt(found.ut)) * KM_PER_AU))
            }
        }
        cell += 1
        t1 = t2
        m1 = m2
    }
    return events
}
