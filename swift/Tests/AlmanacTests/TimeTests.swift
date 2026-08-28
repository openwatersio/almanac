import XCTest
@testable import Almanac

final class TimeTests: XCTestCase {
    func testJ2000() { XCTAssertEqual(julianDay(utc("2000-01-01T12:00:00Z")), 2451545.0, accuracy: 1e-9) }
    func test1950() { XCTAssertEqual(julianDay(utc("1950-01-01T00:00:00Z")), 2433282.5, accuracy: 1e-9) }
    func testDeltaT2000() { XCTAssertEqual(deltaTSeconds(decimalYear: 2000), 63.9, accuracy: 1.1) }
    func testDeltaT1955() { XCTAssertEqual(deltaTSeconds(decimalYear: 1955), 31.1, accuracy: 1.0) }
    func testDeltaT2050() { XCTAssertEqual(deltaTSeconds(decimalYear: 2050), 93.0, accuracy: 2.0) }
    func testTTMinusUT() {
        let d = utc("2026-08-28T00:00:00Z")
        XCTAssertEqual((ttDays(d) - utDays(d)) * 86400, deltaTSeconds(decimalYear: 2026.65), accuracy: 0.1)
    }
}
