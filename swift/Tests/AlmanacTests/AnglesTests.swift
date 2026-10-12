import XCTest
import Almanac

final class AnglesTests: XCTestCase {
    func testSignedAnglesDoNotWrapFullTurns() throws {
        for (degrees, radians) in [(0.0, 0.0), (90, Double.pi / 2), (-180, -Double.pi), (720, 4 * Double.pi)] {
            XCTAssertEqual(try degreesToRadians(degrees), radians, accuracy: 1e-14)
            XCTAssertEqual(try radiansToDegrees(radians), degrees, accuracy: 1e-12)
        }
        XCTAssertEqual(try degreesToRadians(-0.0).sign, .minus)
        XCTAssertEqual(try radiansToDegrees(-0.0).sign, .minus)
    }

    func testNonFiniteAnglesAreValidationErrors() {
        for convert in [degreesToRadians, radiansToDegrees] {
            for value in [Double.nan, .infinity, -.infinity] {
                XCTAssertThrowsError(try convert(value)) { error in
                    guard case AlmanacError.invalidArgument = error else {
                        return XCTFail("Expected invalidArgument, got \(error)")
                    }
                }
            }
        }
    }
}
