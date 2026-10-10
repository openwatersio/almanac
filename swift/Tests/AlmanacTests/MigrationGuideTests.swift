import XCTest
import Almanac

// Runs every Swift example in docs/migrating-from-suncalc.md and
// docs/migrating-from-solar.md; the guides' `swift` blocks appear here verbatim,
// except Solar guide blocks that begin `// Solar`, which show the code being
// replaced. SunCalc expectations are SunCalc 2.1.1's, from
// typescript/test/suncalc-2.1.1.json (see typescript/test/migration-guide.test.ts
// for the inputs). Solar expectations are Solar 4.0.1's, from
// swift/Tests/solar-4.0.1.json, which lists its own inputs. Plain
// `import Almanac`, as a migrating app would write it.

// --- SunCalc guide examples -------------------------------------------------

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

/// The civil day containing `date` in a zone `utcOffset` minutes east of UTC, as a half-open window.
func civilDay(_ date: Date, _ utcOffset: Int) -> (start: Date, end: Date) {
    let offset = Double(utcOffset) * 60
    let start = ((date.timeIntervalSince1970 + offset) / 86400).rounded(.down) * 86400 - offset
    return (Date(timeIntervalSince1970: start), Date(timeIntervalSince1970: start + 86400))
}

/// SunCalc's day when `utcOffset` is omitted: from the lower transit before the solar noon nearest `date` to the one after it.
func solarDay(_ date: Date, _ observer: Observer) throws -> (start: Date, end: Date) {
    let transits = try sunTransits(from: date.addingTimeInterval(-1.5 * 86400), to: date.addingTimeInterval(1.5 * 86400), observer: observer)
    let noon = transits.filter { $0.kind == .upper }
        .min { abs($0.time.timeIntervalSince(date)) < abs($1.time.timeIntervalSince(date)) }!.time
    let lower = transits.filter { $0.kind == .lower }.map(\.time)
    return (lower.last { $0 < noon }!, lower.first { $0 > noon }!)
}

// --- Solar guide examples ---------------------------------------------------

/// Solar 4.0.1's `Solar`, computed by Almanac. It takes `latitude` and `longitude` where Solar takes a `CLLocationCoordinate2D`, because CoreLocation is not available on Linux.
struct Solar {
    let latitude: Double
    let longitude: Double
    private(set) var date: Date

    private(set) var sunrise: Date?
    private(set) var sunset: Date?
    private(set) var civilSunrise: Date?
    private(set) var civilSunset: Date?
    private(set) var nauticalSunrise: Date?
    private(set) var nauticalSunset: Date?
    private(set) var astronomicalSunrise: Date?
    private(set) var astronomicalSunset: Date?

    private let observer: Observer

    init?(for date: Date = Date(), latitude: Double, longitude: Double) {
        guard let observer = try? Observer(latitudeDeg: latitude, longitudeDeg: longitude) else { return nil }
        self.date = date
        self.latitude = latitude
        self.longitude = longitude
        self.observer = observer
        calculate()
    }

    mutating func calculate() {
        let morning = events(near: 6)
        let evening = events(near: 18)
        sunrise = morning[.rise]
        sunset = evening[.set]
        civilSunrise = morning[.civilDawn]
        civilSunset = evening[.civilDusk]
        nauticalSunrise = morning[.nauticalDawn]
        nauticalSunset = evening[.nauticalDusk]
        astronomicalSunrise = morning[.astroDawn]
        astronomicalSunset = evening[.astroDusk]
    }

    /// Whether the Sun's upper limb is above the horizon at `date`: the refracted altitude of its center is above minus its semidiameter, about 0.27°.
    var isDaytime: Bool {
        guard let altitude = try? sunAltAz(date, observer: observer).altDeg else { return false }
        return altitude > -0.27
    }

    var isNighttime: Bool { !isDaytime }

    /// Solar's day: the UTC calendar day of `date`, searched 12 hours either side of `hour` o'clock local mean solar time. West of Greenwich a sunset can fall on the next UTC date, and east of it a sunrise on the previous one.
    private func events(near hour: Double) -> [SunEventKind: Date] {
        let midnight = (date.timeIntervalSince1970 / 86400).rounded(.down) * 86400
        let seed = Date(timeIntervalSince1970: midnight + (hour - longitude / 15) * 3600)
        let found = (try? sunEvents(from: seed.addingTimeInterval(-43200), to: seed.addingTimeInterval(43200), observer: observer)) ?? []
        var nearest: [SunEventKind: Date] = [:]
        for event in found where nearest[event.kind].map({ abs(event.time.timeIntervalSince(seed)) < abs($0.timeIntervalSince(seed)) }) ?? true {
            nearest[event.kind] = event.time
        }
        return nearest
    }
}

