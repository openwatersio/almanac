import XCTest
@testable import Almanac

/// Mirrors typescript/test/events.test.ts: same fixtures, same tolerances,
/// same window-contract/perf cases, same oracle/residual sweeps.
final class EventsTests: XCTestCase {
    static let victoria = try! Observer(latitudeDeg: 48.7621, longitudeDeg: -123.052, elevationM: 0)

    // ------------------------------------------------------------ USNO grid

    struct UsnoRow: Decodable {
        let date: String
        let latitudeDeg: Double
        let longitudeDeg: Double
        let sun: [String: String]
        let moon: [String: String]
    }

    struct Diff { let label: String; let seconds: Double }

    // USNO's one-day service reports only these crossing phenomena, so an absent
    // key is meaningful evidence of "no such event that UT day" only for them.
    // Nautical/astronomical twilight are outside its vocabulary entirely (checked
    // against Horizons below), and it suppresses Upper Transit whenever the body
    // is below the horizon, while this package reports transit unconditionally.
    static let usnoSunCrossings = ["rise", "set", "civilDawn", "civilDusk"]
    static let usnoMoonCrossings = ["rise", "set"]

    // Spec, Fixture corpus > Far-future event rows: USNO fixtures are UT-based, so
    // rows after 2050 measure Espenak-Meeus against USNO's DeltaT projection on top
    // of the astronomy. Those rows assert scatter about their per-date mean offset.
    static let deltaTQuarantineAfterYear = 2050
    static let deltaTMeanBoundSec = 120.0
    static func isFarFuture(_ row: UsnoRow) -> Bool { Int(row.date.prefix(4))! > deltaTQuarantineAfterYear }

    static func loadGrid() throws -> [UsnoRow] {
        let url = fixturesURL().appendingPathComponent("events").appendingPathComponent("usno-grid.json")
        return try JSONDecoder().decode([UsnoRow].self, from: Data(contentsOf: url))
    }

    /// Signed (ours - USNO) difference for every crossing USNO reports in the
    /// row's UT day, having first asserted the absences: an absent key means
    /// "no such event that day" only for the kinds USNO's vocabulary contains.
    func usnoDayDiffs(_ row: UsnoRow, body: String, crossings: [String]) throws -> [Diff] {
        let observer = try Observer(latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg, elevationM: 0)
        let dayStart = utc("\(row.date)T00:00:00Z")
        let dayEnd = dayStart.addingTimeInterval(86400)
        let found: [(kind: String, time: Date)]
        if body == "sun" {
            found = try sunEvents(from: dayStart, to: dayEnd, observer: observer).map { ($0.kind.rawValue, $0.time) }
        } else {
            found = try moonEvents(from: dayStart, to: dayEnd, observer: observer).map { ($0.kind.rawValue, $0.time) }
        }
        let expected = body == "sun" ? row.sun : row.moon
        var diffs: [Diff] = []
        for kind in crossings {
            let mine = found.filter { $0.kind == kind }
            let label = "\(body) \(kind) @ \(row.date) lat \(row.latitudeDeg)"
            guard let want = expected[kind] else {
                XCTAssertEqual(mine.map { $0.time }, [], "\(label): USNO reports none")
                continue
            }
            XCTAssertEqual(mine.count, 1, "\(label): expected exactly one")
            if let first = mine.first {
                let wantTime = utc("\(row.date)T\(want):00Z")
                diffs.append(Diff(label: label, seconds: first.time.timeIntervalSince(wantTime)))
            }
        }
        return diffs
    }

    func testUsnoGridSunCrossingsThrough2050() throws {
        var worst = 0.0
        var worstLabel = ""
        for row in try Self.loadGrid() where !Self.isFarFuture(row) {
            for d in try usnoDayDiffs(row, body: "sun", crossings: Self.usnoSunCrossings) {
                XCTAssertLessThan(abs(d.seconds), 60, d.label)
                if abs(d.seconds) > abs(worst) { worst = d.seconds; worstLabel = d.label }
            }
        }
        print("USNO grid sun: worst \(String(format: "%.1f", worst)) s (\(worstLabel))")
    }

