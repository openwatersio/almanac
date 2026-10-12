package io.openwaters.almanac

import java.time.Instant
import kotlin.math.*

public enum class LunarEclipseKind(private val rawValue: String) {
    PENUMBRAL("penumbral"), PARTIAL("partial"), TOTAL("total");
    override fun toString(): String = rawValue
}
public data class LunarEclipse(
    public val kind: LunarEclipseKind, public val peak: Instant,
    public val magUmbral: Double, public val magPenumbral: Double,
    public val p1: Instant, public val u1: Instant?, public val u2: Instant?,
    public val u3: Instant?, public val u4: Instant?, public val p4: Instant
)
public data class LunarEclipseContactsVisible(
    public val p1: Boolean, public val u1: Boolean?, public val u2: Boolean?,
    public val u3: Boolean?, public val u4: Boolean?, public val p4: Boolean
)
public data class LunarEclipseVisibility(
    public val visibleAtPeak: Boolean, public val moonGeometricAltAtPeakDeg: Double,
    public val contactsVisible: LunarEclipseContactsVisible
)

private val EARTH_ECLIPSE_RADIUS_KM = 6371.0 + 88.0
internal val PRUNE_LATITUDE_DEG = 1.8
private val LUNAR_SCAN_LIMIT_DAYS = 730L
private val PEAK_WINDOW_DAYS = 0.03
private val PENUMBRAL_WINDOW_MINUTES = 200.0
private val MINUTES_PER_DAY = 24.0 * 60.0
internal val SHADOW_TOL_SECONDS = 1.0
internal val SHADOW_ITER_CAP = 20
internal val SAME_ECLIPSE_MS = 100L

internal data class ShadowInfo(val ut: Double, val u: Double, val r: Double, val k: Double, val p: Double, val target: Vec3, val dir: Vec3)

// CalcShadow: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L8458
internal fun calcShadow(bodyRadiusKm: Double, ut: Double, target: Vec3, dir: Vec3): ShadowInfo {
    val u = (dir.x*target.x + dir.y*target.y + dir.z*target.z)/(dir.x*dir.x + dir.y*dir.y + dir.z*dir.z)
    val dx = u*dir.x - target.x
    val dy = u*dir.y - target.y
    val dz = u*dir.z - target.z
    val r = KM_PER_AU * hypot(hypot(dx,dy),dz)
    val k = +SUN_RADIUS_KM - (1.0+u)*(SUN_RADIUS_KM-bodyRadiusKm)
    val p = -SUN_RADIUS_KM + (1.0+u)*(SUN_RADIUS_KM+bodyRadiusKm)
    return ShadowInfo(ut,u,r,k,p,target,dir)
}
private fun earthShadow(ut: Double): ShadowInfo {
    val tt = ttDaysFromUt(ut)
    val s = sunGeoVectorEqj(tt)
    val e = Vec3(-s.x,-s.y,-s.z)
    return calcShadow(EARTH_ECLIPSE_RADIUS_KM,ut,moonGeoVectorEqj(tt),e)
}
private fun earthShadowSlope(ut: Double): Double {
    val dt = 1.0/86400.0
    return (earthShadow(ut+dt).r-earthShadow(ut-dt).r)/dt
}
private fun peakEarthShadow(centerUt: Double): ShadowInfo {
    // A fixed full-moon seed keeps next, previous, and split-range circumstances identical.
    val fullmoon = checkNotNull(searchMoonPhase(180.0,floor(centerUt)-1,4.0)) { "almanac internal: cannot refine full moon" }
    val ut = checkNotNull(search(::earthShadowSlope,fullmoon-PEAK_WINDOW_DAYS,fullmoon+PEAK_WINDOW_DAYS,SHADOW_TOL_SECONDS,SHADOW_ITER_CAP,"peak earth shadow")) { "almanac internal: failed to find peak Earth shadow time" }
    return earthShadow(ut)
}
private fun shadowSemiDurationMinutes(shadow: ShadowInfo, radiusLimitKm: Double, windowMinutes: Double): Double {
    val centerUt = shadow.ut
    fun distance(ut: Double): Double = if (ut == centerUt) shadow.r else earthShadow(ut).r
    val window = windowMinutes/MINUTES_PER_DAY
    val t1 = checkNotNull(search({ -(distance(it)-radiusLimitKm) },centerUt-window,centerUt,SHADOW_TOL_SECONDS,SHADOW_ITER_CAP,"shadow semiduration (before)")) { "almanac internal: failed to find shadow semiduration" }
    val t2 = checkNotNull(search({ +(distance(it)-radiusLimitKm) },centerUt,centerUt+window,SHADOW_TOL_SECONDS,SHADOW_ITER_CAP,"shadow semiduration (after)")) { "almanac internal: failed to find shadow semiduration" }
    return (t2-t1)*(MINUTES_PER_DAY/2.0)
}
internal fun moonEclipticLatitudeDeg(ut: Double): Double = RAD2DEG*calcMoon(ttDaysFromUt(ut)).geoEclipLat

