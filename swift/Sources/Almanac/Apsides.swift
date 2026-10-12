import Foundation

// L3 lunar apsides: perigee and apogee, the zeros of the Moon's radial
// velocity, from the MOON2 distance the position layer already evaluates.
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts:
// `SearchLunarApsis` (~6534) — its central-difference `distance_slope`, its
// five-day scan, its sign-change classification, and the `Search` it hands
// each bracket to. Upstream scans forward from the caller's instant and
// `NextLunarApsis` (~6621) chains from the last result; here the five-day scan
// points are a fixed grid anchored at J2000, so every window that contains an
// apsis finds it from the same bracket and reports the same millisecond — the
// fixed-seed rule the eclipse searches follow. Apsides are at least 11.8 days
// apart, so a cell holds at most one.
//
// Mirrors typescript/src/apsides.ts function-for-function.

/// Closest approach or farthest remove of the Moon from the Earth's centre.
public enum MoonApsisKind: String, Sendable { case perigee, apogee }

/// A lunar perigee or apogee, with the Earth–Moon centre distance there.
public struct MoonApsis: Sendable { public let time: Date; public let kind: MoonApsisKind; public let distanceKm: Double }

/// UPSTREAM: the central-difference half-width `dt` inside `SearchLunarApsis`.
private let slopeDtDays = 0.001
/// UPSTREAM: `increment` — the scan step, here also the grid cell in days since J2000 UT.
private let apsisCellDays = 5.0

/// UPSTREAM: `distance_slope` — dr/dt in AU per day, by central difference.
private func distanceSlope(_ ut: Double) -> Double {
    let tt = ttDaysFromUt(ut)
    let r1 = calcMoon(tt - slopeDtDays / 2).distanceAu
    let r2 = calcMoon(tt + slopeDtDays / 2).distanceAu
    return (r2 - r1) / slopeDtDays
}

private func negativeDistanceSlope(_ ut: Double) -> Double {
    -distanceSlope(ut)
}

/**
 * UPSTREAM: the body of `SearchLunarApsis`'s scan loop for one cell `[t1, t2]`
 * with the slopes `m1`, `m2` at its ends. A slope rising through zero is a
 * perigee and falling through zero an apogee. A zero exactly at a grid point
 * belongs to the cell it ends, so no apsis is reported twice.
 */
private func searchApsisInCell(_ t1: Double, _ t2: Double, _ m1: Double, _ m2: Double) -> (ut: Double, kind: MoonApsisKind)? {
    if m1 < 0 && m2 >= 0 {
        let result = search(distanceSlope, t1, t2, 1, what: "perigee search")
        assertReached(result != nil, "perigee search")
        guard let ut = result else { return nil }
        return (ut, .perigee)
    }
    if m1 > 0 && m2 <= 0 {
        let result = search(negativeDistanceSlope, t1, t2, 1, what: "apogee search")
        assertReached(result != nil, "apogee search")
        guard let ut = result else { return nil }
        return (ut, .apogee)
    }
    return nil
}

/**
 * The Moon's perigees and apogees within the half-open window `[from, to)`,
 * sorted ascending, each with the geocentric distance at that instant.
 */
public func moonApsides(from startUtc: Date, to endUtc: Date) throws -> [MoonApsis] {
    let startUtc = try normalized(startUtc)
    let endUtc = try normalized(endUtc)
    try assertSupported(startUtc)
    try assertSupportedWindowEnd(endUtc)
    if startUtc >= endUtc { return [] }

    let startUt = utDays(startUtc)
    let endUt = utDays(endUtc)
    var events: [MoonApsis] = []

    var t1 = (startUt / apsisCellDays).rounded(.down) * apsisCellDays
    var m1 = distanceSlope(t1)
    while t1 < endUt {
        let t2 = t1 + apsisCellDays
        let m2 = distanceSlope(t2)
        if let found = searchApsisInCell(t1, t2, m1, m2) {
            let q = quantizedUt(found.ut)   // judge the half-open bounds on the reported instant, not the raw root
            if q >= endUt { break }
            if q >= startUt {
                events.append(MoonApsis(
                    time: try normalized(dateFromUt(found.ut)), kind: found.kind,
                    distanceKm: calcMoon(ttDaysFromUt(found.ut)).distanceAu * KM_PER_AU))
            }
        }
        t1 = t2
        m1 = m2
    }
    return events
}
