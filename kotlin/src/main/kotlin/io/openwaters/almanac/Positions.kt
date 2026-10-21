package io.openwaters.almanac

import java.time.Instant
import kotlin.math.cos

public data class SunPosition(public val raDeg: Double, public val decDeg: Double, public val distanceAu: Double)
public data class MoonPosition(public val raDeg: Double, public val decDeg: Double, public val distanceKm: Double)
/** Apparent geocentric position of a fixed star: equator of date, RA in [0, 360). */
public data class StarPosition(public val raDeg: Double, public val decDeg: Double)

internal fun sunApparentAtTT(tt: Double): SunPosition {
    val equ = equatorialFromVector(sunGeoVector(tt))
    return SunPosition(equ.raDeg, equ.decDeg, equ.distanceAu)
}

internal fun moonApparentAtTT(tt: Double): MoonPosition {
    val equ = equatorialFromVector(moonGeoVector(tt))
    return MoonPosition(equ.raDeg, equ.decDeg, equ.distanceAu * KM_PER_AU)
}

public fun sunPosition(time: Instant): SunPosition {
    assertSupported(time)
    return sunApparentAtTT(ttDays(time))
}

public fun moonPosition(time: Instant): MoonPosition {
    assertSupported(time)
    return moonApparentAtTT(ttDays(time))
}

// Equator(star, date, observer, ofdate=true, aberration=true) with the geocentric observer term dropped: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L2803
/**
 * Apparent geocentric position of a fixed star from its J2000 (ICRS) catalog right ascension and declination, both in
 * degrees: right ascension and declination on the true equator and equinox of date, with annual aberration, precession
 * and nutation applied. Proper motion and stellar parallax are not applied.
 */
public fun starPosition(raDeg: Double, decDeg: Double, time: Instant): StarPosition {
    assertSupported(time)
    assertStarCatalog(raDeg, decDeg)
    val tt = ttDays(time)
    val equ = equatorialFromVector(gyration(starGeoVectorEqj(raDeg, decDeg, tt), tt, PrecessDirection.From2000))
    return StarPosition(equ.raDeg, equ.decDeg)
}

// Meeus 28.1–28.2 uses the apparent RA and moves mean longitude to the true equinox.
internal fun equationOfTimeAtTT(tt: Double): Double {
    val tau = tt/365250
    val l0 = 280.4664567 + tau*(360007.6982779 + tau*(0.03032028
        + tau*(1.0/49931 + tau*(-1.0/15300 + tau*(-1.0/2000000)))))
    val tilt = earthTilt(tt)
    val nutationRaDeg = (tilt.dpsi/3600)*cos(tilt.tobl*DEG2RAD)
    var e = l0-0.0057183-sunApparentAtTT(tt).raDeg+nutationRaDeg
    e = ((e%360)+540)%360-180
    return e*4
}

/** Apparent solar time minus mean solar time, in minutes; positive when a sundial runs ahead. */
public fun equationOfTime(time: Instant): Double {
    assertSupported(time)
    return equationOfTimeAtTT(ttDays(time))
}