    func testUsnoGridMoonCrossingsThrough2050() throws {
        var worst = 0.0
        var worstLabel = ""
        for row in try Self.loadGrid() where !Self.isFarFuture(row) {
            for d in try usnoDayDiffs(row, body: "moon", crossings: Self.usnoMoonCrossings) {
                XCTAssertLessThan(abs(d.seconds), 60, d.label)
                if abs(d.seconds) > abs(worst) { worst = d.seconds; worstLabel = d.label }
            }
        }
        print("USNO grid moon: worst \(String(format: "%.1f", worst)) s (\(worstLabel))")
    }

    func testUsnoGridPost2050QuarantinesDeltaT() throws {
        var byDate: [String: [Diff]] = [:]
        for row in try Self.loadGrid() where Self.isFarFuture(row) {
            var diffs = try usnoDayDiffs(row, body: "sun", crossings: Self.usnoSunCrossings)
            diffs += try usnoDayDiffs(row, body: "moon", crossings: Self.usnoMoonCrossings)
            byDate[row.date, default: []].append(contentsOf: diffs)
        }
        XCTAssertGreaterThan(byDate.count, 0, "the grid carries at least one post-2050 date")
        for (date, diffs) in byDate {
            // A scatter rule over a single sample is vacuous — the mean is that sample.
            XCTAssertGreaterThan(diffs.count, 1, "\(date): the scatter rule needs more than one crossing")
            let mean = diffs.reduce(0.0) { $0 + $1.seconds } / Double(diffs.count)
            let scatter = diffs.map { abs($0.seconds - mean) }.max() ?? 0
            print("USNO grid \(date): DeltaT offset \(String(format: "%.1f", mean)) s over \(diffs.count) crossings, scatter \(String(format: "%.1f", scatter)) s")
            XCTAssertLessThan(abs(mean), Self.deltaTMeanBoundSec, "\(date): DeltaT projection offset")
            for d in diffs {
                XCTAssertLessThan(abs(d.seconds - mean), 60, "\(d.label): scatter about the date offset")
            }
        }
    }

    // Transit stays on the strict absolute bound at every epoch: an upper transit
    // is fixed by sidereal time, so a DeltaT error moves it by only DeltaT * 0.0027.
    func testUsnoGridSunTransitWithin60s() throws {
        var worst = 0.0
        for row in try Self.loadGrid() {
            guard let transitStr = row.sun["transit"] else { continue }
            let observer = try Observer(latitudeDeg: row.latitudeDeg, longitudeDeg: row.longitudeDeg, elevationM: 0)
            let dayStart = utc("\(row.date)T00:00:00Z")
            let transits = try sunEvents(from: dayStart, to: dayStart.addingTimeInterval(86400), observer: observer)
                .filter { $0.kind == .transit }
            XCTAssertEqual(transits.count, 1, "transit @ \(row.date) lat \(row.latitudeDeg)")
            if let t = transits.first {
                let want = utc("\(row.date)T\(transitStr):00Z")
                worst = max(worst, abs(t.time.timeIntervalSince(want)))
            }
        }
        print("USNO worst transit margin: \(String(format: "%.1f", worst)) s")
        XCTAssertLessThan(worst, 60)
    }

    // Polar day/night suppresses USNO's Upper Transit but the spec still reports it.
    func testTransitReportedThroughPolarNight() throws {
        let polar = try Observer(latitudeDeg: 70.5, longitudeDeg: -123.052, elevationM: 0)
        let dayStart = utc("2026-12-21T00:00:00Z")
        let events = try sunEvents(from: dayStart, to: dayStart.addingTimeInterval(86400), observer: polar)
        XCTAssertEqual(events.filter { $0.kind == .transit }.count, 1)
        XCTAssertEqual(events.filter { $0.kind == .rise || $0.kind == .set }.count, 0)
    }

