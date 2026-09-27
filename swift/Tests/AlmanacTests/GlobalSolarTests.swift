import XCTest
@testable import Almanac

/// Mirrors typescript/test/globalSolar.test.ts: same fixture, same tolerances.
final class GlobalSolarTests: XCTestCase {
    static let day = 86400.0
    /// Espenak's gamma is the axis distance in equatorial Earth radii.
    static let gammaRadiusKm = 6378.137
    /// Beyond this axis distance the axis meets the ground so obliquely that its point is hypersensitive; upstream skips the location check there too.
    static let glancingAxisKm = 6100.0

    static let catalog: [SolarTests.CatalogRow] = SolarTests.catalog

    /// The kind at the greatest-eclipse point. A non-central row (type flag
    /// `+` or `-`) has an axis that misses the Earth, so nobody sees its
    /// central phase, and a hybrid path is total at greatest eclipse.
    static func expectedKind(_ row: SolarTests.CatalogRow) -> SolarEclipseKind {
        if row.kind == "partial" || !row.central { return .partial }
        return row.kind == "hybrid" ? .total : SolarEclipseKind(rawValue: row.kind)!
    }

    /// UPSTREAM test.js `AngleDiff`: the great-circle angle between two points, degrees.
    static func angleDiffDeg(_ aLat: Double, _ aLon: Double, _ bLat: Double, _ bLon: Double) -> Double {
        let r = Double.pi / 180
        let a = [cos(aLon * r) * cos(aLat * r), sin(aLon * r) * cos(aLat * r), sin(aLat * r)]
        let b = [cos(bLon * r) * cos(bLat * r), sin(bLon * r) * cos(bLat * r), sin(bLat * r)]
        let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
        if dot <= -1 { return 180 }
        if dot >= 1 { return 0 }
        return acos(dot) / r
    }

    /// Every solar eclipse on Earth, 1950-2100, by repeated next.
    static let walk: [GlobalSolarEclipse] = {
        var found: [GlobalSolarEclipse] = []
        var cursor = supportedMin
        while true {
            do {
                let e = try nextGlobalSolarEclipse(after: cursor)
                found.append(e)
                cursor = e.peak
            } catch AlmanacError.outOfRange {
                break
            } catch {
                fatalError("unexpected error in global solar eclipse walk: \(error)")
            }
        }
        return found
    }()

    static func ms(_ d: Date) -> Double { (d.timeIntervalSince1970 * 1000).rounded() }
    static func date(ms: Double) -> Date { Date(timeIntervalSince1970: ms / 1000) }
    static func groundPoint(_ e: GlobalSolarEclipse) -> Observer {
        try! Observer(latitudeDeg: e.latitudeDeg!, longitudeDeg: e.longitudeDeg!)
    }

    // ---------------------------------------------------- the Espenak catalog

    func testWalksEveryCatalogEclipseExactlyOnceAndNothingElse() {
        // Upstream's own test tolerates up to two marginal partial eclipses
        // near the penumbral limit that its model finds and the catalog omits.
        // Over 1950-2100 this port finds none, so the count is exact: a change
        // that adds or drops one fails here. Index alignment is the peak test.
        XCTAssertEqual(Self.catalog.count, 337)
        XCTAssertEqual(Self.walk.count, Self.catalog.count)
        for i in 1..<Self.walk.count { XCTAssertGreaterThan(Self.walk[i].peak, Self.walk[i - 1].peak) }
    }

    func testGreatestEclipseWithin60Seconds() {
        // Measured worst 8.2 s (2081-09-03). The catalog's UT is its TD minus
        // its Delta-T column, this port's Espenak–Meeus model in whole seconds
        // (within 0.8 s on every row), so no Delta-T floor.
        var worst = 0.0, worstAt = ""
        for (e, row) in zip(Self.walk, Self.catalog) {
            let err = abs(e.peak.timeIntervalSince(utc(row.peakUtc)))
            if err > worst { worst = err; worstAt = row.peakUtc }
        }
        XCTAssertLessThanOrEqual(worst, 60, "worst peak error \(worst) s at \(worstAt)")
    }

