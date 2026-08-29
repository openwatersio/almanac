import Foundation

// L3 event searches: sun rise/set, the three twilights, solar transit,
// moonrise/moonset, and the four quarter moon phases.
//
// Two different algorithms live here, for two different reasons.
//
// The altitude searches are NOT translated from upstream. Upstream's
// `SearchRiseSet` walks a fixed 0.42-day grid guarded by a maximum-slope prune;
// a grid can straddle both halves of a grazing pair (the polar-onset day where
// the Sun sets at 08:00 and rises again at 08:16) and report neither. Here each
// daily cycle's altitude extrema are located numerically and every monotonic
// segment between consecutive extrema is bisected, so a pair of crossings
// minutes apart is bracketed by construction rather than by luck of the grid.
// Hour angle supplies only the initial bracket: HA 0/12h are not the exact
// extrema, because declination, distance and lunar parallax all drift within a
// cycle, and toward the poles the daily altitude cycle flattens until the
// extremum wanders hours away from transit.
//
// `searchMoonPhases` IS translated, from the cosinekitty/astronomy upstream at
// pinned sha 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts:
// `SearchMoonPhase` (~5260) and the `Search` (~4634) / `QuadInterp` (~4528)
// root finder it calls, plus the quarter walk of `SearchMoonQuarter` (~5339)
// and `NextMoonQuarter` (~5362).
//
// Mirrors typescript/src/events.ts function-for-function.

/// A Sun event kind: a horizon or twilight crossing, or upper transit.
public enum SunEventKind: String, CaseIterable, Sendable {
    case rise, set, civilDawn, civilDusk, nauticalDawn, nauticalDusk, astroDawn, astroDusk, transit
}

/// A Sun event.
public struct SunEvent: Sendable { public let time: Date; public let kind: SunEventKind }

/// A Moon event kind: the upper limb crossing the horizon.
public enum MoonEventKind: String, Sendable { case rise, set }

/// A Moon event.
public struct MoonEvent: Sendable { public let time: Date; public let kind: MoonEventKind }

/// A quarter lunar phase kind.
public enum MoonPhaseKind: String, Sendable { case new, firstQuarter, full, lastQuarter }

/// A quarter lunar phase event.
public struct PhaseEvent: Sendable { public let time: Date; public let phase: MoonPhaseKind }

// ---------------------------------------------------------------- constants

private let civilAltDeg = -6.0
private let nauticalAltDeg = -12.0
private let astroAltDeg = -18.0

/** Body radii, for the semidiameter that lowers each rise/set target.
 *  INTERNAL, shared with Eclipse.swift's shadow geometry — not `private`. */
let moonMeanRadiusKm = 1737.4
/** UPSTREAM: `SUN_RADIUS_KM`, astronomy.ts line 134. INTERNAL, see above. */
let sunRadiusKm = 695700.0
private let horizonRefractionDeg = 34.0 / 60.0

/**
 * The upper-limb rise/set target: unrefracted centre altitude at
 * −(34′ + the body's true semidiameter at the distance the observer sees).
 * Spec, Conventions: the same rule for both bodies — a fixed 16′ for the Sun
 * sits ~10″ off USNO near aphelion and perihelion, which a high-latitude graze
 * turns into a minute.
 */
private func upperLimbTargetDeg(_ radiusKm: Double, _ distanceAu: Double) -> Double {
    -horizonRefractionDeg - RAD2DEG * asin(radiusKm / (distanceAu * KM_PER_AU))
}

/** Mean hour-angle advance. The Sun's is a mean solar day by definition. */
private let sunHaRateDegPerDay = 360.0
private let sunCycleDays = 1.0
/** Mean lunar day, 24h50m28s. */
private let moonCycleDays = 1.035050
private let moonHaRateDegPerDay = 360.0 / moonCycleDays

