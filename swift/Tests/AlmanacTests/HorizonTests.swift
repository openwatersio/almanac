import XCTest
@testable import Almanac

final class HorizonTests: XCTestCase {
    func testElevatedEvents() throws {
        let observer = try Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 100)
        let start = utc("2026-03-20T00:00:00Z"), end = utc("2026-03-22T00:00:00Z")
        let ground = try sunEvents(from: start, to: end, observer: observer)
        let raised = try sunEvents(from: start, to: end, observer: observer, heightAboveGroundM: 100)
        XCTAssertEqual(try sunEvents(from: start, to: end, observer: observer, heightAboveGroundM: 0).map(\.time), ground.map(\.time))
        XCTAssertLessThan(try XCTUnwrap(raised.first { $0.kind == .rise }).time, try XCTUnwrap(ground.first { $0.kind == .rise }).time)
        XCTAssertGreaterThan(try XCTUnwrap(raised.first { $0.kind == .set }).time, try XCTUnwrap(ground.first { $0.kind == .set }).time)
        XCTAssertEqual(raised.filter { $0.kind != .rise && $0.kind != .set }.map(\.time), ground.filter { $0.kind != .rise && $0.kind != .set }.map(\.time))
        let moonGround = try moonEvents(from: start, to: end, observer: observer)
        let moonRaised = try moonEvents(from: start, to: end, observer: observer, heightAboveGroundM: 100)
        XCTAssertEqual(try moonEvents(from: start, to: end, observer: observer, heightAboveGroundM: 0).map(\.time), moonGround.map(\.time))
        XCTAssertLessThan(try XCTUnwrap(moonRaised.first { $0.kind == .rise }).time, try XCTUnwrap(moonGround.first { $0.kind == .rise }).time)
        XCTAssertGreaterThan(try XCTUnwrap(moonRaised.first { $0.kind == .set }).time, try XCTUnwrap(moonGround.first { $0.kind == .set }).time)
        let dip = try horizonDip(observer: observer, heightAboveGroundM: 100)
        for event in raised where event.kind == .rise || event.kind == .set {
            let ut = utDays(event.time)
            let p = topoAltAzUnrefracted(sunGeoVectorEqj(ttDaysFromUt(ut)), ut, observer)
            XCTAssertLessThan(abs(p.altDeg - (dip - 34.0 / 60 - RAD2DEG * asin(695700 / (p.distanceAu * KM_PER_AU)))), 0.005)
        }
        for event in moonRaised {
            let ut = utDays(event.time)
            let p = topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer)
            XCTAssertLessThan(abs(p.altDeg - (dip - 34.0 / 60 - RAD2DEG * asin(1737.4 / (p.distanceAu * KM_PER_AU)))), 0.005)
        }
        XCTAssertThrowsError(try sunEvents(from: start, to: start, observer: observer, heightAboveGroundM: .nan))
        XCTAssertThrowsError(try moonEvents(from: start, to: start, observer: observer, heightAboveGroundM: -1))
    }

    func testElevatedSolarVisibility() throws {
        let observer = try Observer(latitudeDeg: 20, longitudeDeg: 5.5, elevationM: 100)
        let start = utc("2026-08-12T00:00:00Z"), end = utc("2026-08-13T00:00:00Z")
        XCTAssertTrue(try solarEclipses(from: start, to: end, observer: observer).isEmpty)
        let raised = try solarEclipses(from: start, to: end, observer: observer, heightAboveGroundM: 100)
        XCTAssertEqual(raised.count, 1)
        let e = try XCTUnwrap(raised.first)
        XCTAssertLessThan(e.sunAltDeg.c1, 0)
        XCTAssertGreaterThan(e.sunAltDeg.c1, try horizonDip(observer: observer, heightAboveGroundM: 100))
        XCTAssertEqual(try nextSolarEclipse(after: start, observer: observer, heightAboveGroundM: 100).peak, e.peak)
        XCTAssertEqual(try previousSolarEclipse(before: end, observer: observer, heightAboveGroundM: 100).peak, e.peak)
        for (at, alt) in [(e.c1, e.sunAltDeg.c1), (e.peak, e.sunAltDeg.peak), (e.c4, e.sunAltDeg.c4)] {
            XCTAssertEqual(try sunAltAz(at, observer: observer).altDeg, alt)
        }
        XCTAssertThrowsError(try solarEclipses(from: start, to: start, observer: observer, heightAboveGroundM: .nan))
        XCTAssertThrowsError(try nextSolarEclipse(after: start, observer: observer, heightAboveGroundM: .nan))
        XCTAssertThrowsError(try previousSolarEclipse(before: end, observer: observer, heightAboveGroundM: .nan))
    }

    func testElevatedLunarVisibility() throws {
        let e = try nextLunarEclipse(after: utc("2026-03-01T00:00:00Z"))
        let observer = try Observer(latitudeDeg: 48.4284, longitudeDeg: -74.8, elevationM: 100)
        let ground = try lunarEclipseVisibility(e, observer: observer)
        let raised = try lunarEclipseVisibility(e, observer: observer, heightAboveGroundM: 100)
        XCTAssertFalse(ground.visibleAtPeak)
        XCTAssertTrue(raised.visibleAtPeak)
        XCTAssertEqual(raised.moonGeometricAltAtPeakDeg, ground.moonGeometricAltAtPeakDeg)
        let dip = try horizonDip(observer: observer, heightAboveGroundM: 100)
        let contacts: [(Date?, Bool?)] = [(e.p1, raised.contactsVisible.p1), (e.u1, raised.contactsVisible.u1), (e.u2, raised.contactsVisible.u2), (e.u3, raised.contactsVisible.u3), (e.u4, raised.contactsVisible.u4), (e.p4, raised.contactsVisible.p4)]
        for (at, visible) in contacts {
            guard let at else { XCTAssertNil(visible); continue }
            let ut = utDays(at)
            XCTAssertEqual(visible, topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer).altDeg > dip)
        }
        XCTAssertThrowsError(try lunarEclipseVisibility(e, observer: observer, heightAboveGroundM: .nan))
    }
    struct Row: Decodable {
        struct Site: Decodable { let latitudeDeg: Double; let longitudeDeg: Double; let elevationM: Double }
        let observer: Site; let heightAboveGroundM: Double; let dipDeg: Double
    }

    func testPinnedUpstream() throws {
        let data = try Data(contentsOf: fixturesURL().appendingPathComponent("horizon/dip.json"))
        let rows = try JSONDecoder().decode([Row].self, from: data)
        XCTAssertEqual(rows.count, 25)
        for row in rows {
            let site = try Observer(latitudeDeg: row.observer.latitudeDeg, longitudeDeg: row.observer.longitudeDeg, elevationM: row.observer.elevationM)
            XCTAssertEqual(try horizonDip(observer: site, heightAboveGroundM: row.heightAboveGroundM), row.dipDeg, accuracy: 1e-10)
        }
    }

    func testHeightAndValidation() throws {
        let sea = try Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 2)
        XCTAssertEqual(try horizonDip(observer: sea, heightAboveGroundM: 0).sign, .plus)
        XCTAssertLessThan(try horizonDip(observer: sea, heightAboveGroundM: 2), 0)
        let high = try Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 10)
        XCTAssertLessThan(try horizonDip(observer: high, heightAboveGroundM: 10), try horizonDip(observer: sea, heightAboveGroundM: 2))
        for height in [Double.nan, .infinity, -1, 10001] {
            XCTAssertThrowsError(try horizonDip(observer: sea, heightAboveGroundM: height))
        }
        let low = try Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: -499)
        XCTAssertThrowsError(try horizonDip(observer: low, heightAboveGroundM: 2))
        XCTAssertLessThan(try horizonDip(observer: low, heightAboveGroundM: 1), 0)
    }
}
