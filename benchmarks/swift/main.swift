import Almanac
import Foundation

struct Suite: Decodable {
    let warmupMs: Double, sampleMs: Double
    let samples: Int
    let observer: Site
    let cases: [Workload]
}
struct Site: Decodable { let latitudeDeg: Double, longitudeDeg: Double }
struct Workload: Decodable {
    let name: String, operation: String, from: String
    let to: String?
    let count: Int?
    let latitudeDeg: Double?, expected: Double?
}
struct Result: Encodable {
    let name: String, iterations: Int, checksum: Double, samplesMs: [Double]
}

func require(_ condition: Bool, _ message: String) throws {
    if !condition { throw NSError(domain: "AlmanacBenchmarks", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}

// Same consumer loop as typescript.mjs, using only the existing public API.
func eclipseWalk(_ from: Date, _ to: Date) throws -> [LunarEclipse] {
    var eclipses: [LunarEclipse] = []
    var cursor = from
    while cursor < to {
        let eclipse: LunarEclipse
        do { eclipse = try nextLunarEclipse(after: cursor) }
        catch AlmanacError.outOfRange { break }
        try require(eclipse.peak > cursor, "Eclipse walk stopped advancing")
        if eclipse.peak >= to { break }
        eclipses.append(eclipse)
        cursor = eclipse.peak
    }
    return eclipses
}

func workload(_ spec: Workload, _ suite: Suite) throws -> () throws -> Double {
    let formatter = ISO8601DateFormatter()
    guard let from = formatter.date(from: spec.from), let to = formatter.date(from: spec.to ?? spec.from) else {
        throw NSError(domain: "AlmanacBenchmarks", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid workload date"])
    }
    let observer = try Observer(latitudeDeg: spec.latitudeDeg ?? suite.observer.latitudeDeg, longitudeDeg: suite.observer.longitudeDeg)
    let times = (0..<(spec.count ?? 1)).map { from.addingTimeInterval(Double($0) * 3600) }
    switch spec.operation {
    case "sunPosition":
        return { try times.reduce(0) { try $0 + sunPosition($1).raDeg } }
    case "moonPosition":
        return { try times.reduce(0) { try $0 + moonPosition($1).raDeg } }
    case "sky":
        return { try times.reduce(0) { sum, t in
            try sum + sunAltAz(t, observer: observer).altDeg
                + moonAltAz(t, observer: observer).altDeg + moonIllumination(t).fraction
        } }
    case "sunEvents":
        return { Double(try sunEvents(from: from, to: to, observer: observer).count) }
    case "moonEvents":
        return { Double(try moonEvents(from: from, to: to, observer: observer).count) }
    case "searchMoonPhases":
        return { Double(try searchMoonPhases(from: from, to: to).count) }
    case "nextLunarEclipse":
        return { try nextLunarEclipse(after: from).peak.timeIntervalSince1970 }
    case "eclipseWalk":
        return { Double(try eclipseWalk(from, to).count) }
    case "previousViaWalk":
        return {
            let last = try eclipseWalk(from, to).last
            try require(last != nil, "No previous eclipse in workload")
            return last!.peak.timeIntervalSince1970
        }
    default:
        throw NSError(domain: "AlmanacBenchmarks", code: 1, userInfo: [NSLocalizedDescriptionKey: "Unknown operation: \(spec.operation)"])
    }
}

func nowMs() -> Double { Double(DispatchTime.now().uptimeNanoseconds) / 1_000_000 }

func measure(_ spec: Workload, _ suite: Suite, _ fixedIterations: Int?) throws -> Result {
    let work = try workload(spec, suite)
    let checksum = try work()
    try require(checksum.isFinite, spec.name + ": invalid output")
    if let expected = spec.expected { try require(checksum == expected, spec.name + ": unexpected output") }
    func batch(_ iterations: Int) throws -> Double {
        var sum = 0.0
        let start = nowMs()
        for _ in 0..<iterations { sum += try work() }
        let elapsed = nowMs() - start
        try require(abs(sum / Double(iterations) - checksum) <= max(1, abs(checksum)) * 1e-9,
                    spec.name + ": output changed during measurement")
        return elapsed
    }
    let warmup = nowMs()
    repeat { _ = try batch(1) } while nowMs() - warmup < suite.warmupMs
    var iterations = fixedIterations ?? 1
    if fixedIterations == nil {
        while try batch(iterations) < suite.sampleMs { iterations *= 2 }
    }
    let samplesMs = [try batch(iterations) / Double(iterations)]
    return Result(name: spec.name, iterations: iterations, checksum: checksum, samplesMs: samplesMs)
}

// Same single-sample process contract as typescript.mjs.
let suite = try JSONDecoder().decode(Suite.self, from: Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1])))
let index = Int(CommandLine.arguments[2]) ?? -1
try require(suite.cases.indices.contains(index), "Invalid workload index")
let iterations = CommandLine.arguments.count > 3 ? Int(CommandLine.arguments[3]) : nil
try require(CommandLine.arguments.count <= 3 || (iterations ?? 0) > 0, "Invalid iteration count")
let result = try measure(suite.cases[index], suite, iterations)
print(String(decoding: try JSONEncoder().encode(result), as: UTF8.self))