public fun nextLunarEclipse(after: Instant): LunarEclipse = nearestLunarEclipse(after,1)
public fun previousLunarEclipse(before: Instant): LunarEclipse = nearestLunarEclipse(before,-1)
public fun lunarEclipses(startUtc: Instant, endUtc: Instant): List<LunarEclipse> {
    assertSupported(startUtc)
    assertSupportedWindowEnd(endUtc)
    return scanLunarEclipses(normalized(startUtc).toEpochMilli(),normalized(endUtc).toEpochMilli(),1,false)
}
private fun nearestLunarEclipse(anchor: Instant, direction: Int): LunarEclipse {
    assertSupported(anchor)
    val ms = normalized(anchor).toEpochMilli()
    val startMs = if (direction > 0) ms+SAME_ECLIPSE_MS+1 else max(SUPPORTED_MIN,ms-LUNAR_SCAN_LIMIT_DAYS*86400000)
    val endMs = if (direction > 0) min(SUPPORTED_MAX,ms+LUNAR_SCAN_LIMIT_DAYS*86400000) else ms-SAME_ECLIPSE_MS
    val found = scanLunarEclipses(startMs,endMs,direction,true)
    if (found.isNotEmpty()) return found.first()
    if (if (direction > 0) endMs == SUPPORTED_MAX else startMs == SUPPORTED_MIN) throw AlmanacOutOfRangeException()
    error("almanac internal: no lunar eclipse within $LUNAR_SCAN_LIMIT_DAYS days of $anchor")
}
private fun scanLunarEclipses(startMs: Long, endMs: Long, direction: Int, firstOnly: Boolean): List<LunarEclipse> {
    val found = mutableListOf<LunarEclipse>()
    if (startMs >= endMs) return found
    val startUt = utDays(Instant.ofEpochMilli(startMs))-PEAK_WINDOW_DAYS
    val endUt = utDays(Instant.ofEpochMilli(endMs))+PEAK_WINDOW_DAYS
    var fmUt = if (direction > 0) startUt else endUt
    val limitUt = if (direction > 0) endUt else startUt
    while (direction*(limitUt-fmUt) > 0) {
        val fullmoon = searchMoonPhase(180.0,fmUt,direction*min(40.0,abs(limitUt-fmUt))) ?: break
        fmUt = fullmoon+direction*10
        if (abs(moonEclipticLatitudeDeg(fullmoon)) >= PRUNE_LATITUDE_DEG) continue
        val shadow = peakEarthShadow(fullmoon)
        if (shadow.r >= shadow.p+MOON_MEAN_RADIUS_KM) continue
        val peak = dateFromUt(shadow.ut)
        if (peak.toEpochMilli() < startMs || peak.toEpochMilli() >= endMs) continue
        found.add(buildLunarEclipse(shadow,peak))
        if (firstOnly) break
    }
    return found
}
private fun buildLunarEclipse(shadow: ShadowInfo, peak: Instant): LunarEclipse {
    var kind = LunarEclipseKind.PENUMBRAL
    var sdTotal = 0.0
    var sdPartial = 0.0
    val sdPenum = shadowSemiDurationMinutes(shadow,shadow.p+MOON_MEAN_RADIUS_KM,PENUMBRAL_WINDOW_MINUTES)
    if (shadow.r < shadow.k+MOON_MEAN_RADIUS_KM) {
        kind = LunarEclipseKind.PARTIAL
        sdPartial = shadowSemiDurationMinutes(shadow,shadow.k+MOON_MEAN_RADIUS_KM,sdPenum)
        if (shadow.r+MOON_MEAN_RADIUS_KM < shadow.k) {
            kind = LunarEclipseKind.TOTAL
            sdTotal = shadowSemiDurationMinutes(shadow,shadow.k-MOON_MEAN_RADIUS_KM,sdPartial)
        }
    }
    val s = MOON_MEAN_RADIUS_KM
    val magPenumbral = (shadow.p+s-shadow.r)/(2*s)
    val magUmbral = (shadow.k+s-shadow.r)/(2*s)
    fun at(offsetMinutes: Double): Instant = dateFromUt(shadow.ut+offsetMinutes/MINUTES_PER_DAY)
    val umbral = kind != LunarEclipseKind.PENUMBRAL
    val total = kind == LunarEclipseKind.TOTAL
    return LunarEclipse(kind,peak,magUmbral,magPenumbral,at(-sdPenum),if (umbral) at(-sdPartial) else null,if (total) at(-sdTotal) else null,if (total) at(+sdTotal) else null,if (umbral) at(+sdPartial) else null,at(+sdPenum))
}
private fun assertLunarEclipse(e: LunarEclipse) {
    val umbral = e.kind != LunarEclipseKind.PENUMBRAL
    val total = e.kind == LunarEclipseKind.TOTAL
    for ((name,contact,expected) in listOf(Triple("u1",e.u1,umbral),Triple("u2",e.u2,total),Triple("u3",e.u3,total),Triple("u4",e.u4,umbral))) {
        require((contact != null) == expected) { "${e.kind} lunar eclipse must ${if (expected) "" else "not "}have $name" }
    }
    val ordered = listOf("p1" to e.p1,"u1" to e.u1,"u2" to e.u2,"peak" to e.peak,"u3" to e.u3,"u4" to e.u4,"p4" to e.p4)
    var prevName = ""
    var prevMs = Long.MIN_VALUE
    for ((name,time) in ordered) {
        if (time == null) continue
        val ms = normalized(time).toEpochMilli()
        require(ms > prevMs) { "lunar eclipse contacts out of order: $prevName not before $name" }
        prevName = name
        prevMs = ms
    }
}
public fun lunarEclipseVisibility(eclipse: LunarEclipse, observer: Observer, heightAboveGroundM: Double = 0.0): LunarEclipseVisibility {
    assertLunarEclipse(eclipse)
    val dip = horizonDip(observer,heightAboveGroundM)
    fun altAt(time: Instant): Double {
        val ut = utDays(time)
        return topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)),ut,observer).altDeg
    }
    fun up(time: Instant?): Boolean? = time?.let { altAt(it) > dip }
    val peakAltDeg = altAt(eclipse.peak)
    return LunarEclipseVisibility(peakAltDeg > dip,peakAltDeg,LunarEclipseContactsVisible(altAt(eclipse.p1) > dip,up(eclipse.u1),up(eclipse.u2),up(eclipse.u3),up(eclipse.u4),altAt(eclipse.p4) > dip))
}
