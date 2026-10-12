package io.openwaters.almanac

import java.time.Instant
import kotlin.math.*

public enum class SunEventKind(private val rawValue: String) {
    RISE("rise"), SET("set"), CIVIL_DAWN("civilDawn"), CIVIL_DUSK("civilDusk"), NAUTICAL_DAWN("nauticalDawn"), NAUTICAL_DUSK("nauticalDusk"), ASTRO_DAWN("astroDawn"), ASTRO_DUSK("astroDusk"), TRANSIT("transit");
    override fun toString(): String = rawValue
}

public enum class MoonEventKind(private val rawValue: String) {
    RISE("rise"), SET("set");
    override fun toString(): String = rawValue
}

public enum class PlanetEventKind(private val rawValue: String) {
    RISE("rise"), SET("set");
    override fun toString(): String = rawValue
}

public enum class AltitudeEventKind(private val rawValue: String) {
    RISING("rising"), FALLING("falling");
    override fun toString(): String = rawValue
}

public enum class TransitEventKind(private val rawValue: String) {
    UPPER("upper"), LOWER("lower");
    override fun toString(): String = rawValue
}

public enum class MoonPhaseName(private val rawValue: String) {
    NEW("new"), FIRST_QUARTER("firstQuarter"), FULL("full"), LAST_QUARTER("lastQuarter");
    override fun toString(): String = rawValue
}

public data class SunEvent(public val time: Instant, public val kind: SunEventKind)
public data class MoonEvent(public val time: Instant, public val kind: MoonEventKind)
public data class PlanetEvent(public val time: Instant, public val kind: PlanetEventKind)
public data class AltitudeEvent(public val time: Instant, public val kind: AltitudeEventKind)
public data class TransitEvent(public val time: Instant, public val kind: TransitEventKind)
public data class MoonPhaseEvent(public val time: Instant, public val phase: MoonPhaseName)

internal val MOON_MEAN_RADIUS_KM = 1737.4
internal val SUN_RADIUS_KM = 695700.0
internal val MEAN_SYNODIC_MONTH = 29.530588
private val HORIZON_REFRACTION_DEG = 34.0 / 60
private val MOON_CYCLE_DAYS = 1.035050
private val MOON_HA_RATE_DEG_PER_DAY = 360 / MOON_CYCLE_DAYS
private val SECOND_DAYS = 1.0 / 86400
private val TIME_TOL_DAYS = SECOND_DAYS
private val TANGENT_EPS_DEG = 1e-6
private val EXTREMUM_HALF_WIDTH_DAYS = 2.0 / 24
private val GOLDEN_SECTION_CAP = 100
private val BISECTION_CAP = 60
private val SECANT_CAP = 8
private val HOUR_ANGLE_ITER_CAP = 20
private val INV_PHI = 0.6180339887498949
internal val MIN_UT = utDays(Instant.ofEpochMilli(SUPPORTED_MIN))
internal val MAX_UT = utDays(Instant.ofEpochMilli(SUPPORTED_MAX))

internal fun clampUt(ut: Double): Double = if (ut < MIN_UT) MIN_UT else if (ut > MAX_UT) MAX_UT else ut
// Judge half-open windows on the TimeClipped instant because negative epochs truncate upward.
internal fun quantizedUt(ut: Double): Double = utDays(dateFromUt(ut))
internal fun assertReached(condition: Boolean, what: String) {
    if (!condition) error("almanac internal: $what did not converge")
}

