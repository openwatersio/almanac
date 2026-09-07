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

    func testTimeClipPreservesIntegerMillisecondsAndTruncatesFractionalOnes() throws {
        for ms in [-607981402149.0, 352801962137.0, 1767225600123.0] {
            let at = Date(timeIntervalSince1970: ms / 1000)
            XCTAssertEqual(try normalized(at), at)
            for fraction in [-0.25, 0.25] {
                let raw = ms + fraction
                let clipped = try normalized(Date(timeIntervalSince1970: raw / 1000))
                XCTAssertEqual(clipped, Date(timeIntervalSince1970: raw.rounded(.towardZero) / 1000))
                XCTAssertEqual(try normalized(clipped), clipped)
            }
        }
    }
}
