// swift-tools-version: 6.0
import PackageDescription
let package = Package(
    name: "Almanac",
    products: [.library(name: "Almanac", targets: ["Almanac"])],
    targets: [
        .target(name: "Almanac", path: "swift/Sources/Almanac"),
        .testTarget(name: "AlmanacTests", dependencies: ["Almanac"], path: "swift/Tests/AlmanacTests"),
    ]
)