internal data class Sample(val ut: Double, val altDeg: Double, val hourAngleDeg: Double, val riseSetAltDeg: Double)
internal typealias Sampler = (Double) -> Sample
private fun upperLimbTargetDeg(radiusKm: Double, distanceAu: Double): Double = -HORIZON_REFRACTION_DEG - RAD2DEG * asin(radiusKm / (distanceAu * KM_PER_AU))
private fun sunSampler(observer: Observer, dip: Double): Sampler = { ut ->
    val p = topoAltAzUnrefracted(sunGeoVectorEqj(ttDaysFromUt(ut)), ut, observer)
    Sample(ut, p.altDeg, p.hourAngleDeg, dip + upperLimbTargetDeg(SUN_RADIUS_KM, p.distanceAu))
}
private fun moonSampler(observer: Observer, dip: Double): Sampler = { ut ->
    val p = topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer)
    Sample(ut, p.altDeg, p.hourAngleDeg, dip + upperLimbTargetDeg(MOON_MEAN_RADIUS_KM, p.distanceAu))
}
private fun planetSampler(planet: Planet, observer: Observer, dip: Double): Sampler = { ut ->
    val p = topoAltAzUnrefracted(planetGeoVectorEqj(planet, ttDaysFromUt(ut)), ut, observer)
    Sample(ut, p.altDeg, p.hourAngleDeg, dip - HORIZON_REFRACTION_DEG)
}
private fun offsetDeg(s: Sample, level: Double?): Double = s.altDeg - (level ?: s.riseSetAltDeg)
private fun crossingSign(s: Sample, level: Double?): Int {
    val f = offsetDeg(s, level)
    return if (abs(f) <= TANGENT_EPS_DEG) 0 else sign(f).toInt()
}
internal fun angleOffset(diff: Double): Double {
    var offset = diff % 360
    if (offset <= -180) offset += 360
    else if (offset > 180) offset -= 360
    return offset
}
internal fun nextHourAngle(sample: Sampler, afterUt: Double, targetHaDeg: Double, rateDegPerDay: Double): Double {
    var deficit = ((targetHaDeg - sample(afterUt).hourAngleDeg) % 360 + 360) % 360
    if (deficit == 0.0) deficit = 360.0
    var ut = afterUt + deficit / rateDegPerDay
    repeat(HOUR_ANGLE_ITER_CAP) {
        val step = angleOffset(targetHaDeg - sample(ut).hourAngleDeg) / rateDegPerDay
        ut += step
        if (abs(step) < TIME_TOL_DAYS) return ut
    }
    error("almanac internal: hour-angle iteration did not converge")
}
private fun refineExtremum(sample: Sampler, centreUt: Double, wantMax: Boolean, halfWidthDays: Double, afterUt: Double, flatCycle: Boolean): Sample {
    val a = max(clampUt(centreUt - halfWidthDays), afterUt)
    val b = clampUt(centreUt + halfWidthDays)
    if (!flatCycle) {
        val best = brentExtremum(sample, a, b, wantMax)
        if (best != null) return best
    }
    return goldenExtremum(sample, a, b, wantMax)
}
internal fun brentExtremum(sample: Sampler, a0: Double, b0: Double, wantMax: Boolean): Sample? {
    val cost: (Sample) -> Double = { if (wantMax) -it.altDeg else it.altDeg }
    var a = a0
    var b = b0
    var x = a + (1 - INV_PHI) * (b - a)
    var w = x
    var v = x
    var sx = sample(x)
    var fx = cost(sx)
    var fw = fx
    var fv = fx
    var d = 0.0
    var e = 0.0
    repeat(GOLDEN_SECTION_CAP) {
        if (b - a < TIME_TOL_DAYS) return if (x - a0 < TIME_TOL_DAYS || b0 - x < TIME_TOL_DAYS) null else sx
        val tol1 = max(TIME_TOL_DAYS / 16, 4 * 2.220446049250313e-16 * abs(x))
        val xm = (a + b) / 2
        var golden = true
        if (abs(e) > tol1) {
            val r = (x - w) * (fx - fv)
            var q = (x - v) * (fx - fw)
            var p = (x - v) * q - (x - w) * r
            q = 2 * (q - r)
            if (q > 0) p = -p
            q = abs(q)
            val eTemp = e
            e = d
            if ((p / q).isFinite() && abs(p) < abs(0.5 * q * eTemp) && p > q * (a - x) && p < q * (b - x)) {
                d = p / q
                if (x + d - a < 2 * tol1 || b - (x + d) < 2 * tol1) d = if (xm >= x) tol1 else -tol1
                golden = false
            }
        }
        if (golden) {
            e = if (x >= xm) a - x else b - x
            d = (1 - INV_PHI) * e
        }
        val u = if (abs(d) >= tol1) x + d else x + (if (d >= 0) tol1 else -tol1)
        val su = sample(u)
        val fu = cost(su)
        if (fu <= fx) {
            if (u >= x) a = x else b = x
            v = w; fv = fw
            w = x; fw = fx
            x = u; fx = fu; sx = su
        } else {
            if (u < x) a = u else b = u
            if (fu <= fw || w == x) {
                v = w; fv = fw
                w = u; fw = fu
            } else if (fu <= fv || v == x || v == w) {
                v = u; fv = fu
            }
        }
    }
    return null
}
internal fun goldenExtremum(sample: Sampler, a0: Double, b0: Double, wantMax: Boolean): Sample {
    var a = a0
    var b = b0
    var x1 = b - INV_PHI * (b - a)
    var x2 = a + INV_PHI * (b - a)
    var s1 = sample(x1)
    var s2 = sample(x2)
    val score: (Sample) -> Double = { if (wantMax) it.altDeg else -it.altDeg }
    var converged = false
    for (i in 0 until GOLDEN_SECTION_CAP) {
        if (b - a < TIME_TOL_DAYS) { converged = true; break }
        if (score(s1) > score(s2)) {
            b = x2; x2 = x1; s2 = s1
            x1 = b - INV_PHI * (b - a)
            s1 = sample(x1)
        } else {
            a = x1; x1 = x2; s1 = s2
            x2 = a + INV_PHI * (b - a)
            s2 = sample(x2)
        }
    }
    assertReached(converged, "golden-section extremum refinement")
    return if (score(s1) > score(s2)) s1 else s2
}
internal fun solveCrossing(sample: Sampler, level: Double?, s0: Sample, s1: Sample): Double {
    var a = s0.ut
    var b = s1.ut
    val belowAtA = offsetDeg(s0, level) < 0
    val f: (Double) -> Double = { ut -> (if (belowAtA) 1 else -1) * offsetDeg(if (ut == s0.ut) s0 else if (ut == s1.ut) s1 else sample(ut), level) }
    val targetDeg = level ?: ((s0.riseSetAltDeg + s1.riseSetAltDeg) / 2)
    val secant = secantCrossing(f, a, b, s0, s1, targetDeg)
    if (secant != null) return secant
    val root = search(f, a, b, 0.25, BISECTION_CAP, "altitude crossing")
    if (root != null) {
        val left = max(a, root - TIME_TOL_DAYS / 4)
        val right = min(b, root + TIME_TOL_DAYS / 4)
        if (f(left) < 0 && f(right) >= 0) return (left + right) / 2
    }
    repeat(BISECTION_CAP) {
        if (b - a < TIME_TOL_DAYS) return (a + b) / 2
        val mid = (a + b) / 2
        if ((offsetDeg(sample(mid), level) < 0) == belowAtA) a = mid
        else b = mid
    }
    error("almanac internal: crossing bisection did not converge")
}
internal fun secantCrossing(f: (Double) -> Double, a: Double, b: Double, s0: Sample, s1: Sample, targetDeg: Double): Double? {
    val g0 = sin(s0.altDeg * DEG2RAD)
    val g1 = sin(s1.altDeg * DEG2RAD)
    val c = (g0 + g1) / 2
    val amp = (g0 - g1) / 2
    val ratio = (sin(targetDeg * DEG2RAD) - c) / amp
    if (!(abs(ratio) < 1)) return null
    val theta = acos(ratio)
    var t = a + theta * (b - a) / PI
    var slope = abs(amp) * sin(theta) * PI / (b - a) / cos(targetDeg * DEG2RAD) * RAD2DEG
    var ft = f(t)
    repeat(SECANT_CAP) {
        val step = -ft / slope
        if (!step.isFinite()) return null
        if (abs(step) < TIME_TOL_DAYS / 4) {
            if (ft < 0) {
                val right = min(b, t + TIME_TOL_DAYS / 2)
                return if (f(right) >= 0) min(t + step, right) else null
            }
            val left = max(a, t - TIME_TOL_DAYS / 2)
            return if (f(left) < 0) max(left, t + step) else null
        }
        val next = t + step
        if (next <= a || next >= b) return null
        val fNext = f(next)
        slope = (fNext - ft) / (next - t)
        t = next
        ft = fNext
    }
    return null
}
private data class LevelSpec<K>(val level: Double?, val rising: K, val falling: K)
private data class TimedEvent<K>(val time: Instant, val kind: K)
private data class FoundEvent<K>(val ut: Double, val kind: K)
// Refined extrema make each segment monotonic, including both halves of a polar grazing pair.
private fun <K> searchAltitudeEvents(sample: Sampler, levels: List<LevelSpec<K>>, transitKind: K?, lowerTransitKind: K?, startUt: Double, endUt: Double, haRateDegPerDay: Double, cycleDays: Double, flatCycle: Boolean): List<TimedEvent<K>> {
    val halfWidth = if (flatCycle) cycleDays / 2 else EXTREMUM_HALF_WIDTH_DAYS
    val found = mutableListOf<FoundEvent<K>>()
    fun emit(ut: Double, kind: K) {
        val q = quantizedUt(ut)
        if (q >= startUt && q < endUt) found.add(FoundEvent(ut, kind))
    }
    var s0 = sample(clampUt(startUt - cycleDays))
    val firstMax = nextHourAngle(sample, s0.ut, 0.0, haRateDegPerDay)
    val firstMin = nextHourAngle(sample, s0.ut, 180.0, haRateDegPerDay)
    var nextIsMax = firstMax <= firstMin
    var nextEst = if (nextIsMax) firstMax else firstMin
    val stepCap = ceil(2 * (endUt - s0.ut) / cycleDays).toLong() + 8
    var steps = 0L
    while (s0.ut < endUt && s0.ut < MAX_UT) {
        assertReached(steps++ < stepCap, "extremum chain")
        val atRangeEnd = nextEst >= MAX_UT
        val s1 = if (atRangeEnd) sample(MAX_UT) else if (levels.isEmpty()) sample(nextEst) else refineExtremum(sample, nextEst, nextIsMax, halfWidth, s0.ut, flatCycle)
        assertReached(s1.ut > s0.ut, "extremum chain ordering")
        if (quantizedUt(s1.ut) >= startUt) {
            for (spec in levels) {
                val g0 = crossingSign(s0, spec.level)
                val g1 = crossingSign(s1, spec.level)
                if (g0*g1 >= 0) continue
                emit(solveCrossing(sample, spec.level, s0, s1), if (g1 > 0) spec.rising else spec.falling)
            }
        }
        val transit = if (nextIsMax) transitKind else lowerTransitKind
        if (transit != null && !atRangeEnd) emit(nextEst, transit)
        s0 = s1
        if (atRangeEnd) break
        nextIsMax = !nextIsMax
        nextEst = nextHourAngle(sample, nextEst, if (nextIsMax) 0.0 else 180.0, haRateDegPerDay)
    }
    found.sortBy { it.ut }
    return found.map { TimedEvent(dateFromUt(it.ut), it.kind) }
}
private val SUN_LEVELS = listOf(
    LevelSpec(null, SunEventKind.RISE, SunEventKind.SET),
    LevelSpec(-6.0, SunEventKind.CIVIL_DAWN, SunEventKind.CIVIL_DUSK),
    LevelSpec(-12.0, SunEventKind.NAUTICAL_DAWN, SunEventKind.NAUTICAL_DUSK),
    LevelSpec(-18.0, SunEventKind.ASTRO_DAWN, SunEventKind.ASTRO_DUSK)
)
private fun flatCycle(observer: Observer): Boolean = abs(observer.latitudeDeg) >= 85