private let secondDays = 1.0 / 86400
/** Bisection and golden-section both stop under a second; events are reported to the ms. */
private let timeTolDays = secondDays
/** An extremum this close to the target grazes it without crossing: no event. */
private let tangentEpsDeg = 1e-6
/** Initial half-bracket around the hour-angle estimate of an extremum. */
private let extremumHalfWidthDays = 2.0 / 24
/**
 * Where the daily cycle flattens the extremum drifts hours off transit — the
 * offset scales as 1/cos φ — so there the bracket is the whole half-cycle
 * instead. The threshold is 85°, not the 89° where the drift becomes dramatic:
 * the Moon's fast declination rate already puts the extremum 2.28 h off transit
 * at 88°N and 5.75 h at 88.9°N, past the ±2 h bracket, and golden section then
 * converges to a bracket edge and the monotonic-segment invariant breaks. The
 * cost of the wider threshold is a few extra golden-section steps at latitudes
 * almost nobody queries.
 */
private let flatCycleLatitudeDeg = 85.0

private let goldenSectionCap = 100
private let bisectionCap = 60
private let hourAngleIterCap = 20
private let moonPhaseIterCap = 50
private let invPhi = 0.6180339887498949

private let minUt = utDays(supportedMin)
private let maxUt = utDays(supportedMax)

/** Probes never leave the supported interval (spec: no degraded answer outside it). */
private func clampUt(_ ut: Double) -> Double {
    ut < minUt ? minUt : (ut > maxUt ? maxUt : ut)
}

/**
 * Hitting an iteration cap is a bug, not a runtime condition — see the spec.
 * Deviation from TS: TS throws a plain `Error` here, uncaught by any real
 * caller (same rationale as `equatorialFromVector`'s unreachable branch in
 * Nutation.swift) — this port crashes rather than threading a new error case
 * through every internal helper for a branch nothing exercises.
 */
private func assertReached(_ condition: Bool, _ what: String) {
    if !condition { fatalError("almanac internal: \(what) did not converge") }
}

// ------------------------------------------------------- altitude sampling

/**
 * One evaluation of a body's unrefracted topocentric geometry. `riseSetAltDeg`
 * is the body's own horizon target at this instant: constant for the Sun,
 * distance-dependent for the Moon.
 */
private struct Sample { let ut: Double; let altDeg: Double; let hourAngleDeg: Double; let riseSetAltDeg: Double }
private typealias Sampler = (Double) -> Sample

private func sunSampler(_ observer: Observer) -> Sampler {
    { ut in
        let p = topoAltAzUnrefracted(sunGeoVectorEqj(ttDaysFromUt(ut)), ut, observer)
        return Sample(ut: ut, altDeg: p.altDeg, hourAngleDeg: p.hourAngleDeg,
                      riseSetAltDeg: upperLimbTargetDeg(sunRadiusKm, p.distanceAu))
    }
}

private func moonSampler(_ observer: Observer) -> Sampler {
    { ut in
        let p = topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer)
        return Sample(ut: ut, altDeg: p.altDeg, hourAngleDeg: p.hourAngleDeg,
                      riseSetAltDeg: upperLimbTargetDeg(moonMeanRadiusKm, p.distanceAu))
    }
}

/** A search target: an absolute altitude, or `nil` for the body's own rise/set target. */
private typealias Level = Double?

private func offsetDeg(_ s: Sample, _ level: Level) -> Double {
    s.altDeg - (level ?? s.riseSetAltDeg)
}

/** −1 below, +1 above, 0 grazing (within {tangentEpsDeg}: touches, never crosses). */
private func crossingSign(_ s: Sample, _ level: Level) -> Int {
    let f = offsetDeg(s, level)
    if abs(f) <= tangentEpsDeg { return 0 }
    return f > 0 ? 1 : -1
}

// ----------------------------------------------------------- root findings

/** Wrap an hour-angle difference into (−180, 180]. */
private func angleOffset(_ diff: Double) -> Double {
    var offset = diff.truncatingRemainder(dividingBy: 360)
    if offset <= -180 { offset += 360 } else if offset > 180 { offset -= 360 }
    return offset
}

/**
 * Time of the next local hour angle `targetHaDeg` strictly after `afterUt`:
 * one advance at the body's mean rate, then fixed-point refinement at the same
 * rate. The rate is right to a few percent, so each step cuts the error by ~20×
 * and the loop settles in three or four iterations. This is both the bracket
 * centre for an altitude extremum and — for `targetHaDeg = 0` — the transit
 * event itself.
 */
