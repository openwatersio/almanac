import Foundation
/// Repo-root fixtures/ — resolved from this source file's path, so tests read
/// the same corpus as the TS suite without SwiftPM resource copying.
func fixturesURL() -> URL {
    URL(fileURLWithPath: #filePath)                 // …/swift/Tests/AlmanacTests/Helpers.swift
        .deletingLastPathComponent().deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent()
        .appendingPathComponent("fixtures")
}
func utc(_ iso: String) -> Date { ISO8601DateFormatter().date(from: iso)! }

// usno-phases.json timestamps are minute-precision ("...T04:39Z", no
// seconds) — ISO8601DateFormatter's default options require seconds, so
// pad them before parsing. Shared by IlluminationTests and EventsTests.
func usnoUtc(_ s: String) -> Date { utc(s.replacingOccurrences(of: "Z", with: ":00Z")) }

// solar-local.json instants carry milliseconds ("...T17:41:00.800Z"), which
// ISO8601DateFormatter's default options reject.
func utcMs(_ iso: String) -> Date {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f.date(from: iso)!
}
