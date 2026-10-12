package io.openwaters.almanac

import java.time.Instant
import kotlin.math.*

// Apparent lunar phase follows the shared model; disc angles use Meeus 48.5 and 14.1.
public data class MoonIllumination(public val fraction: Double, public val phaseAngleDeg: Double, public val phase: Double, public val waxing: Boolean)

internal fun angleBetweenDeg(a: Vec3, b: Vec3): Double {
    val aa = a.x * a.x + a.y * a.y + a.z * a.z
    val bb = b.x * b.x + b.y * b.y + b.z * b.z
    val dot = (a.x * b.x + a.y * b.y + a.z * b.z) / sqrt(aa * bb)
    if (dot <= -1) return 180.0
    if (dot >= 1) return 0.0
    return RAD2DEG * acos(dot)
}

private fun eclipticLonOfDateDeg(eqj: Vec3, tt: Double): Double {
    val eqd = gyration(eqj, tt, PrecessDirection.From2000)
    val tobl = earthTilt(tt).tobl
    val ecl = eclipticToEquatorial(-tobl, eqd)
    if (ecl.x == 0.0 && ecl.y == 0.0) return 0.0
    var elon = RAD2DEG * atan2(ecl.y, ecl.x)
    if (elon < 0) elon += 360
    return elon
}

internal fun sunEclipticLonDeg(tt: Double): Double {
    return eclipticLonOfDateDeg(sunGeoVectorEqj(tt), tt)
}

private fun normalizeLongitude(lon: Double): Double {
    return ((lon % 360) + 360) % 360
}

internal fun moonPhaseDeg(tt: Double): Double {
    return moonPhaseFromVector(tt, moonGeoVectorEqj(tt))
}

private fun moonPhaseFromVector(tt: Double, moon: Vec3): Double {
    return normalizeLongitude(
        eclipticLonOfDateDeg(moon, tt) - eclipticLonOfDateDeg(sunGeoVectorEqj(tt), tt)
    )
}

internal fun moonIlluminationAtTT(tt: Double): MoonIllumination {

    val gc = moonGeoVectorEqj(tt)
    val earth = earthHelioVector(tt)
    val hc = Vec3(earth.x + gc.x, earth.y + gc.y, earth.z + gc.z)

    val phaseAngleDeg = angleBetweenDeg(gc, hc)
    val fraction = (1 + cos(DEG2RAD * phaseAngleDeg)) / 2

    val phase = moonPhaseFromVector(tt, gc) / 360
    return MoonIllumination(fraction, phaseAngleDeg, phase, phase < 0.5)
}

public fun moonIllumination(time: Instant): MoonIllumination {
    assertSupported(time)
    return moonIlluminationAtTT(ttDays(time))
}

public data class MoonOrientation(public val brightLimbAngleDeg: Double, public val parallacticAngleDeg: Double)

public fun moonOrientation(time: Instant, observer: Observer): MoonOrientation {
    assertSupported(time)
    val ut = utDays(time)
    val tt = ttDaysFromUt(ut)
    val moon = topoAltAzUnrefracted(moonGeoVectorEqj(tt), ut, observer)
    val sun = sunApparentAtTT(tt)
    val dec = moon.decDeg * DEG2RAD
    val sunDec = sun.decDeg * DEG2RAD
    val dRa = (sun.raDeg - moon.raDeg) * DEG2RAD
    var brightLimbAngleDeg = RAD2DEG * atan2(
        cos(sunDec) * sin(dRa),
        sin(sunDec) * cos(dec) - cos(sunDec) * sin(dec) * cos(dRa)
    )
    if (brightLimbAngleDeg < 0) brightLimbAngleDeg += 360
    if (brightLimbAngleDeg >= 360) brightLimbAngleDeg -= 360
    val ha = moon.hourAngleDeg * DEG2RAD
    val lat = observer.latitudeDeg * DEG2RAD
    var parallacticAngleDeg = RAD2DEG * atan2(
        sin(ha),
        tan(lat) * cos(dec) - sin(dec) * cos(ha)
    )
    if (parallacticAngleDeg <= -180) parallacticAngleDeg += 360
    return MoonOrientation(brightLimbAngleDeg, parallacticAngleDeg)
}
