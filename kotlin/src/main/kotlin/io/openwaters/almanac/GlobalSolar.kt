package io.openwaters.almanac

import java.time.Instant
import kotlin.math.*

public data class GlobalSolarEclipse(
    public val kind: SolarEclipseKind, public val peak: Instant, public val axisDistanceKm: Double,
    public val latitudeDeg: Double?, public val longitudeDeg: Double?, public val obscuration: Double?,
    public val greatestLatitudeDeg: Double, public val greatestLongitudeDeg: Double, public val greatestObscuration: Double
)
public data class SolarEclipseAxisPoint(public val time: Instant, public val latitudeDeg: Double, public val longitudeDeg: Double, public val kind: SolarEclipseAxisKind, public val obscuration: Double)

private val EARTH_MEAN_RADIUS_KM = 6371.0
private val PEAK_WINDOW_DAYS = 0.03
private val CONTACT_WINDOW_DAYS = 0.25
private val CONTACT_TOL_SECONDS = 0.001
private val CONTACT_ITER_CAP = 50
private val DEFAULT_STEP_SECONDS = 60
private val MAX_STEP_SECONDS = 3600

// MoonShadow and GeoidIntersect: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L8481
private fun moonShadow(ut: Double): ShadowInfo {
    val tt = ttDaysFromUt(ut)
    val s = sunGeoVectorEqj(tt)
    val m = moonGeoVectorEqj(tt)
    val e = Vec3(-m.x,-m.y,-m.z)
    val hm = Vec3(m.x-s.x,m.y-s.y,m.z-s.z)
    return calcShadow(MOON_MEAN_RADIUS_KM,ut,e,hm)
}
private fun moonShadowSlope(ut: Double): Double {
    val dt = 1.0/86400.0
    return (moonShadow(ut+dt).r-moonShadow(ut-dt).r)/dt
}
private fun peakMoonShadow(centerUt: Double): ShadowInfo {
    // A fixed new-moon seed makes split ranges and opposite search directions agree.
    val newmoon = checkNotNull(searchMoonPhase(0.0,floor(centerUt)-1,4.0)) { "almanac internal: cannot refine new moon" }
    val ut = checkNotNull(search(::moonShadowSlope,newmoon-PEAK_WINDOW_DAYS,newmoon+PEAK_WINDOW_DAYS,SHADOW_TOL_SECONDS,SHADOW_ITER_CAP,"peak moon shadow")) { "almanac internal: failed to find peak Moon shadow time" }
    return moonShadow(ut)
}
internal data class DilatedAxis(val tt: Double,val v: Vec3,val e: Vec3,val A: Double,val B: Double,val radic: Double)
private fun dilatedAxis(shadow: ShadowInfo): DilatedAxis {
    val tt = ttDaysFromUt(shadow.ut)
    val vd = gyration(shadow.dir,tt,PrecessDirection.From2000)
    val ed = gyration(shadow.target,tt,PrecessDirection.From2000)
    val v = Vec3(vd.x*KM_PER_AU,vd.y*KM_PER_AU,vd.z*(KM_PER_AU/EARTH_FLATTENING))
    val e = Vec3(ed.x*KM_PER_AU,ed.y*KM_PER_AU,ed.z*(KM_PER_AU/EARTH_FLATTENING))
    val R = EARTH_EQUATORIAL_RADIUS_KM
    val A = v.x*v.x+v.y*v.y+v.z*v.z
    val B = -2.0*(v.x*e.x+v.y*e.y+v.z*e.z)
    val C = (e.x*e.x+e.y*e.y+e.z*e.z)-R*R
    val radic = B*B-4*A*C
    return DilatedAxis(tt,v,e,A,B,radic)
}
internal data class GroundPoint(val latitudeDeg: Double,val longitudeDeg: Double,val kind: SolarEclipseAxisKind,val obscuration: Double)
internal fun axisGround(shadow: ShadowInfo,axis: DilatedAxis,u: Double): GroundPoint {
    val px = u*axis.v.x-axis.e.x
    val py = u*axis.v.y-axis.e.y
    val pz = (u*axis.v.z-axis.e.z)*EARTH_FLATTENING
    val place = geodeticPlace(shadow,axis.tt,px,py,pz)
    val surface = calcShadow(MOON_POLAR_RADIUS_KM,shadow.ut,place.o,shadow.dir)
    // The point must lie on the axis; upstream bounds the residual to one nanometre.
    check(surface.r <= 1.0e-9 && surface.r >= 0.0) { "almanac internal: unexpected shadow distance from geoid intersection = ${surface.r}" }
    val kind = eclipseKindFromUmbra(surface.k)
    val obscuration = if (kind == SolarEclipseAxisKind.TOTAL) 1.0 else solarEclipseObscuration(shadow.dir,place.o)
    return GroundPoint(place.latitudeDeg,place.longitudeDeg,kind,obscuration)
}
internal data class GeodeticPlace(val latitudeDeg: Double,val longitudeDeg: Double,val o: Vec3)
internal fun geodeticPlace(shadow: ShadowInfo,tt: Double,px: Double,py: Double,pz: Double): GeodeticPlace {
    val proj = hypot(px,py)*EARTH_FLATTENING_SQUARED
    val latitudeDeg = if (proj == 0.0) { if (pz > 0.0) +90.0 else -90.0 } else RAD2DEG*atan(pz/proj)
    var longitudeDeg = (RAD2DEG*atan2(py,px)-siderealDeg(shadow.ut))%360.0
    if (longitudeDeg <= -180.0) longitudeDeg += 360.0 else if (longitudeDeg > +180.0) longitudeDeg -= 360.0
    val og = gyration(Vec3(px/KM_PER_AU,py/KM_PER_AU,pz/KM_PER_AU),tt,PrecessDirection.Into2000)
    val o = Vec3(og.x+shadow.target.x,og.y+shadow.target.y,og.z+shadow.target.z)
    return GeodeticPlace(latitudeDeg,longitudeDeg,o)
}
private data class LimbPoint(val latitudeDeg: Double,val longitudeDeg: Double,val obscuration: Double)
private fun limbGround(shadow: ShadowInfo,axis: DilatedAxis): LimbPoint {
    val u = -axis.B/(2*axis.A)
    val cx = u*axis.v.x-axis.e.x
    val cy = u*axis.v.y-axis.e.y
    val cz = u*axis.v.z-axis.e.z
    val scale = EARTH_EQUATORIAL_RADIUS_KM/sqrt(cx*cx+cy*cy+cz*cz)
    val place = geodeticPlace(shadow,axis.tt,cx*scale,cy*scale,cz*scale*EARTH_FLATTENING)
    val surface = calcShadow(MOON_POLAR_RADIUS_KM,shadow.ut,place.o,shadow.dir)
    val obscuration = if (surface.r < abs(surface.k) && eclipseKindFromUmbra(surface.k) == SolarEclipseAxisKind.TOTAL) 1.0 else solarEclipseObscuration(shadow.dir,place.o)
    return LimbPoint(place.latitudeDeg,place.longitudeDeg,obscuration)
}
private fun nearAxisGround(shadow: ShadowInfo): GroundPoint? {
    val axis = dilatedAxis(shadow)
    if (!(axis.radic > 0.0)) return null
    val u = (-axis.B-sqrt(axis.radic))/(2*axis.A)
    if (!(u > 0.0)) return null
    return axisGround(shadow,axis,u)
}
private fun grazingGround(shadow: ShadowInfo): GroundPoint {
    val axis = dilatedAxis(shadow)
    return axisGround(shadow,axis,-axis.B/(2*axis.A))
}
private fun geoidIntersect(shadow: ShadowInfo,peak: Instant): GlobalSolarEclipse {
    val ground = nearAxisGround(shadow)
    if (ground == null) {
        val limb = limbGround(shadow,dilatedAxis(shadow))
        return GlobalSolarEclipse(SolarEclipseKind.PARTIAL,peak,shadow.r,null,null,null,limb.latitudeDeg,limb.longitudeDeg,limb.obscuration)
    }
    val kind = if (ground.kind == SolarEclipseAxisKind.TOTAL) SolarEclipseKind.TOTAL else SolarEclipseKind.ANNULAR
    return GlobalSolarEclipse(kind,peak,shadow.r,ground.latitudeDeg,ground.longitudeDeg,ground.obscuration,ground.latitudeDeg,ground.longitudeDeg,ground.obscuration)
}