    // The 70.5°N polar-day onset: 2026-05-14 carries a 16-minute set/rise pair,
    // 2026-05-15 has neither, and 2026-07-27..29 the Moon never clears the horizon.
    func testGrazingPolarDayOnsetPair() throws {
        let polar = try Observer(latitudeDeg: 70.5, longitudeDeg: -123.052, elevationM: 0)
        let day = utc("2026-05-14T00:00:00Z")
        let events = try sunEvents(from: day, to: day.addingTimeInterval(86400), observer: polar)
        let set = events.first { $0.kind == .set }
        let rise = events.first { $0.kind == .rise }
        XCTAssertNotNil(set, "set found")
        XCTAssertNotNil(rise, "rise found")
        guard let set, let rise else { return }
        XCTAssertLessThan(set.time, rise.time)
        // Both times are inside 60 s only because the target carries the Sun's
        // true semidiameter: at a graze this slow (0.166"/s) the old fixed 16'
        // put set 66 s out.
        XCTAssertLessThan(abs(set.time.timeIntervalSince(utc("2026-05-14T08:00:00Z"))), 60)
        XCTAssertLessThan(abs(rise.time.timeIntervalSince(utc("2026-05-14T08:16:00Z"))), 60)
    }

    func testGrazingDayAfterOnsetNoCrossing() throws {
        let polar = try Observer(latitudeDeg: 70.5, longitudeDeg: -123.052, elevationM: 0)
        let d15 = utc("2026-05-15T00:00:00Z")
        let sunNonTransit = try sunEvents(from: d15, to: d15.addingTimeInterval(86400), observer: polar)
            .filter { $0.kind != .transit }
        XCTAssertEqual(sunNonTransit.count, 0)
        for date in ["2026-07-27", "2026-07-28", "2026-07-29"] {
            let t0 = utc("\(date)T00:00:00Z")
            let moon = try moonEvents(from: t0, to: t0.addingTimeInterval(86400), observer: polar)
            XCTAssertEqual(moon.count, 0, "moon @ \(date)")
        }
    }

    // -------------------------------------------- Horizons twilight independence

    struct AltAzRow: Decodable { let utc: String; let altDeg: Double; let siteLatDeg: Double; let siteLonDeg: Double }
    struct TwilightLevel { let alt: Double; let dawn: SunEventKind; let dusk: SunEventKind }

    static let twilightLevels: [TwilightLevel] = [
        TwilightLevel(alt: -6, dawn: .civilDawn, dusk: .civilDusk),
        TwilightLevel(alt: -12, dawn: .nauticalDawn, dusk: .nauticalDusk),
        TwilightLevel(alt: -18, dawn: .astroDawn, dusk: .astroDusk),
    ]