    func testKindMatchesEveryRow() {
        // Hybrid is total at greatest eclipse, and a non-central axis misses the Earth.
        var bad: [String] = []
        for (e, row) in zip(Self.walk, Self.catalog) where e.kind != Self.expectedKind(row) {
            bad.append("\(row.peakUtc): got \(e.kind.rawValue), catalog \(row.kind)\(row.central ? "" : " (non-central)")")
        }
        XCTAssertEqual(bad, [])
        // The non-central rows are the ones that prove the axis can miss while the umbra still touches.
        XCTAssertGreaterThan(Self.catalog.filter { $0.kind != "partial" && !$0.central }.count, 0)
    }

    func testAxisDistanceWithin5KmOfGamma() {
        // Gamma is tabulated to 1e-4 radii, 0.32 km of rounding. Measured within
        // 2.4 km through 2049, and 4.1 km at worst (2096-11-15).
        var worst = 0.0, worstAt = ""
        for (e, row) in zip(Self.walk, Self.catalog) {
            let err = abs(e.axisDistanceKm - abs(row.gamma) * Self.gammaRadiusKm)
            if err > worst { worst = err; worstAt = row.peakUtc }
        }
        XCTAssertLessThanOrEqual(worst, 5, "worst axis distance error \(worst) km at \(worstAt)")
    }

    func testGroundPointWithinOneDegreeUnderGlancingAxisDistance() {
        // The catalog rounds to whole degrees, up to 0.71° on its own;
        // measured worst 0.66° (1951-09-01).
        var count = 0, worst = 0.0, worstAt = ""
        for (e, row) in zip(Self.walk, Self.catalog) where e.kind != .partial && e.axisDistanceKm < Self.glancingAxisKm {
            count += 1
            let err = Self.angleDiffDeg(row.latitudeDeg, row.longitudeDeg, e.latitudeDeg!, e.longitudeDeg!)
            if err > worst { worst = err; worstAt = row.peakUtc }
        }
        XCTAssertGreaterThan(count, 190)
        XCTAssertLessThanOrEqual(worst, 1, "worst ground point error \(worst)° at \(worstAt)")
    }

    func testGroundPointAndObscurationPresentExactlyWhenTheAxisMeetsTheGround() throws {
        for e in Self.walk {
            let label = "\(e.peak)"
            if e.kind == .partial {
                XCTAssertNil(e.latitudeDeg, label); XCTAssertNil(e.longitudeDeg, label); XCTAssertNil(e.obscuration, label)
                continue
            }
            let lat = try XCTUnwrap(e.latitudeDeg, label), lon = try XCTUnwrap(e.longitudeDeg, label)
            let obscuration = try XCTUnwrap(e.obscuration, label)
            XCTAssertTrue((-90...90).contains(lat), label)
            XCTAssertTrue(lon > -180 && lon <= 180, label)
            // An axis inside the Earth's equatorial radius is what puts a point on it.
            XCTAssertLessThan(e.axisDistanceKm, 6378.1366, label)
            if e.kind == .total { XCTAssertEqual(obscuration, 1, label) } else {
                XCTAssertGreaterThan(obscuration, 0, label); XCTAssertLessThan(obscuration, 1, label)
            }
        }
    }

    // ------------------------------- the ground point is on the shadow axis

    // An observer placed there has the axis pass straight through them at the
    // peak, so their own closest approach is the global peak. This checks the
    // geodetic latitude and the sidereal longitude far below the catalog's
    // whole-degree rounding, through the observer path the local search uses.