public fun nextGlobalSolarEclipse(after: Instant): GlobalSolarEclipse = nearestGlobalSolarEclipse(after,1)
public fun previousGlobalSolarEclipse(before: Instant): GlobalSolarEclipse = nearestGlobalSolarEclipse(before,-1)
public fun globalSolarEclipses(startUtc: Instant,endUtc: Instant): List<GlobalSolarEclipse> {
    assertSupported(startUtc)
    assertSupportedWindowEnd(endUtc)
    return scanGlobalSolarEclipses(normalized(startUtc).toEpochMilli(),normalized(endUtc).toEpochMilli(),1,false)
}
private fun nearestGlobalSolarEclipse(anchor: Instant,direction: Int): GlobalSolarEclipse {
    assertSupported(anchor)
    val ms = normalized(anchor).toEpochMilli()
    val startMs = if (direction > 0) ms+SAME_ECLIPSE_MS+1 else SUPPORTED_MIN
    val endMs = if (direction > 0) SUPPORTED_MAX else ms-SAME_ECLIPSE_MS
    val found = scanGlobalSolarEclipses(startMs,endMs,direction,true)
    if (found.isNotEmpty()) return found.first()
    throw AlmanacOutOfRangeException()
}
private fun scanGlobalSolarEclipses(startMs: Long,endMs: Long,direction: Int,firstOnly: Boolean): List<GlobalSolarEclipse> {
    val found = mutableListOf<GlobalSolarEclipse>()
    if (startMs >= endMs) return found
    val startUt = utDays(Instant.ofEpochMilli(startMs))-PEAK_WINDOW_DAYS
    val endUt = utDays(Instant.ofEpochMilli(endMs))+PEAK_WINDOW_DAYS
    var nmUt = if (direction > 0) startUt else endUt
    val limitUt = if (direction > 0) endUt else startUt
    while (direction*(limitUt-nmUt) > 0) {
        val newmoon = searchMoonPhase(0.0,nmUt,direction*min(40.0,abs(limitUt-nmUt))) ?: break
        nmUt = newmoon+direction*10
        if (abs(moonEclipticLatitudeDeg(newmoon)) >= PRUNE_LATITUDE_DEG) continue
        val shadow = peakMoonShadow(newmoon)
        if (shadow.r >= shadow.p+EARTH_MEAN_RADIUS_KM) continue
        val peak = dateFromUt(shadow.ut)
        if (peak.toEpochMilli() < startMs || peak.toEpochMilli() >= endMs) continue
        found.add(geoidIntersect(shadow,peak))
        if (firstOnly) break
    }
    return found
}
public fun solarEclipseAxisPoint(time: Instant): SolarEclipseAxisPoint? {
    assertSupported(time)
    val ground = nearAxisGround(moonShadow(utDays(time))) ?: return null
    return axisPoint(normalized(time),ground)
}
private fun axisPoint(time: Instant,ground: GroundPoint): SolarEclipseAxisPoint = SolarEclipseAxisPoint(time,ground.latitudeDeg,ground.longitudeDeg,ground.kind,ground.obscuration)

