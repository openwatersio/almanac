package io.openwaters.almanac

import java.time.Instant
import kotlin.math.floor

public enum class MoonApsisKind(private val rawValue: String) {
    PERIGEE("perigee"), APOGEE("apogee");
    override fun toString(): String = rawValue
}
public data class MoonApsis(public val time: Instant, public val kind: MoonApsisKind, public val distanceKm: Double)

private val SLOPE_DT_DAYS = 0.001
private val APSIS_CELL_DAYS = 5.0

// SearchLunarApsis: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L6534
private fun distanceSlope(ut: Double): Double {
    val tt = ttDaysFromUt(ut)
    val r1 = calcMoon(tt-SLOPE_DT_DAYS/2).distanceAu
    val r2 = calcMoon(tt+SLOPE_DT_DAYS/2).distanceAu
    return (r2-r1)/SLOPE_DT_DAYS
}
private fun negativeDistanceSlope(ut: Double): Double = -distanceSlope(ut)
private data class ApsisRoot(val ut: Double, val kind: MoonApsisKind)
private fun searchApsisInCell(t1: Double, t2: Double, m1: Double, m2: Double): ApsisRoot? {
    if (m1 < 0 && m2 >= 0) {
        val ut = checkNotNull(search(::distanceSlope,t1,t2,1.0,what="perigee search")) { "almanac internal: perigee search did not converge" }
        return ApsisRoot(ut,MoonApsisKind.PERIGEE)
    }
    if (m1 > 0 && m2 <= 0) {
        val ut = checkNotNull(search(::negativeDistanceSlope,t1,t2,1.0,what="apogee search")) { "almanac internal: apogee search did not converge" }
        return ApsisRoot(ut,MoonApsisKind.APOGEE)
    }
    return null
}

public fun moonApsides(startUtc: Instant, endUtc: Instant): List<MoonApsis> {
    assertSupported(startUtc)
    assertSupportedWindowEnd(endUtc)
    if (normalized(startUtc) >= normalized(endUtc)) return emptyList()
    val startUt = utDays(startUtc)
    val endUt = utDays(endUtc)
    val events = mutableListOf<MoonApsis>()
    var t1 = floor(startUt/APSIS_CELL_DAYS)*APSIS_CELL_DAYS
    var m1 = distanceSlope(t1)
    while (t1 < endUt) {
        val t2 = t1+APSIS_CELL_DAYS
        val m2 = distanceSlope(t2)
        val found = searchApsisInCell(t1,t2,m1,m2)
        if (found != null) {
            val q = quantizedUt(found.ut)
            if (q >= endUt) break
            if (q >= startUt) events.add(MoonApsis(dateFromUt(found.ut),found.kind,calcMoon(ttDaysFromUt(found.ut)).distanceAu*KM_PER_AU))
        }
        t1 = t2
        m1 = m2
    }
    return events
}