private func nextHourAngle(_ sample: Sampler, _ afterUt: Double, _ targetHaDeg: Double, _ rateDegPerDay: Double) -> Double {
    var deficit = (targetHaDeg - sample(afterUt).hourAngleDeg).truncatingRemainder(dividingBy: 360)
    deficit = (deficit + 360).truncatingRemainder(dividingBy: 360)
    if deficit == 0 { deficit = 360 }          // already there: take the next one, not this one
    var ut = afterUt + deficit / rateDegPerDay
    for _ in 0..<hourAngleIterCap {
        let step = angleOffset(targetHaDeg - sample(ut).hourAngleDeg) / rateDegPerDay
        ut += step
        if abs(step) < timeTolDays { return ut }
    }
    assertReached(false, "hour-angle iteration")
    return ut
}

/**
 * Golden-section refinement of the altitude extremum bracketed around
 * `centreUt`. Evaluating the true extremum is what makes a grazing pair
 * findable: the segment on either side of it is monotonic, so bisection can
 * only miss a crossing if the extremum itself was never seen.
 *
 * `afterUt` is the previous extremum. It matters only under the widened
 * high-latitude bracket, where the half-cycle window would otherwise reach back
 * past it — and at the pole, where the daily cycle degenerates into the
 * declination's slow annual drift, unclamped golden section will happily walk
 * backwards and break the chain's ordering.
 */
private func refineExtremum(
    _ sample: Sampler, _ centreUt: Double, _ wantMax: Bool, _ halfWidthDays: Double, _ afterUt: Double
) -> Sample {
    var a = max(clampUt(centreUt - halfWidthDays), afterUt)
    var b = clampUt(centreUt + halfWidthDays)
    var x1 = b - invPhi * (b - a)
    var x2 = a + invPhi * (b - a)
    var s1 = sample(x1)
    var s2 = sample(x2)
    let score: (Sample) -> Double = { wantMax ? $0.altDeg : -$0.altDeg }
    var converged = false
    for _ in 0..<goldenSectionCap {
        if b - a < timeTolDays { converged = true; break }
        if score(s1) > score(s2) {
            b = x2; x2 = x1; s2 = s1
            x1 = b - invPhi * (b - a)
            s1 = sample(x1)
        } else {
            a = x1; x1 = x2; s1 = s2
            x2 = a + invPhi * (b - a)
            s2 = sample(x2)
        }
    }
    assertReached(converged, "golden-section extremum refinement")
    return score(s1) > score(s2) ? s1 : s2
}

/**
 * Bisection for the single crossing of `level` on the monotonic segment
 * between two consecutive extrema.
 */
private func bisectCrossing(_ sample: Sampler, _ level: Level, _ s0: Sample, _ s1: Sample) -> Double {
    var a = s0.ut
    var b = s1.ut
    let belowAtA = offsetDeg(s0, level) < 0
    for _ in 0..<bisectionCap {
        if b - a < timeTolDays { return (a + b) / 2 }
        let mid = (a + b) / 2
        if (offsetDeg(sample(mid), level) < 0) == belowAtA { a = mid } else { b = mid }
    }
    assertReached(false, "crossing bisection")
    return (a + b) / 2
}

// ------------------------------------------------------ the altitude search

private struct LevelSpec<K> { let level: Level; let rising: K; let falling: K }

/**
 * Walk the window one half-cycle at a time, refining each altitude extremum and
 * solving every monotonic segment between consecutive extrema for every target
 * level. The chain starts a full cycle before `startUt` so the segment
 * containing the window's first instant is covered, and runs one extremum past
 * `endUt` so an event just inside the window's end is too.
 */
