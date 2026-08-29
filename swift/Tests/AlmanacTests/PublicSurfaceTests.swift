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

        let cases: [AlmanacError] = [.outOfRange, .invalidObserver("x"), .invalidArgument("y")]
        XCTAssertEqual(cases.count, 3)

        XCTAssertLessThan(supportedMin, supportedMax)
        try assertSupported(supportedMin)
        try assertSupportedWindowEnd(supportedMax)
        XCTAssertNoThrow(try normalized(Date()))
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

        let phases: [PhaseEvent] = try searchMoonPhases(from: start, to: start.addingTimeInterval(60 * 86400))
        XCTAssertFalse(phases.isEmpty)
        for e in phases { _ = (e.time, e.phase) }
        let phaseKinds: [MoonPhaseKind] = [.new, .firstQuarter, .full, .lastQuarter]
        XCTAssertEqual(phaseKinds.map { $0.rawValue }, ["new", "firstQuarter", "full", "lastQuarter"])
    }
}
