package io.openwaters.almanac

import java.io.File
import java.time.Instant
import java.time.OffsetDateTime
import kotlin.math.abs
import kotlin.math.min
import kotlin.test.assertTrue
import kotlinx.serialization.json.*

internal fun fixture(name: String): JsonElement = Json.parseToJsonElement(File(System.getProperty("fixtures"), "$name.json").readText())
internal fun JsonElement.obj(): JsonObject = jsonObject
internal fun JsonObject.array(key: String): JsonArray = getValue(key).jsonArray
internal fun JsonObject.number(key: String): Double = getValue(key).jsonPrimitive.double
internal fun JsonObject.string(key: String): String = getValue(key).jsonPrimitive.content
internal fun JsonObject.instant(key: String): Instant = OffsetDateTime.parse(string(key)).toInstant()
internal fun JsonObject.observer(): Observer = Observer(number("latitudeDeg"), number("longitudeDeg"), get("elevationM")?.jsonPrimitive?.double ?: 0.0)
internal fun angularDiff(a: Double, b: Double): Double { val d = abs(a - b) % 360; return min(d, 360 - d) }
internal fun near(actual: Double, expected: Double, tolerance: Double, label: String = "") {
    assertTrue(abs(actual - expected) <= tolerance, "$label: expected $expected, got $actual, tolerance $tolerance")
}
