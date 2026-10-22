package io.openwaters.almanac

import kotlin.math.*

// Frame rotations preserve the upstream term order: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L1392
internal val DEG2RAD = 0.017453292519943296
internal val RAD2DEG = 57.295779513082321
internal val ASEC2RAD = 4.848136811095359935899141e-6
private val ASEC180 = 180.0 * 60 * 60
private val ASEC360 = 2 * ASEC180
internal val PI2 = 2 * PI

internal val ARC = 3600 * (180 / PI)
internal val KM_PER_AU = 1.4959787069098932e8
internal val C_AUDAY = 173.1446326846693
internal val EARTH_EQUATORIAL_RADIUS_KM = 6378.1366
internal val EARTH_EQUATORIAL_RADIUS_AU = EARTH_EQUATORIAL_RADIUS_KM / KM_PER_AU

internal val EARTH_FLATTENING = 0.996647180302104
internal val EARTH_FLATTENING_SQUARED = EARTH_FLATTENING * EARTH_FLATTENING

internal data class Vec3(val x: Double, val y: Double, val z: Double)

internal data class EquatorialFromVector(val raDeg: Double, val decDeg: Double, val distanceAu: Double)

internal enum class PrecessDirection { Into2000, From2000 }

internal fun frac(x: Double): Double {
    return x - floor(x)
}

// Not upstream: an angle wrapped into [0, 360). Upstream adds 360 to a negative remainder, and a remainder within an ulp below zero then rounds to 360 itself.
internal fun wrapDeg360(deg: Double): Double {
    var r = deg % 360
    if (r < 0)
        r += 360
    if (r >= 360)
        r -= 360
    return r
}

private data class NutationAngles(val dpsi: Double, val deps: Double)

private fun iau2000b(tt: Double): NutationAngles {
    fun mod(x: Double): Double {
        return (x % ASEC360) * ASEC2RAD
    }

    val t = tt / 36525
    val elp = mod(1287104.79305 + t*129596581.0481)
    val f   = mod(335779.526232 + t*1739527262.8478)
    val d   = mod(1072260.70369 + t*1602961601.2090)
    val om  = mod(450160.398036 - t*6962890.5431)

    var sarg = sin(om)
    var carg = cos(om)
    var dp = (-172064161.0 - 174666.0*t)*sarg + 33386.0*carg
    var de = (92052331.0 + 9086.0*t)*carg + 15377.0*sarg

    var arg = 2.0*(f - d + om)
    sarg = sin(arg)
    carg = cos(arg)
    dp += (-13170906.0 - 1675.0*t)*sarg - 13696.0*carg
    de += (5730336.0 - 3015.0*t)*carg - 4587.0*sarg

    arg = 2.0*(f + om)
    sarg = sin(arg)
    carg = cos(arg)
    dp += (-2276413.0 - 234.0*t)*sarg + 2796.0*carg
    de += (978459.0 - 485.0*t)*carg + 1374.0*sarg

    arg = 2.0*om
    sarg = sin(arg)
    carg = cos(arg)
    dp += (2074554.0 + 207.0*t)*sarg - 698.0*carg
    de += (-897492.0 + 470.0*t)*carg - 291.0*sarg

    sarg = sin(elp)
    carg = cos(elp)
    dp += (1475877.0 - 3633.0*t)*sarg + 11817.0*carg
    de += (73871.0 - 184.0*t)*carg - 1924.0*sarg

    return NutationAngles(-0.000135 + (dp * 1.0e-7), +0.000388 + (de * 1.0e-7))
}

internal fun meanObliquityDeg(tt: Double): Double {
    val t = tt / 36525
    val asec = (
        (((( -  0.0000000434   * t
             -  0.000000576  ) * t
             +  0.00200340   ) * t
             -  0.0001831    ) * t
             - 46.836769     ) * t + 84381.406
    )
    return asec / 3600.0
}

internal data class EarthTilt(val dpsi: Double, val deps: Double, val ee: Double, val mobl: Double, val tobl: Double)

// Pair cache time/value per thread because JVM callers can evaluate concurrently.
private class TiltCache(var tt: Double = Double.NaN, var tilt: EarthTilt? = null)
private val tiltCache = ThreadLocal.withInitial { TiltCache() }
internal fun earthTilt(tt: Double): EarthTilt {
    val cache = tiltCache.get()
    val previous = cache.tilt
    if (previous != null && abs(cache.tt - tt) <= 1.0e-6) return previous
    val nut = iau2000b(tt)
    val meanOb = meanObliquityDeg(tt)
    val tilt = EarthTilt(nut.dpsi, nut.deps, nut.dpsi * cos(meanOb * DEG2RAD) / 15, meanOb, meanOb + nut.deps / 3600)
    cache.tt = tt
    cache.tilt = tilt
    return tilt
}

internal fun eclipticToEquatorial(oblDegrees: Double, pos: Vec3): Vec3 {
    val obl = oblDegrees * DEG2RAD
    val cosObl = cos(obl)
    val sinObl = sin(obl)
    return Vec3(pos.x, pos.y*cosObl - pos.z*sinObl, pos.y*sinObl + pos.z*cosObl)
}

