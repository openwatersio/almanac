import XCTest
import Almanac

/// Plain `import Almanac` (NOT `@testable`) touching every public type,
/// field, and function shipped so far: `@testable` hides missing `public`
/// modifiers, so this test is the compiler proving the public surface, not
/// an assertion about behaviour (that's every other test file's job).
/// Extend this file as later tasks add to the public API.
final class PublicSurfaceTests: XCTestCase {
    func testObserverAndErrors() throws {
        let observer = try Observer(latitudeDeg: 48.7621, longitudeDeg: -123.052, elevationM: 3)
        XCTAssertEqual(observer.latitudeDeg, 48.7621)
        XCTAssertEqual(observer.longitudeDeg, -123.052)
        XCTAssertEqual(observer.elevationM, 3)
        XCTAssertLessThan(try horizonDip(observer: observer, heightAboveGroundM: 3), 0)

        let cases: [AlmanacError] = [.outOfRange, .invalidObserver("x"), .invalidArgument("y")]
        XCTAssertEqual(cases.count, 3)
    }

    func testPositions() throws {
        let time = Date(timeIntervalSince1970: 1_756_353_600) // 2025-08-28
        let sun: SunPosition = try sunPosition(time)
        XCTAssertFalse(sun.raDeg.isNaN)
        XCTAssertFalse(sun.decDeg.isNaN)
        XCTAssertFalse(sun.distanceAu.isNaN)

        let moon: MoonPosition = try moonPosition(time)
        XCTAssertFalse(moon.raDeg.isNaN)
        XCTAssertFalse(moon.decDeg.isNaN)
        XCTAssertFalse(moon.distanceKm.isNaN)
    }

