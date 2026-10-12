import XCTest
@testable import Almanac

final class EquationOfTimeTests: XCTestCase {
    struct Row: Codable { let utc: String; let minutes: Double }

    // Horizons' local apparent solar time at longitude 0 is UT plus the equation
    // of time; its frozen Delta-T in 2100 moves the result under a thousandth of
    // a minute. Measured worst: 0.99 s.
    static let eotTolMin = 2.0 / 60

    func testHorizonsEquationOfTimeWithin2s() throws {
        let url = fixturesURL().appendingPathComponent("equation-of-time").appendingPathComponent("horizons-eot.json")
        let rows = try JSONDecoder().decode([Row].self, from: Data(contentsOf: url))
        var worst = 0.0
        for row in rows {
            let diff = try equationOfTime(utc(row.utc)) - row.minutes
            worst = max(worst, abs(diff))
            XCTAssertLessThan(abs(diff), Self.eotTolMin, "equation of time @ \(row.utc)")
        }
        XCTAssertGreaterThan(worst, 0)
    }

    // Meeus, Astronomical Algorithms, example 28.a: 1992 October 13 at 0h TD, E = +13m42.6s.
    func testMeeusExample28a() {
        let tt = utc("1992-10-13T00:00:00Z").timeIntervalSince(utc("2000-01-01T12:00:00Z")) / 86400
        XCTAssertEqual(equationOfTimeAtTT(tt), 13 + 42.6 / 60, accuracy: 0.05)
    }

    func testOutOfRangeThrows() {
        XCTAssertThrowsError(try equationOfTime(utc("2101-01-01T00:00:00Z")))
    }
}