private fun rotate(rot: Array<DoubleArray>, vec: Vec3): Vec3 {
    return Vec3(rot[0][0]*vec.x + rot[1][0]*vec.y + rot[2][0]*vec.z, rot[0][1]*vec.x + rot[1][1]*vec.y + rot[2][1]*vec.z, rot[0][2]*vec.x + rot[1][2]*vec.y + rot[2][2]*vec.z)
}

private fun precessionRot(tt: Double, dir: PrecessDirection): Array<DoubleArray> {
    val t = tt / 36525

    var eps0 = 84381.406

    var psia   = (((((-    0.0000000951  * t
                      +    0.000132851 ) * t
                      -    0.00114045  ) * t
                      -    1.0790069   ) * t
                      + 5038.481507    ) * t)

    var omegaa = (((((+    0.0000003337  * t
                      -    0.000000467 ) * t
                      -    0.00772503  ) * t
                      +    0.0512623   ) * t
                      -    0.025754    ) * t + eps0)

    var chia   = (((((-    0.0000000560  * t
                      +    0.000170663 ) * t
                      -    0.00121197  ) * t
                      -    2.3814292   ) * t
                      +   10.556403    ) * t)

    eps0   *= ASEC2RAD
    psia   *= ASEC2RAD
    omegaa *= ASEC2RAD
    chia   *= ASEC2RAD

    val sa = sin(eps0)
    val ca = cos(eps0)
    val sb = sin(-psia)
    val cb = cos(-psia)
    val sc = sin(-omegaa)
    val cc = cos(-omegaa)
    val sd = sin(chia)
    val cd = cos(chia)

    val xx =  cd*cb - sb*sd*cc
    val yx =  cd*sb*ca + sd*cc*cb*ca - sa*sd*sc
    val zx =  cd*sb*sa + sd*cc*cb*sa + ca*sd*sc
    val xy = -sd*cb - sb*cd*cc
    val yy = -sd*sb * ca + cd*cc*cb*ca - sa*cd*sc
    val zy = -sd*sb * sa + cd*cc*cb*sa + ca*cd*sc
    val xz =  sb*sc
    val yz = -sc*cb * ca - sa*cc
    val zz = -sc*cb * sa + cc*ca

    if (dir == PrecessDirection.Into2000) {

        return arrayOf(doubleArrayOf(xx, yx, zx), doubleArrayOf(xy, yy, zy), doubleArrayOf(xz, yz, zz))
    }

    return arrayOf(doubleArrayOf(xx, xy, xz), doubleArrayOf(yx, yy, yz), doubleArrayOf(zx, zy, zz))
}

internal fun precession(pos: Vec3, tt: Double, dir: PrecessDirection): Vec3 {
    return rotate(precessionRot(tt, dir), pos)
}

private fun nutationRot(tt: Double, dir: PrecessDirection): Array<DoubleArray> {
    val tilt = earthTilt(tt)
    val oblm = tilt.mobl * DEG2RAD
    val oblt = tilt.tobl * DEG2RAD
    val psi  = tilt.dpsi * ASEC2RAD
    val cobm = cos(oblm)
    val sobm = sin(oblm)
    val cobt = cos(oblt)
    val sobt = sin(oblt)
    val cpsi = cos(psi)
    val spsi = sin(psi)

    val xx =  cpsi
    val yx = -spsi*cobm
    val zx = -spsi*sobm
    val xy =  spsi*cobt
    val yy =  cpsi*cobm*cobt + sobm*sobt
    val zy =  cpsi*sobm*cobt - cobm*sobt
    val xz =  spsi*sobt
    val yz =  cpsi*cobm*sobt - sobm*cobt
    val zz =  cpsi*sobm*sobt + cobm*cobt

    if (dir == PrecessDirection.From2000) {

        return arrayOf(doubleArrayOf(xx, xy, xz), doubleArrayOf(yx, yy, yz), doubleArrayOf(zx, zy, zz))
    }

    return arrayOf(doubleArrayOf(xx, yx, zx), doubleArrayOf(xy, yy, zy), doubleArrayOf(xz, yz, zz))
}

internal fun applyNutation(pos: Vec3, tt: Double, dir: PrecessDirection): Vec3 {
    return rotate(nutationRot(tt, dir), pos)
}

internal fun gyration(pos: Vec3, tt: Double, dir: PrecessDirection): Vec3 {
    return if (dir == PrecessDirection.Into2000)
        precession(applyNutation(pos, tt, dir), tt, dir) else
        applyNutation(precession(pos, tt, dir), tt, dir)
}

internal fun equatorialFromVector(pos: Vec3): EquatorialFromVector {
    val xyproj = pos.x*pos.x + pos.y*pos.y
    val dist = sqrt(xyproj + pos.z*pos.z)
    if (xyproj == 0.0) {
        if (pos.z == 0.0)
            error("Indeterminate sky coordinates")
        return EquatorialFromVector(0.0, if (pos.z < 0) -90.0 else 90.0, dist)
    }

    val raDeg = wrapDeg360(RAD2DEG * atan2(pos.y, pos.x))
    val decDeg = RAD2DEG * atan2(pos.z, sqrt(xyproj))
    return EquatorialFromVector(raDeg, decDeg, dist)
}
