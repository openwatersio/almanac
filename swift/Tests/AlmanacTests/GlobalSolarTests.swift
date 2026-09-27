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
        // its own Espenak–Meeus Delta-T, the model this port uses, so no Delta-T floor.
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
        // Gamma is tabulated to 1e-4 radii, 0.32 km of rounding. Measured worst
        // 4.1 km (2096-11-15); the lunar theory's error grows away from J2000,
        // from under 2.3 km through 2049 to that worst case in the 2090s.
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
}
