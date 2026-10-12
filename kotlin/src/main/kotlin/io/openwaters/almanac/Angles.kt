package io.openwaters.almanac

/** Converts degrees to radians without wrapping the angle. */
public fun degreesToRadians(degrees: Double): Double {
    require(degrees.isFinite()) { "degrees must be finite" }
    return degrees * DEG2RAD
}

/** Converts radians to degrees without wrapping the angle. */
public fun radiansToDegrees(radians: Double): Double {
    require(radians.isFinite()) { "radians must be finite" }
    return radians * RAD2DEG
}
