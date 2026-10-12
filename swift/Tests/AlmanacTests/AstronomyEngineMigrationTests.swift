import Almanac
import Foundation
import XCTest

func briefingPositions(_ time: Date, _ observer: Observer) throws -> (sun: AltAz, moon: AltAz, venus: AltAz) {
    (try sunAltAz(time, observer: observer), try moonAltAz(time, observer: observer),
     try planetAltAz(.venus, at: time, observer: observer))
}

func briefingMoon(_ time: Date) throws -> (phaseDeg: Double, fraction: Double) {
    let illumination = try moonIllumination(time)
    return (illumination.phase * 360, illumination.fraction)
}

func passageCrossings(_ start: Date, _ end: Date, _ observer: Observer) throws -> (sun: [SunEvent], moon: [MoonEvent], phases: [MoonPhaseEvent]) {
    (try sunEvents(from: start, to: end, observer: observer),
     try moonEvents(from: start, to: end, observer: observer),
     try searchMoonPhases(from: start, to: end))
}

func visibleLunarEclipses(_ start: Date, _ end: Date, _ observer: Observer) throws -> [LunarEclipse] {
    try lunarEclipses(from: start, to: end).filter { try lunarEclipseVisibility($0, observer: observer).visibleAtPeak }
}

final class AstronomyEngineMigrationTests: XCTestCase {
    struct Reference: Decodable {
        struct Position: Decodable { let altDeg: Double; let azDeg: Double }
        let time: String; let latitudeDeg: Double; let longitudeDeg: Double
        let sun: Position; let moon: Position; let venus: Position
        let phaseDeg: Double; let fraction: Double
    }

    struct References: Decodable { let astronomyEngine: [Reference] }

    func testGuideExamplesAreVerbatim() throws {
        let source = try String(contentsOfFile: #filePath, encoding: .utf8)
        let guide = try String(contentsOf: fixturesURL().deletingLastPathComponent().appendingPathComponent("docs/migrating-from-astronomy-engine.md"), encoding: .utf8)
        let blocks = guide.components(separatedBy: "```swift\n").dropFirst().map { $0.components(separatedBy: "```")[0] }
        XCTAssertFalse(blocks.isEmpty)
        for block in blocks { XCTAssertTrue(source.contains(block), String(block.prefix(80))) }
    }

    func testPositionsAndMoonStateAgainstAstronomyEngine() throws {
        let url = fixturesURL().deletingLastPathComponent().appendingPathComponent("typescript/test/migration-references.json")
        let references = try JSONDecoder().decode(References.self, from: Data(contentsOf: url)).astronomyEngine
        for ref in references {
            let time = utc(ref.time)
            let observer = try Observer(latitudeDeg: ref.latitudeDeg, longitudeDeg: ref.longitudeDeg)
            let positions = try briefingPositions(time, observer)
            for (mine, theirs) in [(positions.sun, ref.sun), (positions.moon, ref.moon), (positions.venus, ref.venus)] {
                XCTAssertLessThan(abs(mine.altDeg - theirs.altDeg), 1 / 60)
                XCTAssertLessThan(abs(mine.azDeg - theirs.azDeg), 1 / 60)
            }
            let state = try briefingMoon(time)
            XCTAssertLessThan(abs(state.phaseDeg - ref.phaseDeg), 1 / 60)
            XCTAssertLessThan(abs(state.fraction - ref.fraction), 1e-6)
        }
    }

    func testPassageCrossingsAndPhases() throws {
        let start = utc("2026-08-10T00:00:00Z")
        let end = utc("2026-08-14T00:00:00Z")
        let sky = try passageCrossings(start, end, Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656))
        XCTAssertEqual(sky.sun.filter { $0.kind == .rise }.count, 4)
        XCTAssertTrue(sky.moon.contains { $0.kind == .set })
        XCTAssertEqual(sky.phases.count, 1)
        XCTAssertEqual(sky.phases[0].phase, .new)
        XCTAssertLessThan(abs(sky.phases[0].time.timeIntervalSince(utc("2026-08-12T17:36:00Z"))), 60)
        XCTAssertTrue(sky.sun.allSatisfy { $0.time >= start && $0.time < end })
        XCTAssertTrue(sky.moon.allSatisfy { $0.time >= start && $0.time < end })
        XCTAssertTrue(sky.phases.allSatisfy { $0.time >= start && $0.time < end })
    }

    func testLunarVisibilityIsObserverSpecific() throws {
        let start = utc("2026-03-01T00:00:00Z")
        let end = utc("2026-03-05T00:00:00Z")
        let pacific = try visibleLunarEclipses(start, end, Observer(latitudeDeg: 20, longitudeDeg: -160))
        XCTAssertEqual(pacific.count, 1)
        XCTAssertEqual(pacific[0].kind, .total)
        XCTAssertLessThan(abs(pacific[0].peak.timeIntervalSince(utc("2026-03-03T11:33:00Z"))), 60)
        XCTAssertTrue(try visibleLunarEclipses(start, end, Observer(latitudeDeg: 20, longitudeDeg: 60)).isEmpty)
    }
}
