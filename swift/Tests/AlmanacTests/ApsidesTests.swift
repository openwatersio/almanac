import XCTest
@testable import Almanac

final class ApsidesTests: XCTestCase {
    struct ApsisRow: Codable { let utc: String; let kind: String; let distanceKm: Double }

    static let rows: [ApsisRow] = {
        let url = fixturesURL().appendingPathComponent("apsides").appendingPathComponent("horizons-apsides.json")
        return try! JSONDecoder().decode([ApsisRow].self, from: Data(contentsOf: url))
    }()

    // Three Horizons windows; group by contiguous run.
    static let runs: [[ApsisRow]] = {
        var runs: [[ApsisRow]] = []
        for row in rows {
            if let last = runs.last?.last, utc(row.utc).timeIntervalSince(utc(last.utc)) <= 20 * 86400 {
                runs[runs.count - 1].append(row)
            } else {
                runs.append([row])
            }
        }
        return runs
    }()

    // The distance curve is flat at an apsis, so its timing is ill-conditioned:
    // MOON2's periodic distance residual moves the extremum by minutes, most at
    // apogee (see typescript/test/apsides.test.ts). Measured worst: 14.8 min, 54 km.
    static let apsisTimeTolSec = 20.0 * 60
    static let apsisDistTolKm = 70.0

    func testHorizonsApsidesWithin20MinutesAnd70km() throws {
        for run in Self.runs {
            let mine = try moonApsides(from: utc(run[0].utc).addingTimeInterval(-86400),
                                       to: utc(run[run.count - 1].utc).addingTimeInterval(86400))
            XCTAssertEqual(mine.count, run.count, "count for run starting \(run[0].utc)")
            for (a, row) in zip(mine, run) {
                XCTAssertEqual(a.kind.rawValue, row.kind, "kind @ \(row.utc)")
                XCTAssertLessThan(abs(a.time.timeIntervalSince(utc(row.utc))), Self.apsisTimeTolSec, "\(row.kind) @ \(row.utc)")
                XCTAssertLessThan(abs(a.distanceKm - row.distanceKm), Self.apsisDistTolKm, "\(row.kind) distance @ \(row.utc)")
            }
        }
    }

    func testDistanceIsThePositionModelExtremum() throws {
        for a in try moonApsides(from: utc("2026-01-01T00:00:00Z"), to: utc("2026-04-01T00:00:00Z")) {
            XCTAssertEqual(a.distanceKm, try moonPosition(a.time).distanceKm, accuracy: 1e-3)
            let before = try moonPosition(a.time.addingTimeInterval(-3600)).distanceKm - a.distanceKm
            let after = try moonPosition(a.time.addingTimeInterval(3600)).distanceKm - a.distanceKm
            let sign = a.kind == .perigee ? 1.0 : -1.0
            XCTAssertGreaterThan(sign * before, 0)
            XCTAssertGreaterThan(sign * after, 0)
        }
    }

    func testHalfOpenWindowSplitsAtAnApsis() throws {
        let first = try moonApsides(from: utc("2026-03-01T00:00:00Z"), to: utc("2026-04-01T00:00:00Z"))[0]
        XCTAssertTrue(try moonApsides(from: utc("2026-03-01T00:00:00Z"), to: first.time).isEmpty)
        XCTAssertEqual(try moonApsides(from: first.time, to: utc("2026-04-01T00:00:00Z"))[0].time, first.time)
        let before = try moonApsides(from: utc("2026-01-01T00:00:00Z"), to: first.time)
        let after = try moonApsides(from: first.time, to: utc("2027-01-01T00:00:00Z"))
        let year = try moonApsides(from: utc("2026-01-01T00:00:00Z"), to: utc("2027-01-01T00:00:00Z"))
        XCTAssertEqual(before.count + after.count, year.count)
    }

    func testEmptyReversedAndOutOfRangeWindows() throws {
        let t = utc("2026-06-01T00:00:00Z")
        XCTAssertTrue(try moonApsides(from: t, to: t).isEmpty)
        XCTAssertTrue(try moonApsides(from: t.addingTimeInterval(86400), to: t).isEmpty)
        XCTAssertThrowsError(try moonApsides(from: utc("1949-12-31T23:59:59Z"), to: t))
        XCTAssertThrowsError(try moonApsides(from: t, to: utc("2101-01-01T00:00:01Z")))
        XCTAssertThrowsError(try moonApsides(from: Date(timeIntervalSince1970: .nan), to: t))
        XCTAssertThrowsError(try moonApsides(from: utc("2101-01-02T00:00:00Z"), to: t))
    }

    func testFullSupportedWindowSortedAndAlternating() throws {
        let all = try moonApsides(from: utc("1950-01-01T00:00:00Z"), to: utc("2101-01-01T00:00:00Z"))
        XCTAssertEqual(all.count, 4003)
        for i in 1..<all.count {
            XCTAssertGreaterThan(all[i].time, all[i - 1].time)
            XCTAssertNotEqual(all[i].kind, all[i - 1].kind)
        }
    }
}
