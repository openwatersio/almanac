import XCTest
@testable import Almanac

final class TypesTests: XCTestCase {
    func testIntervalHalfOpen() throws {
        XCTAssertNoThrow(try assertSupported(supportedMin))
        XCTAssertNoThrow(try assertSupported(supportedMax.addingTimeInterval(-0.001)))
        XCTAssertThrowsError(try assertSupported(supportedMax)) { XCTAssertEqual($0 as? AlmanacError, .outOfRange) }
        XCTAssertThrowsError(try assertSupported(supportedMin.addingTimeInterval(-0.001)))
    }
    func testNonFiniteDateIsInvalidArgument() {
        XCTAssertThrowsError(try assertSupported(Date(timeIntervalSince1970: .nan))) {
            XCTAssertEqual($0 as? AlmanacError, .invalidArgument("non-finite Date"))
        }
    }
    func testNormalizedTruncatesTowardZero() throws {
        // positive sub-ms tail truncates down…
        XCTAssertEqual(try normalized(Date(timeIntervalSince1970: 1_000.000_123_9)).timeIntervalSince1970, 1_000.000, accuracy: 1e-9)
        // …negative sub-ms tail truncates UP (toward zero) — TimeClip, not floor
        XCTAssertEqual(try normalized(Date(timeIntervalSince1970: -1_000.000_123_9)).timeIntervalSince1970, -1_000.000, accuracy: 1e-9)
        // exact-ms idempotence
        XCTAssertEqual(try normalized(Date(timeIntervalSince1970: -0.5)).timeIntervalSince1970, -0.5, accuracy: 0)
    }
    func testWindowEndAcceptsSupportedMax() {
        XCTAssertNoThrow(try assertSupportedWindowEnd(supportedMax))
        XCTAssertThrowsError(try assertSupportedWindowEnd(supportedMax.addingTimeInterval(0.001)))
    }
    func testObserverValidation() {
        XCTAssertThrowsError(try Observer(latitudeDeg: 91, longitudeDeg: 0))
        XCTAssertThrowsError(try Observer(latitudeDeg: 0, longitudeDeg: 181))
        XCTAssertThrowsError(try Observer(latitudeDeg: 0, longitudeDeg: 0, elevationM: 10001))
        XCTAssertNoThrow(try Observer(latitudeDeg: 48.7621, longitudeDeg: -123.052))
    }
}
