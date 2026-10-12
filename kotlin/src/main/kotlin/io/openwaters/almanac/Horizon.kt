package io.openwaters.almanac

import kotlin.math.*

public fun horizonDip(observer: Observer, heightAboveGroundM: Double): Double {
    val elevation = observer.elevationM
    val ground = elevation - heightAboveGroundM
    require(heightAboveGroundM >= 0 && heightAboveGroundM <= 10000 && ground >= -500 && ground <= 10000) {
        "eye height or ground elevation out of range"
    }
    if (heightAboveGroundM == 0.0) return 0.0
    // HorizonDipAngle: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L5437
    val phi = observer.latitudeDeg * DEG2RAD
    val sinphi = sin(phi)
    val cosphi = cos(phi)
    val c = 1 / hypot(cosphi, sinphi * EARTH_FLATTENING)
    val s = c * (EARTH_FLATTENING * EARTH_FLATTENING)
    val htKm = ground / 1000
    val ach = EARTH_EQUATORIAL_RADIUS_KM * c + htKm
    val ash = EARTH_EQUATORIAL_RADIUS_KM * s + htKm
    val radiusM = 1000 * hypot(ach * cosphi, ash * sinphi)
    val k = 0.175 * (1 - (6.5e-3 / 283.15) * (elevation - (2.0 / 3) * heightAboveGroundM)).pow(3.256)
    return RAD2DEG * -(sqrt(2 * (1 - k) * heightAboveGroundM / radiusM) / (1 - k))
}