/// The first of each Sun event in the calendar day containing `date` in `timeZone`. A kind is missing when the Sun does not reach its altitude that day.
func dayEvents(on date: Date, in timeZone: TimeZone, latitude: Double, longitude: Double) throws -> [SunEventKind: Date] {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let day = calendar.dateInterval(of: .day, for: date)!
    let observer = try Observer(latitudeDeg: latitude, longitudeDeg: longitude)
    var first: [SunEventKind: Date] = [:]
    for event in try sunEvents(from: day.start, to: day.end, observer: observer) where first[event.kind] == nil {
        first[event.kind] = event.time
    }
    return first
}

func sunsetToday(latitude: Double, longitude: Double) -> Date? {
    Solar(latitude: latitude, longitude: longitude)?.sunset
}

func eveningInVictoria(_ date: Date) throws -> (sunset: Date?, civilDusk: Date?) {
    let times = try dayEvents(on: date, in: TimeZone(identifier: "America/Vancouver")!, latitude: 48.4284, longitude: -123.3656)
    return (times[.set], times[.civilDusk])
}

// --- checks against SunCalc 2.1.1 -------------------------------------------

final class MigrationGuideTests: XCTestCase {
    struct Reference: Decodable {
        struct Position: Decodable { let azimuth: Double; let altitude: Double }
        struct MoonPosition: Decodable { let altitude: Double; let distance: Double; let parallacticAngle: Double }
        struct Illumination: Decodable { let fraction: Double; let angle: Double }
        let times: [String: String]; let solarDayTimes: [String: String]; let position: Position; let moonPosition: MoonPosition; let moonIllumination: Illumination
    }

    struct File: Decodable { let victoria: Reference }

    func signed180(_ deg: Double) -> Double {
        var x = deg.truncatingRemainder(dividingBy: 360)
        if x < 0 { x += 360 }
        return x > 180 ? x - 360 : x
    }

