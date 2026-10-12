package io.openwaters.almanac

import java.time.Instant
import kotlin.math.abs
import kotlin.test.*
import kotlinx.serialization.json.*

internal class SeasonsTest {
    @Test fun seasonsMatchUsnoWithFutureDeltaTScatter() {
        val rows = fixture("seasons/usno-seasons").jsonArray.map { it.obj() }
        val early = rows.filter { it.string("utc").substring(0,4).toInt() <= 2050 }
        val found = seasons(Instant.ofEpochMilli(SUPPORTED_MIN),Instant.parse("2051-01-01T00:00:00Z"))
        assertEquals(early.size,found.size)
        for ((i,event) in found.withIndex()) {
            assertEquals(early[i].string("kind"),event.kind.toString())
            assertTrue(abs(event.time.toEpochMilli()-early[i].instant("utc").toEpochMilli()) < 90000)
        }
        val future = rows.filter { it.string("utc").substring(0,4).toInt() > 2050 }.groupBy { it.string("utc").substring(0,4).toInt() }
        assertEquals(50,future.size)
        for ((year,run) in future) {
            val mine = seasons(Instant.parse("$year-01-01T00:00:00Z"),Instant.parse("${year+1}-01-01T00:00:00Z"))
            assertEquals(run.size,mine.size)
            val diffs = mine.mapIndexed { i,e ->
                assertEquals(run[i].string("kind"),e.kind.toString())
                (e.time.toEpochMilli()-run[i].instant("utc").toEpochMilli())/1000.0
            }
            assertTrue(abs(diffs.average()) < 120)
            assertTrue(diffs.all { abs(it-diffs.average()) < 90 })
        }
    }

    @Test fun fullRangeIsSortedAndExactSplitsAreHalfOpen() {
        val all = seasons(Instant.ofEpochMilli(SUPPORTED_MIN),Instant.ofEpochMilli(SUPPORTED_MAX))
        assertEquals(604,all.size)
        assertTrue(all.zipWithNext().all { it.first.time < it.second.time })
        val a = Instant.parse("2026-01-01T00:00:00Z")
        val b = Instant.parse("2027-01-01T00:00:00Z")
        val year = seasons(a,b)
        assertEquals(4,year.size)
        assertEquals(SeasonKind.MARCH_EQUINOX,year.first().kind)
        val split = year.first().time
        assertTrue(seasons(a,split).isEmpty())
        assertEquals(year,seasons(a,split)+seasons(split,b))
        assertTrue(seasons(a,a).isEmpty())
        assertTrue(seasons(b,a).isEmpty())
        for ((start,end) in listOf(Instant.MIN to a,a to Instant.MAX,Instant.ofEpochMilli(SUPPORTED_MIN-1) to a,a to Instant.ofEpochMilli(SUPPORTED_MAX+1),Instant.ofEpochMilli(SUPPORTED_MAX) to a))
            assertFailsWith<AlmanacOutOfRangeException> { seasons(start,end) }
    }
}
