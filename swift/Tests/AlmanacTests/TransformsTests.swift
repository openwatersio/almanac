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

    struct StarRow: Decodable {
        let utc: String; let latitudeDeg: Double; let longitudeDeg: Double; let star: String
        let raDeg: Double; let decDeg: Double; let azDeg: Double; let altDeg: Double
    }

    // USNO celestial-navigation apparent alt/az (NOVAS) of the navigational
    // stars above the horizon at two sites, computed here from each star's
    // SIMBAD J2000 position. Same 1 arcmin / altDeg > 10° rule as the sun and
    // moon; derive.mjs keeps only stars whose proper motion stays under that
    // through 2050.
    func testStarsUsnoWithinOneArcmin() throws {
        let url = fixturesURL().appendingPathComponent("altaz").appendingPathComponent("stars-usno.json")
        let rows = try JSONDecoder().decode([StarRow].self, from: Data(contentsOf: url))
        XCTAssertGreaterThan(rows.count, 100)
        for row in rows where row.altDeg > 10 {
            let observer = try Observer(latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg, elevationM: 0)
            let p = try starAltAz(raDeg: row.raDeg, decDeg: row.decDeg, at: utc(row.utc), observer: observer)
            XCTAssertLessThan(abs(p.altDeg - row.altDeg) * 60, 1, "\(row.star) alt @ \(row.utc)")
            let cosAlt = cos(row.altDeg * Double.pi / 180)
            XCTAssertLessThan(abs(Self.azDiffDeg(p.azDeg, row.azDeg)) * cosAlt * 60, 1, "\(row.star) az @ \(row.utc)")
        }
    }

    func testStarAltAzRejectsPositionsOffTheSphere() {
        let t = utc("2026-03-20T06:00:00Z")
        for (ra, dec) in [(360.0, 0.0), (-1.0, 0.0), (0.0, 90.5), (Double.nan, 0.0)] {
            XCTAssertThrowsError(try starAltAz(raDeg: ra, decDeg: dec, at: t, observer: Self.victoria), "\(ra), \(dec)")
        }
    }
}
