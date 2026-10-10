import XCTest
@testable import Almanac

/// Mirrors the `sunAltitudeEvents` and `sunTransits and moonTransits` blocks of
/// typescript/test/events.test.ts: same fixtures, tolerances, and oracles.
final class TransitsTests: XCTestCase {
    static let victoria = try! Observer(latitudeDeg: 48.7621, longitudeDeg: -123.052)
    static let polar = try! Observer(latitudeDeg: 70.5, longitudeDeg: -123.052)
    static let day = 86400.0

    struct AltAzRow: Decodable { let utc: String; let altDeg: Double; let siteLatDeg: Double; let siteLonDeg: Double }

    func load<T: Decodable>(_ type: T.Type, _ path: String) throws -> T {
        try JSONDecoder().decode(type, from: Data(contentsOf: fixturesURL().appendingPathComponent(path)))
    }

    // ------------------------------------------------ caller-chosen altitudes

    func testHorizonsAltitudeCrossingsOneForOne() throws {
        let rows = try load([AltAzRow].self, "altaz/sun-airless-twilight.json")
        var blocks: [[AltAzRow]] = []
        for r in rows {
            if let last = blocks.last?.last, last.siteLatDeg == r.siteLatDeg, utc(r.utc).timeIntervalSince(utc(last.utc)) == 60 {
                blocks[blocks.count - 1].append(r)
            } else {
                blocks.append([r])
            }
        }
        var worst = 0.0
        var checked = 0
        for block in blocks {
            let observer = try Observer(latitudeDeg: block[0].siteLatDeg, longitudeDeg: block[0].siteLonDeg)
            let start = utc(block[0].utc), end = utc(block.last!.utc)
            for level in [6.0, -0.3, -4, -8] {
                var expected: [(time: Date, kind: String)] = []
                for i in 1..<block.count {
                    let fa = block[i - 1].altDeg - level, fb = block[i].altDeg - level
                    if (fa < 0) == (fb < 0) { continue }
                    expected.append((utc(block[i - 1].utc).addingTimeInterval(60 * -fa / (fb - fa)), fb >= 0 ? "rising" : "falling"))
                }
                let found = try sunAltitudeEvents(from: start, to: end, observer: observer, altitudeDeg: level)
                let label = "\(level)° @ \(block[0].utc) lat \(observer.latitudeDeg)"
                XCTAssertEqual(found.map(\.kind.rawValue), expected.map(\.kind), label)
                for (f, e) in zip(found, expected) {
                    let diff = abs(f.time.timeIntervalSince(e.time))
                    worst = max(worst, diff)
                    XCTAssertLessThan(diff, 60, label)
                    checked += 1
                }
            }
        }
        print("Horizons altitude crossings: \(checked) crossings, worst \(String(format: "%.1f", worst)) s")
        XCTAssertGreaterThan(checked, 60)
    }

    func testNearPolarGrazingAndEmptyDays() throws {
        func kinds(_ iso: String, _ level: Double) throws -> [String] {
            let start = utc("\(iso)T00:00:00Z")
            return try sunAltitudeEvents(from: start, to: start.addingTimeInterval(Self.day), observer: Self.polar, altitudeDeg: level).map(\.kind.rawValue)
        }
        XCTAssertEqual(try kinds("2026-02-11", 6), [])
        XCTAssertEqual(try kinds("2026-02-12", 6), ["rising", "falling"])
        XCTAssertEqual(try kinds("2026-05-17", -0.3), [])
        XCTAssertEqual(try kinds("2026-05-16", -0.3), ["falling", "rising"])
        XCTAssertEqual(try kinds("2026-12-21", 6), [])
        XCTAssertEqual(try kinds("2026-12-21", -4), ["rising", "falling"])
    }

