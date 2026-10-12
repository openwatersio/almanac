package io.openwaters.almanac

import java.time.Instant
import kotlin.math.floor
import kotlin.test.*
import kotlinx.serialization.json.*

internal fun scaled(value: Double, scale: Double): Long = floor(value * scale + 0.5).toLong()
internal fun scaledNear(actual: Double, expected: JsonObject, field: String, scale: Double) {
    near(scaled(actual, scale).toDouble(), expected.number(field), 5.0, "$field $expected")
}

internal class ParityTest {
    private val victoria = Observer(48.4284, -123.3656)

    @Test fun positionsReproduceScaledCorpus() {
        val rows = fixture("parity/positions").jsonArray
        assertEquals(6894, rows.size)
        for (element in rows) {
            val row = element.obj()
            val time = Instant.ofEpochMilli(row.getValue("tMs").jsonPrimitive.long)
            val sun = sunPosition(time)
            val moon = moonPosition(time)
            val expectedSun = row.getValue("sun").obj()
            val expectedMoon = row.getValue("moon").obj()
            scaledNear(sun.raDeg, expectedSun, "raDeg", 1e6)
            scaledNear(sun.decDeg, expectedSun, "decDeg", 1e6)
            scaledNear(sun.distanceAu, expectedSun, "distanceAu", 1e9)
            scaledNear(moon.raDeg, expectedMoon, "raDeg", 1e6)
            scaledNear(moon.decDeg, expectedMoon, "decDeg", 1e6)
            scaledNear(moon.distanceKm, expectedMoon, "distanceKm", 1e3)
        }
    }

    @Test fun appearanceReproducesScaledCorpus() {
        val rows = fixture("parity/altaz").jsonArray
        assertEquals(6894, rows.size)
        for (element in rows) {
            val row = element.obj()
            val time = Instant.ofEpochMilli(row.getValue("tMs").jsonPrimitive.long)
            val actual = mapOf("sun" to sunAltAz(time, victoria), "moon" to moonAltAz(time, victoria), "star" to starAltAz(88.792939, 7.407064, time, victoria))
            for ((body, value) in actual) {
                scaledNear(value.azDeg, row.getValue(body).obj(), "azDeg", 1e6)
                scaledNear(value.altDeg, row.getValue(body).obj(), "altDeg", 1e6)
            }
        }
        for (element in fixture("parity/illumination").jsonArray) {
            val row = element.obj()
            val value = moonIllumination(Instant.ofEpochMilli(row.getValue("tMs").jsonPrimitive.long))
            scaledNear(value.fraction, row, "fraction", 1e6)
            scaledNear(value.phaseAngleDeg, row, "phaseAngleDeg", 1e6)
            scaledNear(value.phase, row, "phase", 1e6)
            assertEquals(row.getValue("waxing").jsonPrimitive.boolean, value.waxing)
        }
        for (element in fixture("parity/suncalc").obj().array("orientation")) {
            val row = element.obj()
            val value = moonOrientation(Instant.ofEpochMilli(row.getValue("tMs").jsonPrimitive.long), victoria)
            scaledNear(value.brightLimbAngleDeg, row, "brightLimbAngleDeg", 1e6)
            scaledNear(value.parallacticAngleDeg, row, "parallacticAngleDeg", 1e6)
        }
        for (element in fixture("parity/horizon").jsonArray) {
            val row = element.obj()
            scaledNear(horizonDip(row.getValue("observer").obj().observer(), row.number("heightAboveGroundM")), row, "dipDeg", 1e6)
        }
    }
}