private func searchAltitudeEvents<K>(
    sample: Sampler,
    levels: [LevelSpec<K>],
    transitKind: K?,
    startUt: Double,
    endUt: Double,
    haRateDegPerDay: Double,
    cycleDays: Double,
    extremumHalfWidthDays: Double
) throws -> [(time: Date, kind: K)] {
    var found: [(ut: Double, kind: K)] = []
    func emit(_ ut: Double, _ kind: K) {
        if ut >= startUt && ut < endUt { found.append((ut, kind)) }   // half-open [start, end)
    }

    // The chain's first point need not be an extremum: between any instant and
    // the next extremum after it the altitude is already monotonic.
    var s0 = sample(clampUt(startUt - cycleDays))
    let firstMax = nextHourAngle(sample, s0.ut, 0, haRateDegPerDay)
    let firstMin = nextHourAngle(sample, s0.ut, 180, haRateDegPerDay)
    var nextIsMax = firstMax <= firstMin
    var nextEst = nextIsMax ? firstMax : firstMin

    let stepCap = Int((2 * (endUt - s0.ut) / cycleDays).rounded(.up)) + 8
    var steps = 0
    while s0.ut < endUt && s0.ut < maxUt {
        assertReached(steps < stepCap, "extremum chain")
        steps += 1
        let atRangeEnd = nextEst >= maxUt
        // At the supported-interval edge the boundary instant stands in for the
        // extremum we are not allowed to probe past. The segment up to it is
        // still monotonic, so any crossing inside the window is still found.
        let s1 = atRangeEnd ? sample(maxUt)
            : refineExtremum(sample, nextEst, nextIsMax, extremumHalfWidthDays, s0.ut)
        assertReached(s1.ut > s0.ut, "extremum chain ordering")

        for spec in levels {
            let g0 = crossingSign(s0, spec.level)
            let g1 = crossingSign(s1, spec.level)
            if g0 * g1 >= 0 { continue }      // no crossing, or a graze that only touches
            emit(bisectCrossing(sample, spec.level, s0, s1), g1 > 0 ? spec.rising : spec.falling)
        }
        if nextIsMax, let transitKind, !atRangeEnd { emit(nextEst, transitKind) }

        s0 = s1
        if atRangeEnd { break }
        nextIsMax.toggle()
        nextEst = nextHourAngle(sample, nextEst, nextIsMax ? 0 : 180, haRateDegPerDay)
    }

    found.sort { $0.ut < $1.ut }
    return try found.map { (try normalized(dateFromUt($0.ut)), $0.kind) }
}

private let sunLevels: [LevelSpec<SunEventKind>] = [
    LevelSpec(level: nil, rising: .rise, falling: .set),
    LevelSpec(level: civilAltDeg, rising: .civilDawn, falling: .civilDusk),
    LevelSpec(level: nauticalAltDeg, rising: .nauticalDawn, falling: .nauticalDusk),
    LevelSpec(level: astroAltDeg, rising: .astroDawn, falling: .astroDusk),
]

private let moonLevels: [LevelSpec<MoonEventKind>] = [
    LevelSpec(level: nil, rising: .rise, falling: .set),
]

private func extremumHalfWidth(_ observer: Observer, _ cycleDays: Double) -> Double {
    abs(observer.latitudeDeg) >= flatCycleLatitudeDeg ? cycleDays / 2 : extremumHalfWidthDays
}

/**
 * Sun rise, set, the three twilights and upper transit within the half-open
 * window `[from, to)`, sorted ascending.
 *
 * Rise and set are the unrefracted geometric centre altitude at −(34′ + the
 * Sun's true semidiameter at distance) — the upper-limb convention with the
 * actual disc, the same rule the Moon gets; the twilights are centre altitude
 * −6°, −12° and −18° with no refraction term; transit is local hour angle
 * zero. An empty list is a valid answer — polar day and polar night drop
 * the crossings — while transit is reported regardless of whether the Sun is
 * above the horizon when it happens.
 */
public func sunEvents(from startUtc: Date, to endUtc: Date, observer: Observer) throws -> [SunEvent] {
    try assertSupported(startUtc)
    try assertSupportedWindowEnd(endUtc)
    if startUtc >= endUtc { return [] }
    let raw = try searchAltitudeEvents(
        sample: sunSampler(observer), levels: sunLevels, transitKind: .transit,
        startUt: utDays(startUtc), endUt: utDays(endUtc),
        haRateDegPerDay: sunHaRateDegPerDay, cycleDays: sunCycleDays,
        extremumHalfWidthDays: extremumHalfWidth(observer, sunCycleDays)
    )
    return raw.map { SunEvent(time: $0.time, kind: $0.kind) }
}

