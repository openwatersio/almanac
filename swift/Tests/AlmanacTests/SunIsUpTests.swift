import XCTest
import Almanac

final class SunIsUpTests: XCTestCase {
    func testIndependentUSNOEvidence() throws {
        struct Row: Decodable {
            let date: String
            let latitudeDeg: Double
            let longitudeDeg: Double
            let sun: [String: String]
        }
        let data = try Data(contentsOf: fixturesURL().appendingPathComponent("events/usno-grid.json"))
        let rows = try JSONDecoder().decode([Row].self, from: data)
        for row in rows where Int(row.date.prefix(4))! <= 2050 {
            let observer = try Observer(latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg)
            for kind in ["rise", "set"] {
                guard let clock = row.sun[kind] else { continue }
                let time = utc(row.date + "T" + clock + ":00Z")
                XCTAssertEqual(try sunIsUp(time.addingTimeInterval(-60), observer: observer), kind == "set")
                XCTAssertEqual(try sunIsUp(time.addingTimeInterval(60), observer: observer), kind == "rise")
            }
        }
    }

    func testDayNightAndPolarPeriods() throws {
        let equator = try Observer(latitudeDeg: 0, longitudeDeg: 0)
        XCTAssertTrue(try sunIsUp(utc("2024-06-21T12:00:00Z"), observer: equator))
        XCTAssertFalse(try sunIsUp(utc("2024-06-21T00:00:00Z"), observer: equator))
        let polar = try Observer(latitudeDeg: 78.2, longitudeDeg: 15.6)
        XCTAssertTrue(try sunIsUp(utc("2024-06-21T23:30:00Z"), observer: polar))
        XCTAssertFalse(try sunIsUp(utc("2024-12-21T12:00:00Z"), observer: polar))
    }

    func testShortPolarDayUpperLimb() throws {
        let observer = try Observer(latitudeDeg: 70.5, longitudeDeg: 0)
        let time = utc("2024-11-22T11:29:40Z")
        XCTAssertLessThan(try sunAltAz(time, observer: observer).altDeg, -0.211)
        XCTAssertTrue(try sunIsUp(time, observer: observer))
        XCTAssertFalse(try sunIsUp(utc("2024-11-22T11:29:36Z"), observer: observer))
        XCTAssertTrue(try sunIsUp(utc("2024-11-22T12:01:55Z"), observer: observer))
        XCTAssertFalse(try sunIsUp(utc("2024-11-22T12:01:59Z"), observer: observer))
    }

    func testAgreementAcrossSeasonalAndGrazingCrossings() throws {
        for latitude in [0.0, 60, -40, 70.5, 84.9] {
            let observer = try Observer(latitudeDeg: latitude, longitudeDeg: 0)
            for start in ["2024-06-21", "2025-01-03", "2024-11-22", "2024-03-05"] {
                let from = utc(start + "T00:00:00Z")
                for event in try sunEvents(from: from, to: from.addingTimeInterval(86400), observer: observer)
                    where event.kind == .rise || event.kind == .set {
                    XCTAssertEqual(try sunIsUp(event.time.addingTimeInterval(-2), observer: observer), event.kind == .set)
                    XCTAssertEqual(try sunIsUp(event.time.addingTimeInterval(2), observer: observer), event.kind == .rise)
                }
            }
        }
    }

    func testEyeHeightIsSeparateFromElevation() throws {
        let observer = try Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 100)
        let from = utc("2026-03-20T00:00:00Z")
        let events = try sunEvents(from: from, to: from.addingTimeInterval(86400), observer: observer, heightAboveGroundM: 100)
        let rise = try XCTUnwrap(events.first { $0.kind == .rise })
        let afterRise = rise.time.addingTimeInterval(2)
        XCTAssertTrue(try sunIsUp(afterRise, observer: observer, heightAboveGroundM: 100))
        XCTAssertFalse(try sunIsUp(afterRise, observer: observer))
        XCTAssertFalse(try sunIsUp(afterRise, observer: observer, heightAboveGroundM: 0))
        for event in events where event.kind == .rise || event.kind == .set {
            XCTAssertEqual(try sunIsUp(event.time.addingTimeInterval(-2), observer: observer, heightAboveGroundM: 100), event.kind == .set)
            XCTAssertEqual(try sunIsUp(event.time.addingTimeInterval(2), observer: observer, heightAboveGroundM: 100), event.kind == .rise)
        }
    }

    func testValidationAndSupportedBoundaries() throws {
        let observer = try Observer(latitudeDeg: 0, longitudeDeg: 0)
        let time = utc("2026-03-20T12:00:00Z")
        XCTAssertThrowsError(try sunIsUp(Date(timeIntervalSince1970: .nan), observer: observer))
        for date in ["1949-12-31T00:00:00Z", "2101-01-01T00:00:00Z"] {
            XCTAssertThrowsError(try sunIsUp(utc(date), observer: observer)) { error in
                guard case AlmanacError.outOfRange = error else { return XCTFail("Expected outOfRange, got \(error)") }
            }
        }
        for height in [Double.nan, .infinity, -1, 10001] {
            XCTAssertThrowsError(try sunIsUp(time, observer: observer, heightAboveGroundM: height))
        }
        let low = try Observer(latitudeDeg: 0, longitudeDeg: 0, elevationM: -499)
        XCTAssertThrowsError(try sunIsUp(time, observer: low, heightAboveGroundM: 2))
        _ = try sunIsUp(utc("1950-01-01T00:00:00Z"), observer: observer)
        _ = try sunIsUp(utc("2100-12-31T23:59:59Z"), observer: observer)
        let boundary = utc("1950-01-01T00:00:00Z")
        XCTAssertEqual(try sunIsUp(boundary.addingTimeInterval(-0.0005), observer: observer), try sunIsUp(boundary, observer: observer))
    }
}