    func testMinusSixIsCivilTwilight() throws {
        for observer in [Self.victoria, Self.polar, try Observer(latitudeDeg: -88.5, longitudeDeg: -123.052)] {
            let start = utc("2026-01-01T00:00:00Z"), end = utc("2027-01-01T00:00:00Z")
            let civil = try sunEvents(from: start, to: end, observer: observer)
                .filter { $0.kind == .civilDawn || $0.kind == .civilDusk }
                .map { "\($0.time.timeIntervalSince1970) \($0.kind == .civilDawn ? "rising" : "falling")" }
            let mine = try sunAltitudeEvents(from: start, to: end, observer: observer, altitudeDeg: -6)
                .map { "\($0.time.timeIntervalSince1970) \($0.kind.rawValue)" }
            XCTAssertEqual(mine, civil, "lat \(observer.latitudeDeg)")
        }
    }

    func testCrossingsSitOnTheRequestedAltitude() throws {
        var worst = 0.0
        for latitudeDeg in [-89.5, -35, 0, 48.7621, 70.5, 86, 88.9, 90] {
            let observer = try Observer(latitudeDeg: latitudeDeg, longitudeDeg: -123.052)
            let flat = abs(latitudeDeg) >= 85
            let start = utc("2026-01-01T00:00:00Z")
            let end = start.addingTimeInterval((flat ? 366 : 40) * Self.day)
            for level in flat ? [-0.3, 2, -4] : [12.5, -0.3, -8, 40] {
                func offset(_ t: Date) -> Double {
                    let ut = utDays(t)
                    return topoAltAzUnrefracted(sunGeoVectorEqj(ttDaysFromUt(ut)), ut, observer).altDeg - level
                }
                for e in try sunAltitudeEvents(from: start, to: end, observer: observer, altitudeDeg: level) {
                    let rate = (offset(e.time.addingTimeInterval(30)) - offset(e.time.addingTimeInterval(-30))) / 60
                    XCTAssertEqual(rate > 0, e.kind == .rising, "lat \(latitudeDeg) \(level)°")
                    let seconds = abs(offset(e.time) / rate)
                    worst = max(worst, seconds)
                    XCTAssertLessThan(seconds, 1, "lat \(latitudeDeg) \(level)° @ \(e.time)")
                }
            }
        }
        print("altitude-event residual: worst \(String(format: "%.3f", worst)) s")
    }

    func testAltitudeFlatteningBandBruteForceOracle() throws {
        let observer = try Observer(latitudeDeg: 88.5, longitudeDeg: -123.052)
        let start = utc("2026-03-10T00:00:00Z")
        let end = start.addingTimeInterval(20 * Self.day)
        func offset(_ t: Date) -> Double {
            let ut = utDays(t)
            return topoAltAzUnrefracted(sunGeoVectorEqj(ttDaysFromUt(ut)), ut, observer).altDeg + 0.3
        }
        var brute: [(time: Date, kind: String)] = []
        var prev = offset(start)
        var t = start.addingTimeInterval(60)
        while t <= end {
            let cur = offset(t)
            if prev < 0 && cur >= 0 { brute.append((t, "rising")) }
            if prev >= 0 && cur < 0 { brute.append((t, "falling")) }
            prev = cur
            t = t.addingTimeInterval(60)
        }
        XCTAssertGreaterThan(brute.count, 1)
        let mine = try sunAltitudeEvents(from: start, to: end, observer: observer, altitudeDeg: -0.3)
        XCTAssertEqual(mine.map(\.kind.rawValue), brute.map(\.kind))
        for (m, b) in zip(mine, brute) { XCTAssertLessThan(abs(m.time.timeIntervalSince(b.time)), 60) }
    }