    func testHorizonsAirlessTwilightWithin60s() throws {
        let url = fixturesURL().appendingPathComponent("altaz").appendingPathComponent("sun-airless-twilight.json")
        let rows = try JSONDecoder().decode([AltAzRow].self, from: Data(contentsOf: url))
        var bySite: [String: [AltAzRow]] = [:]
        for r in rows { bySite["\(r.siteLatDeg),\(r.siteLonDeg)", default: []].append(r) }

        var worst = 0.0
        var worstLabel = ""
        var checked = 0

        for (key, siteRows) in bySite {
            let parts = key.split(separator: ",")
            let observer = try Observer(latitudeDeg: Double(parts[0])!, longitudeDeg: Double(parts[1])!, elevationM: 0)
            // The fixture is two disjoint 2-day blocks per site; only consecutive
            // 1-minute samples bracket a crossing.
            for level in Self.twilightLevels {
                for i in 1..<siteRows.count {
                    let a = siteRows[i - 1]
                    let b = siteRows[i]
                    let ta = utc(a.utc)
                    let tb = utc(b.utc)
                    guard tb.timeIntervalSince(ta) == 60 else { continue }
                    let fa = a.altDeg - level.alt
                    let fb = b.altDeg - level.alt
                    if fa == 0 || fa * fb > 0 { continue }
                    let crossing = ta.addingTimeInterval(tb.timeIntervalSince(ta) * fa / (fa - fb))
                    let kind = fb > fa ? level.dawn : level.dusk
                    let found = try sunEvents(from: ta.addingTimeInterval(-2 * 3600), to: tb.addingTimeInterval(2 * 3600), observer: observer)
                        .filter { $0.kind == kind }
                        .map { abs($0.time.timeIntervalSince(crossing)) }
                        .sorted()
                    let label = "\(kind) @ \(a.utc) site \(key)"
                    XCTAssertGreaterThan(found.count, 0, "\(label): no matching event")
                    checked += 1
                    if let first = found.first {
                        if first > worst { worst = first; worstLabel = label }
                        XCTAssertLessThan(first, 60, label)
                    }
                }
            }
        }
        print("Horizons twilight: \(checked) crossings, worst \(String(format: "%.1f", worst)) s (\(worstLabel))")
        XCTAssertGreaterThan(checked, 20)
    }

    // -------------------------------------------------------------- moon phases

    struct PhaseRow: Decodable { let phase: String; let utc: String }

    static func loadPhaseRows() throws -> [PhaseRow] {
        let url = fixturesURL().appendingPathComponent("phases").appendingPathComponent("usno-phases.json")
        return try JSONDecoder().decode([PhaseRow].self, from: Data(contentsOf: url))
    }

    // The fixture is seven 99-entry USNO runs; group by contiguous run so a
    // window's count can be compared without inventing gaps.
    static func phaseRuns(_ rows: [PhaseRow]) -> [[PhaseRow]] {
        let sorted = rows.sorted { usnoUtc($0.utc) < usnoUtc($1.utc) }
        var runs: [[PhaseRow]] = []
        for row in sorted {
            if let lastRow = runs.last?.last,
               usnoUtc(row.utc).timeIntervalSince(usnoUtc(lastRow.utc)) <= 40 * 86400 {
                runs[runs.count - 1].append(row)
            } else {
                runs.append([row])
            }
        }
        return runs
    }

    static func runYear(_ run: [PhaseRow]) -> Int { Int(run[0].utc.prefix(4))! }
    // A moon phase is a Terrestrial Time event reported in UT, so unlike a rise or
    // a transit its UT label moves one-for-one with DeltaT — the same quarantine
    // the grid uses applies here, by run.
    static func isDeltaTDivergent(_ run: [PhaseRow]) -> Bool { runYear(run) > deltaTQuarantineAfterYear }

    @discardableResult
    func checkPhaseRun(_ run: [PhaseRow], toleranceSeconds: Double) throws -> (worst: Double, label: String) {
        let start = usnoUtc(run[0].utc).addingTimeInterval(-6 * 3600)
        let end = usnoUtc(run[run.count - 1].utc).addingTimeInterval(6 * 3600)
        let mine = try searchMoonPhases(from: start, to: end)
        XCTAssertEqual(mine.count, run.count, "count for run starting \(run[0].utc)")
        var worst = 0.0
        var label = ""
        for i in 0..<min(mine.count, run.count) {
            XCTAssertEqual(mine[i].phase.rawValue, run[i].phase, "phase order @ \(run[i].utc)")
            let signed = mine[i].time.timeIntervalSince(usnoUtc(run[i].utc))
            if abs(signed) > abs(worst) { worst = signed; label = "\(run[i].phase) @ \(run[i].utc)" }
            XCTAssertLessThan(abs(signed), toleranceSeconds, "\(run[i].phase) @ \(run[i].utc)")
        }
        return (worst, label)
    }

