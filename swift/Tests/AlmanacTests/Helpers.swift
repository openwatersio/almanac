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
