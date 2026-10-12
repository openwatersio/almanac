package io.openwaters.almanac

import java.time.Instant
import kotlin.math.floor
import kotlin.test.*
import kotlinx.serialization.json.*

internal fun scaled(value: Double, scale: Double): Long = floor(value * scale + 0.5).toLong()
internal fun scaledNear(actual: Double, expected: JsonObject, field: String, scale: Double) {
    near(scaled(actual, scale).toDouble(), expected.number(field), 5.0, "$field $expected")
}
internal fun eventMs(time: Instant): Long = scaled(time.toEpochMilli() / 100.0, 1.0) * 100
internal fun eventNear(time: Instant, expected: JsonObject, field: String = "tMs") {
    near(eventMs(time).toDouble(), expected.number(field), 100.0, "$field $expected")
}
