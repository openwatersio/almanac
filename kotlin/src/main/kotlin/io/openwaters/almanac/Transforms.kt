package io.openwaters.almanac

import java.time.Instant
import kotlin.math.*

// Topocentric rotations follow upstream: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L2014
public data class AltAz(public val azDeg: Double, public val altDeg: Double)

internal data class TopoUnrefracted(val azDeg: Double, val altDeg: Double, val hourAngleDeg: Double, val distanceAu: Double, val raDeg: Double, val decDeg: Double)

private fun earthRotationAngleDeg(ut: Double): Double {
    val thet1 = 0.7790572732640 + 0.00273781191135448 * ut
    val thet3 = ut % 1
    var theta = 360 * ((thet1 + thet3) % 1)
    if (theta < 0)
        theta += 360
    return theta
}

internal fun siderealDeg(ut: Double): Double {
    val tt = ttDaysFromUt(ut)
    val t = tt / 36525
    val eqeq = 15 * earthTilt(tt).ee    
    val theta = earthRotationAngleDeg(ut)
    val st = eqeq + 0.014506 +
             (((( -    0.0000000368   * t
                  -    0.000029956  ) * t
                  -    0.00000044   ) * t
                  +    1.3915817    ) * t
                  + 4612.156534     ) * t
    var gastDeg = (st / 3600 + theta) % 360
    if (gastDeg < 0)
        gastDeg += 360
    return gastDeg
}

private fun observerGeoVectorOfDate(gastDeg: Double, observer: Observer): Vec3 {
    val phi = observer.latitudeDeg * DEG2RAD
    val sinphi = sin(phi)
    val cosphi = cos(phi)
    val c = 1 / hypot(cosphi, EARTH_FLATTENING * sinphi)
    val s = EARTH_FLATTENING_SQUARED * c
    val htKm = observer.elevationM / 1000
    val ach = EARTH_EQUATORIAL_RADIUS_KM * c + htKm
    val ash = EARTH_EQUATORIAL_RADIUS_KM * s + htKm
    val stlocl = (gastDeg + observer.longitudeDeg) * DEG2RAD
    val sinst = sin(stlocl)
    val cosst = cos(stlocl)
    return Vec3(ach * cosphi * cosst / KM_PER_AU, ach * cosphi * sinst / KM_PER_AU, ash * sinphi / KM_PER_AU)
}

internal fun observerGeoVectorEqj(ut: Double, observer: Observer): Vec3 {
    return gyration(observerGeoVectorOfDate(siderealDeg(ut), observer), ttDaysFromUt(ut), PrecessDirection.Into2000)
}

private fun spin(angleDeg: Double, pos: Vec3): Vec3 {
    val angr = angleDeg * DEG2RAD
    val c = cos(angr)
    val s = sin(angr)
    return Vec3(c * pos.x + s * pos.y, c * pos.y - s * pos.x, pos.z)
}

internal fun topoAltAzUnrefracted(bodyEqj: Vec3, ut: Double, observer: Observer): TopoUnrefracted {
    val tt = ttDaysFromUt(ut)
    val gast = siderealDeg(ut)

    val gcObserver = observerGeoVectorOfDate(gast, observer)
    val bodyOfDate = gyration(bodyEqj, tt, PrecessDirection.From2000)
    val datevect = Vec3(bodyOfDate.x - gcObserver.x, bodyOfDate.y - gcObserver.y, bodyOfDate.z - gcObserver.z)
    val (raDeg, decDeg, distanceAu) = equatorialFromVector(datevect)

    val sinlat = sin(observer.latitudeDeg * DEG2RAD)
    val coslat = cos(observer.latitudeDeg * DEG2RAD)
    val sinlon = sin(observer.longitudeDeg * DEG2RAD)
    val coslon = cos(observer.longitudeDeg * DEG2RAD)
    val sindc = sin(decDeg * DEG2RAD)
    val cosdc = cos(decDeg * DEG2RAD)
    
    val sinra = sin(raDeg * DEG2RAD)
    val cosra = cos(raDeg * DEG2RAD)

    val uze = Vec3(coslat * coslon, coslat * sinlon, sinlat)
    val une = Vec3(-sinlat * coslon, -sinlat * sinlon, coslat)
    val uwe = Vec3(sinlon, -coslon, 0.0)

    val spinAngle = -gast
    val uz = spin(spinAngle, uze)
    val un = spin(spinAngle, une)
    val uw = spin(spinAngle, uwe)

    val p = Vec3(cosdc * cosra, cosdc * sinra, sindc)

    val pz = p.x * uz.x + p.y * uz.y + p.z * uz.z
    val pn = p.x * un.x + p.y * un.y + p.z * un.z
    val pw = p.x * uw.x + p.y * uw.y + p.z * uw.z

    val proj = hypot(pn, pw)
    val az = horizontalAzimuth(pn,pw)
    val zd = RAD2DEG * atan2(proj, pz)

    var hourAngleDeg = (gast + observer.longitudeDeg - raDeg) % 360
    if (hourAngleDeg < 0)
        hourAngleDeg += 360

    return TopoUnrefracted(az, 90 - zd, hourAngleDeg, distanceAu, raDeg, decDeg)
}

internal fun horizontalAzimuth(pn: Double,pw: Double): Double {
    val proj = hypot(pn,pw)
    var az: Double
    if (proj > 0) {
        az = -RAD2DEG * atan2(pw, pn)
        if (az < 0)
            az += 360
    } else {
        az = 0.0
    }
    return az
}

internal fun refractionDeg(altitudeDeg: Double): Double {
    if (altitudeDeg < -90.0 || altitudeDeg > 90.0)
        return 0.0

    var hd = altitudeDeg
    if (hd < -1.0)
        hd = -1.0

    var refr = (1.02 / tan((hd + 10.3 / (hd + 5.11)) * DEG2RAD)) / 60.0

    if (altitudeDeg < -1.0) {

        refr *= (altitudeDeg + 90.0) / 89.0
    }

    return refr
}

internal fun refract(unrefracted: TopoUnrefracted): AltAz {
    return AltAz(unrefracted.azDeg, unrefracted.altDeg + refractionDeg(unrefracted.altDeg))
}

public fun sunAltAz(time: Instant, observer: Observer): AltAz {
    assertSupported(time)
    val ut = utDays(time)
    return refract(topoAltAzUnrefracted(sunGeoVectorEqj(ttDaysFromUt(ut)), ut, observer))
}

public fun moonAltAz(time: Instant, observer: Observer): AltAz {
    assertSupported(time)
    val ut = utDays(time)
    return refract(topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer))
}

private val STAR_DISTANCE_AU = 1000 * 63241.07708807546

public fun starAltAz(raDeg: Double, decDeg: Double, time: Instant, observer: Observer): AltAz {
    assertSupported(time)
    require(raDeg >= 0 && raDeg < 360) { "raDeg out of range: $raDeg" }
    require(decDeg >= -90 && decDeg <= 90) { "decDeg out of range: $decDeg" }
    val ut = utDays(time)
    val rCosDec = STAR_DISTANCE_AU * cos(decDeg * DEG2RAD)
    val eqj = Vec3(rCosDec * cos(raDeg * DEG2RAD), rCosDec * sin(raDeg * DEG2RAD), STAR_DISTANCE_AU * sin(decDeg * DEG2RAD))
    return refract(topoAltAzUnrefracted(eqj, ut, observer))
}
