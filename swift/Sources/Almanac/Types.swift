import Foundation

public enum AlmanacError: Error, Equatable {
    case outOfRange
    case invalidObserver(String)
    case invalidArgument(String)
}

/// Cross-port rule: instants are integer epoch milliseconds via truncation toward
/// zero (ECMAScript TimeClip — what JS Date already did to its input). NOT floor:
/// floor diverges on negative sub-ms tails (pre-1970 instants).
public func normalized(_ d: Date) throws -> Date {
    let ms = d.timeIntervalSince1970 * 1000
    guard ms.isFinite else { throw AlmanacError.invalidArgument("non-finite Date") }
    return Date(timeIntervalSince1970: ms.rounded(.towardZero) / 1000)
}
/// Point in time: [min, max). Window ends use assertSupportedWindowEnd ([min, max]).
public func assertSupportedWindowEnd(_ d: Date) throws {
    guard d.timeIntervalSince1970.isFinite else { throw AlmanacError.invalidArgument("non-finite Date") }
    guard d >= supportedMin, d <= supportedMax else { throw AlmanacError.outOfRange }
}

/// 1950-01-01T00:00Z (incl.) … 2101-01-01T00:00Z (excl.) — the fixture-evidence interval.
public let supportedMin = Date(timeIntervalSince1970: -631_152_000)
public let supportedMax = Date(timeIntervalSince1970: 4_133_980_800)

public func assertSupported(_ d: Date) throws {
    guard d.timeIntervalSince1970.isFinite else { throw AlmanacError.invalidArgument("non-finite Date") }
    guard d >= supportedMin, d < supportedMax else { throw AlmanacError.outOfRange }
}

public struct Observer: Sendable {
    public let latitudeDeg: Double
    public let longitudeDeg: Double
    public let elevationM: Double
    public init(latitudeDeg: Double, longitudeDeg: Double, elevationM: Double = 0) throws {
        guard (-90...90).contains(latitudeDeg) else { throw AlmanacError.invalidObserver("latitudeDeg \(latitudeDeg)") }
        guard (-180...180).contains(longitudeDeg) else { throw AlmanacError.invalidObserver("longitudeDeg \(longitudeDeg)") }
        guard (-500...10000).contains(elevationM) else { throw AlmanacError.invalidObserver("elevationM \(elevationM)") }
        self.latitudeDeg = latitudeDeg; self.longitudeDeg = longitudeDeg; self.elevationM = elevationM
    }
}