/**
 * Moonrise and moonset within the half-open window `[from, to)`, sorted
 * ascending — the apparent topocentric upper limb crossing the horizon, so
 * refraction (34′), topocentric parallax and the true semidiameter at the
 * Moon's distance are all included — the same upper-limb rule as the Sun's.
 * An empty list is a valid answer.
 */
public func moonEvents(from startUtc: Date, to endUtc: Date, observer: Observer) throws -> [MoonEvent] {
    try assertSupported(startUtc)
    try assertSupportedWindowEnd(endUtc)
    if startUtc >= endUtc { return [] }
    let raw = try searchAltitudeEvents(
        sample: moonSampler(observer), levels: moonLevels, transitKind: nil,
        startUt: utDays(startUtc), endUt: utDays(endUtc),
        haRateDegPerDay: moonHaRateDegPerDay, cycleDays: moonCycleDays,
        extremumHalfWidthDays: extremumHalfWidth(observer, moonCycleDays)
    )
    return raw.map { MoonEvent(time: $0.time, kind: $0.kind) }
}

// -------------------------------------------------------------- moon phases

/**
 * UPSTREAM: `MEAN_SYNODIC_MONTH`, astronomy.ts line 129. The elongation it
 * searches is `moonPhaseDeg` (Illumination.swift), apparent on both sides per
 * the spec's moon-phase definition — upstream's `PairLongitude` uses
 * geometric longitudes, which sit a flat ~40 s off the USNO catalogue.
 */
private let meanSynodicMonth = 29.530588
private let phaseNames: [MoonPhaseKind] = [.new, .firstQuarter, .full, .lastQuarter]

private struct QuadRoot { let t: Double; let dfdt: Double }

/** UPSTREAM: `QuadInterp`, astronomy.ts ~4528. */
private func quadInterp(_ tm: Double, _ dt: Double, _ fa: Double, _ fm: Double, _ fb: Double) -> QuadRoot? {
    let q = (fb + fa) / 2 - fm
    let r = (fb - fa) / 2
    let s = fm
    var x: Double

    if q == 0 {
        if r == 0 { return nil }               // horizontal line: no progress possible
        x = -s / r
        if x < -1 || x > 1 { return nil }
    } else {
        let u = r * r - 4 * q * s
        if u <= 0 { return nil }
        let ru = u.squareRoot()
        let x1 = (-r + ru) / (2 * q)
        let x2 = (-r - ru) / (2 * q)
        if -1 <= x1 && x1 <= 1 {
            if -1 <= x2 && x2 <= 1 { return nil }
            x = x1
        } else if -1 <= x2 && x2 <= 1 {
            x = x2
        } else {
            return nil
        }
    }
    return QuadRoot(t: tm + x * dt, dfdt: (2 * q * x + r) / dt)
}

/**
 * UPSTREAM: `Search`, astronomy.ts ~4634 — bisection with quadratic
 * acceleration for the ascending zero crossing of `f` in `[t1, t2]`. Times are
 * days since J2000 UT rather than upstream's `AstroTime`.
 *
 * INTERNAL, shared with Eclipse.swift's shadow searches — not `private`. `what`
 * labels a non-convergence failure so an eclipse-side search doesn't report
 * itself as a moon-phase one.
 */
