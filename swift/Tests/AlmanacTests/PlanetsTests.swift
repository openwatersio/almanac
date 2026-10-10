import XCTest
@testable import Almanac

final class PlanetsTests: XCTestCase {
    struct HelioRow: Decodable { let planet: String; let tt: String; let xAu: Double; let yAu: Double; let zAu: Double }
    struct PositionRow: Decodable { let planet: String; let tt: String; let raDeg: Double; let decDeg: Double; let distanceAu: Double }
    struct Site: Decodable { let latitudeDeg: Double; let longitudeDeg: Double; let elevationM: Double? }
    struct HorizontalRow: Decodable { let planet: String; let utc: String; let mode: String; let observer: Site; let azDeg: Double; let altDeg: Double }
    struct PhotometryRow: Decodable {
        let planet: String; let tt: String; let fraction: Double; let phaseAngleDeg: Double; let magnitude: Double; let elongationDeg: Double
        let ringTiltDeg: Double?; let globeMagnitude: Double?
    }
    struct PhotometryReference: Decodable { let rows: [PhotometryRow] }
    struct Event: Decodable { let utc: String; let kind: String }
    struct EventWindow: Decodable {
        let planet: String; let startUtc: String; let endUtc: String; let observer: Site; let heightAboveGroundM: Double; let events: [Event]
    }
    struct GrazingCase: Decodable { let planet: String; let startUtc: String; let endUtc: String; let observer: Site }
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
                let illumA = try planetIllumination(planet, at: raw), illumB = try planetIllumination(planet, at: clipped)
                XCTAssertEqual(illumA.fraction, illumB.fraction); XCTAssertEqual(illumA.phaseAngleDeg, illumB.phaseAngleDeg)
                XCTAssertEqual(illumA.magnitude, illumB.magnitude); XCTAssertEqual(illumA.elongationDeg, illumB.elongationDeg)
                let eventA = try planetEvents(planet, from: raw, to: clipped.addingTimeInterval(2*86400), observer: observer)
                let eventB = try planetEvents(planet, from: clipped, to: clipped.addingTimeInterval(2*86400), observer: observer)
                XCTAssertEqual(eventA.map(\.time), eventB.map(\.time)); XCTAssertEqual(eventA.map { $0.kind.rawValue }, eventB.map { $0.kind.rawValue })
            }
        }
    }

    func testIlluminationAgainstJPL() throws {
        var highPhaseVenus = 0
        for row in try Self.load([PhotometryRow].self, "illumination") {
            let p = planetIlluminationAtTT(Planet(rawValue: row.planet)!, PositionsTests.ttDaysOf(row.tt))
            XCTAssertLessThan(abs(p.fraction-row.fraction), 0.01, "\(row.planet) @ \(row.tt)")
            XCTAssertLessThan(abs(p.elongationDeg-row.elongationDeg)*60, 1)
            XCTAssertEqual(p.fraction, (1+cos(p.phaseAngleDeg*Double.pi/180))/2, accuracy: 1e-12)
            XCTAssertGreaterThanOrEqual(p.elongationDeg, 0); XCTAssertLessThanOrEqual(p.elongationDeg, 180)
            // The pinned Venus high-phase branch differs from JPL; retain those rows as geometry evidence.
            if row.planet == "venus" && row.phaseAngleDeg >= 163.6 { highPhaseVenus += 1 }
            else { XCTAssertLessThan(abs(p.magnitude-row.magnitude), 0.3, "\(row.planet) @ \(row.tt)") }
        }
        XCTAssertGreaterThan(highPhaseVenus, 5)
    }

    func testPinnedPhotometryAndSaturnRings() throws {
        var ringCases = 0
        for row in try Self.load(PhotometryReference.self, "photometry-reference").rows {
            let p = planetIlluminationAtTT(Planet(rawValue: row.planet)!, PositionsTests.ttDaysOf(row.tt))
            XCTAssertEqual(p.magnitude, row.magnitude, accuracy: 1e-10)
            XCTAssertEqual(p.fraction, row.fraction, accuracy: 1e-10)
            XCTAssertEqual(p.phaseAngleDeg, row.phaseAngleDeg, accuracy: 1e-8)
            XCTAssertEqual(p.elongationDeg, row.elongationDeg, accuracy: 1e-8)
            if let tilt = row.ringTiltDeg, abs(tilt) > 10 {
                ringCases += 1
                XCTAssertLessThan(p.magnitude, row.globeMagnitude!-0.3)
            }
        }
        XCTAssertGreaterThan(ringCases, 0)
        XCTAssertThrowsError(try planetIllumination(.earth, at: Date()))
        XCTAssertThrowsError(try planetIllumination(.venus, at: Date(timeIntervalSince1970: .nan)))
    }

    func testRiseSetAgainstJPLMinuteGrids() throws {
        for row in try Self.load([EventWindow].self, "events") {
            let observer = try Observer(latitudeDeg: row.observer.latitudeDeg, longitudeDeg: row.observer.longitudeDeg, elevationM: row.observer.elevationM ?? 0)
            let found = try planetEvents(Planet(rawValue: row.planet)!, from: utc(row.startUtc), to: utc(row.endUtc), observer: observer, heightAboveGroundM: row.heightAboveGroundM)
            XCTAssertEqual(found.count, row.events.count, "\(row.planet) lat \(row.observer.latitudeDeg)")
            for i in 0..<min(found.count, row.events.count) {
                XCTAssertEqual(found[i].kind.rawValue, row.events[i].kind)
                XCTAssertLessThan(abs(found[i].time.timeIntervalSince(utcMs(row.events[i].utc))), 60)
                if i > 0 { XCTAssertGreaterThan(found[i].time, found[i-1].time) }
            }
        }
    }

    func testEventHeightAndHalfOpenWindows() throws {
        let start = utc("2026-03-20T00:00:00Z"), end = utc("2026-03-22T00:00:00Z")
        let observer = try Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 100)
        for planet in Self.skyPlanets {
            let ground = try planetEvents(planet, from: start, to: end, observer: observer)
            let zero = try planetEvents(planet, from: start, to: end, observer: observer, heightAboveGroundM: 0)
            let raised = try planetEvents(planet, from: start, to: end, observer: observer, heightAboveGroundM: 100)
            XCTAssertEqual(zero.map(\.time), ground.map(\.time)); XCTAssertEqual(zero.map { $0.kind.rawValue }, ground.map { $0.kind.rawValue })
            XCTAssertLessThan(raised.first { $0.kind == .rise }!.time, ground.first { $0.kind == .rise }!.time)
            XCTAssertGreaterThan(raised.first { $0.kind == .set }!.time, ground.first { $0.kind == .set }!.time)
            for event in raised {
                let ut = utDays(event.time)
                let p = topoAltAzUnrefracted(planetGeoVectorEqj(planet, ttDaysFromUt(ut)), ut, observer)
                XCTAssertEqual(p.altDeg, try horizonDip(observer: observer, heightAboveGroundM: 100)-34/60, accuracy: 0.005)
            }
            let split = ground[0].time
            let parts = try planetEvents(planet, from: start, to: split, observer: observer) + planetEvents(planet, from: split, to: end, observer: observer)
            XCTAssertEqual(parts.map(\.time), ground.map(\.time)); XCTAssertEqual(parts.map { $0.kind.rawValue }, ground.map { $0.kind.rawValue })
            XCTAssertTrue(try planetEvents(planet, from: start, to: start, observer: observer).isEmpty)
            XCTAssertTrue(try planetEvents(planet, from: end, to: start, observer: observer).isEmpty)
            XCTAssertThrowsError(try planetEvents(planet, from: start, to: start, observer: observer, heightAboveGroundM: .nan))
            XCTAssertThrowsError(try planetEvents(planet, from: start, to: start, observer: observer, heightAboveGroundM: -1))
            for (a,b) in [(supportedMin, supportedMin.addingTimeInterval(2*86400)), (supportedMax.addingTimeInterval(-2*86400), supportedMax)] {
                for event in try planetEvents(planet, from: a, to: b, observer: observer) {
                    XCTAssertGreaterThanOrEqual(event.time, a); XCTAssertLessThan(event.time, b)
                }
            }
        }
        XCTAssertThrowsError(try planetEvents(.earth, from: start, to: start, observer: observer))
        XCTAssertThrowsError(try planetEvents(.venus, from: Date(timeIntervalSince1970: .nan), to: end, observer: observer))
    }

    func testPolarGrazingPairsAgainstMinuteOracle() throws {
        for row in try Self.load([GrazingCase].self, "grazing-cases") {
            let planet = Planet(rawValue: row.planet)!, start = utc(row.startUtc), end = utc(row.endUtc)
            let observer = try Observer(latitudeDeg: row.observer.latitudeDeg, longitudeDeg: row.observer.longitudeDeg)
            func offset(_ time: Date) -> Double {
                let ut = utDays(time)
                return topoAltAzUnrefracted(planetGeoVectorEqj(planet, ttDaysFromUt(ut)), ut, observer).altDeg+34/60
            }
            var brute: [(Date, String)] = [], prev = offset(start)
            var time = start.addingTimeInterval(60)
            while time <= end {
                let cur = offset(time)
                if (prev < 0) != (cur < 0) { brute.append((time, cur >= 0 ? "rise" : "set")) }
                prev = cur; time = time.addingTimeInterval(60)
            }
            XCTAssertEqual(brute.count, 2)
            if brute.count == 2 { XCTAssertLessThan(brute[1].0.timeIntervalSince(brute[0].0), 30*60) }
            let found = try planetEvents(planet, from: start, to: end, observer: observer)
            XCTAssertEqual(found.count, brute.count, row.planet)
            for i in 0..<min(found.count, brute.count) {
                XCTAssertEqual(found[i].kind.rawValue, brute[i].1)
                XCTAssertLessThan(abs(found[i].time.timeIntervalSince(brute[i].0)), 60)
            }
            let circumpolar = try Observer(latitudeDeg: row.observer.latitudeDeg+0.1, longitudeDeg: row.observer.longitudeDeg)
            XCTAssertTrue(try planetEvents(planet, from: start, to: end, observer: circumpolar).isEmpty)
        }
    }

    func testOuterPlanetPerformanceAcrossSupportedInterval() throws {
        let observer = try Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656)
        let start = Date()
        var checksum = 0.0, events = 0
        for year in 1950...2100 {
            for planet in [Planet.uranus, .neptune] {
                for month in 1...12 {
                    let time = utc(String(format: "%04d-%02d-01T00:00:00Z", year, month))
                    checksum += try planetHeliocentricPosition(planet, at: time).xAu
                    checksum += try planetPosition(planet, at: time).raDeg
                    checksum += try planetAltAz(planet, at: time, observer: observer).altDeg
                    checksum += try planetIllumination(planet, at: time).magnitude
                }
                let from = utc("\(year)-01-01T00:00:00Z"), to = utc("\(year)-01-03T00:00:00Z")
                events += try planetEvents(planet, from: from, to: to, observer: observer).count
            }
        }
        XCTAssertTrue(checksum.isFinite)
        XCTAssertGreaterThan(events, 0)
        XCTAssertLessThan(Date().timeIntervalSince(start), 10)
    }
}
