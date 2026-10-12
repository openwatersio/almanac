package io.openwaters.almanac

import java.time.Instant

public data class SunPosition(public val raDeg: Double, public val decDeg: Double, public val distanceAu: Double)
public data class MoonPosition(public val raDeg: Double, public val decDeg: Double, public val distanceKm: Double)

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
