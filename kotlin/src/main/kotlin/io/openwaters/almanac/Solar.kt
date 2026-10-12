package io.openwaters.almanac

import java.time.Instant
import kotlin.math.*

public enum class SolarEclipseKind(private val rawValue: String) {
    PARTIAL("partial"), ANNULAR("annular"), TOTAL("total");
    override fun toString(): String = rawValue
}
public enum class SolarEclipseAxisKind(private val rawValue: String) {
    TOTAL("total"), ANNULAR("annular");
    override fun toString(): String = rawValue
}
public data class SolarEclipseSunAltitudes(public val c1: Double, public val c2: Double?, public val peak: Double, public val c3: Double?, public val c4: Double)
public data class SolarEclipse(public val kind: SolarEclipseKind, public val obscuration: Double, public val c1: Instant, public val c2: Instant?, public val peak: Instant, public val c3: Instant?, public val c4: Instant, public val sunAltDeg: SolarEclipseSunAltitudes)

// LocalMoonShadow and contacts: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L8494
private val SUN_RADIUS_AU = SUN_RADIUS_KM / KM_PER_AU
internal val MOON_POLAR_RADIUS_KM = 1736.0
private val MOON_POLAR_RADIUS_AU = MOON_POLAR_RADIUS_KM / KM_PER_AU

private val PEAK_WINDOW_DAYS = 0.2

private val PARTIAL_WINDOW_DAYS = 0.2
private val TOTAL_WINDOW_DAYS = 0.01

internal fun localMoonShadow(ut: Double, observer: Observer): ShadowInfo {
    val tt = ttDaysFromUt(ut)

    val pos = observerGeoVectorEqj(ut, observer)

    val s = sunGeoVectorEqj(tt)

    val m = moonGeoVectorEqj(tt)

    val o = Vec3(pos.x - m.x, pos.y - m.y, pos.z - m.z)

    val hm = Vec3(m.x - s.x, m.y - s.y, m.z - s.z)
    return calcShadow(MOON_MEAN_RADIUS_KM, ut, o, hm)
}

internal fun solarAngleBetweenDeg(a: Vec3, b: Vec3): Double {
    val aa = (a.x*a.x + a.y*a.y + a.z*a.z)
    if (abs(aa) < 1.0e-8) error("almanac internal: AngleBetween first vector is too short")
    val bb = (b.x*b.x + b.y*b.y + b.z*b.z)
    if (abs(bb) < 1.0e-8) error("almanac internal: AngleBetween second vector is too short")
    val dot = (a.x*b.x + a.y*b.y + a.z*b.z) / sqrt(aa * bb)
    if (dot <= -1.0) return 180.0
    if (dot >= +1.0) return 0.0
    return RAD2DEG * acos(dot)
}

internal fun discOverlap(a: Double, b: Double, c: Double): Double {
    if (a <= 0.0) error("almanac internal: radius of first disc must be positive")
    if (b <= 0.0) error("almanac internal: radius of second disc must be positive")
    if (c < 0.0) error("almanac internal: distance between discs is not allowed to be negative")

    if (c >= a + b) {

        return 0.0
    }

    if (c == 0.0) {

        return if (a <= b) 1.0 else (b*b)/(a*a)
    }

    val x = (a*a - b*b + c*c) / (2*c)
    val radicand = a*a - x*x
    if (radicand <= 0.0) {

        return if (a <= b) 1.0 else (b*b)/(a*a)
    }

    val y = sqrt(radicand)

    val lens1 = a*a*acos(x/a) - x*y
    val lens2 = b*b*acos((c-x)/b) - (c-x)*y

    return (lens1 + lens2) / (PI*a*a)
}

private fun discObscuration(hm: Vec3, lo: Vec3): Double {

    val ho = Vec3(hm.x + lo.x, hm.y + lo.y, hm.z + lo.z)

    val sunRadius = asin(SUN_RADIUS_AU / hypot(hypot(ho.x, ho.y), ho.z))

    val moonRadius = asin(MOON_POLAR_RADIUS_AU / hypot(hypot(lo.x, lo.y), lo.z))

    val sunMoonSeparation = solarAngleBetweenDeg(lo, ho)

    return discOverlap(sunRadius, moonRadius, sunMoonSeparation * DEG2RAD)
}

