// swift-tools-version: 5.9
import Foundation
import PackageDescription

// A separate consumer package keeps benchmarking out of the library's products.
let package = Package(
    name: "AlmanacBenchmarks",
    dependencies: [.package(name: "Almanac", path: ProcessInfo.processInfo.environment["ALMANAC_SOURCE"] ?? "..")],
    targets: [
        .executableTarget(name: "AlmanacBenchmarks", dependencies: [.product(name: "Almanac", package: "Almanac")], path: "swift"),
    ]
)
