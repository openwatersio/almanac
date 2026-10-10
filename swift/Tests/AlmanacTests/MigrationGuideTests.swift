import XCTest
import Almanac

// Runs every Swift example in docs/migrating-from-suncalc.md; the guide's
// `swift` blocks appear here verbatim. Expected values are SunCalc 2.1.1's, from
// typescript/test/suncalc-2.1.1.json (see typescript/test/migration-guide.test.ts
// for the inputs). Plain `import Almanac`, as a migrating app would write it.

// --- guide examples ---------------------------------------------------------

func getPosition(_ date: Date, _ lat: Double, _ lng: Double) throws -> (azimuth: Double, altitude: Double) {
    let position = try sunAltAz(date, observer: Observer(latitudeDeg: lat, longitudeDeg: lng))
    return (position.azDeg, position.altDeg)
}

func sunTimes(_ day: (start: Date, end: Date), _ lat: Double, _ lng: Double) throws -> [String: Date] {
    let observer = try Observer(latitudeDeg: lat, longitudeDeg: lng)
    var result: [String: Date] = [:]
    let events = try sunEvents(from: day.start, to: day.end, observer: observer)
    result["sunrise"] = events.first { $0.kind == .rise }?.time
    result["sunset"] = events.first { $0.kind == .set }?.time
    let golden = try sunAltitudeEvents(from: day.start, to: day.end, observer: observer, altitudeDeg: 6)
    result["goldenHourEnd"] = golden.first { $0.kind == .rising }?.time
    result["goldenHour"] = golden.first { $0.kind == .falling }?.time
    result["solarNoon"] = try sunTransits(from: day.start, to: day.end, observer: observer).first { $0.kind == .upper }?.time
    return result
}

func moonState(_ date: Date, _ lat: Double, _ lng: Double) throws -> (altitude: Double, distance: Double, fraction: Double, angle: Double) {
    let observer = try Observer(latitudeDeg: lat, longitudeDeg: lng)
    let orientation = try moonOrientation(at: date, observer: observer)
    return (try moonAltAz(date, observer: observer).altDeg, try moonPosition(date).distanceKm,
            try moonIllumination(date).fraction, orientation.brightLimbAngleDeg)
}

func brightLimbFromZenith(_ date: Date, _ lat: Double, _ lng: Double) throws -> Double {
    let orientation = try moonOrientation(at: date, observer: Observer(latitudeDeg: lat, longitudeDeg: lng))
    return orientation.brightLimbAngleDeg - orientation.parallacticAngleDeg
}

// --- checks against SunCalc 2.1.1 -------------------------------------------

final class MigrationGuideTests: XCTestCase {
    struct Reference: Decodable {
        struct Position: Decodable { let azimuth: Double; let altitude: Double }
        struct MoonPosition: Decodable { let altitude: Double; let distance: Double; let parallacticAngle: Double }
        struct Illumination: Decodable { let fraction: Double; let angle: Double }
        let times: [String: String]; let position: Position; let moonPosition: MoonPosition; let moonIllumination: Illumination
    }

    struct File: Decodable { let victoria: Reference }

    func signed180(_ deg: Double) -> Double {
        var x = deg.truncatingRemainder(dividingBy: 360)
        if x < 0 { x += 360 }
        return x > 180 ? x - 360 : x
    }

    func testGuideBlocksAreVerbatim() throws {
        let guide = try String(contentsOf: fixturesURL().deletingLastPathComponent().appendingPathComponent("docs/migrating-from-suncalc.md"), encoding: .utf8)
        let source = try String(contentsOfFile: #filePath, encoding: .utf8)
        let blocks = guide.components(separatedBy: "```swift\n").dropFirst().map { $0.components(separatedBy: "```")[0] }
        XCTAssertGreaterThanOrEqual(blocks.count, 4)
        for block in blocks { XCTAssertTrue(source.contains(block), String(block.prefix(80))) }
    }

    func testVictoriaAgainstSunCalc() throws {
        let url = fixturesURL().deletingLastPathComponent().appendingPathComponent("typescript/test/suncalc-2.1.1.json")
        let reference = try JSONDecoder().decode(File.self, from: Data(contentsOf: url)).victoria
        let (lat, lng) = (48.4284, -123.3656)
        let at = utc("2026-03-20T20:00:00Z")

        let sun = try getPosition(at, lat, lng)
        XCTAssertLessThan(abs(signed180(sun.azimuth - reference.position.azimuth)), 0.2)
        XCTAssertLessThan(abs(sun.altitude - reference.position.altitude), 0.2)

        // The civil day of 2026-03-20 at UTC-7.
        let start = utc("2026-03-20T07:00:00Z")
        let times = try sunTimes((start, start.addingTimeInterval(86400)), lat, lng)
        XCTAssertEqual(Set(times.keys), ["sunrise", "sunset", "goldenHourEnd", "goldenHour", "solarNoon"])
        for (name, time) in times {
            let theirs = utcMs(reference.times[name]!)
            XCTAssertLessThan(abs(time.timeIntervalSince(theirs)), 10, name)
        }

        let moon = try moonState(at, lat, lng)
        XCTAssertLessThan(abs(moon.altitude - reference.moonPosition.altitude), 0.2)
        XCTAssertLessThan(abs(moon.distance - reference.moonPosition.distance), 20)
        XCTAssertLessThan(abs(moon.fraction - reference.moonIllumination.fraction), 1e-3)
        XCTAssertLessThan(abs(signed180(moon.angle - reference.moonIllumination.angle)), 2)
        let tilt = reference.moonIllumination.angle - reference.moonPosition.parallacticAngle
        XCTAssertLessThan(abs(signed180(try brightLimbFromZenith(at, lat, lng) - tilt)), 2)
    }
}
