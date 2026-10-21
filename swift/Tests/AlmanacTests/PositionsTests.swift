import XCTest
@testable import Almanac

/// Mirrors typescript/test/positions.test.ts: coarse fixtures are TT-labeled
/// and drive the internal *ApparentAtTT entry points directly (no ΔT model
/// between ephemeris and reference data); dense fixtures are UTC-labeled and
/// exercise the public sunPosition/moonPosition API end to end.
final class PositionsTests: XCTestCase {
    struct PosRow: Decodable {
        let utc: String?
        let tt: String?
        let raDeg: Double
        let decDeg: Double
        let distanceAu: Double?
        let distanceKm: Double?
        let illumFraction: Double?
    }

    // MOON2 runs ~27 ppm low on distance vs JPL ephemerides — model-inherent,
    // not a port defect (the TS reference implementation reproduces it
    // exactly); angular 1' tolerance is unaffected.
    static let moonDistTolKm = 70.0

    /// arcmin separation between two RA/Dec pairs — same formula as the TS test.
    static func sep(_ ra1: Double, _ dec1: Double, _ ra2: Double, _ dec2: Double) -> Double {
        let r = Double.pi / 180
        let c = sin(dec1*r)*sin(dec2*r) + cos(dec1*r)*cos(dec2*r)*cos((ra1-ra2)*r)
        return acos(min(1, max(-1, c))) / r * 60
    }

    static func load(_ name: String) throws -> [PosRow] {
        let url = fixturesURL().appendingPathComponent("positions").appendingPathComponent(name)
        return try JSONDecoder().decode([PosRow].self, from: Data(contentsOf: url))
    }

    // Coarse fixtures carry `tt` (a calendar-label string with a misleading Z
    // suffix — parsed like the TS test's Date.parse, purely to get
    // days-since-J2000-TT; no real UTC/TT distinction is implied).
    static func ttDaysOf(_ tt: String) -> Double {
        (utc(tt).timeIntervalSince1970 - utc("2000-01-01T12:00:00Z").timeIntervalSince1970) / 86400.0
    }

    func testSunCoarseWithinOneArcmin() throws {
        for row in try Self.load("sun-coarse.json") {
            let p = sunApparentAtTT(Self.ttDaysOf(row.tt!))
            XCTAssertLessThan(Self.sep(p.raDeg, p.decDeg, row.raDeg, row.decDeg), 1, "sun-coarse @ \(row.tt!)")
            XCTAssertLessThan(abs(p.distanceAu - row.distanceAu!), 1e-4, "sun-coarse @ \(row.tt!)")
        }
    }

    func testMoonCoarseWithinOneArcmin() throws {
        for row in try Self.load("moon-coarse.json") {
            let p = moonApparentAtTT(Self.ttDaysOf(row.tt!))
            XCTAssertLessThan(Self.sep(p.raDeg, p.decDeg, row.raDeg, row.decDeg), 1, "moon-coarse @ \(row.tt!)")
            XCTAssertLessThan(abs(p.distanceKm - row.distanceKm!), Self.moonDistTolKm, "moon-coarse @ \(row.tt!)")
        }
    }

    func testSunDenseWithinOneArcmin() throws {
        for row in try Self.load("sun-dense.json") {
            let p = try sunPosition(utc(row.utc!))
            XCTAssertLessThan(Self.sep(p.raDeg, p.decDeg, row.raDeg, row.decDeg), 1, "sun-dense @ \(row.utc!)")
            XCTAssertLessThan(abs(p.distanceAu - row.distanceAu!), 1e-4, "sun-dense @ \(row.utc!)")
        }
    }

    func testMoonDenseWithinOneArcmin() throws {
        for row in try Self.load("moon-dense.json") {
            let p = try moonPosition(utc(row.utc!))
            XCTAssertLessThan(Self.sep(p.raDeg, p.decDeg, row.raDeg, row.decDeg), 1, "moon-dense @ \(row.utc!)")
            XCTAssertLessThan(abs(p.distanceKm - row.distanceKm!), Self.moonDistTolKm, "moon-dense @ \(row.utc!)")
        }
    }

    struct StarPlaceRow: Decodable {
        let utc: String; let star: String; let raDeg: Double; let decDeg: Double
        let pmMasPerYear: Double; let ghaDeg: Double; let decOfDateDeg: Double
    }