public fun solarObscuration(time: Instant, observer: Observer): Double {
    assertSupported(time)

    val shadow = localMoonShadow(utDays(time), observer)
    return discObscuration(shadow.dir, shadow.target)
}

internal fun solarEclipseObscuration(hm: Vec3, lo: Vec3): Double {
    return min(0.9999, discObscuration(hm, lo))
}

private fun localShadowSlope(ut: Double, observer: Observer): Double {
    val dt = 1.0 / 86400.0
    return (localMoonShadow(ut + dt, observer).r - localMoonShadow(ut - dt, observer).r) / dt
}

private fun peakLocalMoonShadow(centerUt: Double, observer: Observer): ShadowInfo {

    val newmoon = searchMoonPhase(0.0, floor(centerUt) - 1, 4.0)
    if (newmoon == null) error("almanac internal: cannot refine new moon")
    val ut = search(
        { u -> localShadowSlope(u, observer) }, newmoon - PEAK_WINDOW_DAYS, newmoon + PEAK_WINDOW_DAYS,
        SHADOW_TOL_SECONDS, SHADOW_ITER_CAP, "peak local moon shadow"
    )
    if (ut == null) error("almanac internal: failed to find peak local Moon shadow time")
    return localMoonShadow(ut, observer)
}

internal fun eclipseKindFromUmbra(k: Double): SolarEclipseAxisKind {
    return if (k > 0.014) SolarEclipseAxisKind.TOTAL else SolarEclipseAxisKind.ANNULAR
}

private fun localPartialDistance(shadow: ShadowInfo): Double {
    return shadow.p - shadow.r
}

private fun localTotalDistance(shadow: ShadowInfo): Double {
    return abs(shadow.k) - shadow.r
}

private fun localEclipseTransition(
    observer: Observer, direction: Int, func: (ShadowInfo) -> Double, t1: Double, t2: Double
): Double {
    val ut = search(
        { u -> direction * func(localMoonShadow(u, observer)) }, t1, t2,
        SHADOW_TOL_SECONDS, SHADOW_ITER_CAP, "local eclipse transition"
    )
    if (ut == null) error("almanac internal: local eclipse transition search failed")
    return ut
}

private fun sunAltDegAt(d: Instant, observer: Observer): Double {
    val ut = utDays(d)
    val alt = topoAltAzUnrefracted(sunGeoVectorEqj(ttDaysFromUt(ut)), ut, observer).altDeg
    return alt + refractionDeg(alt)
}

private fun buildSolarEclipse(shadow: ShadowInfo, observer: Observer): SolarEclipse {
    val peakUt = shadow.ut
    val c1Ut = localEclipseTransition(observer, 1, ::localPartialDistance, peakUt - PARTIAL_WINDOW_DAYS, peakUt)
    val c4Ut = localEclipseTransition(observer, -1, ::localPartialDistance, peakUt, peakUt + PARTIAL_WINDOW_DAYS)
    var c2Ut: Double? = null
    var c3Ut: Double? = null
    var kind: SolarEclipseKind

    if (shadow.r < abs(shadow.k)) {
        c2Ut = localEclipseTransition(observer, 1, ::localTotalDistance, peakUt - TOTAL_WINDOW_DAYS, peakUt)
        c3Ut = localEclipseTransition(observer, -1, ::localTotalDistance, peakUt, peakUt + TOTAL_WINDOW_DAYS)
        kind = if (eclipseKindFromUmbra(shadow.k) == SolarEclipseAxisKind.TOTAL) SolarEclipseKind.TOTAL else SolarEclipseKind.ANNULAR
    } else {
        kind = SolarEclipseKind.PARTIAL
    }

    val obscuration = if (kind == SolarEclipseKind.TOTAL) 1.0 else solarEclipseObscuration(shadow.dir, shadow.target)

    val c1 = dateFromUt(c1Ut)
    val c2 = c2Ut?.let(::dateFromUt)
    val peak = dateFromUt(peakUt)
    val c3 = c3Ut?.let(::dateFromUt)
    val c4 = dateFromUt(c4Ut)
    return SolarEclipse(kind, obscuration, c1, c2, peak, c3, c4,
        SolarEclipseSunAltitudes(sunAltDegAt(c1, observer), c2?.let { sunAltDegAt(it, observer) }, sunAltDegAt(peak, observer), c3?.let { sunAltDegAt(it, observer) }, sunAltDegAt(c4, observer)))
}