    func testAltitudeValidationAndWindow() throws {
        let t1 = utc("2026-08-28T00:00:00Z"), t2 = utc("2026-08-29T00:00:00Z")
        for bad in [Double.nan, .infinity, -90.0001, 91] {
            XCTAssertThrowsError(try sunAltitudeEvents(from: t2, to: t1, observer: Self.victoria, altitudeDeg: bad)) {
                guard case AlmanacError.invalidArgument = $0 else { return XCTFail("\(bad): \($0)") }
            }
        }
        XCTAssertEqual(try sunAltitudeEvents(from: t1, to: t2, observer: Self.victoria, altitudeDeg: 90).count, 0)
        XCTAssertEqual(try sunAltitudeEvents(from: t1, to: t2, observer: Self.victoria, altitudeDeg: -90).count, 0)
        XCTAssertThrowsError(try sunAltitudeEvents(from: Date(timeIntervalSince1970: .nan), to: t1, observer: Self.victoria, altitudeDeg: 6))
        XCTAssertThrowsError(try sunAltitudeEvents(from: utc("1949-12-31T00:00:00Z"), to: t1, observer: Self.victoria, altitudeDeg: 6)) {
            XCTAssertEqual($0 as? AlmanacError, .outOfRange)
        }
        XCTAssertEqual(try sunAltitudeEvents(from: t1, to: t1, observer: Self.victoria, altitudeDeg: 6).count, 0)
        XCTAssertEqual(try sunAltitudeEvents(from: t2, to: t1, observer: Self.victoria, altitudeDeg: 6).count, 0)
        let events = try sunAltitudeEvents(from: t1, to: t2, observer: Self.victoria, altitudeDeg: 6)
        XCTAssertEqual(events.map(\.kind), [.falling, .rising])
        let at = events[0].time
        XCTAssertEqual(try sunAltitudeEvents(from: t1, to: at, observer: Self.victoria, altitudeDeg: 6).count, 0)
        XCTAssertEqual(try sunAltitudeEvents(from: at, to: t2, observer: Self.victoria, altitudeDeg: 6).first?.time, at)
        XCTAssertNoThrow(try sunAltitudeEvents(from: supportedMax.addingTimeInterval(-Self.day), to: supportedMax, observer: Self.victoria, altitudeDeg: 6))
    }

    // ---------------------------------------------------------------- transits

    func testSunUpperTransitIsSunEventsTransit() throws {
        for observer in [Self.victoria, Self.polar, try Observer(latitudeDeg: -88.5, longitudeDeg: 10)] {
            let start = utc("2026-01-01T00:00:00Z"), end = utc("2027-01-01T00:00:00Z")
            let want = try sunEvents(from: start, to: end, observer: observer).filter { $0.kind == .transit }.map(\.time)
            let transits = try sunTransits(from: start, to: end, observer: observer)
            XCTAssertEqual(transits.filter { $0.kind == .upper }.map(\.time), want)
            for i in 1..<transits.count {
                XCTAssertNotEqual(transits[i].kind, transits[i - 1].kind)
                XCTAssertGreaterThan(transits[i].time, transits[i - 1].time)
            }
        }
    }

    func testUsnoTransitsWithin60s() throws {
        var worst = 0.0
        var checked = 0
        for row in try EventsTests.loadGrid() {
            let observer = try Observer(latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg)
            let dayStart = utc("\(row.date)T00:00:00Z"), dayEnd = dayStart.addingTimeInterval(Self.day)
            for (body, key, kind) in [("moon", "transit", TransitEventKind.upper), ("moon", "lowerTransit", .lower), ("sun", "lowerTransit", .lower)] {
                guard let want = (body == "sun" ? row.sun : row.moon)[key] else { continue }
                let found = try (body == "sun" ? sunTransits(from: dayStart, to: dayEnd, observer: observer)
                    : moonTransits(from: dayStart, to: dayEnd, observer: observer)).filter { $0.kind == kind }
                let label = "\(body) \(kind) @ \(row.date) lat \(row.latitudeDeg)"
                XCTAssertEqual(found.count, 1, label)
                guard let first = found.first else { continue }
                let diff = abs(first.time.timeIntervalSince(utc("\(row.date)T\(want):00Z")))
                worst = max(worst, diff)
                XCTAssertLessThan(diff, 60, label)
                checked += 1
            }
        }
        print("USNO transits: \(checked) checked, worst \(String(format: "%.1f", worst)) s")
        XCTAssertGreaterThan(checked, 40)
    }

    struct TransitGrid: Decodable {
        struct Site: Decodable { let latitudeDeg: Double; let longitudeDeg: Double }
        struct Row: Decodable { let utc: String; let kind: String }
        let body: String; let observer: Site; let startUtc: String; let endUtc: String; let transits: [Row]
    }

