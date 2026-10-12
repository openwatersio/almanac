import XCTest
@testable import Almanac

final class SeasonsTests: XCTestCase {
    struct SeasonRow: Codable { let kind: String; let utc: String }

    static let rows: [SeasonRow] = {
        let url = fixturesURL().appendingPathComponent("seasons").appendingPathComponent("usno-seasons.json")
        return try! JSONDecoder().decode([SeasonRow].self, from: Data(contentsOf: url))
    }()
    static func year(_ r: SeasonRow) -> Int { Int(r.utc.prefix(4))! }

    // Same quarantine as the moon phases: a season is a TT event reported in UT.
    static let deltaTQuarantineAfterYear = 2050
    static let deltaTMeanBoundSec = 120.0
    // USNO rounds to the minute, 30 s on its own, and the truncated VSOP87 Earth
    // series sits about 1.5 arcseconds, 35 s of solar motion, off the full theory
    // (see typescript/test/seasons.test.ts). Measured worst through 2050: 79 s.
    static let seasonTolSec = 90.0

    func testUsnoSeasonsThrough2050Within90s() throws {
        let expected = Self.rows.filter { Self.year($0) <= Self.deltaTQuarantineAfterYear }
        let found = try seasons(from: utc("1950-01-01T00:00:00Z"), to: utc("2051-01-01T00:00:00Z"))
        XCTAssertEqual(found.count, expected.count)
        var worst = 0.0
        for (mine, row) in zip(found, expected) {
            XCTAssertEqual(mine.kind.rawValue, row.kind, "kind @ \(row.utc)")
            let signed = mine.time.timeIntervalSince(usnoUtc(row.utc))
            worst = max(worst, abs(signed))
            XCTAssertLessThan(abs(signed), Self.seasonTolSec, "\(row.kind) @ \(row.utc)")
        }
        XCTAssertGreaterThan(worst, 0)
    }

    func testSeasonsAfter2050QuarantineDeltaT() throws {
        var checked = 0
        for year in (Self.deltaTQuarantineAfterYear + 1)...2100 {
            let run = Self.rows.filter { Self.year($0) == year }
            let mine = try seasons(from: utc("\(year)-01-01T00:00:00Z"), to: utc("\(year + 1)-01-01T00:00:00Z"))
            XCTAssertEqual(mine.count, run.count, "count for \(year)")
            let diffs = zip(mine, run).map { $0.time.timeIntervalSince(usnoUtc($1.utc)) }
            let mean = diffs.reduce(0, +) / Double(diffs.count)
            XCTAssertLessThan(abs(mean), Self.deltaTMeanBoundSec, "\(year): DeltaT projection offset")
            for (i, row) in run.enumerated() {
                XCTAssertEqual(mine[i].kind.rawValue, row.kind, "kind @ \(row.utc)")
                XCTAssertLessThan(abs(diffs[i] - mean), Self.seasonTolSec, "\(row.kind) @ \(row.utc): scatter")
            }
            checked += 1
        }
        XCTAssertEqual(checked, 2100 - Self.deltaTQuarantineAfterYear)
    }

    func testHalfOpenWindowSplitsAtASeason() throws {
        let equinox = try seasons(from: utc("2026-03-01T00:00:00Z"), to: utc("2026-04-01T00:00:00Z"))[0]
        XCTAssertEqual(equinox.kind, .marchEquinox)
        XCTAssertTrue(try seasons(from: utc("2026-03-01T00:00:00Z"), to: equinox.time).isEmpty)
        let fromIt = try seasons(from: equinox.time, to: utc("2026-04-01T00:00:00Z"))
        XCTAssertEqual(fromIt.count, 1)
        XCTAssertEqual(fromIt[0].time, equinox.time)
        let before = try seasons(from: utc("2026-01-01T00:00:00Z"), to: equinox.time)
        let after = try seasons(from: equinox.time, to: utc("2027-01-01T00:00:00Z"))
        XCTAssertEqual(before.count + after.count, 4)
    }

    func testEmptyReversedAndOutOfRangeWindows() throws {
        let t = utc("2026-06-01T00:00:00Z")
        XCTAssertTrue(try seasons(from: t, to: t).isEmpty)
        XCTAssertTrue(try seasons(from: t.addingTimeInterval(86400), to: t).isEmpty)
        XCTAssertThrowsError(try seasons(from: utc("1949-12-31T23:59:59Z"), to: t))
        XCTAssertThrowsError(try seasons(from: t, to: utc("2101-01-01T00:00:01Z")))
        XCTAssertThrowsError(try seasons(from: Date(timeIntervalSince1970: .nan), to: t))
        // Validation precedes the reversed-window short circuit.
        XCTAssertThrowsError(try seasons(from: utc("2101-01-02T00:00:00Z"), to: t))
    }

    func testFullSupportedWindowHolds604Seasons() throws {
        let all = try seasons(from: utc("1950-01-01T00:00:00Z"), to: utc("2101-01-01T00:00:00Z"))
        XCTAssertEqual(all.count, 604)
        for i in 1..<all.count {
            XCTAssertGreaterThan(all[i].time, all[i - 1].time)
            let ms = all[i].time.timeIntervalSince1970 * 1000
            XCTAssertEqual(ms, ms.rounded(), accuracy: 1e-3)
        }
    }
}