    func testUsnoMoonPhasesWithin60s() throws {
        var worst = 0.0
        var worstLabel = ""
        for run in Self.phaseRuns(try Self.loadPhaseRows()) where !Self.isDeltaTDivergent(run) {
            let r = try checkPhaseRun(run, toleranceSeconds: 60)
            if abs(r.worst) > abs(worst) { worst = r.worst; worstLabel = r.label }
        }
        print("USNO phases 1950-2050: worst \(String(format: "%.1f", worst)) s (\(worstLabel))")
    }

    func testMoonPhaseRunsPost2050QuarantineDeltaT() throws {
        var checked = 0
        for run in Self.phaseRuns(try Self.loadPhaseRows()) where Self.isDeltaTDivergent(run) {
            let start = usnoUtc(run[0].utc).addingTimeInterval(-6 * 3600)
            let end = usnoUtc(run[run.count - 1].utc).addingTimeInterval(6 * 3600)
            let mine = try searchMoonPhases(from: start, to: end)
            XCTAssertEqual(mine.count, run.count, "count for run starting \(run[0].utc)")
            guard mine.count == run.count else { continue }
            let diffs = zip(mine, run).map { $0.0.time.timeIntervalSince(usnoUtc($0.1.utc)) }
            let mean = diffs.reduce(0, +) / Double(diffs.count)
            let scatter = diffs.map { abs($0 - mean) }.max() ?? 0
            print("USNO phases \(Self.runYear(run)): DeltaT offset \(String(format: "%.1f", mean)) s, scatter \(String(format: "%.1f", scatter)) s")
            XCTAssertLessThan(abs(mean), Self.deltaTMeanBoundSec, "\(Self.runYear(run)): DeltaT projection offset")
            for i in 0..<run.count {
                XCTAssertEqual(mine[i].phase.rawValue, run[i].phase, "phase order @ \(run[i].utc)")
                XCTAssertLessThan(abs(diffs[i] - mean), 60, "\(run[i].phase) @ \(run[i].utc): scatter")
            }
            checked += 1
        }
        XCTAssertGreaterThan(checked, 0, "the catalogue carries post-2050 runs")
    }

    func testSearchedQuartersSelfConsistentWithIllumination() throws {
        let found = try searchMoonPhases(from: utc("2026-01-01T00:00:00Z"), to: utc("2026-04-01T00:00:00Z"))
        let first = found.first { $0.phase == .firstQuarter }!
        let last = found.first { $0.phase == .lastQuarter }!
        // Both read the same apparent elongation (moonPhaseDeg in Illumination.swift),
        // so this is exact to the search's own 0.1 s root tolerance.
        let fq = try moonIllumination(first.time)
        XCTAssertLessThan(abs(fq.phase - 0.25), 1e-6)
        XCTAssertTrue(fq.waxing)
        let lq = try moonIllumination(last.time)
        XCTAssertLessThan(abs(lq.phase - 0.75), 1e-6)
        XCTAssertFalse(lq.waxing)
    }

    // --------------------------------------------------- latitude sweep residual

    // No fixture reaches the latitudes where the daily cycle flattens and the
    // altitude extremum drifts hours off transit. The invariant that holds
    // everywhere: at a reported rise or set the body's unrefracted centre
    // altitude is exactly -(34' + its true semidiameter at the topocentric
    // distance). The residual is normalised by the local altitude rate, so the
    // assertion is the algorithm's own contract at every latitude.
    private struct ResidualBody { let name: String; let vector: (Double) -> Vec3; let radiusKm: Double }

