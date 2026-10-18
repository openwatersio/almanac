import XCTest
@testable import Almanac

final class EarthApsidesTests: XCTestCase {
    struct Row: Decodable { let utc: String; let kind: String; let distanceKm: Double }
    struct Reference: Decodable { let rows: [Row] }
    func testPinnedOracleAndEveryMillisecondBoundary() throws {
        let data = try Data(contentsOf: fixturesURL().appendingPathComponent("raw/earth-apsides/reference.json"))
        let rows = try JSONDecoder().decode(Reference.self, from: data).rows
        let start = utc("1950-01-01T00:00:00Z"), end = utc("2101-01-01T00:00:00Z")
        let all = try earthApsides(from: start, to: end)
        XCTAssertEqual(all.count, 302)
        XCTAssertEqual(all.count, rows.count)
        for (a, row) in zip(all, rows) {
            XCTAssertEqual(a.kind.rawValue, row.kind)
            let reference = try XCTUnwrap(ISO8601DateFormatter.fractional.date(from: row.utc))
            XCTAssertLessThan(abs(a.time.timeIntervalSince(reference)), 2)
            XCTAssertEqual(a.distanceKm, row.distanceKm, accuracy: 0.001)
            XCTAssertTrue(try earthApsides(from: Date(timeIntervalSince1970: ((a.time.timeIntervalSince1970 * 1000).rounded() - 1) / 1000), to: a.time).isEmpty)
            let exact = try earthApsides(from: a.time, to: Date(timeIntervalSince1970: ((a.time.timeIntervalSince1970 * 1000).rounded() + 1) / 1000))
            XCTAssertEqual(exact.first?.time, a.time)
            XCTAssertEqual(exact.first?.distanceKm, a.distanceKm)
            let p = try planetHeliocentricPosition(.earth, at: a.time)
            XCTAssertEqual(sqrt(p.xAu*p.xAu+p.yAu*p.yAu+p.zAu*p.zAu)*KM_PER_AU, a.distanceKm, accuracy: 0.001)
        }
        let split = utc("2026-04-01T00:00:00Z")
        let adjacent = try earthApsides(from: start, to: split) + earthApsides(from: split, to: end)
        XCTAssertEqual(adjacent.map { $0.time }, all.map { $0.time })
        XCTAssertTrue(try earthApsides(from: start, to: start).isEmpty)
        XCTAssertTrue(try earthApsides(from: split, to: start).isEmpty)
        XCTAssertThrowsError(try earthApsides(from: start.addingTimeInterval(-0.001), to: end))
        XCTAssertThrowsError(try earthApsides(from: start, to: end.addingTimeInterval(0.001)))
        XCTAssertThrowsError(try earthApsides(from: end, to: start))
        XCTAssertThrowsError(try earthApsides(from: Date(timeIntervalSince1970: .nan), to: end))
        // Foundation permits sub-millisecond dates; normalization truncates toward zero.
        let negative = Date(timeIntervalSince1970: -1000.0009)
        XCTAssertEqual(try earthApsides(from: negative, to: split).map { $0.time }, try earthApsides(from: Date(timeIntervalSince1970: -1000), to: split).map { $0.time })
    }
}

private extension ISO8601DateFormatter {
    static var fractional: ISO8601DateFormatter {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }
}