    func testLocalSearchAtTheGroundPointPeaksAtGreatestEclipseWithTheSameObscuration() throws {
        let central = Self.walk.filter { $0.kind != .partial }
        XCTAssertGreaterThan(central.count, 200)
        var bad: [String] = []
        for e in central {
            let found = try solarEclipses(from: e.peak.addingTimeInterval(-Self.day), to: e.peak.addingTimeInterval(Self.day), observer: Self.groundPoint(e))
            guard found.count == 1, let local = found.first else { bad.append("\(e.peak): \(found.count) local eclipses"); continue }
            let dt = abs(local.peak.timeIntervalSince(e.peak))
            if dt > 2 { bad.append("\(e.peak): local peak off by \(dt) s") }
            let obscuration = try solarObscuration(at: e.peak, observer: Self.groundPoint(e))
            if abs(obscuration - e.obscuration!) > 1e-6 { bad.append("\(e.peak): obscuration \(obscuration) vs \(e.obscuration!)") }
        }
        XCTAssertEqual(bad, [])
    }

    func testLocalSearchAtTheGroundPointSeesTheSameKindExceptTheOneNearHybrid() throws {
        // Upstream classifies the local kind from the umbra of the Moon's mean
        // radius (1737.4 km) and the global kind from its polar radius (1736.0 km).
        // Only 1966-05-20 falls between them: the catalog's annular eclipse with a
        // 3 km path, whose mean-radius umbra is 44 m wide, which the local peak
        // misses by 0.14 km.
        var differ: [String] = []
        for e in Self.walk where e.kind != .partial {
            let local = try solarEclipses(from: e.peak.addingTimeInterval(-Self.day), to: e.peak.addingTimeInterval(Self.day), observer: Self.groundPoint(e))[0]
            if local.kind != e.kind {
                differ.append("\(ISO8601DateFormatter().string(from: e.peak).prefix(10)) global \(e.kind.rawValue) local \(local.kind.rawValue)")
            }
        }
        XCTAssertEqual(differ, ["1966-05-20 global annular local partial"])
    }

    // ------------------------------------------------------ search semantics

    static func assertSame(_ a: GlobalSolarEclipse, _ b: GlobalSolarEclipse, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertEqual(a.kind, b.kind, file: file, line: line)
        XCTAssertEqual(a.peak, b.peak, file: file, line: line)
        XCTAssertEqual(a.axisDistanceKm, b.axisDistanceKm, file: file, line: line)
        XCTAssertEqual(a.latitudeDeg, b.latitudeDeg, file: file, line: line)
        XCTAssertEqual(a.longitudeDeg, b.longitudeDeg, file: file, line: line)
        XCTAssertEqual(a.obscuration, b.obscuration, file: file, line: line)
    }

    func testBackwardAndRangeSearchesFindTheSameEclipses() throws {
        var backward: [GlobalSolarEclipse] = []
        var cursor = supportedMax.addingTimeInterval(-0.001)
        for _ in 0...Self.walk.count {
            do {
                let e = try previousGlobalSolarEclipse(before: cursor)
                XCTAssertLessThan(e.peak, cursor)
                backward.append(e)
                cursor = e.peak
            } catch AlmanacError.outOfRange { break }
        }
        let range = try globalSolarEclipses(from: supportedMin, to: supportedMax)
        for found in [Array(backward.reversed()), range] {
            XCTAssertEqual(found.count, Self.walk.count)
            for (e, want) in zip(found, Self.walk) { Self.assertSame(e, want) }
        }
    }

    func testRangeIncludesEachPeakAtStartAndExcludesItAtEnd() throws {
        for e in Self.walk {
            let ms = Self.ms(e.peak)
            XCTAssertEqual(try globalSolarEclipses(from: e.peak, to: Self.date(ms: ms + 1)).map(\.peak), [e.peak], "\(e.peak)")
            XCTAssertTrue(try globalSolarEclipses(from: Self.date(ms: ms - 1), to: e.peak).isEmpty, "\(e.peak)")
        }
    }