public fun sunEvents(startUtc: Instant, endUtc: Instant, observer: Observer, heightAboveGroundM: Double = 0.0): List<SunEvent> {
    assertSupported(startUtc)
    assertSupportedWindowEnd(endUtc)
    val dip = horizonDip(observer, heightAboveGroundM)
    if (normalized(startUtc) >= normalized(endUtc)) return emptyList()
    return searchAltitudeEvents(sunSampler(observer,dip),SUN_LEVELS,SunEventKind.TRANSIT,null,utDays(startUtc),utDays(endUtc),360.0,1.0,flatCycle(observer)).map { SunEvent(it.time,it.kind) }
}
public fun moonEvents(startUtc: Instant, endUtc: Instant, observer: Observer, heightAboveGroundM: Double = 0.0): List<MoonEvent> {
    assertSupported(startUtc)
    assertSupportedWindowEnd(endUtc)
    val dip = horizonDip(observer, heightAboveGroundM)
    if (normalized(startUtc) >= normalized(endUtc)) return emptyList()
    return searchAltitudeEvents(moonSampler(observer,dip),listOf(LevelSpec(null,MoonEventKind.RISE,MoonEventKind.SET)),null,null,utDays(startUtc),utDays(endUtc),MOON_HA_RATE_DEG_PER_DAY,MOON_CYCLE_DAYS,flatCycle(observer)).map { MoonEvent(it.time,it.kind) }
}
public fun planetEvents(planet: Planet, startUtc: Instant, endUtc: Instant, observer: Observer, heightAboveGroundM: Double = 0.0): List<PlanetEvent> {
    assertPlanet(planet)
    assertSupported(startUtc)
    assertSupportedWindowEnd(endUtc)
    val dip = horizonDip(observer, heightAboveGroundM)
    if (normalized(startUtc) >= normalized(endUtc)) return emptyList()
    val cycleDays = 0.9972695717592592
    return searchAltitudeEvents(planetSampler(planet,observer,dip),listOf(LevelSpec(null,PlanetEventKind.RISE,PlanetEventKind.SET)),null,null,utDays(startUtc),utDays(endUtc),360/cycleDays,cycleDays,flatCycle(observer)).map { PlanetEvent(it.time,it.kind) }
}
public fun sunAltitudeEvents(startUtc: Instant, endUtc: Instant, observer: Observer, altitudeDeg: Double): List<AltitudeEvent> {
    require(altitudeDeg >= -90 && altitudeDeg <= 90) { "altitudeDeg out of range: $altitudeDeg" }
    assertSupported(startUtc)
    assertSupportedWindowEnd(endUtc)
    if (normalized(startUtc) >= normalized(endUtc)) return emptyList()
    return searchAltitudeEvents(sunSampler(observer,0.0),listOf(LevelSpec(altitudeDeg,AltitudeEventKind.RISING,AltitudeEventKind.FALLING)),null,null,utDays(startUtc),utDays(endUtc),360.0,1.0,flatCycle(observer)).map { AltitudeEvent(it.time,it.kind) }
}
public fun sunTransits(startUtc: Instant, endUtc: Instant, observer: Observer): List<TransitEvent> {
    assertSupported(startUtc)
    assertSupportedWindowEnd(endUtc)
    if (normalized(startUtc) >= normalized(endUtc)) return emptyList()
    return searchAltitudeEvents(sunSampler(observer,0.0),emptyList(),TransitEventKind.UPPER,TransitEventKind.LOWER,utDays(startUtc),utDays(endUtc),360.0,1.0,flatCycle(observer)).map { TransitEvent(it.time,it.kind) }
}
public fun moonTransits(startUtc: Instant, endUtc: Instant, observer: Observer): List<TransitEvent> {
    assertSupported(startUtc)
    assertSupportedWindowEnd(endUtc)
    if (normalized(startUtc) >= normalized(endUtc)) return emptyList()
    return searchAltitudeEvents(moonSampler(observer,0.0),emptyList(),TransitEventKind.UPPER,TransitEventKind.LOWER,utDays(startUtc),utDays(endUtc),MOON_HA_RATE_DEG_PER_DAY,MOON_CYCLE_DAYS,flatCycle(observer)).map { TransitEvent(it.time,it.kind) }
}
internal data class QuadRoot(val t: Double, val dfdt: Double)
// QuadInterp and Search: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L4528
internal fun quadInterp(tm: Double, dt: Double, fa: Double, fm: Double, fb: Double): QuadRoot? {
    val Q = (fb + fa) / 2 - fm
    val R = (fb - fa) / 2
    val S = fm
    val x: Double
    if (Q == 0.0) {
        if (R == 0.0) return null
        x = -S / R
        if (x < -1 || x > 1) return null
    } else {
        val u = R*R - 4*Q*S
        if (u <= 0) return null
        val ru = sqrt(u)
        val x1 = (-R + ru) / (2 * Q)
        val x2 = (-R - ru) / (2 * Q)
        if (-1 <= x1 && x1 <= 1) {
            if (-1 <= x2 && x2 <= 1) return null
            x = x1
        } else if (-1 <= x2 && x2 <= 1) x = x2
        else return null
    }
    return QuadRoot(tm + x*dt, (2*Q*x + R)/dt)
}
internal fun search(f: (Double) -> Double, t1: Double, t2: Double, dtToleranceSeconds: Double, iterLimit: Int = 50, what: String = "moon-phase search"): Double? {
    var t1 = t1
    var t2 = t2
    val dtDays = abs(dtToleranceSeconds * SECOND_DAYS)
    var f1 = f(t1)
    var f2 = f(t2)
    var fmid = Double.NaN
    var calcFmid = true
    var iter = 0
    while (true) {
        assertReached(iter++ < iterLimit, what)
        val tmid = (t1 + t2) / 2
        val dt = tmid - t1
        if (abs(dt) < dtDays) return if (f1 <= 0 && f2 >= 0) tmid else null
        if (calcFmid) fmid = f(tmid) else calcFmid = true
        val q = quadInterp(tmid,t2-tmid,f1,fmid,f2)
        if (q != null && q.dfdt != 0.0) {
            val fq = f(q.t)
            if (abs(fq/q.dfdt) < dtDays) return q.t
            val dtGuess = 1.2 * abs(fq/q.dfdt)
            if (dtGuess < dt/10) {
                val tleft = q.t - dtGuess
                val tright = q.t + dtGuess
                if ((tleft-t1)*(tleft-t2) < 0 && (tright-t1)*(tright-t2) < 0) {
                    val fleft = f(tleft)
                    val fright = f(tright)
                    if (fleft < 0 && fright >= 0) {
                        f1 = fleft; f2 = fright; t1 = tleft; t2 = tright
                        fmid = fq; calcFmid = false
                        continue
                    }
                }
            }
        }
        if (f1 < 0 && fmid >= 0) { t2 = tmid; f2 = fmid; continue }
        if (fmid < 0 && f2 >= 0) { t1 = tmid; f1 = fmid; continue }
        return null
    }
}
internal fun searchMoonPhase(targetLonDeg: Double, startUt: Double, limitDays: Double): Double? {
    val moonOffset: (Double) -> Double = { angleOffset(moonPhaseDeg(ttDaysFromUt(it)) - targetLonDeg) }
    val uncertainty = 1.5
    var ya = moonOffset(startUt)
    val dt1: Double
    val dt2: Double
    if (limitDays < 0) {
        if (ya < 0) ya += 360
        val estDt = -(MEAN_SYNODIC_MONTH*ya)/360
        dt2 = estDt + uncertainty
        if (dt2 < limitDays) return null
        dt1 = max(limitDays, estDt - uncertainty)
    } else {
        if (ya > 0) ya -= 360
        val estDt = -(MEAN_SYNODIC_MONTH*ya)/360
        dt1 = estDt - uncertainty
        if (dt1 > limitDays) return null
        dt2 = min(limitDays, estDt + uncertainty)
    }
    return search(moonOffset,startUt+dt1,startUt+dt2,0.1)
}
public fun searchMoonPhases(startUtc: Instant, endUtc: Instant): List<MoonPhaseEvent> {
    assertSupported(startUtc)
    assertSupportedWindowEnd(endUtc)
    if (normalized(startUtc) >= normalized(endUtc)) return emptyList()
    val startUt = utDays(startUtc)
    val endUt = utDays(endUtc)
    val events = mutableListOf<MoonPhaseEvent>()
    var probeUt = clampUt(startUt-1)
    var quarter = (floor(moonPhaseDeg(ttDaysFromUt(probeUt))/90).toInt()+1)%4
    while (true) {
        val ut = checkNotNull(searchMoonPhase(90.0*quarter,probeUt,10.0)) { "almanac internal: moon quarter search did not converge" }
        val q = quantizedUt(ut)
        if (q >= endUt) break
        if (q >= startUt) events.add(MoonPhaseEvent(dateFromUt(ut),MoonPhaseName.entries[quarter]))
        probeUt = ut+6
        quarter = (quarter+1)%4
    }
    return events
}