public fun solarEclipseCentralLine(peak: Instant,stepSeconds: Int = DEFAULT_STEP_SECONDS): List<SolarEclipseAxisPoint> {
    assertSupported(peak)
    require(stepSeconds in 1..MAX_STEP_SECONDS) { "stepSeconds must be a whole number from 1 to $MAX_STEP_SECONDS: $stepSeconds" }
    val peakUt = utDays(peak)
    if (nearAxisGround(moonShadow(peakUt)) == null) return emptyList()
    val first = dateFromUt(groundContactUt(peakUt,-1))
    val last = dateFromUt(groundContactUt(peakUt,+1))
    val line = mutableListOf(axisPoint(first,grazingGround(moonShadow(utDays(first)))))
    val stepMs = stepSeconds*1000L
    var ms = (floor(first.toEpochMilli()/stepMs.toDouble()).toLong()+1)*stepMs
    while (ms < last.toEpochMilli()) {
        val time = Instant.ofEpochMilli(ms)
        val ground = nearAxisGround(moonShadow(utDays(time)))
        if (ground != null) line.add(axisPoint(time,ground))
        ms += stepMs
    }
    if (last > first) line.add(axisPoint(last,grazingGround(moonShadow(utDays(last)))))
    return line
}
private fun groundContactUt(ut: Double,direction: Int): Double {
    val t1 = if (direction < 0) ut-CONTACT_WINDOW_DAYS else ut
    val t2 = if (direction < 0) ut else ut+CONTACT_WINDOW_DAYS
    return checkNotNull(search({ u -> -direction*dilatedAxis(moonShadow(u)).radic },t1,t2,CONTACT_TOL_SECONDS,CONTACT_ITER_CAP,"central line contact")) { "almanac internal: failed to find a ground contact of the shadow axis" }
}
