import XCTest
@testable import Almanac

/// Mirrors typescript/test/eclipse.test.ts: same fixtures, same tolerances.
///
/// Three TS cases have no Swift counterpart because Swift's type system
/// removes the failure class they probe: "unknown kind" (`LunarEclipseKind`
/// is a closed enum, not a string), "validates the observer" (`Observer`'s
/// throwing initializer already refuses an invalid one — there is no way to
/// hand `lunarEclipseVisibility` a bad one), and "undefined contact treated
/// as absent" (Swift has no `undefined`; the one behaviour from that test
/// that still applies here — a legitimately absent optional contact reads as
/// `nil` — is covered by the penumbral visibility test below).
final class EclipseTests: XCTestCase {
    static let victoria = try! Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 0)
    static let athens = try! Observer(latitudeDeg: 37.98, longitudeDeg: 23.72, elevationM: 0)

    struct CatalogRow: Decodable {
        let peakUtc: String
        let kind: String
        let magPenumbral: Double
        let magUmbral: Double
        let kindFirm: Bool
    }

    struct ContactRow: Decodable {
        let eclipse: String
        let p1: String?; let u1: String?; let u2: String?
        let peak: String?; let u3: String?; let u4: String?; let p4: String?
    }

    static func loadCatalog() throws -> [CatalogRow] {
        let url = fixturesURL().appendingPathComponent("eclipses").appendingPathComponent("espenak-1950-2100.json")
        return try JSONDecoder().decode([CatalogRow].self, from: Data(contentsOf: url))
    }

    static func loadContacts() throws -> [ContactRow] {
        let url = fixturesURL().appendingPathComponent("eclipses").appendingPathComponent("contacts.json")
        return try JSONDecoder().decode([ContactRow].self, from: Data(contentsOf: url))
    }

    static let catalog: [CatalogRow] = try! loadCatalog()
    static let contacts: [ContactRow] = try! loadContacts()

    /// One walk of the whole catalog interval, shared by every fixture
    /// assertion below — repeated `nextLunarEclipse` from 1950-01-01 until the
    /// search runs past the supported interval. 344 eclipses over 150 years is
    /// the expensive part of this suite; computing it once and asserting many
    /// ways is the point.
    static let walk: [LunarEclipse] = {
        var found: [LunarEclipse] = []
        var cursor = utc("1950-01-01T00:00:00Z")
        while true {
            do {
                let e = try nextLunarEclipse(after: cursor)
                found.append(e)
                cursor = e.peak
            } catch AlmanacError.outOfRange {
                break
            } catch {
                fatalError("unexpected error in eclipse walk: \(error)")
            }
        }
        return found
    }()

    static func isoDay(_ d: Date) -> String {
        String(ISO8601DateFormatter().string(from: d).prefix(10))
    }

    static func find(_ dayPrefix: String) -> LunarEclipse {
        walk.first { isoDay($0.peak) == dayPrefix }!
    }

    // ------------------------------------------------- vs the Espenak catalog

    func testWalksCatalogExactlyOnceInOrder() throws {
        // Count plus strict ascent is only half the claim; the "same eclipses,
        // in order" half is the peak-time test below, which compares
        // index-for-index and so fails loudly if the walk ever swapped an
        // eclipse for another.
        XCTAssertEqual(Self.walk.count, Self.catalog.count)
        for i in 1..<Self.walk.count {
            XCTAssertGreaterThan(Self.walk[i].peak, Self.walk[i - 1].peak)
        }
    }

    func testNeverScansNearSearchBound() {
        // The bound `nextLunarEclipse` gives up at is 730 days; the longest
        // gap between consecutive eclipses over 1950-2100 is under half a
        // year, so the bound is a runaway guard, not a limit on real results.
        var maxGapDays = 0.0
        for i in 1..<Self.walk.count {
            maxGapDays = max(maxGapDays, Self.walk[i].peak.timeIntervalSince(Self.walk[i - 1].peak) / 86400)
        }
        XCTAssertLessThan(maxGapDays, 365, "max gap \(maxGapDays) d")
    }

    func testPeakTimesWithin60Seconds() {
        var worst = 0.0
        for (i, e) in Self.walk.enumerated() {
            worst = max(worst, abs(e.peak.timeIntervalSince(utc(Self.catalog[i].peakUtc))))
        }
        XCTAssertLessThanOrEqual(worst, 60, "worst peak error \(worst) s")
    }

    func testKindMatchesFirmCatalogRows() {
        var bad: [String] = []
        for (i, e) in Self.walk.enumerated() {
            let row = Self.catalog[i]
            if row.kindFirm && e.kind.rawValue != row.kind {
                bad.append("\(row.peakUtc): got \(e.kind.rawValue), want \(row.kind)")
            }
        }
        XCTAssertEqual(bad, [])
    }

    func testMagnitudesWithin003() {
        var worstU = 0.0, worstP = 0.0
        for (i, e) in Self.walk.enumerated() {
            worstU = max(worstU, abs(e.magUmbral - Self.catalog[i].magUmbral))
            worstP = max(worstP, abs(e.magPenumbral - Self.catalog[i].magPenumbral))
        }
        XCTAssertLessThanOrEqual(worstU, 0.03, "worst umbral magnitude error \(worstU)")
        XCTAssertLessThanOrEqual(worstP, 0.03, "worst penumbral magnitude error \(worstP)")
    }

    func testContactShapeMatchesKind() {
        for e in Self.walk {
            switch e.kind {
            case .penumbral:
                XCTAssertNil(e.u1); XCTAssertNil(e.u2); XCTAssertNil(e.u3); XCTAssertNil(e.u4)
            case .partial:
                XCTAssertNotNil(e.u1); XCTAssertNotNil(e.u4)
                XCTAssertNil(e.u2); XCTAssertNil(e.u3)
            case .total:
                XCTAssertNotNil(e.u1); XCTAssertNotNil(e.u2); XCTAssertNotNil(e.u3); XCTAssertNotNil(e.u4)
            }
            XCTAssertLessThan(e.p1, e.peak)
            XCTAssertGreaterThan(e.p4, e.peak)
        }
    }

    // ---------------------------------------- contact times vs circumstances

    func testContactsWithin60SecondsOfCirumstancesTables() throws {
        let byDay = Dictionary(uniqueKeysWithValues: Self.walk.map { (Self.isoDay($0.peak), $0) })
        for row in Self.contacts {
            guard let e = byDay[row.eclipse] else {
                XCTFail("no eclipse found on \(row.eclipse)")
                continue
            }
            let pairs: [(String, String?, Date?)] = [
                ("p1", row.p1, e.p1), ("u1", row.u1, e.u1), ("u2", row.u2, e.u2),
                ("peak", row.peak, e.peak), ("u3", row.u3, e.u3), ("u4", row.u4, e.u4), ("p4", row.p4, e.p4)
            ]
            for (k, want, got) in pairs {
                guard let want else {
                    XCTAssertNil(got, "\(row.eclipse) \(k) should be absent")
                    continue
                }
                guard let got else { XCTFail("\(row.eclipse) \(k) should be present"); continue }
                // contacts.json is minute-precision ("...T02:37Z", no seconds).
                let err = abs(got.timeIntervalSince(usnoUtc(want)))
                XCTAssertLessThanOrEqual(err, 60, "\(row.eclipse) \(k) off by \(err) s")
            }
        }
    }

    // ------------------------------------ 2026-08-28 partial — the regression

    func testPartialEclipse20260828IsJustShortOfTotality() {
        let e = Self.find("2026-08-28")
        XCTAssertEqual(e.kind, .partial)
        XCTAssertLessThanOrEqual(abs(e.magUmbral - 0.93), 0.03, "magUmbral \(e.magUmbral)")
    }

    func testPartialEclipse20260828VisibilityVictoriaAndAthens() throws {
        let e = Self.find("2026-08-28")
        let vic = try lunarEclipseVisibility(e, observer: Self.victoria)
        let ath = try lunarEclipseVisibility(e, observer: Self.athens)
        XCTAssertTrue(vic.visibleAtPeak)
        XCTAssertGreaterThan(vic.moonGeometricAltAtPeakDeg, 0)
        XCTAssertFalse(ath.visibleAtPeak)
        XCTAssertLessThan(ath.moonGeometricAltAtPeakDeg, 0)
    }

    // --------------------------------------------------- lunarEclipseVisibility

    func testTotalEclipseReportsBooleanForEveryPresentContact() throws {
        let total = Self.find("2019-01-21")
        let v = try lunarEclipseVisibility(total, observer: Self.victoria)
        // 2019-01-21 was the "super blood wolf moon": the whole event was
        // above the horizon over western North America.
        XCTAssertEqual(
            [v.contactsVisible.p1, v.contactsVisible.u1, v.contactsVisible.u2,
             v.contactsVisible.u3, v.contactsVisible.u4, v.contactsVisible.p4],
            [true, true, true, true, true, true]
        )
    }

    func testPenumbralEclipseReportsNilExactlyWhereNoUmbralContact() throws {
        let penumbral = Self.find("2020-11-30")
        let v = try lunarEclipseVisibility(penumbral, observer: Self.victoria)
        XCTAssertNotNil(v.contactsVisible.p1)   // Bool, not Bool? — always present
        XCTAssertNotNil(v.contactsVisible.p4)
        XCTAssertNil(v.contactsVisible.u1)
        XCTAssertNil(v.contactsVisible.u2)
        XCTAssertNil(v.contactsVisible.u3)
        XCTAssertNil(v.contactsVisible.u4)
    }

    func testAltitudeAtPeakIsGeometricUnrefractedTopocentricCentre() throws {
        let total = Self.find("2019-01-21")
        let v = try lunarEclipseVisibility(total, observer: Self.victoria)
        // The public moonAltAz applies the 'normal' refraction model on top of
        // the same topocentric centre, so the two differ by exactly that lift.
        let refracted = try moonAltAz(total.peak, observer: Self.victoria).altDeg
        XCTAssertEqual(refracted - v.moonGeometricAltAtPeakDeg, refractionDeg(v.moonGeometricAltAtPeakDeg), accuracy: 1e-9)
        // Independent physical check: at a total lunar eclipse the Moon sits
        // within ~1 degree of the anti-solar point, so its altitude mirrors
        // the Sun's up to the Moon's horizontal parallax (~1 degree).
        let sunAlt = try sunAltAz(total.peak, observer: Self.victoria).altDeg
        XCTAssertLessThan(abs(v.moonGeometricAltAtPeakDeg + sunAlt), 2.5)
        // Regression on the numeric value itself.
        XCTAssertEqual(v.moonGeometricAltAtPeakDeg, 41.71, accuracy: 0.05)
    }

    // ------------------------------------------------------- malformed input

    /// `..` returns `e` with one or more fields overridden — the Swift
    /// analogue of the TS suite's `{ ...total, ...patch }`. Contact fields
    /// take a double optional so "leave as-is" (`nil`) is distinguishable
    /// from "override to absent" (`.some(nil)`).
    static func modified(
        _ e: LunarEclipse, kind: LunarEclipseKind? = nil, peak: Date? = nil,
        p1: Date? = nil, u1: Date?? = nil, u2: Date?? = nil, u3: Date?? = nil, u4: Date?? = nil, p4: Date? = nil
    ) -> LunarEclipse {
        LunarEclipse(
            kind: kind ?? e.kind, peak: peak ?? e.peak, magUmbral: e.magUmbral, magPenumbral: e.magPenumbral,
            p1: p1 ?? e.p1, u1: u1 ?? e.u1, u2: u2 ?? e.u2, u3: u3 ?? e.u3, u4: u4 ?? e.u4, p4: p4 ?? e.p4
        )
    }

    func assertInvalidArgument(_ e: LunarEclipse, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try lunarEclipseVisibility(e, observer: Self.victoria), file: file, line: line) { error in
            guard case AlmanacError.invalidArgument = error else {
                return XCTFail("expected invalidArgument, got \(error)", file: file, line: line)
            }
        }
    }

    func testRejectsU2PresentWithoutU3() {
        let total = Self.find("2019-01-21")
        assertInvalidArgument(Self.modified(total, u3: .some(nil)))
    }

    func testRejectsKindTotalWithoutUmbralTotalityContacts() {
        let total = Self.find("2019-01-21")
        assertInvalidArgument(Self.modified(total, u2: .some(nil), u3: .some(nil)))
    }

    func testRejectsKindPartialCarryingTotalityContacts() {
        let total = Self.find("2019-01-21")
        assertInvalidArgument(Self.modified(total, kind: .partial))
    }

    func testRejectsKindPenumbralCarryingUmbralContacts() {
        let total = Self.find("2019-01-21")
        assertInvalidArgument(Self.modified(total, kind: .penumbral))
    }

    func testRejectsPeakBeforeP1() {
        let total = Self.find("2019-01-21")
        assertInvalidArgument(Self.modified(total, peak: total.p1.addingTimeInterval(-0.001)))
    }

    func testRejectsContactsOutOfOrder() {
        let total = Self.find("2019-01-21")
        assertInvalidArgument(Self.modified(total, u4: .some(total.u3!.addingTimeInterval(-0.001))))
    }

    func testRejectsDuplicateContactInstants() {
        let total = Self.find("2019-01-21")
        assertInvalidArgument(Self.modified(total, u3: .some(total.peak)))
    }

    func testRejectsNaNTime() {
        let total = Self.find("2019-01-21")
        assertInvalidArgument(Self.modified(total, p4: Date(timeIntervalSince1970: .nan)))
        assertInvalidArgument(Self.modified(total, peak: Date(timeIntervalSince1970: .nan)))
    }

    func testAcceptsAWellFormedEclipse() throws {
        let total = Self.find("2019-01-21")
        XCTAssertNoThrow(try lunarEclipseVisibility(total, observer: Self.victoria))
    }

    // --------------------------------------------------------- range handling

    func testRejectsStartTimeOutsideSupportedInterval() {
        XCTAssertThrowsError(try nextLunarEclipse(after: utc("1949-12-31T00:00:00Z"))) {
            XCTAssertEqual($0 as? AlmanacError, .outOfRange)
        }
        XCTAssertThrowsError(try nextLunarEclipse(after: Date(timeIntervalSince1970: .nan))) { error in
            guard case AlmanacError.invalidArgument = error else {
                return XCTFail("expected invalidArgument, got \(error)")
            }
        }
    }

    func testThrowsWhenNextEclipseFallsPastEndOfInterval() {
        XCTAssertThrowsError(try nextLunarEclipse(after: utc("2100-11-01T00:00:00Z"))) {
            XCTAssertEqual($0 as? AlmanacError, .outOfRange)
        }
    }

    func testReturnsStrictlyTheNextEclipseWhenCalledWithAnEclipsePeak() throws {
        let first = try nextLunarEclipse(after: utc("2026-01-01T00:00:00Z"))
        let second = try nextLunarEclipse(after: first.peak)
        XCTAssertGreaterThan(second.peak, first.peak)
        // and a query just before a peak still returns that peak
        let again = try nextLunarEclipse(after: first.peak.addingTimeInterval(-1.0))
        XCTAssertEqual(again.peak, first.peak)
    }

    func testPinsTheSameEclipseBandAt100MsEitherSideOfTheBoundary() throws {
        let e = try nextLunarEclipse(after: utc("2026-01-01T00:00:00Z"))
        let peak = e.peak
        // Inside the band: judged the caller's own previous result, so the
        // search moves on to the next eclipse. This is the band's accepted cost.
        let inside = try nextLunarEclipse(after: peak.addingTimeInterval(-0.100))
        XCTAssertGreaterThan(inside.peak, peak)
        // One millisecond outside it: the same eclipse, exactly.
        let outside = try nextLunarEclipse(after: peak.addingTimeInterval(-0.101))
        XCTAssertEqual(outside.peak, peak)
    }

    func testReturnsIntegerMillisecondInstants() throws {
        let e = try nextLunarEclipse(after: utc("2026-01-01T00:00:00Z"))
        for t in [e.peak, e.p1, e.p4, e.u1, e.u4].compactMap({ $0 }) {
            let ms = t.timeIntervalSince1970 * 1000
            XCTAssertEqual(ms, ms.rounded(), accuracy: 1e-6)
        }
    }
}
