package io.openwaters.almanac

/** Converts degrees to radians without wrapping the angle. */
public fun degreesToRadians(degrees: Double): Double {
    require(degrees.isFinite()) { "degrees must be finite" }
    return degrees * DEG2RAD
}

/** Converts radians to degrees without wrapping; rejects conversion overflow. */
public fun radiansToDegrees(radians: Double): Double {
    require(radians.isFinite()) { "radians must be finite" }
    val degrees = radians * RAD2DEG
    require(degrees.isFinite()) { "angle conversion overflow" }
    return degrees
}