private fun seesAnyOfIt(e: SolarEclipse, dip: Double): Boolean {
    return e.sunAltDeg.c1 > dip || e.sunAltDeg.peak > dip || e.sunAltDeg.c4 > dip
}

public fun nextSolarEclipse(after: Instant, observer: Observer, heightAboveGroundM: Double = 0.0): SolarEclipse {
    return nearestSolarEclipse(after, 1, observer, heightAboveGroundM)
}

public fun previousSolarEclipse(before: Instant, observer: Observer, heightAboveGroundM: Double = 0.0): SolarEclipse {
    return nearestSolarEclipse(before, -1, observer, heightAboveGroundM)
}

public fun solarEclipses(startUtc: Instant, endUtc: Instant, observer: Observer, heightAboveGroundM: Double = 0.0): List<SolarEclipse> {
    assertSupported(startUtc)
    assertSupportedWindowEnd(endUtc)
    val dip = horizonDip(observer, heightAboveGroundM)
    return scanSolarEclipses(normalized(startUtc).toEpochMilli(), normalized(endUtc).toEpochMilli(), 1, false, observer, dip)
}

private fun nearestSolarEclipse(anchor: Instant, direction: Int, observer: Observer, heightAboveGroundM: Double): SolarEclipse {
    assertSupported(anchor)
    val dip = horizonDip(observer, heightAboveGroundM)
    val ms = normalized(anchor).toEpochMilli()

    val startMs = if (direction > 0) ms + SAME_ECLIPSE_MS + 1 else SUPPORTED_MIN
    val endMs = if (direction > 0) SUPPORTED_MAX else ms - SAME_ECLIPSE_MS
    val found = scanSolarEclipses(startMs, endMs, direction, true, observer, dip)
    if (found.isNotEmpty()) return found[0]
    throw AlmanacOutOfRangeException()
}

private fun scanSolarEclipses(startMs: Long, endMs: Long, direction: Int, firstOnly: Boolean, observer: Observer, dip: Double): List<SolarEclipse> {
    val found = mutableListOf<SolarEclipse>()
    if (startMs >= endMs) return found

    val startUt = utDays(Instant.ofEpochMilli(startMs)) - PEAK_WINDOW_DAYS
    val endUt = utDays(Instant.ofEpochMilli(endMs)) + PEAK_WINDOW_DAYS
    var nmUt = if (direction > 0) startUt else endUt
    val limitUt = if (direction > 0) endUt else startUt

    while (direction * (limitUt - nmUt) > 0) {
        val newmoon = searchMoonPhase(0.0, nmUt, direction * min(40.0, abs(limitUt - nmUt)))
        if (newmoon == null) break

        nmUt = newmoon + direction * 10

        if (abs(moonEclipticLatitudeDeg(newmoon)) >= PRUNE_LATITUDE_DEG) continue

        val shadow = peakLocalMoonShadow(newmoon, observer)
        if (shadow.r >= shadow.p) continue
        val peak = dateFromUt(shadow.ut)
        if (peak.toEpochMilli() < startMs || peak.toEpochMilli() >= endMs) continue

        val eclipse = buildSolarEclipse(shadow, observer)

        if (!seesAnyOfIt(eclipse, dip)) continue
        found.add(eclipse)
        if (firstOnly) break
    }
    return found
}
