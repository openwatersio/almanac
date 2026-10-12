package io.openwaters.almanac

import java.time.Instant
import kotlinx.serialization.json.*
import kotlin.test.*

internal class SunIsUpTest {
    @Test fun independentUSNOEvidence() {
        for (element in fixture("events/usno-grid").jsonArray) {
            val row = element.obj()
            if (row.string("date").take(4).toInt() > 2050) continue
            val observer = row.observer()
            for (kind in listOf("rise", "set")) {
                val clock = row.getValue("sun").obj()[kind]?.jsonPrimitive?.content ?: continue
                val time = Instant.parse(row.string("date") + "T" + clock + ":00Z")
                assertEquals(kind == "set", sunIsUp(time.minusSeconds(60), observer))
                assertEquals(kind == "rise", sunIsUp(time.plusSeconds(60), observer))
            }
        }
    }

    @Test fun dayNightAndPolarPeriods() {
        val equator = Observer(0.0, 0.0)
        assertTrue(sunIsUp(Instant.parse("2024-06-21T12:00:00Z"), equator))
        assertFalse(sunIsUp(Instant.parse("2024-06-21T00:00:00Z"), equator))
        val polar = Observer(78.2, 15.6)
        assertTrue(sunIsUp(Instant.parse("2024-06-21T23:30:00Z"), polar))
        assertFalse(sunIsUp(Instant.parse("2024-12-21T12:00:00Z"), polar))
    }

    @Test fun shortPolarDayUpperLimb() {
        val observer = Observer(70.5, 0.0)
        val time = Instant.parse("2024-11-22T11:29:40Z")
        assertTrue(sunAltAz(time, observer).altDeg < -0.211)
        assertTrue(sunIsUp(time, observer))
        assertFalse(sunIsUp(Instant.parse("2024-11-22T11:29:36Z"), observer))
        assertTrue(sunIsUp(Instant.parse("2024-11-22T12:01:55Z"), observer))
        assertFalse(sunIsUp(Instant.parse("2024-11-22T12:01:59Z"), observer))
    }

    @Test fun agreementAcrossSeasonalAndGrazingCrossings() {
        for (latitude in listOf(0.0, 60.0, -40.0, 70.5, 84.9)) {
            val observer = Observer(latitude, 0.0)
            for (date in listOf("2024-06-21", "2025-01-03", "2024-11-22", "2024-03-05")) {
                val from = Instant.parse(date + "T00:00:00Z")
                for (event in sunEvents(from, from.plusSeconds(86400), observer).filter { it.kind == SunEventKind.RISE || it.kind == SunEventKind.SET }) {
                    assertEquals(event.kind == SunEventKind.SET, sunIsUp(event.time.minusSeconds(2), observer))
                    assertEquals(event.kind == SunEventKind.RISE, sunIsUp(event.time.plusSeconds(2), observer))
                }
            }
        }
    }

    @Test fun eyeHeightIsSeparateFromElevation() {
        val observer = Observer(48.4284, -123.3656, 100.0)
        val from = Instant.parse("2026-03-20T00:00:00Z")
        val events = sunEvents(from, from.plusSeconds(86400), observer, 100.0)
        val afterRise = events.first { it.kind == SunEventKind.RISE }.time.plusSeconds(2)
        assertTrue(sunIsUp(afterRise, observer, 100.0))
        assertFalse(sunIsUp(afterRise, observer))
        assertFalse(sunIsUp(afterRise, observer, 0.0))
        for (event in events.filter { it.kind == SunEventKind.RISE || it.kind == SunEventKind.SET }) {
            assertEquals(event.kind == SunEventKind.SET, sunIsUp(event.time.minusSeconds(2), observer, 100.0))
            assertEquals(event.kind == SunEventKind.RISE, sunIsUp(event.time.plusSeconds(2), observer, 100.0))
        }
    }

    @Test fun validationAndSupportedBoundaries() {
        val observer = Observer(0.0, 0.0)
        val time = Instant.parse("2026-03-20T12:00:00Z")
        for (date in listOf("1949-12-31T00:00:00Z", "2101-01-01T00:00:00Z")) {
            assertFailsWith<AlmanacOutOfRangeException> { sunIsUp(Instant.parse(date), observer) }
        }
        for (height in listOf(Double.NaN, Double.POSITIVE_INFINITY, -1.0, 10001.0)) {
            val error = assertFailsWith<IllegalArgumentException> { sunIsUp(time, observer, height) }
            assertFalse(error is AlmanacOutOfRangeException)
        }
        assertFailsWith<IllegalArgumentException> { sunIsUp(time, Observer(0.0, 0.0, -499.0), 2.0) }
        sunIsUp(Instant.parse("1950-01-01T00:00:00Z"), observer)
        sunIsUp(Instant.parse("2100-12-31T23:59:59.999Z"), observer)
        val boundary = Instant.parse("1950-01-01T00:00:00Z")
        assertEquals(sunIsUp(boundary, observer), sunIsUp(boundary.minusNanos(1), observer))
    }
}