    func testApproachesAPeakFromEitherSide() throws {
        for e in Self.walk {
            let ms = Self.ms(e.peak)
            XCTAssertEqual(try nextGlobalSolarEclipse(after: Self.date(ms: ms - 101)).peak, e.peak, "\(e.peak)")
            XCTAssertEqual(try previousGlobalSolarEclipse(before: Self.date(ms: ms + 101)).peak, e.peak, "\(e.peak)")
        }
    }

    func testPinsTheSameEclipseBandAt100Ms() throws {
        let e = Self.walk.first { $0.peak > utc("2026-01-01T00:00:00Z") }!
        let ms = Self.ms(e.peak)
        XCTAssertGreaterThan(try nextGlobalSolarEclipse(after: e.peak).peak, e.peak)
        XCTAssertGreaterThan(try nextGlobalSolarEclipse(after: Self.date(ms: ms - 100)).peak, e.peak)
        XCTAssertEqual(try nextGlobalSolarEclipse(after: Self.date(ms: ms - 101)).peak, e.peak)
        XCTAssertLessThan(try previousGlobalSolarEclipse(before: e.peak).peak, e.peak)
        XCTAssertLessThan(try previousGlobalSolarEclipse(before: Self.date(ms: ms + 100)).peak, e.peak)
        XCTAssertEqual(try previousGlobalSolarEclipse(before: Self.date(ms: ms + 101)).peak, e.peak)
    }

    func testReturnsIntegerMillisecondPeaks() throws {
        for e in Self.walk { XCTAssertEqual(try normalized(e.peak), e.peak, "\(e.peak) is not an integer-millisecond instant") }
    }

    func testValidatesBeforeEmptyWindowAndReachesBoundaryAsOutOfRange() throws {
        // No solar eclipse between the 2026-08-12 total and the 2027-02-06 annular.
        let from = utc("2026-09-01T00:00:00Z"), to = utc("2027-01-01T00:00:00Z")
        XCTAssertTrue(try globalSolarEclipses(from: from, to: to).isEmpty)
        XCTAssertTrue(try globalSolarEclipses(from: from, to: from).isEmpty)
        XCTAssertTrue(try globalSolarEclipses(from: to, to: from).isEmpty)
        XCTAssertTrue(try globalSolarEclipses(from: utc(Self.catalog.last!.peakUtc).addingTimeInterval(Self.day), to: supportedMax).isEmpty)
        let nan = Date(timeIntervalSince1970: .nan)
        for query in [
            { _ = try globalSolarEclipses(from: nan, to: to) },
            { _ = try globalSolarEclipses(from: from, to: nan) },
            { _ = try nextGlobalSolarEclipse(after: nan) },
            { _ = try previousGlobalSolarEclipse(before: nan) }
        ] {
            XCTAssertThrowsError(try query()) { error in
                guard case AlmanacError.invalidArgument = error else { return XCTFail("expected invalidArgument, got \(error)") }
            }
        }
        for query in [
            { _ = try globalSolarEclipses(from: supportedMin.addingTimeInterval(-0.001), to: to) },
            { _ = try globalSolarEclipses(from: from, to: supportedMax.addingTimeInterval(0.001)) },
            { _ = try globalSolarEclipses(from: supportedMax, to: from) },
            { _ = try nextGlobalSolarEclipse(after: supportedMin.addingTimeInterval(-0.001)) },
            { _ = try nextGlobalSolarEclipse(after: utc(Self.catalog.last!.peakUtc).addingTimeInterval(Self.day)) },
            { _ = try previousGlobalSolarEclipse(before: utc(Self.catalog.first!.peakUtc).addingTimeInterval(-Self.day)) },
            { _ = try previousGlobalSolarEclipse(before: supportedMin) },
            { _ = try previousGlobalSolarEclipse(before: supportedMax) }
        ] {
            XCTAssertThrowsError(try query()) { XCTAssertEqual($0 as? AlmanacError, .outOfRange) }
        }
    }

    // ---------------------------------------------------------- central line