    // USNO's celestial-navigation GHA and declination for the navigational
    // stars, from each star's SIMBAD J2000 position. The places include proper
    // motion and starPosition does not, so each row allows 1″ plus the star's
    // proper motion since J2000. Annual aberration alone is up to 20.5″.
    func testStarsUsnoGhaAndDeclinationWithinOneArcsecPlusProperMotion() throws {
        let url = fixturesURL().appendingPathComponent("positions").appendingPathComponent("stars-usno.json")
        let rows = try JSONDecoder().decode([StarPlaceRow].self, from: Data(contentsOf: url))
        XCTAssertGreaterThan(rows.count, 100)
        let j2000 = utc("2000-01-01T12:00:00Z").timeIntervalSince1970
        for row in rows {
            let t = utc(row.utc)
            let p = try starPosition(raDeg: row.raDeg, decDeg: row.decDeg, at: t)
            let years = (t.timeIntervalSince1970 - j2000) / (365.25 * 86400)
            let tolArcsec = 1 + row.pmMasPerYear * abs(years) / 1000
            let gha = try greenwichSiderealTime(t) - p.raDeg
            let dGha = ((((gha - row.ghaDeg).truncatingRemainder(dividingBy: 360)) + 540).truncatingRemainder(dividingBy: 360)) - 180
            XCTAssertLessThan(abs(dGha) * cos(p.decDeg * Double.pi / 180) * 3600, tolArcsec, "\(row.star) GHA @ \(row.utc)")
            XCTAssertLessThan(abs(p.decDeg - row.decOfDateDeg) * 3600, tolArcsec, "\(row.star) dec @ \(row.utc)")
        }
    }

    func testStarPositionRightAscensionInRange() throws {
        let t = utc("2026-03-20T06:00:00Z")
        for ra in [0, 0.001, 359.999] {
            let p = try starPosition(raDeg: ra, decDeg: 0, at: t)
            XCTAssertGreaterThanOrEqual(p.raDeg, 0)
            XCTAssertLessThan(p.raDeg, 360)
        }
    }

    func testStarPositionRejectsOffSphereAndOutOfInterval() {
        let t = utc("2026-03-20T06:00:00Z")
        for (ra, dec) in [(360.0, 0.0), (-1.0, 0.0), (0.0, -90.5), (0.0, Double.nan)] {
            XCTAssertThrowsError(try starPosition(raDeg: ra, decDeg: dec, at: t), "\(ra), \(dec)") {
                guard case AlmanacError.invalidArgument = $0 else { return XCTFail("\($0)") }
            }
        }
        XCTAssertThrowsError(try starPosition(raDeg: 0, decDeg: 0, at: utc("2101-01-01T00:00:00Z"))) {
            XCTAssertEqual($0 as? AlmanacError, .outOfRange)
        }
    }

    func testEarthHelioStateVelocityIsTheDerivativeOfEarthHelioVector() {
        let h = 0.01 // days
        for tt in [-18262, 0, 9573.25, 36524] {
            let state = earthHelioState(tt)
            let a = earthHelioVector(tt - h), b = earthHelioVector(tt + h), here = earthHelioVector(tt)
            XCTAssertEqual(state.pos.x, here.x); XCTAssertEqual(state.pos.y, here.y); XCTAssertEqual(state.pos.z, here.z)
            // AU per day; orbital speed is ~0.0172
            XCTAssertLessThan(abs(state.vel.x - (b.x - a.x) / (2 * h)), 1e-9, "x @ \(tt)")
            XCTAssertLessThan(abs(state.vel.y - (b.y - a.y) / (2 * h)), 1e-9, "y @ \(tt)")
            XCTAssertLessThan(abs(state.vel.z - (b.z - a.z) / (2 * h)), 1e-9, "z @ \(tt)")
        }
    }

    func testOutOfRangeThrows() {
        XCTAssertThrowsError(try sunPosition(utc("1949-12-31T23:59:59Z")))
    }

    /// -631_152_000.0005 s truncates toward zero (TimeClip) to exactly
    /// supportedMin's -631_152_000 s -- landing IN range, not 0.5 ms below it.
    /// Every public entry point normalizes its Date input before validating,
    /// so this must be accepted, matching what TS's Date already guarantees
    /// by construction.
    func testSubMillisecondBoundaryIsAccepted() throws {
        XCTAssertNoThrow(try sunPosition(Date(timeIntervalSince1970: -631_152_000.0005)))
    }
}