    func testAltAz() throws {
        let observer = try Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656)
        let time = Date(timeIntervalSince1970: 1_756_353_600)
        let sunAA: AltAz = try sunAltAz(time, observer: observer)
        XCTAssertFalse(sunAA.azDeg.isNaN)
        XCTAssertFalse(sunAA.altDeg.isNaN)
        let moonAA: AltAz = try moonAltAz(time, observer: observer)
        XCTAssertFalse(moonAA.azDeg.isNaN)
        XCTAssertFalse(moonAA.altDeg.isNaN)
        let starAA: AltAz = try starAltAz(raDeg: 88.792939, decDeg: 7.407064, at: time, observer: observer)
        XCTAssertFalse(starAA.azDeg.isNaN)
        XCTAssertFalse(starAA.altDeg.isNaN)
    }

    func testIllumination() throws {
        let m: MoonIllumination = try moonIllumination(Date(timeIntervalSince1970: 1_756_353_600))
        XCTAssertFalse(m.fraction.isNaN)
        XCTAssertFalse(m.phaseAngleDeg.isNaN)
        XCTAssertFalse(m.phase.isNaN)
        _ = m.waxing
    }

    func testEvents() throws {
        let observer = try Observer(latitudeDeg: 48.7621, longitudeDeg: -123.052)
        let start = Date(timeIntervalSince1970: 1_756_339_200) // 2025-08-28T00:00:00Z
        let end = start.addingTimeInterval(2 * 86400)

        let sun: [SunEvent] = try sunEvents(from: start, to: end, observer: observer)
        XCTAssertFalse(sun.isEmpty)
        for e in sun { _ = (e.time, e.kind) }
        XCTAssertEqual(SunEventKind.allCases.count, 9)
        for kind in SunEventKind.allCases { _ = kind.rawValue }

        let moon: [MoonEvent] = try moonEvents(from: start, to: end, observer: observer)
        for e in moon { _ = (e.time, e.kind) }
        let moonKinds: [MoonEventKind] = [.rise, .set]
        XCTAssertEqual(moonKinds.map { $0.rawValue }, ["rise", "set"])

        let phases: [MoonPhaseEvent] = try searchMoonPhases(from: start, to: start.addingTimeInterval(60 * 86400))
        XCTAssertFalse(phases.isEmpty)
        for e in phases { _ = (e.time, e.phase) }
        let phaseKinds: [MoonPhaseName] = [.new, .firstQuarter, .full, .lastQuarter]
        XCTAssertEqual(phaseKinds.map { $0.rawValue }, ["new", "firstQuarter", "full", "lastQuarter"])
    }

    func testEclipse() throws {
        let observer = try Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656)
        let e: LunarEclipse = try nextLunarEclipse(after: Date(timeIntervalSince1970: 1_756_339_200))
        let previous: LunarEclipse = try previousLunarEclipse(before: e.peak)
        let range: [LunarEclipse] = try lunarEclipses(from: previous.peak, to: e.peak)
        XCTAssertEqual(range.map(\.peak), [previous.peak])
        _ = (e.peak, e.magUmbral, e.magPenumbral, e.p1, e.u1, e.u2, e.u3, e.u4, e.p4)
        let kinds: [LunarEclipseKind] = [.penumbral, .partial, .total]
        XCTAssertEqual(kinds.map { $0.rawValue }, ["penumbral", "partial", "total"])
        XCTAssertTrue([.penumbral, .partial, .total].contains(e.kind))

        let v: LunarEclipseVisibility = try lunarEclipseVisibility(e, observer: observer)
        XCTAssertFalse(v.moonGeometricAltAtPeakDeg.isNaN)
        _ = v.visibleAtPeak
        let c: LunarEclipseContactsVisible = v.contactsVisible
        _ = (c.p1, c.u1, c.u2, c.u3, c.u4, c.p4)

        // Construct all three via their public inits — proves the inits
        // themselves are public, which a `@testable` test (EclipseTests)
        // would not catch if they accidentally went internal.
        let hand = LunarEclipse(
            kind: e.kind, peak: e.peak, magUmbral: e.magUmbral, magPenumbral: e.magPenumbral,
            p1: e.p1, u1: e.u1, u2: e.u2, u3: e.u3, u4: e.u4, p4: e.p4
        )
        _ = hand.kind
        let handContacts = LunarEclipseContactsVisible(p1: true, u1: nil, u2: nil, u3: nil, u4: nil, p4: false)
        let handVisibility = LunarEclipseVisibility(
            visibleAtPeak: true, moonGeometricAltAtPeakDeg: 10.0, contactsVisible: handContacts
        )
        XCTAssertTrue(handVisibility.visibleAtPeak)
        XCTAssertEqual(handVisibility.contactsVisible.p1, true)
        XCTAssertNil(handVisibility.contactsVisible.u1)
    }

    func testSolarEclipse() throws {
        let observer = try Observer(latitudeDeg: 44.94, longitudeDeg: -123.03)
        let e: SolarEclipse = try nextSolarEclipse(after: Date(timeIntervalSince1970: 1_500_000_000), observer: observer) // 2017-07-14
        let previous: SolarEclipse = try previousSolarEclipse(before: e.peak, observer: observer)
        let range: [SolarEclipse] = try solarEclipses(from: previous.peak, to: e.peak, observer: observer)
        XCTAssertEqual(range.map(\.peak), [previous.peak])
        _ = (e.obscuration, e.c1, e.c2, e.peak, e.c3, e.c4)
        let alt: SolarEclipseSunAltitudes = e.sunAltDeg
        _ = (alt.c1, alt.c2, alt.peak, alt.c3, alt.c4)
        let kinds: [SolarEclipseKind] = [.partial, .annular, .total]
        XCTAssertEqual(kinds.map { $0.rawValue }, ["partial", "annular", "total"])
        XCTAssertTrue(kinds.contains(e.kind))

        let covered: Double = try solarObscuration(at: e.peak, observer: observer)
        XCTAssertFalse(covered.isNaN)

        // Construct both via their public inits — proves the inits themselves
        // are public, which a `@testable` test would not catch.
        let handAlt = SolarEclipseSunAltitudes(c1: 10, c2: nil, peak: 20, c3: nil, c4: 30)
        let hand = SolarEclipse(kind: .partial, obscuration: 0.5, c1: e.c1, c2: nil, peak: e.peak, c3: nil, c4: e.c4, sunAltDeg: handAlt)
        XCTAssertEqual(hand.kind, .partial)
        XCTAssertNil(hand.sunAltDeg.c2)
    }

    func testGlobalSolarEclipse() throws {
        let e: GlobalSolarEclipse = try nextGlobalSolarEclipse(after: Date(timeIntervalSince1970: 1_500_000_000)) // 2017-07-14
        let previous: GlobalSolarEclipse = try previousGlobalSolarEclipse(before: e.peak)
        let range: [GlobalSolarEclipse] = try globalSolarEclipses(from: previous.peak, to: e.peak)
        XCTAssertEqual(range.map(\.peak), [previous.peak])
        let kind: SolarEclipseKind = e.kind
        let point: (Double?, Double?) = (e.latitudeDeg, e.longitudeDeg)
        let obscuration: Double? = e.obscuration
        let greatest: (Double, Double, Double) = (e.greatestLatitudeDeg, e.greatestLongitudeDeg, e.greatestObscuration)
        _ = (kind, e.peak, e.axisDistanceKm, point, obscuration, greatest)

        // Construct via its public init — proves the init itself is public,
        // which a `@testable` test would not catch.
        let hand = GlobalSolarEclipse(
            kind: .partial, peak: e.peak, axisDistanceKm: 6500, latitudeDeg: nil, longitudeDeg: nil, obscuration: nil,
            greatestLatitudeDeg: 64, greatestLongitudeDeg: -114, greatestObscuration: 0.8)
        XCTAssertEqual(hand.kind, .partial)
        XCTAssertNil(hand.latitudeDeg)
    }

    func testCentralLine() throws {
        let e: GlobalSolarEclipse = try nextGlobalSolarEclipse(after: Date(timeIntervalSince1970: 1_500_000_000)) // 2017-08-21 total
        let point: SolarEclipseAxisPoint? = try solarEclipseAxisPoint(at: e.peak)
        let p = try XCTUnwrap(point)
        _ = (p.time, p.latitudeDeg, p.longitudeDeg, p.kind, p.obscuration)
        let line: [SolarEclipseAxisPoint] = try solarEclipseCentralLine(peak: e.peak)
        XCTAssertFalse(line.isEmpty)
        let coarse: [SolarEclipseAxisPoint] = try solarEclipseCentralLine(peak: e.peak, stepSeconds: 600)
        XCTAssertLessThan(coarse.count, line.count)

        // Construct via its public init — proves the init itself is public,
        // which a `@testable` test would not catch.
        let hand = SolarEclipseAxisPoint(time: e.peak, latitudeDeg: 37, longitudeDeg: -88, kind: .total, obscuration: 1)
        XCTAssertEqual(hand.kind, .total)
        let kinds: [SolarEclipseAxisKind] = [.annular, .total]
        XCTAssertEqual(kinds.map { $0.rawValue }, ["annular", "total"])
    }
}