    struct PathRow: Decodable { let utc: String; let latitudeDeg: Double; let longitudeDeg: Double; let diameterRatio: Double; let sunAltDeg: Double; let durationS: Double }
    struct PathPoint: Decodable { let latitudeDeg: Double; let longitudeDeg: Double }
    struct PathGreatest: Decodable { let utc: String; let latitudeDeg: Double; let longitudeDeg: Double }
    struct PathTable: Decodable {
        let eclipse: String; let kind: String; let deltaTSeconds: Double
        let greatestEclipse: PathGreatest; let limits: [PathPoint]; let centralLine: [PathRow]
    }
    static let pathTables: [PathTable] = try! JSONDecoder().decode(
        [PathTable].self,
        from: Data(contentsOf: fixturesURL().appendingPathComponent("eclipses").appendingPathComponent("solar-paths.json")))

    /// Ground tolerance against the path tables, km, and the looser one where a glancing axis meets the ground obliquely.
    static let pathKm = 5.0
    static let glancingPathKm = 15.0
    /// Mean Earth radius, for ground distances between nearby points, km.
    static let earthMeanKm = 6371.0088

    typealias Unit = (Double, Double, Double)
    static func unit(_ latDeg: Double, _ lonDeg: Double) -> Unit {
        let r = Double.pi / 180
        return (cos(latDeg * r) * cos(lonDeg * r), cos(latDeg * r) * sin(lonDeg * r), sin(latDeg * r))
    }
    static func dot3(_ a: Unit, _ b: Unit) -> Double { a.0 * b.0 + a.1 * b.1 + a.2 * b.2 }
    static func cross3(_ a: Unit, _ b: Unit) -> Unit { (a.1 * b.2 - a.2 * b.1, a.2 * b.0 - a.0 * b.2, a.0 * b.1 - a.1 * b.0) }
    static func norm3(_ a: Unit) -> Double { (a.0 * a.0 + a.1 * a.1 + a.2 * a.2).squareRoot() }
    static func angle(_ a: Unit, _ b: Unit) -> Double { atan2(norm3(cross3(a, b)), dot3(a, b)) }

    /// Ground distance between two points, km.
    static func groundKm(_ aLat: Double, _ aLon: Double, _ bLat: Double, _ bLon: Double) -> Double {
        earthMeanKm * angle(unit(aLat, aLon), unit(bLat, bLon))
    }

    /// The nearest place on a central line to a point: its ground distance, km,
    /// and the instant the line passes there, interpolated along the segment.
    static func nearestOnLine(_ latDeg: Double, _ lonDeg: Double, _ line: [SolarEclipseAxisPoint]) -> (km: Double, time: Date) {
        let p = unit(latDeg, lonDeg)
        var best = (km: Double.infinity, time: Date(timeIntervalSince1970: .nan))
        for i in 1..<line.count {
            let a = unit(line[i - 1].latitudeDeg, line[i - 1].longitudeDeg)
            let b = unit(line[i].latitudeDeg, line[i].longitudeDeg)
            let n = cross3(a, b)
            let nLen = norm3(n)
            let ab = angle(a, b)
            // The foot of the perpendicular from p onto the segment's great circle, when it falls inside the segment.
            let s = nLen > 0 ? dot3(p, n) / nLen : 0
            let d = nLen > 0 ? nLen : 1
            let foot = (p.0 - s * n.0 / d, p.1 - s * n.1 / d, p.2 - s * n.2 / d)
            let af = angle(a, foot), fb = angle(foot, b)
            var rad: Double, frac: Double
            if nLen > 0 && abs(af + fb - ab) < 1e-9 {
                rad = abs(asin(max(-1, min(1, s))))
                frac = af / ab
            } else {
                let pa = angle(p, a), pb = angle(p, b)
                (rad, frac) = pa <= pb ? (pa, 0) : (pb, 1)
            }
            if earthMeanKm * rad < best.km {
                let t0 = line[i - 1].time.timeIntervalSince1970, t1 = line[i].time.timeIntervalSince1970
                best = (earthMeanKm * rad, Date(timeIntervalSince1970: t0 + frac * (t1 - t0)))
            }
        }
        return best
    }