    func testRiseSetTargetResidualPoleToEquator() throws {
        let kmPerAuTest = 1.4959787069098932e8
        func offset(_ body: ResidualBody, _ t: Date, _ o: Observer) -> Double {
            let ut = utDays(t)
            let p = topoAltAzUnrefracted(body.vector(ttDaysFromUt(ut)), ut, o)
            let target = -34.0 / 60 - (180 / Double.pi) * asin(body.radiusKm / (p.distanceAu * kmPerAuTest))
            return p.altDeg - target
        }

        let bodies: [ResidualBody] = [
            ResidualBody(name: "sun", vector: sunGeoVectorEqj, radiusKm: 695700),
            ResidualBody(name: "moon", vector: moonGeoVectorEqj, radiusKm: 1737.4),
        ]

        var worst = 0.0
        var worstLabel = ""
        for body in bodies {
            for latitudeDeg in [-89.5, -35, 0, 48.7621, 70.5, 86, 88, 88.9, 89.5, 90] {
                let observer = try Observer(latitudeDeg: latitudeDeg, longitudeDeg: -123.052, elevationM: 0)
                // Above the flattening threshold a crossing can be months away,
                // so those latitudes get a whole year rather than a month.
                let flat = abs(latitudeDeg) >= 85
                let start = utc("2026-01-01T00:00:00Z")
                let end = start.addingTimeInterval((flat ? 366 : 40) * 86400)

                let events: [(time: Date, kind: String)]
                if body.name == "sun" {
                    events = try sunEvents(from: start, to: end, observer: observer).map { ($0.time, $0.kind.rawValue) }
                } else {
                    events = try moonEvents(from: start, to: end, observer: observer).map { ($0.time, $0.kind.rawValue) }
                }
                let crossings = events.filter { $0.kind == "rise" || $0.kind == "set" }
                XCTAssertGreaterThan(crossings.count, 1, "\(body.name) lat \(latitudeDeg): found a rise and a set")
                for e in crossings {
                    let residual = abs(offset(body, e.time, observer))
                    let ratePerSec = abs(
                        offset(body, e.time.addingTimeInterval(30), observer)
                        - offset(body, e.time.addingTimeInterval(-30), observer)
                    ) / 60
                    let seconds = residual / ratePerSec
                    if seconds > worst { worst = seconds; worstLabel = "\(body.name) lat \(latitudeDeg)" }
                    XCTAssertLessThan(seconds, 1, "\(body.name) lat \(latitudeDeg) \(e.kind) @ \(e.time)")
                }
                for i in 1..<events.count {
                    XCTAssertGreaterThanOrEqual(events[i].time, events[i - 1].time, "\(body.name) lat \(latitudeDeg): sorted")
                }
            }
        }
        print("rise/set target residual: worst \(String(format: "%.3f", worst)) s of time (\(worstLabel))")
    }

    // A residual test can only speak for the events that were found; a bracket
    // that misses one leaves nothing to measure. So the flattening band gets an
    // independent oracle: a 1-minute brute-force scan of the same unrefracted
    // altitude, every sign change of which must be matched one-for-one.
    //
    // This is the regression for the |lat| >= 85 threshold. At the old 89 the
    // Moon at -88.5 lost the 2026-09-26 rise and its set: the extremum sits
    // 5.75 h off transit there, past the +/-2 h bracket, so golden section
    // returned a bracket edge and the segment it produced was not monotonic.
    func testFlatteningBandBruteForceOracle() throws {
        let observer = try Observer(latitudeDeg: -88.5, longitudeDeg: -123.052, elevationM: 0)
        let start = utc("2026-09-10T00:00:00Z")
        let end = start.addingTimeInterval(30 * 86400)
        let kmPerAuTest = 1.4959787069098932e8

        func offset(_ d: Date) -> Double {
            let ut = utDays(d)
            let p = topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer)
            return p.altDeg - (-34.0 / 60 - (180 / Double.pi) * asin(1737.4 / (p.distanceAu * kmPerAuTest)))
        }

        var brute: [(time: Date, kind: String)] = []
        var prev = offset(start)
        var t = start.addingTimeInterval(60)
        while t <= end {
            let cur = offset(t)
            if prev < 0 && cur >= 0 { brute.append((t, "rise")) }
            if prev >= 0 && cur < 0 { brute.append((t, "set")) }
            prev = cur
            t = t.addingTimeInterval(60)
        }
        XCTAssertGreaterThan(brute.count, 1, "the scan window carries crossings to match")

