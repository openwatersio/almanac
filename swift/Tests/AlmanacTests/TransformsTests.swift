import XCTest
@testable import Almanac

/// Mirrors typescript/test/transforms.test.ts exactly — same fixtures, same
/// anchors, same tolerances.
final class TransformsTests: XCTestCase {
    struct AltAzRow: Decodable { let utc: String; let azDeg: Double; let altDeg: Double }

    // fixtures/altaz/meta.json SITE_COORD: -123.3656,48.4284,0 (Victoria BC).
    static let victoria = try! Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 0)

    // Signed azimuth difference in [-180, 180] — az wraps at 0/360, a naive
    // subtraction would spuriously fail near that boundary.
    static func azDiffDeg(_ a: Double, _ b: Double) -> Double {
        (((a - b + 540).truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360) - 180
    }

    static func load(_ name: String) throws -> [AltAzRow] {
        let url = fixturesURL().appendingPathComponent("altaz").appendingPathComponent(name)
        return try JSONDecoder().decode([AltAzRow].self, from: Data(contentsOf: url))
    }

    func testRefractionAtHorizon() {
        XCTAssertGreaterThan(refractionDeg(0) * 60, 28) // Bennett-model ballpark, upstream 'normal'
    }

    func testSiderealGmstAtJ2000() {
        XCTAssertLessThan(abs(siderealDeg(0) - 280.4606), 0.01)
    }

    // Horizons REFRACTED apparent az/el at Victoria BC. Only altDeg > 10° rows
    // are asserted: refraction models diverge near the horizon (plan rule).
    func testSunVictoriaWithinOneArcmin() throws {
        for row in try Self.load("sun-victoria-2026-03.json") where row.altDeg > 10 {
            let p = try sunAltAz(utc(row.utc), observer: Self.victoria)
            XCTAssertLessThan(abs(p.altDeg - row.altDeg) * 60, 1, "sun alt @ \(row.utc)")
            let cosAlt = cos(row.altDeg * Double.pi / 180)
            XCTAssertLessThan(abs(Self.azDiffDeg(p.azDeg, row.azDeg)) * cosAlt * 60, 1, "sun az @ \(row.utc)")
        }
    }

    func testMoonVictoriaWithinOneArcmin() throws {
        for row in try Self.load("moon-victoria-2026-03.json") where row.altDeg > 10 {
            let p = try moonAltAz(utc(row.utc), observer: Self.victoria)
            XCTAssertLessThan(abs(p.altDeg - row.altDeg) * 60, 1, "moon alt @ \(row.utc)")
            let cosAlt = cos(row.altDeg * Double.pi / 180)
            XCTAssertLessThan(abs(Self.azDiffDeg(p.azDeg, row.azDeg)) * cosAlt * 60, 1, "moon az @ \(row.utc)")
        }
    }
}