    /// A table row's instant on this port's time scale: the same TD, since each table's UT uses its own Delta-T.
    static func sameTd(_ utcString: String, _ tableDeltaT: Double) -> Date {
        let t = utcMs(utcString)
        let ours = deltaTSeconds(decimalYear: 2000 + utDays(t) / 365.25)
        let ms = ((t.timeIntervalSince1970 + tableDeltaT - ours) * 1000).rounded(.towardZero)
        return Date(timeIntervalSince1970: ms / 1000)
    }

    static func eclipse(for table: PathTable) -> GlobalSolarEclipse {
        let at = utcMs(table.greatestEclipse.utc)
        return walk.first { abs($0.peak.timeIntervalSince(at)) < day }!
    }

    func testCentralLinesAgainstTheNasaPathTables() throws {
        // Greatest eclipse to 0.1′ and the central line every 120 s. A glancing
        // axis meets the ground so obliquely that a kilometer across the axis is
        // several along the ground; of these six only 2044-08-23 (6,129 km) is.
        // Measured: greatest eclipse within 2.6 km, rows within 3.1 km across the
        // line and 4.9 s along it, and ends within 3.6 km, except 2044-08-23 at
        // 8.1 km, 9.4 km and 8.1 s, and 9.1 km.
        for table in Self.pathTables {
            let e = Self.eclipse(for: table)
            let glancing = e.axisDistanceKm >= Self.glancingAxisKm
            let tolKm = glancing ? Self.glancingPathKm : Self.pathKm
            let line = try solarEclipseCentralLine(peak: e.peak, stepSeconds: 10)
            let label = "\(table.eclipse)\(glancing ? " (glancing)" : "")"

            let geKm = Self.groundKm(e.latitudeDeg!, e.longitudeDeg!, table.greatestEclipse.latitudeDeg, table.greatestEclipse.longitudeDeg)
            XCTAssertLessThanOrEqual(geKm, tolKm, "\(label): greatest eclipse \(geKm) km")

            var bad: [String] = []
            for row in table.centralLine {
                let near = Self.nearestOnLine(row.latitudeDeg, row.longitudeDeg, line)
                let dt = near.time.timeIntervalSince(Self.sameTd(row.utc, table.deltaTSeconds))
                if near.km > tolKm || abs(dt) > 60 { bad.append("\(row.utc): \(near.km) km, \(dt) s") }
            }
            XCTAssertEqual(bad, [], label)

            for (end, limit) in zip([line.first!, line.last!], table.limits) {
                let km = Self.groundKm(end.latitudeDeg, end.longitudeDeg, limit.latitudeDeg, limit.longitudeDeg)
                XCTAssertLessThanOrEqual(km, tolKm, "\(label): end at \(end.time) is \(km) km from the table's limit")
            }

            for p in line { XCTAssertEqual(p.kind.rawValue, table.kind, "\(label) \(p.time)") }
            for row in table.centralLine {
                // A row within the tables' few seconds of timing difference from an end has no point.
                guard let p = try solarEclipseAxisPoint(at: Self.sameTd(row.utc, table.deltaTSeconds)) else { continue }
                // The ratio of apparent diameters is tabulated to 1e-3; its square, the
                // covered area at the center of an annular path, to within 0.002.
                if table.kind == "total" { XCTAssertEqual(p.obscuration, 1, "\(label) \(row.utc)") }
                else { XCTAssertLessThanOrEqual(abs(p.obscuration - row.diameterRatio * row.diameterRatio), 0.002, "\(label) \(row.utc)") }
            }
        }
    }