        let mine = try moonEvents(from: start, to: end, observer: observer)
        XCTAssertEqual(mine.count, brute.count,
            "scan found \(brute.map { "\($0.kind) \($0.time)" }.joined(separator: ", "))")
        for i in 0..<min(mine.count, brute.count) {
            XCTAssertEqual(mine[i].kind.rawValue, brute[i].kind, "crossing \(i)")
            // The scan brackets each crossing in the minute before its detection.
            XCTAssertLessThan(abs(mine[i].time.timeIntervalSince(brute[i].time)), 60, "crossing \(i) within the scan step")
        }
    }

    // ------------------------------------------------------ window / validation

    func testValidationPrecedesReversedWindowShortCircuit() throws {
        let t1 = utc("2026-08-28T00:00:00Z")
        let nan = Date(timeIntervalSince1970: .nan)
        XCTAssertThrowsError(try sunEvents(from: nan, to: t1, observer: Self.victoria)) { error in
            guard case AlmanacError.invalidArgument = error else { return XCTFail("expected invalidArgument, got \(error)") }
        }
        XCTAssertThrowsError(try moonEvents(from: nan, to: t1, observer: Self.victoria)) { error in
            guard case AlmanacError.invalidArgument = error else { return XCTFail("expected invalidArgument, got \(error)") }
        }
        XCTAssertThrowsError(try searchMoonPhases(from: nan, to: t1)) { error in
            guard case AlmanacError.invalidArgument = error else { return XCTFail("expected invalidArgument, got \(error)") }
        }
        // Swift bakes observer validity into Observer's own throwing initializer,
        // so an out-of-range latitude can never reach sunEvents in the first
        // place — the equivalent of TS's RangeError-before-short-circuit case.
        XCTAssertThrowsError(try Observer(latitudeDeg: 91, longitudeDeg: 0))
    }

    func testEmptyAndReversedWindowsReturnEmpty() throws {
        let t1 = utc("2026-08-28T00:00:00Z")
        let t2 = utc("2026-08-29T00:00:00Z")
        XCTAssertEqual(try sunEvents(from: t1, to: t1, observer: Self.victoria).count, 0)
        XCTAssertEqual(try sunEvents(from: t2, to: t1, observer: Self.victoria).count, 0)
        XCTAssertEqual(try moonEvents(from: t1, to: t1, observer: Self.victoria).count, 0)
        XCTAssertEqual(try moonEvents(from: t2, to: t1, observer: Self.victoria).count, 0)
        XCTAssertEqual(try searchMoonPhases(from: t1, to: t1).count, 0)
        XCTAssertEqual(try searchMoonPhases(from: t2, to: t1).count, 0)
    }

    func testWindowOverlappingOutsideSupportedIntervalIsOutOfRange() throws {
        let before = utc("1949-12-01T00:00:00Z")
        let after = utc("1950-02-01T00:00:00Z")
        XCTAssertThrowsError(try sunEvents(from: before, to: after, observer: Self.victoria)) { error in
            XCTAssertEqual(error as? AlmanacError, .outOfRange)
        }
        XCTAssertThrowsError(try moonEvents(from: before, to: after, observer: Self.victoria)) { error in
            XCTAssertEqual(error as? AlmanacError, .outOfRange)
        }
        XCTAssertThrowsError(try searchMoonPhases(from: before, to: after)) { error in
            XCTAssertEqual(error as? AlmanacError, .outOfRange)
        }
        XCTAssertThrowsError(try sunEvents(from: supportedMax.addingTimeInterval(-86400), to: supportedMax.addingTimeInterval(1), observer: Self.victoria)) { error in
            XCTAssertEqual(error as? AlmanacError, .outOfRange)
        }
    }

    func testExactFullRangeWindowEndIsLegal() throws {
        XCTAssertNoThrow(try searchMoonPhases(from: supportedMax.addingTimeInterval(-86400), to: supportedMax))
    }

    func testEventsSortedAscendingAndNormalized() throws {
        let t1 = utc("2026-08-28T00:00:00Z")
        let events = try sunEvents(from: t1, to: t1.addingTimeInterval(5 * 86400), observer: Self.victoria)
        XCTAssertGreaterThan(events.count, 20)
        for i in 1..<events.count {
            XCTAssertGreaterThanOrEqual(events[i].time, events[i - 1].time)
        }
        for e in events { XCTAssertEqual(try normalized(e.time), e.time) }
    }

    func testWindowHalfOpenSunTransit() throws {
        let t1 = utc("2026-08-28T00:00:00Z")
        let t2 = utc("2026-08-29T00:00:00Z")
        let transit = try sunEvents(from: t1, to: t2, observer: Self.victoria).first { $0.kind == .transit }
        XCTAssertNotNil(transit)
        guard let at = transit?.time else { return }
        XCTAssertFalse(try sunEvents(from: t1, to: at, observer: Self.victoria).contains { $0.time == at })
        XCTAssertTrue(try sunEvents(from: at, to: t2, observer: Self.victoria).contains { $0.time == at })
    }

    func testWindowHalfOpenMoonPhase() throws {
        let phases = try searchMoonPhases(from: utc("2026-08-01T00:00:00Z"), to: utc("2026-09-01T00:00:00Z"))
        let at = phases[0].time
        XCTAssertFalse(try searchMoonPhases(from: utc("2026-08-01T00:00:00Z"), to: at).contains { $0.time == at })
        let after = try searchMoonPhases(from: at, to: utc("2026-09-01T00:00:00Z"))
        XCTAssertEqual(after.first?.time, at)
    }

    // -------------------------------------------------------------------- perf

    func testPerfFullRangeSearchMoonPhases() throws {
        let t0 = Date()
        let all = try searchMoonPhases(from: supportedMin, to: supportedMax)
        let dt = Date().timeIntervalSince(t0)
        print("searchMoonPhases 1950-2100: \(all.count) events in \(String(format: "%.2f", dt)) s")
        XCTAssertGreaterThan(all.count, 7000)
        XCTAssertLessThan(dt, 10.0)
    }

    func testPerfOneYearSunAndMoonEvents() throws {
        let start = utc("2026-01-01T00:00:00Z")
        let end = utc("2027-01-01T00:00:00Z")
        let t0 = Date()
        let sun = try sunEvents(from: start, to: end, observer: Self.victoria)
        let moon = try moonEvents(from: start, to: end, observer: Self.victoria)
        let dt = Date().timeIntervalSince(t0)
        print("one year at Victoria: \(sun.count) sun + \(moon.count) moon events in \(String(format: "%.2f", dt)) s")
        XCTAssertGreaterThan(sun.count, 3000)
        XCTAssertGreaterThan(moon.count, 600)
        XCTAssertLessThan(dt, 5.0)
    }

    // The documented blocking cost: the spec keeps windows unrestricted, so a
    // caller can ask for all 151 years and this is what that costs.
    func testPerfFullRangeSunAndMoonEvents() throws {
        let t0 = Date()
        let sun = try sunEvents(from: supportedMin, to: supportedMax, observer: Self.victoria)
        let t1 = Date()
        let moon = try moonEvents(from: supportedMin, to: supportedMax, observer: Self.victoria)
        let dt = Date().timeIntervalSince(t0)
        print("full range 1950-2100 at Victoria: \(sun.count) sun in \(String(format: "%.1f", t1.timeIntervalSince(t0))) s"
            + " + \(moon.count) moon in \(String(format: "%.1f", dt - t1.timeIntervalSince(t0))) s = \(String(format: "%.1f", dt)) s")
        XCTAssertLessThan(dt, 120.0)
    }
}
