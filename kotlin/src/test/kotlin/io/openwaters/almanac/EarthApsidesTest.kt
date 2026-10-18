package io.openwaters.almanac

import java.time.Instant
import kotlin.math.abs
import kotlin.test.*
import kotlinx.serialization.json.*

internal class EarthApsidesTest {
    @Test fun pinnedOracleAndEveryMillisecondBoundary() {
        val start = Instant.ofEpochMilli(SUPPORTED_MIN)
        val end = Instant.ofEpochMilli(SUPPORTED_MAX)
        val all = earthApsides(start,end)
        val rows = fixture("raw/earth-apsides/reference").obj()["rows"]!!.jsonArray
        assertEquals(302,all.size)
        assertEquals(rows.size,all.size)
        for ((i,a) in all.withIndex()) {
            val row = rows[i].obj()
            assertEquals(row.string("kind"),a.kind.toString())
            assertTrue(abs(a.time.toEpochMilli()-row.instant("utc").toEpochMilli()) < 2000)
            near(a.distanceKm,row.number("distanceKm"),0.001)
            assertTrue(earthApsides(a.time.minusMillis(1),a.time).isEmpty())
            assertEquals(listOf(a),earthApsides(a.time,a.time.plusMillis(1)))
            val p = planetHeliocentricPosition(Planet.EARTH,a.time)
            near(kotlin.math.sqrt(p.xAu*p.xAu+p.yAu*p.yAu+p.zAu*p.zAu)*KM_PER_AU,a.distanceKm,0.001)
        }
        assertTrue(all.zipWithNext().all { it.first.time < it.second.time && it.first.kind != it.second.kind })
        val split = Instant.parse("2026-04-01T00:00:00Z")
        assertEquals(all,earthApsides(start,split)+earthApsides(split,end))
        assertTrue(earthApsides(start,start).isEmpty())
        assertTrue(earthApsides(split,start).isEmpty())
        for ((a,b) in listOf(Instant.MIN to end,start to Instant.MAX,start.minusMillis(1) to end,start to end.plusMillis(1),end to start))
            assertFailsWith<AlmanacOutOfRangeException> { earthApsides(a,b) }
        assertEquals(earthApsides(Instant.ofEpochSecond(-1000),split),earthApsides(Instant.ofEpochSecond(-1001,999100000),split))
    }
}