    func testLocalSearchAtEveryInteriorCentralLinePointPeaksThereWithItsKind() throws {
        // The ends are where the Sun sits on the horizon. Measured worst 0.40 s over 953 points.
        var bad: [String] = []
        var checked = 0
        for table in Self.pathTables {
            let line = try solarEclipseCentralLine(peak: Self.eclipse(for: table).peak)
            for p in line.dropFirst().dropLast() {
                checked += 1
                let observer = try Observer(latitudeDeg: p.latitudeDeg, longitudeDeg: p.longitudeDeg)
                let found = try solarEclipses(from: p.time.addingTimeInterval(-Self.day), to: p.time.addingTimeInterval(Self.day), observer: observer)
                guard found.count == 1, let local = found.first else { bad.append("\(p.time): \(found.count) local eclipses"); continue }
                let dt = abs(local.peak.timeIntervalSince(p.time))
                if dt > 2 || local.kind != p.kind { bad.append("\(p.time): local \(local.kind.rawValue) \(dt) s off") }
            }
        }
        XCTAssertGreaterThan(checked, 900)
        XCTAssertEqual(bad, [])
    }

    static let lines: [[SolarEclipseAxisPoint]] = walk.map { try! solarEclipseCentralLine(peak: $0.peak) }

    func testEveryCentralEclipseHasALineFromContactToContactThroughWholeMinutes() throws {
        var longestH = 0.0
        for (e, line) in zip(Self.walk, Self.lines) {
            let label = "\(e.peak)"
            if e.kind == .partial { XCTAssertTrue(line.isEmpty, label); continue }
            XCTAssertGreaterThanOrEqual(line.count, 2, label)
            guard let firstPoint = line.first, let lastPoint = line.last else { continue }
            let first = Self.ms(firstPoint.time), last = Self.ms(lastPoint.time)
            longestH = max(longestH, (last - first) / 3_600_000)
            // Every step between the contacts is present, on whole minutes.
            let inner = line.dropFirst().dropLast().map { Self.ms($0.time) }
            var expected: [Double] = []
            var ms = ((first / 60_000).rounded(.down) + 1) * 60_000
            while ms < last { expected.append(ms); ms += 60_000 }
            XCTAssertEqual(inner, expected, label)
            // The ends are the contacts, found to the millisecond: the axis misses
            // two milliseconds outside them and meets the ground two inside.
            XCTAssertNil(try solarEclipseAxisPoint(at: Self.date(ms: first - 2)), label)
            XCTAssertNil(try solarEclipseAxisPoint(at: Self.date(ms: last + 2)), label)
            XCTAssertNotNil(try solarEclipseAxisPoint(at: Self.date(ms: first + 2)), label)
            XCTAssertNotNil(try solarEclipseAxisPoint(at: Self.date(ms: last - 2)), label)
        }
        // The contact search reaches 6 hours either side of the peak; measured longest 3.88 h (2096-11-15).
        XCTAssertLessThan(longestH, 5)
    }

    func testHybridPathsChangeKindAlongTheLine() {
        // Annular to total to annular, except 2013-11-03, which Espenak types H3:
        // the path begins annular and ends total.
        var sequences: [String] = []
        for (i, row) in Self.catalog.enumerated() where row.kind == "hybrid" {
            var runs = ""
            for p in Self.lines[i] {
                let c = p.kind == .total ? "t" : "a"
                if runs.last.map(String.init) != c { runs += c }
            }
            sequences.append("\(ISO8601DateFormatter().string(from: Self.walk[i].peak).prefix(10)) \(runs)")
        }
        XCTAssertEqual(sequences, [
            "1986-10-03 ata", "1987-03-29 ata", "2005-04-08 ata", "2013-11-03 at", "2023-04-20 ata",
            "2031-11-14 ata", "2049-11-25 ata", "2050-05-20 ata", "2067-12-06 ata",
        ])
    }

