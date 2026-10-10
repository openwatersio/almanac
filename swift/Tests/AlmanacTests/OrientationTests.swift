import XCTest
@testable import Almanac

/// Mirrors typescript/test/orientation.test.ts.
final class OrientationTests: XCTestCase {
    struct Row: Decodable {
        struct Site: Decodable { let latitudeDeg: Double; let longitudeDeg: Double }
        let utc: String; let observer: Site; let elongationDeg: Double; let brightLimbDeg: Double; let parallacticDeg: Double
    }
    static let solarParallaxArcmin = 8.794 / 60

    func signed180(_ deg: Double) -> Double {
        var x = deg.truncatingRemainder(dividingBy: 360)
        if x < 0 { x += 360 }
        return x > 180 ? x - 360 : x
    }

    func rows() throws -> [Row] {
        try JSONDecoder().decode([Row].self, from: Data(contentsOf: fixturesURL().appendingPathComponent("altaz/moon-orientation.json")))
    }

    func testHorizonsBrightLimb() throws {
        var worst = 0.0
        for row in try rows() {
            let o = try moonOrientation(at: utc(row.utc), observer: Observer(latitudeDeg: row.observer.latitudeDeg, longitudeDeg: row.observer.longitudeDeg))
            let limit = 1 + Self.solarParallaxArcmin / sin(row.elongationDeg * DEG2RAD)
            let arcmin = abs(signed180(o.brightLimbAngleDeg - row.brightLimbDeg)) * 60
            worst = max(worst, arcmin / limit)
            XCTAssertLessThan(arcmin, limit, "\(row.utc) lat \(row.observer.latitudeDeg)")
        }
        print("Horizons bright limb: worst \(String(format: "%.3f", worst)) of the limit")
    }

    func testHorizonsParallacticAngle() throws {
        var worst = 0.0
        for row in try rows() {
            let o = try moonOrientation(at: utc(row.utc), observer: Observer(latitudeDeg: row.observer.latitudeDeg, longitudeDeg: row.observer.longitudeDeg))
            let arcmin = abs(signed180(o.parallacticAngleDeg - row.parallacticDeg)) * 60
            worst = max(worst, arcmin)
            XCTAssertLessThan(arcmin, 1, "\(row.utc) lat \(row.observer.latitudeDeg)")
        }
        print("Horizons parallactic angle: worst \(String(format: "%.3f", worst))′")
    }

    func testParallacticAngleMatchesAzimuthTriangle() throws {
        for latitudeDeg in [-89.5, -60, -35, 0, 20, 48.4284, 70.5, 89.5] {
            let observer = try Observer(latitudeDeg: latitudeDeg, longitudeDeg: 31.3)
            let phi = latitudeDeg * DEG2RAD
            var t = utc("2026-03-01T00:00:00Z")
            while t < utc("2026-04-01T00:00:00Z") {
                let ut = utDays(t)
                let p = topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer)
                let a = p.azDeg * DEG2RAD, h = p.altDeg * DEG2RAD
                let sinDec = sin(phi) * sin(h) + cos(phi) * cos(h) * cos(a)
                let q = atan2(-sin(a) * cos(phi) * cos(h), sin(phi) - sinDec * sin(h)) * RAD2DEG
                let o = try moonOrientation(at: t, observer: observer)
                XCTAssertLessThan(abs(signed180(o.parallacticAngleDeg - q)), 1e-6, "lat \(latitudeDeg) @ \(t)")
                t = t.addingTimeInterval(3 * 3600)
            }
        }
    }

    func testRanges() throws {
        let observer = try Observer(latitudeDeg: -35, longitudeDeg: 150)
        var t = utc("2026-01-01T00:00:00Z")
        while t < utc("2027-01-01T00:00:00Z") {
            let o = try moonOrientation(at: t, observer: observer)
            XCTAssertTrue(o.brightLimbAngleDeg >= 0 && o.brightLimbAngleDeg < 360)
            XCTAssertTrue(o.parallacticAngleDeg > -180 && o.parallacticAngleDeg <= 180)
            t = t.addingTimeInterval(7 * 3600)
        }
    }

    func testValidation() throws {
        let observer = try Observer(latitudeDeg: 0, longitudeDeg: 0)
        XCTAssertThrowsError(try moonOrientation(at: Date(timeIntervalSince1970: .nan), observer: observer))
        XCTAssertThrowsError(try moonOrientation(at: utc("2101-01-01T00:00:00Z"), observer: observer)) { XCTAssertEqual($0 as? AlmanacError, .outOfRange) }
    }
}
