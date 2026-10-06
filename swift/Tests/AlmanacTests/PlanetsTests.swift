import XCTest
@testable import Almanac

final class PlanetsTests: XCTestCase {
    struct HelioRow: Decodable { let planet: String; let tt: String; let xAu: Double; let yAu: Double; let zAu: Double }
    struct PositionRow: Decodable { let planet: String; let tt: String; let raDeg: Double; let decDeg: Double; let distanceAu: Double }
    struct Site: Decodable { let latitudeDeg: Double; let longitudeDeg: Double }
    struct HorizontalRow: Decodable { let planet: String; let utc: String; let mode: String; let observer: Site; let azDeg: Double; let altDeg: Double }
    static func load<T: Decodable>(_ type: T.Type, _ name: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(contentsOf: fixturesURL().appendingPathComponent("planets/\(name).json")))
    }
    static let skyPlanets = Planet.allCases.filter { $0 != .earth }

    func testHeliocentricVectorsAgainstJPL() throws {
        let rows = try Self.load([HelioRow].self, "heliocentric")
        for planet in Planet.allCases {
            let samples = rows.filter { $0.planet == planet.rawValue }
            XCTAssertEqual(samples.first?.tt, "1950-01-01T00:00:00Z")
            XCTAssertEqual(samples.last?.tt, "2100-12-31T23:59:59Z")
            for row in samples {
                let p = planetHelioVector(planet, PositionsTests.ttDaysOf(row.tt))
                XCTAssertLessThan(hypot(hypot(p.x-row.xAu, p.y-row.yAu), p.z-row.zAu), 1e-3, "\(planet) @ \(row.tt)")
            }
        }
    }

    func testApparentPositionsAgainstJPL() throws {
        let rows = try Self.load([PositionRow].self, "positions")
        for planet in Self.skyPlanets {
            let samples = rows.filter { $0.planet == planet.rawValue }
            XCTAssertTrue(samples.contains { $0.raDeg < 1 || $0.raDeg > 359 })
            for row in samples {
                let p = planetApparentAtTT(planet, PositionsTests.ttDaysOf(row.tt))
                XCTAssertLessThan(PositionsTests.sep(p.raDeg, p.decDeg, row.raDeg, row.decDeg), 1, "\(planet) @ \(row.tt)")
                XCTAssertLessThan(abs(p.distanceAu-row.distanceAu), 1e-3, "\(planet) @ \(row.tt)")
                XCTAssertGreaterThanOrEqual(p.raDeg, 0); XCTAssertLessThan(p.raDeg, 360)
                XCTAssertLessThanOrEqual(abs(p.decDeg), 90)
            }
        }
    }

    func testHorizontalTracksAgainstJPL() throws {
        for row in try Self.load([HorizontalRow].self, "altaz") {
            if row.mode == "refracted" && row.altDeg <= 10 { continue }
            let planet = Planet(rawValue: row.planet)!, time = utc(row.utc)
            let observer = try Observer(latitudeDeg: row.observer.latitudeDeg, longitudeDeg: row.observer.longitudeDeg)
            let actual: AltAz
            if row.mode == "airless" {
                let ut = utDays(time)
                let p = topoAltAzUnrefracted(planetGeoVectorEqj(planet, ttDaysFromUt(ut)), ut, observer)
                actual = AltAz(azDeg: p.azDeg, altDeg: p.altDeg)
            } else { actual = try planetAltAz(planet, at: time, observer: observer) }
            XCTAssertLessThan(abs(actual.altDeg-row.altDeg)*60, 1, "\(planet) \(row.mode) @ \(row.utc)")
            let azDiff = (actual.azDeg-row.azDeg+540).truncatingRemainder(dividingBy: 360)-180
            XCTAssertLessThan(abs(azDiff)*cos(row.altDeg*Double.pi/180)*60, 1)
        }
    }

    func testEarthValidationAndTimeClip() throws {
        let observer = try Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656)
        for time in [supportedMin, Date(timeIntervalSince1970: -1.2349), utcMs("2100-12-31T23:59:59.999Z")] {
            let earth = earthHelioVector(ttDays(try normalized(time)))
            let p = try planetHeliocentricPosition(.earth, at: time)
            XCTAssertEqual(p.xAu, earth.x); XCTAssertEqual(p.yAu, earth.y); XCTAssertEqual(p.zAu, earth.z)
            for planet in Self.skyPlanets {
                XCTAssertTrue(try planetPosition(planet, at: time).raDeg.isFinite)
                XCTAssertTrue(try planetAltAz(planet, at: time, observer: observer).altDeg.isFinite)
            }
        }
        XCTAssertNil(Planet(rawValue: "pluto"))
        XCTAssertThrowsError(try planetPosition(.earth, at: Date()))
        XCTAssertThrowsError(try planetAltAz(.earth, at: Date(), observer: observer))
        for time in [Date(timeIntervalSince1970: .nan), supportedMin.addingTimeInterval(-1), supportedMax] {
            XCTAssertThrowsError(try planetHeliocentricPosition(.earth, at: time))
            XCTAssertThrowsError(try planetPosition(.venus, at: time))
            XCTAssertThrowsError(try planetAltAz(.venus, at: time, observer: observer))
        }
        for ms in [-1234.9, -0.9, 0.9, 1234.9] {
            let raw = Date(timeIntervalSince1970: ms/1000), clipped = Date(timeIntervalSince1970: ms.rounded(.towardZero)/1000)
            for planet in Planet.allCases {
                let a = try planetHeliocentricPosition(planet, at: raw), b = try planetHeliocentricPosition(planet, at: clipped)
                XCTAssertEqual(a.xAu, b.xAu); XCTAssertEqual(a.yAu, b.yAu); XCTAssertEqual(a.zAu, b.zAu)
                if planet == .earth { continue }
                let posA = try planetPosition(planet, at: raw), posB = try planetPosition(planet, at: clipped)
                XCTAssertEqual(posA.raDeg, posB.raDeg); XCTAssertEqual(posA.decDeg, posB.decDeg); XCTAssertEqual(posA.distanceAu, posB.distanceAu)
                let altA = try planetAltAz(planet, at: raw, observer: observer), altB = try planetAltAz(planet, at: clipped, observer: observer)
                XCTAssertEqual(altA.azDeg, altB.azDeg); XCTAssertEqual(altA.altDeg, altB.altDeg)
            }
        }
    }
}
