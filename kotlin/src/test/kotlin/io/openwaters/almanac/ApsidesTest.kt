package io.openwaters.almanac

import java.time.Instant
import kotlin.math.abs
import kotlin.test.*
import kotlinx.serialization.json.*

internal class ApsidesTest {
    @Test fun apsidesMatchHorizonsAcrossAllThreeWindows() {
        val runs = mutableListOf<MutableList<JsonObject>>()
        for (element in fixture("apsides/horizons-apsides").jsonArray) {
            val row = element.obj()
            if (runs.isEmpty() || row.instant("utc").epochSecond-runs.last().last().instant("utc").epochSecond > 20*86400) runs.add(mutableListOf(row))
            else runs.last().add(row)
        }
        assertEquals(3,runs.size)
        for (run in runs) {
            val found = moonApsides(run.first().instant("utc").minusSeconds(86400),run.last().instant("utc").plusSeconds(86400))
            assertEquals(run.size,found.size)
            for ((i,event) in found.withIndex()) {
                assertEquals(run[i].string("kind"),event.kind.toString())
                assertTrue(abs(event.time.toEpochMilli()-run[i].instant("utc").toEpochMilli()) < 20*60000)
                near(event.distanceKm,run[i].number("distanceKm"),70.0)
            }
        }
    }

    @Test fun distanceIsAnExtremumOfThePositionModel() {
        for (event in moonApsides(Instant.parse("2026-01-01T00:00:00Z"),Instant.parse("2026-04-01T00:00:00Z"))) {
            near(event.distanceKm,moonPosition(event.time).distanceKm,1e-3)
            val sign = if (event.kind == MoonApsisKind.PERIGEE) 1 else -1
            assertTrue(sign*(moonPosition(event.time.minusSeconds(3600)).distanceKm-event.distanceKm) > 0)
            assertTrue(sign*(moonPosition(event.time.plusSeconds(3600)).distanceKm-event.distanceKm) > 0)
        }
    }

    @Test fun fullRangeAlternatesAndExactSplitsAreHalfOpen() {
        val all = moonApsides(Instant.ofEpochMilli(SUPPORTED_MIN),Instant.ofEpochMilli(SUPPORTED_MAX))
        assertEquals(4003,all.size)
        assertTrue(all.zipWithNext().all { it.first.time < it.second.time && it.first.kind != it.second.kind })
        val a = Instant.parse("2026-01-01T00:00:00Z")
        val b = Instant.parse("2027-01-01T00:00:00Z")
        val year = moonApsides(a,b)
        val split = year.first().time
        assertTrue(moonApsides(a,split).isEmpty())
        assertEquals(year,moonApsides(a,split)+moonApsides(split,b))
        assertTrue(moonApsides(a,a).isEmpty())
        assertTrue(moonApsides(b,a).isEmpty())
        for ((start,end) in listOf(Instant.MIN to a,a to Instant.MAX,Instant.ofEpochMilli(SUPPORTED_MIN-1) to a,a to Instant.ofEpochMilli(SUPPORTED_MAX+1),Instant.ofEpochMilli(SUPPORTED_MAX) to a))
            assertFailsWith<AlmanacOutOfRangeException> { moonApsides(start,end) }
    }
}
