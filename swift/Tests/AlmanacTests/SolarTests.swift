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
}
