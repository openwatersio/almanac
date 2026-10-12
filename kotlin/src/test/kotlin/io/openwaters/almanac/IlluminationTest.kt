package io.openwaters.almanac

import java.time.Instant
import kotlin.test.*
import kotlinx.serialization.json.*

internal class IlluminationTest {
    @Test fun illuminatedFractionMatchesHorizons() {
        for (grid in listOf("coarse", "dense")) for (element in fixture("positions/moon-$grid").jsonArray) {
            val row = element.obj()
            val actual = if (grid == "coarse") moonIlluminationAtTT(utDays(row.instant("tt"))) else moonIllumination(row.instant("utc"))
            near(actual.fraction, row.number("illumFraction"), 0.01, "$row")
            assertTrue(actual.fraction in 0.0..1.0)
        }
    }

    @Test fun phaseAndWaxingAgreeWithQuarterAndFullMoons() {
        val rows = fixture("phases/usno-phases").jsonArray.map { it.obj() }
        for ((kind, phase) in listOf("firstQuarter" to 0.25, "lastQuarter" to 0.75)) {
            val row = rows.first { it.string("phase") == kind }
            val actual = moonIllumination(row.instant("utc"))
            near(actual.phase, phase, 0.02)
            assertEquals(phase < 0.5, actual.waxing)
        }
        near(moonIllumination(Instant.parse("2026-08-28T04:00:00Z")).phase, 0.5, 0.05)
        assertFailsWith<AlmanacOutOfRangeException> { moonIllumination(Instant.MAX) }
        assertEquals(0.0, angleBetweenDeg(Vec3(1.0, 0.0, 0.0), Vec3(1.0, 0.0, 0.0)))
        assertEquals(180.0, angleBetweenDeg(Vec3(1.0, 0.0, 0.0), Vec3(-1.0, 0.0, 0.0)))
    }
}
