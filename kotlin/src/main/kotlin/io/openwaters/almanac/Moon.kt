package io.openwaters.almanac

import kotlin.math.*

internal data class MoonEcliptic(val geoEclipLon: Double, val geoEclipLat: Double, val distanceAu: Double)

// MOON2 preserves upstream operation order: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L1494
internal fun calcMoon(tt: Double): MoonEcliptic {
    val T = tt / 36525
    val T2 = T * T
    val co = DoubleArray(52)
    val si = DoubleArray(52)
    fun CO(x: Int, y: Int): Double = co[(x + 6) * 4 + y - 1]
    fun SI(x: Int, y: Int): Double = si[(x + 6) * 4 + y - 1]
    fun SetCO(x: Int, y: Int, v: Double) { co[(x + 6) * 4 + y - 1] = v }
    fun SetSI(x: Int, y: Int, v: Double) { si[(x + 6) * 4 + y - 1] = v }
    fun Sine(phi: Double): Double = sin(PI2 * phi)
    var DLAM = 0.0
    var DS = 0.0
    var GAM1C = 0.0
    var SINPI = 3422.7000
    val S1 = Sine(0.19833+0.05611*T)
    val S2 = Sine(0.27869+0.04508*T)
    val S3 = Sine(0.16827-0.36903*T)
    val S4 = Sine(0.34734-5.37261*T)
    val S5 = Sine(0.10498-5.37899*T)
    val S6 = Sine(0.42681-0.41855*T)
    val S7 = Sine(0.14943-5.37511*T)
    val DL0 = 0.84*S1+0.31*S2+14.27*S3+ 7.26*S4+ 0.28*S5+0.24*S6
    val DL = 2.94*S1+0.31*S2+14.27*S3+ 9.34*S4+ 1.12*S5+0.83*S6
    val DLS =-6.40*S1                                   -1.89*S6
    val DF = 0.21*S1+0.31*S2+14.27*S3-88.70*S4-15.30*S5+0.24*S6-1.86*S7
    val DD = DL0-DLS
    val DGAM = (-3332E-9 * Sine(0.59734-5.37261*T)
              -539E-9 * Sine(0.35498-5.37899*T)
               -64E-9 * Sine(0.39943-5.37511*T))

    val L0 = PI2*frac(0.60643382+1336.85522467*T-0.00000313*T2) + DL0/ARC
    val L = PI2*frac(0.37489701+1325.55240982*T+0.00002565*T2) + DL /ARC
    val LS = PI2*frac(0.99312619+  99.99735956*T-0.00000044*T2) + DLS/ARC
    val F = PI2*frac(0.25909118+1342.22782980*T-0.00000892*T2) + DF /ARC
    val D = PI2*frac(0.82736186+1236.85308708*T-0.00000397*T2) + DD /ARC

    for (I in 1..4) {
        val ARG: Double
        val MAX: Int
        val FAC: Double
        when (I) {
            1 -> { ARG = L; MAX = 4; FAC = 1.000002208 }
            2 -> { ARG = LS; MAX = 3; FAC = 0.997504612 - 0.002495388 * T }
            3 -> { ARG = F; MAX = 4; FAC = 1.000002708 + 139.978 * DGAM }
            else -> { ARG = D; MAX = 6; FAC = 1.0 }
        }
        SetCO(0, I, 1.0)
        SetCO(1, I, cos(ARG) * FAC)
        SetSI(0, I, 0.0)
        SetSI(1, I, sin(ARG) * FAC)
        for (J in 2..MAX) {
            val c = CO(J-1,I) * CO(1,I) - SI(J-1,I) * SI(1,I)
            val s = SI(J-1,I) * CO(1,I) + CO(J-1,I) * SI(1,I)
            SetCO(J, I, c)
            SetSI(J, I, s)
        }
        for (J in 1..MAX) {
            SetCO(-J, I, CO(J, I))
            SetSI(-J, I, -SI(J, I))
        }
    }
    for (i in MOON_INDICES.indices) {
        var x = 1.0
        var y = 0.0
        for (index in MOON_INDICES[i]) {
            val c = co[index]
            val s = si[index]
            val nextX = x*c - y*s
            y = y*c + x*s
            x = nextX
        }
        val row = MOON_COEFF[i]
        DLAM += row[0] * y
        DS += row[1] * y
        GAM1C += row[2] * x
        SINPI += row[3] * x
    }
    var N = 0.0
    for (i in MOON_N_INDICES.indices) {
        var x = 1.0
        var y = 0.0
        for (j in 0..3) {
            val p = MOON_N_INDICES[i][j]
            if (p != 0) {
                val c = CO(p, j+1)
                val s = SI(p, j+1)
                val nextX = x*c - y*s
                y = y*c + x*s
                x = nextX
            }
        }
        N += MOON_N_COEFF[i] * y
    }
    DLAM += (
        +0.82*Sine(0.7736  -62.5512*T)+0.31*Sine(0.0466 -125.1025*T)
        +0.35*Sine(0.5785  -25.1042*T)+0.66*Sine(0.4591+1335.8075*T)
        +0.64*Sine(0.3130  -91.5680*T)+1.14*Sine(0.1480+1331.2898*T)
        +0.21*Sine(0.5918+1056.5859*T)+0.44*Sine(0.5784+1322.8595*T)
        +0.24*Sine(0.2275   -5.7374*T)+0.28*Sine(0.2965   +2.6929*T)
        +0.33*Sine(0.3132   +6.3368*T)
    )

    val S = F + DS/ARC

    val lat_seconds = (1.000002708 + 139.978*DGAM)*(18518.511+1.189+GAM1C)*sin(S) - 6.24*sin(3*S) + N

    return MoonEcliptic(PI2 * frac((L0+DLAM/ARC) / PI2), (PI / (180 * 3600)) * lat_seconds, (ARC * EARTH_EQUATORIAL_RADIUS_AU) / (0.999953253 * SINPI))
}

internal fun moonGeoVectorEqj(tt: Double): Vec3 {
    val moon = calcMoon(tt)
    val distCosLat = moon.distanceAu * cos(moon.geoEclipLat)
    val gepos = Vec3(distCosLat * cos(moon.geoEclipLon), distCosLat * sin(moon.geoEclipLon), moon.distanceAu * sin(moon.geoEclipLat))
    val mpos1 = eclipticToEquatorial(meanObliquityDeg(tt), gepos)
    return precession(mpos1, tt, PrecessDirection.Into2000)
}

internal fun moonGeoVector(tt: Double): Vec3 = gyration(moonGeoVectorEqj(tt), tt, PrecessDirection.From2000)
