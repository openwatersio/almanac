import XCTest
@testable import Almanac

/// Mirrors typescript/test/illumination.test.ts: coarse fixtures are
/// TT-labeled and drive the internal moonIlluminationAtTT entry point
/// directly (same pattern as PositionsTests); dense fixtures and the USNO
/// phase fixtures are UTC-labeled and exercise the public moonIllumination
/// API end to end.
final class IlluminationTests: XCTestCase {
    struct PosRow: Decodable {
        let utc: String?
        let tt: String?
        let illumFraction: Double?
    }

    struct PhaseRow: Decodable {
        let phase: String
        let utc: String
    }

    static func load(_ name: String) throws -> [PosRow] {
        let url = fixturesURL().appendingPathComponent("positions").appendingPathComponent(name)
        return try JSONDecoder().decode([PosRow].self, from: Data(contentsOf: url))
    }

    static func loadPhases() throws -> [PhaseRow] {
        let url = fixturesURL().appendingPathComponent("phases").appendingPathComponent("usno-phases.json")
        return try JSONDecoder().decode([PhaseRow].self, from: Data(contentsOf: url))
    }

    static func ttDaysOf(_ tt: String) -> Double {
        (utc(tt).timeIntervalSince1970 - utc("2000-01-01T12:00:00Z").timeIntervalSince1970) / 86400.0
    }

    // usno-phases.json timestamps are minute-precision ("...T04:39Z", no
    // seconds) — ISO8601DateFormatter's default options require seconds, so
    // pad them before parsing.
    static func usnoUtc(_ s: String) -> Date {
        utc(s.replacingOccurrences(of: "Z", with: ":00Z"))
    }

    func testMoonCoarseIllumFractionWithin001() throws {
        for row in try Self.load("moon-coarse.json") {
            let m = moonIlluminationAtTT(Self.ttDaysOf(row.tt!))
            XCTAssertLessThan(abs(m.fraction - row.illumFraction!), 0.01, "moon-coarse @ \(row.tt!)")
        }
    }

    func testMoonDenseIllumFractionWithin001() throws {
        for row in try Self.load("moon-dense.json") {
            let m = try moonIllumination(utc(row.utc!))
            XCTAssertLessThan(abs(m.fraction - row.illumFraction!), 0.01, "moon-dense @ \(row.utc!)")
        }
    }

    func testPhaseSelfConsistencyFullMoon() throws {
        let m = try moonIllumination(utc("2026-08-28T04:00:00Z"))
        XCTAssertGreaterThan(m.phase, 0.45)
        XCTAssertLessThan(m.phase, 0.55)
    }

    func testUsnoFirstQuarterPhaseWaxing() throws {
        let row = try Self.loadPhases().first { $0.phase == "firstQuarter" }!
        let m = try moonIllumination(Self.usnoUtc(row.utc))
        XCTAssertGreaterThan(m.phase, 0.23)
        XCTAssertLessThan(m.phase, 0.27)
        XCTAssertTrue(m.waxing)
    }

    func testUsnoLastQuarterPhaseNotWaxing() throws {
        let row = try Self.loadPhases().first { $0.phase == "lastQuarter" }!
        let m = try moonIllumination(Self.usnoUtc(row.utc))
        XCTAssertGreaterThan(m.phase, 0.73)
        XCTAssertLessThan(m.phase, 0.77)
        XCTAssertFalse(m.waxing)
    }
}
