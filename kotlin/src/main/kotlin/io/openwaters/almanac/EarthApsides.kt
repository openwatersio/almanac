// SearchPlanetApsis (Earth), pinned Astronomy Engine 865d3da7d8112bbc7911238052c6af4aaf877181.
// Central difference in UT, orbital-period/6 brackets; fixed J2000 grid gives window-independent roots.
package io.openwaters.almanac

import java.time.Instant
import kotlin.math.floor

public enum class EarthApsisKind(private val rawValue: String) {
    PERIHELION("perihelion"), APHELION("aphelion");
    override fun toString(): String = rawValue
}
public data class EarthApsis(public val time: Instant, public val kind: EarthApsisKind, public val distanceKm: Double)

private val SLOPE_DT_DAYS = 0.001
private val APSIS_CELL_DAYS = 365.256 / 6.0

// SearchPlanetApsis: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L6754
private fun distanceSlope(ut: Double): Double {
    val r1 = earthHelioDistance(ttDaysFromUt(ut-SLOPE_DT_DAYS/2))
    val r2 = earthHelioDistance(ttDaysFromUt(ut+SLOPE_DT_DAYS/2))
    return (r2-r1)/SLOPE_DT_DAYS
}
private fun negativeDistanceSlope(ut: Double): Double = -distanceSlope(ut)
private data class EarthApsisRoot(val ut: Double, val kind: EarthApsisKind)
private fun searchApsisInCell(t1: Double, t2: Double, m1: Double, m2: Double): EarthApsisRoot? {
    if (m1 < 0 && m2 >= 0) {
        val ut = checkNotNull(search(::distanceSlope,t1,t2,1.0,what="perihelion search")) { "almanac internal: perihelion search did not converge" }
        return EarthApsisRoot(ut,EarthApsisKind.PERIHELION)
    }
    if (m1 > 0 && m2 <= 0) {
        val ut = checkNotNull(search(::negativeDistanceSlope,t1,t2,1.0,what="aphelion search")) { "almanac internal: aphelion search did not converge" }
        return EarthApsisRoot(ut,EarthApsisKind.APHELION)
    }
    return null
}

public fun earthApsides(startUtc: Instant, endUtc: Instant): List<EarthApsis> {
    assertSupported(startUtc)
    assertSupportedWindowEnd(endUtc)
    if (normalized(startUtc) >= normalized(endUtc)) return emptyList()
    val startUt = utDays(startUtc)
    val endUt = utDays(endUtc)
    val events = mutableListOf<EarthApsis>()
    var cell = floor(startUt/APSIS_CELL_DAYS)
    var t1 = cell*APSIS_CELL_DAYS
    var m1 = distanceSlope(t1)
    while (t1 < endUt) {
        val t2 = (cell+1)*APSIS_CELL_DAYS
        val m2 = distanceSlope(t2)
        val found = searchApsisInCell(t1,t2,m1,m2)
        if (found != null) {
            val q = quantizedUt(found.ut)
            if (q >= endUt) break
            if (q >= startUt) events.add(EarthApsis(dateFromUt(found.ut),found.kind,earthHelioDistance(ttDaysFromUt(found.ut))*KM_PER_AU))
        }
        cell += 1
        t1 = t2
        m1 = m2
    }
    return events
}
