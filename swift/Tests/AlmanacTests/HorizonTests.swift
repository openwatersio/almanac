import XCTest
import Almanac

final class HorizonTests: XCTestCase {
    struct Row: Decodable {
        struct Site: Decodable { let latitudeDeg: Double; let longitudeDeg: Double; let elevationM: Double }
        let observer: Site; let heightAboveGroundM: Double; let dipDeg: Double
    }

    func testPinnedUpstream() throws {
        let data = try Data(contentsOf: fixturesURL().appendingPathComponent("horizon/dip.json"))
        let rows = try JSONDecoder().decode([Row].self, from: data)
        XCTAssertEqual(rows.count, 25)
        for row in rows {
            let site = try Observer(latitudeDeg: row.observer.latitudeDeg, longitudeDeg: row.observer.longitudeDeg, elevationM: row.observer.elevationM)
            XCTAssertEqual(try horizonDip(observer: site, heightAboveGroundM: row.heightAboveGroundM), row.dipDeg, accuracy: 1e-10)
        }
    }

    func testHeightAndValidation() throws {
        let sea = try Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 2)
        XCTAssertEqual(try horizonDip(observer: sea, heightAboveGroundM: 0).sign, .plus)
        XCTAssertLessThan(try horizonDip(observer: sea, heightAboveGroundM: 2), 0)
        let high = try Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: 10)
        XCTAssertLessThan(try horizonDip(observer: high, heightAboveGroundM: 10), try horizonDip(observer: sea, heightAboveGroundM: 2))
        for height in [Double.nan, .infinity, -1, 10001] {
            XCTAssertThrowsError(try horizonDip(observer: sea, heightAboveGroundM: height))
        }
        let low = try Observer(latitudeDeg: 48.4284, longitudeDeg: -123.3656, elevationM: -499)
        XCTAssertThrowsError(try horizonDip(observer: low, heightAboveGroundM: 2))
        XCTAssertLessThan(try horizonDip(observer: low, heightAboveGroundM: 1), 0)
    }
}