    func testGuideBlocksAreVerbatim() throws {
        let source = try String(contentsOfFile: #filePath, encoding: .utf8)
        for (name, minimum) in [("migrating-from-suncalc.md", 4), ("migrating-from-solar.md", 4)] {
            let guide = try String(contentsOf: fixturesURL().deletingLastPathComponent().appendingPathComponent("docs/\(name)"), encoding: .utf8)
            let blocks = guide.components(separatedBy: "```swift\n").dropFirst().map { $0.components(separatedBy: "```")[0] }
                .filter { !$0.hasPrefix("// Solar\n") }
            XCTAssertGreaterThanOrEqual(blocks.count, minimum, name)
            for block in blocks { XCTAssertTrue(source.contains(block), "\(name): \(block.prefix(80))") }
        }
    }

    struct SolarCase: Decodable {
        let place: String; let latitude: Double; let longitude: Double; let date: String
        let sunrise: String?; let sunset: String?; let civilSunrise: String?; let civilSunset: String?
        let nauticalSunrise: String?; let nauticalSunset: String?; let astronomicalSunrise: String?; let astronomicalSunset: String?
        let isDaytime: [String: Bool]
    }

    struct SolarFile: Decodable { let solar: String; let cases: [SolarCase] }

    // The worst case differences docs/migrating-from-solar.md states, in seconds,
    // for the four places between 34°S and 49°N and for Longyearbyen at 78°N.
    static let solarTolerance: [String: (mid: Double, polar: Double)] = [
        "sunrise": (48, 160), "sunset": (43, 172),
        "civilSunrise": (44, 144), "civilSunset": (48, 244),
        "nauticalSunrise": (41, 449), "nauticalSunset": (52, 7),
        "astronomicalSunrise": (40, 9), "astronomicalSunset": (59, 5),
    ]

    func testAdapterAgainstSolar() throws {
        let url = fixturesURL().deletingLastPathComponent().appendingPathComponent("swift/Tests/solar-4.0.1.json")
        let file = try JSONDecoder().decode(SolarFile.self, from: Data(contentsOf: url))
        XCTAssertEqual(file.solar, "4.0.1")
        XCTAssertEqual(file.cases.count, 21)
        for c in file.cases {
            let ours = try XCTUnwrap(Solar(for: utc(c.date), latitude: c.latitude, longitude: c.longitude))
            let pairs: [(String, String?, Date?)] = [
                ("sunrise", c.sunrise, ours.sunrise), ("sunset", c.sunset, ours.sunset),
                ("civilSunrise", c.civilSunrise, ours.civilSunrise), ("civilSunset", c.civilSunset, ours.civilSunset),
                ("nauticalSunrise", c.nauticalSunrise, ours.nauticalSunrise), ("nauticalSunset", c.nauticalSunset, ours.nauticalSunset),
                ("astronomicalSunrise", c.astronomicalSunrise, ours.astronomicalSunrise), ("astronomicalSunset", c.astronomicalSunset, ours.astronomicalSunset),
            ]
            for (name, theirs, mine) in pairs {
                let label = "\(c.place) \(c.date) \(name)"
                XCTAssertEqual(theirs == nil, mine == nil, label)
                if let theirs, let mine {
                    let tolerance = Self.solarTolerance[name]!
                    XCTAssertLessThanOrEqual(abs(mine.timeIntervalSince(utc(theirs))), abs(c.latitude) > 60 ? tolerance.polar : tolerance.mid, label)
                }
            }
            for (instant, theirs) in c.isDaytime {
                let at = utc(instant)
                // Skip instants within about a degree of sunrise or sunset, where the two libraries' times differ.
                if abs(try sunAltAz(at, observer: Observer(latitudeDeg: c.latitude, longitudeDeg: c.longitude)).altDeg + 0.27) < 1 { continue }
                let ours = try XCTUnwrap(Solar(for: at, latitude: c.latitude, longitude: c.longitude))
                // Solar needs both a sunrise and a sunset to report daytime, so it says night all through polar day.
                let polarDay = c.sunrise == nil && c.sunset == nil && ours.isDaytime
                XCTAssertEqual(ours.isDaytime, polarDay ? true : theirs, "\(c.place) \(instant)")
                XCTAssertEqual(ours.isNighttime, !ours.isDaytime)
                if polarDay { XCTAssertFalse(theirs) }
            }
        }
    }

    func testSolarGuideExamples() throws {
        // Victoria at 7 pm PDT on June 21: Solar's UTC day is already June 22, so it reports June 22's sunrise and sunset.
        let evening = utc("2026-06-22T02:00:00Z")
        let solar = try XCTUnwrap(Solar(for: evening, latitude: 48.4284, longitude: -123.3656))
        XCTAssertEqual(solar.date, evening)
        XCTAssertEqual(solar.latitude, 48.4284)
        XCTAssertLessThan(abs(solar.sunset!.timeIntervalSince(utc("2026-06-23T04:18:48Z"))), 60)
        let local = try eveningInVictoria(evening)
        XCTAssertLessThan(abs(local.sunset!.timeIntervalSince(utc("2026-06-22T04:18:37Z"))), 60)
        XCTAssertGreaterThan(local.civilDusk!, local.sunset!)

        var copy = solar
        copy.calculate()
        XCTAssertEqual(copy.sunset, solar.sunset)
        XCTAssertNil(Solar(latitude: 91, longitude: 0))
        XCTAssertNotNil(sunsetToday(latitude: 48.4284, longitude: -123.3656))
    }

    func testVictoriaAgainstSunCalc() throws {
        let url = fixturesURL().deletingLastPathComponent().appendingPathComponent("typescript/test/suncalc-2.1.1.json")
        let reference = try JSONDecoder().decode(File.self, from: Data(contentsOf: url)).victoria
        let (lat, lng) = (48.4284, -123.3656)
        let at = utc("2026-03-20T20:00:00Z")

        let sun = try getPosition(at, lat, lng)
        XCTAssertLessThan(abs(signed180(sun.azimuth - reference.position.azimuth)), 0.2)
        XCTAssertLessThan(abs(sun.altitude - reference.position.altitude), 0.2)

        // The civil day of 2026-03-20 at UTC-7, and SunCalc's solar day when the offset is omitted.
        let date = utc("2026-03-20T12:00:00Z")
        let observer = try Observer(latitudeDeg: lat, longitudeDeg: lng)
        for (label, day, theirs) in [("civil", civilDay(date, -420), reference.times), ("solar", try solarDay(date, observer), reference.solarDayTimes)] {
            let times = try sunTimes(day, lat, lng)
            XCTAssertEqual(Set(times.keys), ["sunrise", "sunset", "goldenHourEnd", "goldenHour", "solarNoon"], label)
            for (name, time) in times {
                XCTAssertLessThan(abs(time.timeIntervalSince(utcMs(theirs[name]!))), 10, "\(label) \(name)")
            }
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
