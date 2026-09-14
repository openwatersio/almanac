import XCTest
@testable import Almanac

/// Mirrors typescript/test/solar.test.ts: same fixtures, same tolerances.
/// The TS input-validation cases for an invalid observer have no Swift
/// counterpart: `Observer`'s throwing initializer already refuses one.
final class SolarTests: XCTestCase {
    static let victoria = try! Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 0)
    static let day = 86400.0
    /// A path at least this wide keeps the catalog's whole-degree observer inside it.
    static let widePathKm = 200.0

    struct CatalogRow: Decodable {
        let peakUtc: String
        let kind: String
        let central: Bool
        let gamma: Double
        let magnitude: Double
        let latitudeDeg: Double
        let longitudeDeg: Double
        let sunAltDeg: Double
        let pathWidthKm: Double?
        var observer: Observer { try! Observer(latitudeDeg: latitudeDeg, longitudeDeg: longitudeDeg) }
        var wide: Bool { pathWidthKm.map { $0 >= SolarTests.widePathKm } ?? false }
    }

    static func loadCatalog() throws -> [CatalogRow] {
        let url = fixturesURL().appendingPathComponent("eclipses").appendingPathComponent("solar-catalog.json")
        return try JSONDecoder().decode([CatalogRow].self, from: Data(contentsOf: url))
    }
    static let catalog: [CatalogRow] = try! loadCatalog()

    struct Contact: Decodable { let utc: String; let sunAltDeg: Double? }
    struct LocalRow: Decodable {
        let eclipse: String; let place: String; let latitudeDeg: Double; let longitudeDeg: Double; let visible: Bool
        let kind: String?; let magnitude: Double?; let obscuration: Double?
        let c1: Contact?; let c2: Contact?; let peak: Contact?; let c3: Contact?; let c4: Contact?
        var observer: Observer { try! Observer(latitudeDeg: latitudeDeg, longitudeDeg: longitudeDeg) }
        /// The window `[eclipse day − 1, eclipse day + 2)` a USNO case lives in.
        var window: (Date, Date) {
            let day = utc("\(eclipse)T00:00:00Z")
            return (day.addingTimeInterval(-SolarTests.day), day.addingTimeInterval(2 * SolarTests.day))
        }
    }
    static func loadLocal() throws -> [LocalRow] {
        let url = fixturesURL().appendingPathComponent("eclipses").appendingPathComponent("solar-local.json")
        return try JSONDecoder().decode([LocalRow].self, from: Data(contentsOf: url))
    }
    static let local: [LocalRow] = try! loadLocal()

    /// Every eclipse Victoria can see, 1950-2100, by repeated next.
    static let walk: [SolarEclipse] = {
        var found: [SolarEclipse] = []
        var cursor = supportedMin
        while true {
            do {
                let e = try nextSolarEclipse(after: cursor, observer: victoria)
                found.append(e)
                cursor = e.peak
            } catch AlmanacError.outOfRange {
                break
            } catch {
                fatalError("unexpected error in solar eclipse walk: \(error)")
            }
        }
        return found
    }()

    static func ms(_ d: Date) -> Double { (d.timeIntervalSince1970 * 1000).rounded() }
    static func date(ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }

    // --------------------------------------- solarObscuration at greatest eclipse

    func testCatalogCovers1950To2100() {
        XCTAssertGreaterThan(Self.catalog.count, 300)
        XCTAssertTrue(Self.catalog.first!.peakUtc.hasPrefix("1950"))
        XCTAssertTrue(Self.catalog.last!.peakUtc.hasPrefix("2100"))
    }

    func testObscurationAtGreatestEclipseMatchesEveryCatalogKind() throws {
        var bad: [String] = []
        for row in Self.catalog {
            let obs = try solarObscuration(at: utc(row.peakUtc), observer: row.observer)
            let ok: Bool
            switch row.kind {
            case "partial": ok = obs > 0
            case "annular": ok = row.wide ? abs(obs - row.magnitude * row.magnitude) <= 0.01 : obs >= row.magnitude * row.magnitude - 0.1
            default: ok = row.wide ? obs == 1 : obs >= 0.9   // total and hybrid
            }
            if !ok { bad.append("\(row.peakUtc) \(row.kind)\(row.wide ? "" : " (narrow)"): obscuration \(obs), magnitude \(row.magnitude)") }
        }
        XCTAssertEqual(bad, [])
    }

    func testObscurationIsZeroADayFromAnyEclipse() throws {
        XCTAssertEqual(try solarObscuration(at: utc("2026-01-15T20:00:00Z"), observer: Self.victoria), 0)
    }

    func testObscurationValidatesItsInputs() {
        XCTAssertThrowsError(try solarObscuration(at: supportedMax, observer: Self.victoria)) {
            XCTAssertEqual($0 as? AlmanacError, .outOfRange)
        }
        XCTAssertThrowsError(try solarObscuration(at: Date(timeIntervalSince1970: .nan), observer: Self.victoria)) { error in
            guard case AlmanacError.invalidArgument = error else { return XCTFail("expected invalidArgument, got \(error)") }
        }
    }

    // ------------------------------------------- local circumstances vs USNO

    func testUsnoCases() throws {
        for row in Self.local {
            let (from, to) = row.window
            let found = try solarEclipses(from: from, to: to, observer: row.observer)
            let label = "\(row.eclipse) \(row.place)"
            guard row.visible else {
                XCTAssertTrue(found.isEmpty, "\(label): nothing to see")
                continue
            }
            XCTAssertEqual(found.count, 1, "\(label): one eclipse")
            guard let e = found.first else { continue }
            XCTAssertEqual(e.kind.rawValue, row.kind, label)
            let pairs: [(String, Contact?, Date?, Double?)] = [
                ("c1", row.c1, e.c1, e.sunAltDeg.c1), ("c2", row.c2, e.c2, e.sunAltDeg.c2), ("peak", row.peak, e.peak, e.sunAltDeg.peak),
                ("c3", row.c3, e.c3, e.sunAltDeg.c3), ("c4", row.c4, e.c4, e.sunAltDeg.c4)
            ]
            for (k, want, got, gotAlt) in pairs {
                guard let want else {
                    // c2/c3 absent for a partial; c1/c4 absent when USNO listed a
                    // sunrise or sunset instead, which means the Sun was down at ours.
                    if k == "c2" || k == "c3" { XCTAssertNil(got, "\(label) \(k) should be absent") }
                    else { XCTAssertLessThan(gotAlt!, 0, "\(label) \(k) should be below the horizon") }
                    continue
                }
                guard let got, let gotAlt else { XCTFail("\(label) \(k) should be present"); continue }
                let err = abs(got.timeIntervalSince(utcMs(want.utc)))
                XCTAssertLessThanOrEqual(err, k == "peak" ? 300 : 60, "\(label) \(k) off by \(err) s")
                if let wantAlt = want.sunAltDeg {
                    // USNO reports the geometric altitude; refract it with the port's own model to compare like with like.
                    XCTAssertLessThanOrEqual(abs(gotAlt - (wantAlt + refractionDeg(wantAlt))), k == "peak" ? 1.5 : 0.5, "\(label) \(k) altitude")
                }
            }
            XCTAssertLessThanOrEqual(abs(e.obscuration - row.obscuration!), 0.01, "\(label) obscuration")
        }
    }

    // ------------------------------------------------ the search vs the catalog

    func testFindsEveryCentralEclipseFromItsGreatestEclipsePoint() throws {
        var bad: [String] = []
        for row in Self.catalog where row.kind != "partial" && row.central {
            let peak = utc(row.peakUtc)
            let found = try solarEclipses(from: peak.addingTimeInterval(-Self.day), to: peak.addingTimeInterval(Self.day), observer: row.observer)
            guard found.count == 1, let e = found.first else { bad.append("\(row.peakUtc): \(found.count) eclipses"); continue }
            let dt = abs(e.peak.timeIntervalSince(peak))
            if dt > 300 { bad.append("\(row.peakUtc): peak off by \(dt) s") }
            var wanted = row.kind == "hybrid" ? ["total", "annular"] : [row.kind]
            if !row.wide { wanted.append("partial") }
            if !wanted.contains(e.kind.rawValue) { bad.append("\(row.peakUtc): kind \(e.kind.rawValue), catalog \(row.kind)\(row.wide ? "" : " (narrow path)")") }
            if abs(e.sunAltDeg.peak - row.sunAltDeg) > 2 { bad.append("\(row.peakUtc): peak altitude \(e.sunAltDeg.peak), catalog \(row.sunAltDeg)") }
        }
        XCTAssertEqual(bad, [])
    }

    func testDropsAnEclipseTheAntipodeCouldOnlySeeThroughTheEarth() throws {
        // Under |gamma| 0.2 the antipode's axis distance (2·gamma·R) is inside
        // the penumbra, so only the night filter can exclude it.
        let rows = Self.catalog.filter { $0.central && $0.kind != "partial" && abs($0.gamma) < 0.2 }
        XCTAssertGreaterThan(rows.count, 10)
        for row in rows {
            let antipode = try Observer(
                latitudeDeg: -row.latitudeDeg,
                longitudeDeg: row.longitudeDeg > 0 ? row.longitudeDeg - 180 : row.longitudeDeg + 180)
            let peak = utc(row.peakUtc)
            XCTAssertGreaterThan(try solarObscuration(at: peak, observer: antipode), 0, "\(row.peakUtc) antipode obscuration")
            XCTAssertTrue(try solarEclipses(from: peak.addingTimeInterval(-Self.day), to: peak.addingTimeInterval(Self.day), observer: antipode).isEmpty, "\(row.peakUtc) antipode search")
        }
    }

    // ------------------------------------------------- search semantics

    func testVictoriaSeesAFewDozenStrictlyAscending() {
        XCTAssertGreaterThan(Self.walk.count, 30)
        for i in 1..<Self.walk.count { XCTAssertGreaterThan(Self.walk[i].peak, Self.walk[i - 1].peak) }
    }

    static func assertSame(_ a: SolarEclipse, _ b: SolarEclipse, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(a.kind, b.kind, file: file, line: line)
        XCTAssertEqual(a.obscuration, b.obscuration, file: file, line: line)
        XCTAssertEqual(a.c1, b.c1, file: file, line: line); XCTAssertEqual(a.c2, b.c2, file: file, line: line)
        XCTAssertEqual(a.peak, b.peak, file: file, line: line)
        XCTAssertEqual(a.c3, b.c3, file: file, line: line); XCTAssertEqual(a.c4, b.c4, file: file, line: line)
        XCTAssertEqual(a.sunAltDeg.c1, b.sunAltDeg.c1, file: file, line: line); XCTAssertEqual(a.sunAltDeg.c2, b.sunAltDeg.c2, file: file, line: line)
        XCTAssertEqual(a.sunAltDeg.peak, b.sunAltDeg.peak, file: file, line: line)
        XCTAssertEqual(a.sunAltDeg.c3, b.sunAltDeg.c3, file: file, line: line); XCTAssertEqual(a.sunAltDeg.c4, b.sunAltDeg.c4, file: file, line: line)
    }

    func testBackwardAndRangeSearchesFindTheSameEclipses() throws {
        var backward: [SolarEclipse] = []
        var cursor = supportedMax.addingTimeInterval(-0.001)
        for _ in 0...Self.walk.count {
            do {
                let e = try previousSolarEclipse(before: cursor, observer: Self.victoria)
                XCTAssertLessThan(e.peak, cursor)
                backward.append(e)
                cursor = e.peak
            } catch AlmanacError.outOfRange { break }
        }
        let range = try solarEclipses(from: supportedMin, to: supportedMax, observer: Self.victoria)
        for found in [Array(backward.reversed()), range] {
            XCTAssertEqual(found.count, Self.walk.count)
            for (e, want) in zip(found, Self.walk) { Self.assertSame(e, want) }
        }
    }

    func testRangeIncludesEachPeakAtStartAndExcludesItAtEnd() throws {
        for e in Self.walk {
            let ms = Self.ms(e.peak)
            XCTAssertEqual(try solarEclipses(from: e.peak, to: Self.date(ms: ms + 1), observer: Self.victoria).map(\.peak), [e.peak], "\(e.peak)")
            XCTAssertTrue(try solarEclipses(from: Self.date(ms: ms - 1), to: e.peak, observer: Self.victoria).isEmpty, "\(e.peak)")
        }
    }

    func testPinsTheSameEclipseBandAt100Ms() throws {
        let e = Self.walk.first { $0.peak > utc("2000-01-01T00:00:00Z") }!
        let ms = Self.ms(e.peak)
        XCTAssertGreaterThan(try nextSolarEclipse(after: Self.date(ms: ms - 100), observer: Self.victoria).peak, e.peak)
        XCTAssertEqual(try nextSolarEclipse(after: Self.date(ms: ms - 101), observer: Self.victoria).peak, e.peak)
        XCTAssertLessThan(try previousSolarEclipse(before: Self.date(ms: ms + 100), observer: Self.victoria).peak, e.peak)
        XCTAssertEqual(try previousSolarEclipse(before: Self.date(ms: ms + 101), observer: Self.victoria).peak, e.peak)
    }

    func testContactsInOrderIntegerMsWithSunAltAzAltitudes() throws {
        for e in Self.walk {
            let order = [e.c1, e.c2, e.peak, e.c3, e.c4].compactMap { $0 }
            for i in 1..<order.count { XCTAssertGreaterThan(order[i], order[i - 1]) }
            for d in order { XCTAssertEqual(try normalized(d), d, "\(d) is not an integer-millisecond instant") }
            XCTAssertEqual(e.c2 == nil, e.kind == .partial)
            XCTAssertEqual(e.c3 == nil, e.kind == .partial)
            XCTAssertEqual(e.sunAltDeg.c1, try sunAltAz(e.c1, observer: Self.victoria).altDeg)
            XCTAssertEqual(e.sunAltDeg.peak, try sunAltAz(e.peak, observer: Self.victoria).altDeg)
            XCTAssertEqual(e.sunAltDeg.c4, try sunAltAz(e.c4, observer: Self.victoria).altDeg)
            XCTAssertTrue(e.sunAltDeg.c1 > 0 || e.sunAltDeg.peak > 0 || e.sunAltDeg.c4 > 0)
            if e.kind == .total { XCTAssertEqual(e.obscuration, 1) } else {
                XCTAssertGreaterThan(e.obscuration, 0); XCTAssertLessThan(e.obscuration, 1)
            }
        }
    }

    func testObscurationAtAnInstantAgreesWithThePeakAndReachesOneInTotality() throws {
        let victoria2024 = Self.local.first { $0.place.hasPrefix("Victoria") }!
        var (from, to) = victoria2024.window
        let e = try solarEclipses(from: from, to: to, observer: victoria2024.observer)[0]
        XCTAssertEqual(try solarObscuration(at: e.peak, observer: victoria2024.observer), e.obscuration, accuracy: 1e-6)

        let salem = Self.local.first { $0.place.hasPrefix("Salem") }!
        (from, to) = salem.window
        let t = try solarEclipses(from: from, to: to, observer: salem.observer)[0]
        let mid = Date(timeIntervalSince1970: (t.c2!.timeIntervalSince1970 + t.c3!.timeIntervalSince1970) / 2)
        XCTAssertEqual(try solarObscuration(at: mid, observer: salem.observer), 1)
        XCTAssertEqual(try solarObscuration(at: t.c1.addingTimeInterval(-60), observer: salem.observer), 0)
    }

    func testValidatesBeforeEmptyWindowAndReachesBoundaryAsOutOfRange() throws {
        let from = utc("2026-09-01T00:00:00Z"), to = utc("2026-09-10T12:00:00Z")
        XCTAssertTrue(try solarEclipses(from: from, to: to, observer: Self.victoria).isEmpty)
        XCTAssertTrue(try solarEclipses(from: to, to: from, observer: Self.victoria).isEmpty)
        let nan = Date(timeIntervalSince1970: .nan)
        for query in [
            { _ = try solarEclipses(from: nan, to: to, observer: Self.victoria) },
            { _ = try solarEclipses(from: from, to: nan, observer: Self.victoria) },
            { _ = try nextSolarEclipse(after: nan, observer: Self.victoria) }
        ] {
            XCTAssertThrowsError(try query()) { error in
                guard case AlmanacError.invalidArgument = error else { return XCTFail("expected invalidArgument, got \(error)") }
            }
        }
        for query in [
            { _ = try solarEclipses(from: supportedMin.addingTimeInterval(-0.001), to: to, observer: Self.victoria) },
            { _ = try solarEclipses(from: from, to: supportedMax.addingTimeInterval(0.001), observer: Self.victoria) },
            { _ = try nextSolarEclipse(after: utc(Self.catalog.last!.peakUtc).addingTimeInterval(Self.day), observer: Self.victoria) },
            { _ = try previousSolarEclipse(before: utc(Self.catalog.first!.peakUtc).addingTimeInterval(-Self.day), observer: Self.victoria) },
            { _ = try previousSolarEclipse(before: supportedMax, observer: Self.victoria) }
        ] {
            XCTAssertThrowsError(try query()) { XCTAssertEqual($0 as? AlmanacError, .outOfRange) }
        }
    }

    func testNightFilterKeepsAnEclipseTheSunIsUpForOnlyAtItsPeak() throws {
        // 68°N in early December: the Sun clears the horizon for minutes around
        // noon, and on 1956-12-02 the local peak falls inside them while C1 and
        // C4 do not. Upstream would drop this eclipse; the peak clause keeps it.
        let polar = try Observer(latitudeDeg: 68, longitudeDeg: 60)
        let found = try solarEclipses(from: utc("1956-12-01T00:00:00Z"), to: utc("1956-12-04T00:00:00Z"), observer: polar)
        XCTAssertEqual(found.count, 1)
        guard let e = found.first else { return }
        XCTAssertLessThan(e.sunAltDeg.c1, 0)
        XCTAssertGreaterThan(e.sunAltDeg.peak, 0)
        XCTAssertLessThan(e.sunAltDeg.c4, 0)
    }
}
