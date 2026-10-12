package io.openwaters.almanac

import java.time.Instant
import kotlin.math.floor

public enum class SeasonKind(private val rawValue: String) {
    MARCH_EQUINOX("marchEquinox"), JUNE_SOLSTICE("juneSolstice"), SEPTEMBER_EQUINOX("septemberEquinox"), DECEMBER_SOLSTICE("decemberSolstice");
    override fun toString(): String = rawValue
}
public data class SeasonEvent(public val time: Instant, public val kind: SeasonKind)

private val SEASON_CELL_DAYS = 80.0
private fun sunLonDeg(ut: Double): Double = sunEclipticLonDeg(ttDaysFromUt(ut))
private data class SeasonRoot(val ut: Double, val quarter: Int)

// Fixed J2000 cells give every overlapping window the same root bracket.
private fun searchSeasonInCell(t1: Double, t2: Double, lon1: Double): SeasonRoot? {
    val quarter = (floor(lon1/90).toInt()+1)%4
    val targetLonDeg = 90*quarter
    val sunOffset: (Double) -> Double = { angleOffset(sunLonDeg(it)-targetLonDeg) }
    if (sunOffset(t2) < 0) return null
    val ut = checkNotNull(search(sunOffset,t1,t2,0.01,what="season search")) { "almanac internal: season search did not converge" }
    return SeasonRoot(ut,quarter)
}

public fun seasons(startUtc: Instant, endUtc: Instant): List<SeasonEvent> {
    assertSupported(startUtc)
    assertSupportedWindowEnd(endUtc)
    if (normalized(startUtc) >= normalized(endUtc)) return emptyList()
    val startUt = utDays(startUtc)
    val endUt = utDays(endUtc)
    val events = mutableListOf<SeasonEvent>()
    var t1 = floor(startUt/SEASON_CELL_DAYS)*SEASON_CELL_DAYS
    var lon1 = sunLonDeg(t1)
    while (t1 < endUt) {
        val t2 = t1+SEASON_CELL_DAYS
        val found = searchSeasonInCell(t1,t2,lon1)
        if (found != null) {
            val q = quantizedUt(found.ut)
            if (q >= endUt) break
            if (q >= startUt) events.add(SeasonEvent(dateFromUt(found.ut),SeasonKind.entries[found.quarter]))
        }
        t1 = t2
        lon1 = sunLonDeg(t1)
    }
    return events
}