    func testTheAxisPointAtGreatestEclipseIsTheGlobalGroundPoint() throws {
        // The global point comes from the unrounded root, the axis point from the reported millisecond.
        for e in Self.walk {
            let p = try solarEclipseAxisPoint(at: e.peak)
            if e.kind == .partial { XCTAssertNil(p, "\(e.peak)"); continue }
            let point = try XCTUnwrap(p, "\(e.peak)")
            XCTAssertEqual(point.kind, e.kind, "\(e.peak)")
            XCTAssertLessThan(abs(point.latitudeDeg - e.latitudeDeg!), 1e-3, "\(e.peak)")
            XCTAssertLessThan(abs((point.longitudeDeg - e.longitudeDeg! + 540).truncatingRemainder(dividingBy: 360) - 180), 1e-3, "\(e.peak)")
            XCTAssertLessThan(abs(point.obscuration - e.obscuration!), 1e-6, "\(e.peak)")
        }
    }

    func testACoarserStepSamplesTheSameInstantsAsAFinerOne() throws {
        let e = Self.walk.first { $0.peak > utc("2026-08-12T00:00:00Z") }!
        var fine: [Double: SolarEclipseAxisPoint] = [:]
        for p in try solarEclipseCentralLine(peak: e.peak, stepSeconds: 10) { fine[Self.ms(p.time)] = p }
        for p in try solarEclipseCentralLine(peak: e.peak, stepSeconds: 60) {
            let f = try XCTUnwrap(fine[Self.ms(p.time)], "\(p.time)")
            XCTAssertEqual(f.latitudeDeg, p.latitudeDeg); XCTAssertEqual(f.longitudeDeg, p.longitudeDeg)
            XCTAssertEqual(f.kind, p.kind); XCTAssertEqual(f.obscuration, p.obscuration)
        }
    }

    func testNoAxisPointAtALunarEclipse() throws {
        // At a lunar eclipse the Sun-Moon line crosses the Earth on the Sun's side of the Moon.
        let lunar = try lunarEclipses(from: supportedMin, to: supportedMax)
        XCTAssertGreaterThan(lunar.count, 300)
        let withPoint = try lunar.filter { try solarEclipseAxisPoint(at: $0.peak) != nil }.map(\.peak)
        XCTAssertEqual(withPoint, [])
    }

    func testAxisPointAndCentralLineInputs() throws {
        let quiet = utc("2026-01-15T20:00:00Z")
        XCTAssertNil(try solarEclipseAxisPoint(at: quiet))
        XCTAssertTrue(try solarEclipseCentralLine(peak: quiet).isEmpty)

        let e = Self.walk.first { $0.peak > utc("2026-08-12T00:00:00Z") }!
        XCTAssertGreaterThan(try solarEclipseCentralLine(peak: e.peak, stepSeconds: 1).count, 5000)
        XCTAssertGreaterThanOrEqual(try solarEclipseCentralLine(peak: e.peak, stepSeconds: 3600).count, 2)
        for step in [0, -60, 3601] {
            XCTAssertThrowsError(try solarEclipseCentralLine(peak: e.peak, stepSeconds: step), "step \(step)") { error in
                guard case AlmanacError.invalidArgument = error else { return XCTFail("expected invalidArgument, got \(error)") }
            }
        }
        let nan = Date(timeIntervalSince1970: .nan)
        for query in [{ _ = try solarEclipseAxisPoint(at: nan) }, { _ = try solarEclipseCentralLine(peak: nan) }] {
            XCTAssertThrowsError(try query()) { error in
                guard case AlmanacError.invalidArgument = error else { return XCTFail("expected invalidArgument, got \(error)") }
            }
        }
        for query in [
            { _ = try solarEclipseAxisPoint(at: supportedMax) },
            { _ = try solarEclipseCentralLine(peak: supportedMin.addingTimeInterval(-0.001)) }
        ] {
            XCTAssertThrowsError(try query()) { XCTAssertEqual($0 as? AlmanacError, .outOfRange) }
        }
    }
}
