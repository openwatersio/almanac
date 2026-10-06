// swift-tools-version: 5.9
import Foundation
import PackageDescription

// A separate consumer package keeps benchmarking out of the library's products.
let source = ProcessInfo.processInfo.environment["ALMANAC_SOURCE"]
    ?? URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().path
// Swift has no conditional compilation test for a function's existence. Old
// revisions use the consumer loops; revisions with #6 measure the native APIs.
let eclipses = try String(contentsOfFile: "\(source)/swift/Sources/Almanac/Eclipse.swift", encoding: .utf8)
// ponytail: declaration detection assumes Eclipse.swift; update if the API moves.
let eclipseSearches: [SwiftSetting] = eclipses.contains("public func lunarEclipses(") ? [.define("ALMANAC_ECLIPSE_SEARCHES")] : []
// Solar eclipses arrived in 0.4.0 in their own file, so its presence is the test.
let solarEclipses: [SwiftSetting] = FileManager.default.fileExists(atPath: "\(source)/swift/Sources/Almanac/Solar.swift") ? [.define("ALMANAC_SOLAR_ECLIPSES")] : []
// The global search and central line arrived together in 0.5.0 in GlobalSolar.swift.
let globalEclipses: [SwiftSetting] = FileManager.default.fileExists(atPath: "\(source)/swift/Sources/Almanac/GlobalSolar.swift") ? [.define("ALMANAC_GLOBAL_SOLAR_ECLIPSES")] : []
// ponytail: declaration detection assumes Events.swift; update if the API moves.
let events = try String(contentsOfFile: "\(source)/swift/Sources/Almanac/Events.swift", encoding: .utf8)
let planets: [SwiftSetting] = events.contains("public func planetEvents(") ? [.define("ALMANAC_PLANETS")] : []
let package = Package(
    name: "AlmanacBenchmarks",
    dependencies: [.package(name: "Almanac", path: source)],
    targets: [
        .executableTarget(name: "AlmanacBenchmarks", dependencies: [.product(name: "Almanac", package: "Almanac")], path: "swift", swiftSettings: eclipseSearches + solarEclipses + globalEclipses + planets),
    ]
)
