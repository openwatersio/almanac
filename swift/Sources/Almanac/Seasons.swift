import Foundation

// L3 season search: the four instants a year when the Sun's apparent
// geocentric ecliptic longitude reaches 0°, 90°, 180° and 270°.
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts:
// `SearchSunLongitude` (~4787), whose `sun_offset` and 0.01 s `Search` are
// kept. Upstream's `Seasons(year)` (~6130) brackets each search from a fixed
// calendar date. Here the bracket is a cell of a fixed 80-day grid anchored at
// J2000, so every window that contains a season finds it from the same bracket
// and reports the same millisecond — the fixed-seed rule the eclipse searches
// follow. A cell spans under 90° of solar longitude, so it holds at most one
// quarter crossing.
//
// Mirrors typescript/src/seasons.ts function-for-function.

/// The season the Sun's longitude starts: 0° March equinox, 90° June solstice, 180° September equinox, 270° December solstice.
public enum SeasonKind: String, CaseIterable, Sendable { case marchEquinox, juneSolstice, septemberEquinox, decemberSolstice }

/// An equinox or solstice.
public struct SeasonEvent: Sendable { public let time: Date; public let kind: SeasonKind }

private let seasonKinds: [SeasonKind] = [.marchEquinox, .juneSolstice, .septemberEquinox, .decemberSolstice]
/// Grid cell, in days since J2000 UT: under the 89-day shortest season, so a cell holds at most one crossing.
private let seasonCellDays = 80.0

private func sunLonDeg(_ ut: Double) -> Double {
    sunEclipticLonDeg(ttDaysFromUt(ut))
}

/**
 * UPSTREAM: `SearchSunLongitude` on one grid cell `[t1, t2]`, with
 * `lon1 = sunLonDeg(t1)` already in hand. Returns the crossing of the next
 * multiple of 90° after `lon1`, or nil when the cell ends before it.
 */
private func searchSeasonInCell(_ t1: Double, _ t2: Double, _ lon1: Double) -> (ut: Double, quarter: Int)? {
    let quarter = (Int((lon1 / 90).rounded(.down)) + 1) % 4
    let targetLonDeg = 90 * Double(quarter)
    let sunOffset: (Double) -> Double = { ut in angleOffset(sunLonDeg(ut) - targetLonDeg) }
    if sunOffset(t2) < 0 { return nil }
    let result = search(sunOffset, t1, t2, 0.01, what: "season search")
    assertReached(result != nil, "season search")
    guard let ut = result else { return nil }
    return (ut, quarter)
}

/**
 * The equinoxes and solstices within the half-open window `[from, to)`,
 * sorted ascending.
 *
 * A season starts the instant the Sun's apparent geocentric ecliptic longitude
 * reaches 0° (March equinox), 90° (June solstice), 180° (September equinox) or
 * 270° (December solstice). The names are months, not seasons, because the
 * same instant starts opposite seasons in the two hemispheres.
 */
public func seasons(from startUtc: Date, to endUtc: Date) throws -> [SeasonEvent] {
    let startUtc = try normalized(startUtc)
    let endUtc = try normalized(endUtc)
    try assertSupported(startUtc)
    try assertSupportedWindowEnd(endUtc)
    if startUtc >= endUtc { return [] }

    let startUt = utDays(startUtc)
    let endUt = utDays(endUtc)
    var events: [SeasonEvent] = []

    var t1 = (startUt / seasonCellDays).rounded(.down) * seasonCellDays
    var lon1 = sunLonDeg(t1)
    while t1 < endUt {
        let t2 = t1 + seasonCellDays
        if let found = searchSeasonInCell(t1, t2, lon1) {
            let q = quantizedUt(found.ut)   // judge the half-open bounds on the reported instant, not the raw root
            if q >= endUt { break }
            if q >= startUt {
                events.append(SeasonEvent(time: try normalized(dateFromUt(found.ut)), kind: seasonKinds[found.quarter]))
            }
        }
        t1 = t2
        lon1 = sunLonDeg(t1)
    }
    return events
}