    func testHorizonsHourAngleTransits() throws {
        var worst = 0.0
        for grid in try load([TransitGrid].self, "altaz/transits.json") {
            let observer = try Observer(latitudeDeg: grid.observer.latitudeDeg, longitudeDeg: grid.observer.longitudeDeg)
            let start = utc(grid.startUtc), end = utc(grid.endUtc)
            let found = try grid.body == "sun" ? sunTransits(from: start, to: end, observer: observer)
                : moonTransits(from: start, to: end, observer: observer)
            let label = "\(grid.body) lat \(grid.observer.latitudeDeg)"
            XCTAssertEqual(found.map(\.kind.rawValue), grid.transits.map(\.kind), label)
            for (f, e) in zip(found, grid.transits) {
                let diff = abs(f.time.timeIntervalSince(utcMs(e.utc)))
                worst = max(worst, diff)
                XCTAssertLessThan(diff, 60, "\(label) @ \(e.utc)")
            }
        }
        print("Horizons transits: worst \(String(format: "%.1f", worst)) s")
    }

    func testTransitFlatteningBandBruteForceOracle() throws {
        let bodies: [(String, (Double) -> Vec3, (Date, Date, Observer) throws -> [TransitEvent])] = [
            ("sun", sunGeoVectorEqj, { try sunTransits(from: $0, to: $1, observer: $2) }),
            ("moon", moonGeoVectorEqj, { try moonTransits(from: $0, to: $1, observer: $2) }),
        ]
        for (name, vector, transits) in bodies {
            for latitudeDeg in [-88.5, 89.5] {
                let observer = try Observer(latitudeDeg: latitudeDeg, longitudeDeg: -123.052)
                let start = utc("2026-09-10T00:00:00Z"), end = start.addingTimeInterval(30 * Self.day)
                func ha(_ t: Date) -> Double {
                    let ut = utDays(t)
                    return topoAltAzUnrefracted(vector(ttDaysFromUt(ut)), ut, observer).hourAngleDeg
                }
                var brute: [(time: Date, kind: String)] = []
                var prev = ha(start)
                var t = start.addingTimeInterval(60)
                while t <= end {
                    let cur = ha(t)
                    if cur < prev { brute.append((t, "upper")) } else if prev < 180 && cur >= 180 { brute.append((t, "lower")) }
                    prev = cur
                    t = t.addingTimeInterval(60)
                }
                let mine = try transits(start, end, observer)
                XCTAssertEqual(mine.map(\.kind.rawValue), brute.map(\.kind), "\(name) lat \(latitudeDeg)")
                for (m, b) in zip(mine, brute) { XCTAssertLessThan(abs(m.time.timeIntervalSince(b.time)), 60, "\(name) lat \(latitudeDeg)") }
            }
        }
    }

    func testTransitValidationAndWindow() throws {
        let t1 = utc("2026-08-28T00:00:00Z"), t2 = utc("2026-08-29T00:00:00Z")
        let fns: [(Date, Date, Observer) throws -> [TransitEvent]] = [
            { try sunTransits(from: $0, to: $1, observer: $2) }, { try moonTransits(from: $0, to: $1, observer: $2) },
        ]
        for fn in fns {
            XCTAssertThrowsError(try fn(Date(timeIntervalSince1970: .nan), t1, Self.victoria))
            XCTAssertThrowsError(try fn(utc("1949-12-31T00:00:00Z"), t1, Self.victoria)) { XCTAssertEqual($0 as? AlmanacError, .outOfRange) }
            XCTAssertEqual(try fn(t1, t1, Self.victoria).count, 0)
            XCTAssertEqual(try fn(t2, t1, Self.victoria).count, 0)
            let found = try fn(t1, t2, Self.victoria)
            XCTAssertFalse(found.isEmpty)
            let at = found[0].time
            XCTAssertFalse(try fn(t1, at, Self.victoria).contains { $0.time == at })
            XCTAssertEqual(try fn(at, t2, Self.victoria).first?.time, at)
            for e in found { XCTAssertEqual((e.time.timeIntervalSince1970 * 1000).rounded(), e.time.timeIntervalSince1970 * 1000) }
            XCTAssertNoThrow(try fn(supportedMax.addingTimeInterval(-Self.day), supportedMax, Self.victoria))
        }
    }
}