func search(
    _ f: (Double) -> Double, _ t1In: Double, _ t2In: Double, _ dtToleranceSeconds: Double,
    iterLimit: Int = moonPhaseIterCap, what: String = "moon-phase search"
) -> Double? {
    let dtDays = abs(dtToleranceSeconds * secondDays)
    var t1 = t1In, t2 = t2In
    var f1 = f(t1)
    var f2 = f(t2)
    var fmid = Double.nan
    var calcFmid = true

    var iter = 0
    while true {
        assertReached(iter < iterLimit, what)
        iter += 1
        let tmid = (t1 + t2) / 2
        let dt = tmid - t1
        if abs(dt) < dtDays { return tmid }

        if calcFmid { fmid = f(tmid) } else { calcFmid = true }

        if let q = quadInterp(tmid, t2 - tmid, f1, fmid, f2), q.dfdt != 0 {
            let fq = f(q.t)
            if abs(fq / q.dfdt) < dtDays { return q.t }
            let dtGuess = 1.2 * abs(fq / q.dfdt)
            if dtGuess < dt / 10 {
                let tleft = q.t - dtGuess
                let tright = q.t + dtGuess
                if (tleft - t1) * (tleft - t2) < 0 && (tright - t1) * (tright - t2) < 0 {
                    let fleft = f(tleft)
                    let fright = f(tright)
                    if fleft < 0 && fright >= 0 {
                        f1 = fleft; f2 = fright; t1 = tleft; t2 = tright
                        fmid = fq; calcFmid = false
                        continue
                    }
                }
            }
        }

        if f1 < 0 && fmid >= 0 { t2 = tmid; f2 = fmid; continue }
        if fmid < 0 && f2 >= 0 { t1 = tmid; f1 = fmid; continue }
        return nil    // no ascending crossing here, or the window is too wide
    }
}

/**
 * UPSTREAM: `SearchMoonPhase`, astronomy.ts ~5260 — forward search only, which
 * is all the quarter walk needs. The phase repeats every synodic month, so the
 * time of the next occurrence is predicted from the current offset and then
 * bracketed ±1.5 days: the Moon's eccentricity has been seen to move a quarter
 * more than 0.9 days off the simple prediction.
 *
 * INTERNAL, shared with Eclipse.swift's full-moon probe — not `private`.
 */
func searchMoonPhase(_ targetLonDeg: Double, _ startUt: Double, _ limitDays: Double) -> Double? {
    let moonOffset: (Double) -> Double = { ut in angleOffset(moonPhaseDeg(ttDaysFromUt(ut)) - targetLonDeg) }
    let uncertainty = 1.5
    var ya = moonOffset(startUt)
    if ya > 0 { ya -= 360 }
    let estDt = -(meanSynodicMonth * ya) / 360
    let dt1 = estDt - uncertainty
    if dt1 > limitDays { return nil }
    let dt2 = min(limitDays, estDt + uncertainty)
    return search(moonOffset, startUt + dt1, startUt + dt2, 0.1)
}

/**
 * The four quarter moon phases within the half-open window `[from, to)`,
 * sorted ascending.
 *
 * A phase is the instant the Moon's geocentric ecliptic longitude leads the
 * Sun's by 0° (new), 90° (first quarter), 180° (full) or 270° (last quarter).
 */
public func searchMoonPhases(from startUtc: Date, to endUtc: Date) throws -> [PhaseEvent] {
    try assertSupported(startUtc)
    try assertSupportedWindowEnd(endUtc)
    if startUtc >= endUtc { return [] }

    let startUt = utDays(startUtc)
    let endUt = utDays(endUtc)
    var events: [PhaseEvent] = []

    // UPSTREAM `SearchMoonQuarter` finds the first quarter strictly after its
    // argument, so the walk starts a day early: a phase landing exactly on
    // startUtc belongs to this half-open window.
    var probeUt = clampUt(startUt - 1)
    var quarter = (Int((moonPhaseDeg(ttDaysFromUt(probeUt)) / 90).rounded(.down)) + 1) % 4

    while true {
        let result = searchMoonPhase(90 * Double(quarter), probeUt, 10)
        assertReached(result != nil, "moon quarter search")
        guard let ut = result, ut < endUt else { break }
        if ut >= startUt {
            events.append(PhaseEvent(time: try normalized(dateFromUt(ut)), phase: phaseNames[quarter]))
        }
        // UPSTREAM `NextMoonQuarter`: skip 6 days, under the smallest observed
        // quarter-to-quarter interval, so the next search cannot re-find this one.
        probeUt = ut + 6
        quarter = (quarter + 1) % 4
    }
    return events
}
