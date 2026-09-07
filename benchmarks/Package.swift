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
let package = Package(
    name: "AlmanacBenchmarks",
    dependencies: [.package(name: "Almanac", path: source)],
    targets: [
        .executableTarget(name: "AlmanacBenchmarks", dependencies: [.product(name: "Almanac", package: "Almanac")], path: "swift", swiftSettings: eclipseSearches),
    ]
)
