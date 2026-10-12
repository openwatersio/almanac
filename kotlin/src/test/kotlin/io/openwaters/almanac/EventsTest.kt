package io.openwaters.almanac

import java.time.Instant
import kotlin.math.*
import kotlin.test.*
import kotlinx.serialization.json.*

internal class EventsTest {
    private val victoria = Observer(48.7621, -123.052)
    private val start = Instant.parse("2026-01-01T00:00:00Z")
    private val end = Instant.parse("2027-01-01T00:00:00Z")
    private fun events(body: String, a: Instant, b: Instant, site: Observer, height: Double = 0.0): List<Pair<Instant, String>> =
        if (body == "sun") sunEvents(a, b, site, height).map { it.time to it.kind.toString() }
        else moonEvents(a, b, site, height).map { it.time to it.kind.toString() }
    private fun vector(body: String, tt: Double): Vec3 = if (body == "sun") sunGeoVectorEqj(tt) else moonGeoVectorEqj(tt)
    private fun top(body: String, time: Instant, site: Observer): TopoUnrefracted {
        val ut = utDays(time)
        return topoAltAzUnrefracted(vector(body, ttDaysFromUt(ut)), ut, site)
    }

    @Test fun usnoGridCrossingsAndTransitsKeepAbsoluteAndFutureScatterBounds() {
        val future = mutableMapOf<String, MutableList<Double>>()
        var transitCount = 0
        for (element in fixture("events/usno-grid").jsonArray) {
            val row = element.obj()
            val date = row.string("date")
            val a = Instant.parse(date + "T00:00:00Z")
            val site = row.observer()
            for (body in listOf("sun", "moon")) {
                val found = events(body, a, a.plusSeconds(86400), site)
                val expected = row.getValue(body).obj()
                val crossings = if (body == "sun") listOf("rise", "set", "civilDawn", "civilDusk") else listOf("rise", "set")
                for (kind in crossings) {
                    val mine = found.filter { it.second == kind }
                    if (kind !in expected) { assertTrue(mine.isEmpty(), "$date $body $kind"); continue }
                    assertEquals(1, mine.size, "$date $body $kind")
                    val want = Instant.parse(date + "T" + expected.string(kind) + ":00Z")
                    val diff = (mine.single().first.toEpochMilli() - want.toEpochMilli()) / 1000.0
                    if (date.substring(0,4).toInt() > 2050) future.getOrPut(date) { mutableListOf() }.add(diff)
                    else assertTrue(abs(diff) < 60, "$date $body $kind $diff")
                }
                val transits = if (body == "sun") sunTransits(a, a.plusSeconds(86400), site) else moonTransits(a, a.plusSeconds(86400), site)
                for ((key, kind) in listOf("transit" to TransitEventKind.UPPER, "lowerTransit" to TransitEventKind.LOWER)) {
                    if (key !in expected) continue
                    val mine = transits.filter { it.kind == kind }
                    assertEquals(1, mine.size)
                    val want = Instant.parse(date + "T" + expected.string(key) + ":00Z")
                    assertTrue(abs(mine.single().time.toEpochMilli() - want.toEpochMilli()) < 60000)
                    transitCount++
                }
            }
        }
        assertTrue(transitCount > 40)
        assertTrue(future.isNotEmpty())
        for ((date, diffs) in future) {
            assertTrue(diffs.size > 1)
            val mean = diffs.average()
            assertTrue(abs(mean) < 120, date)
            assertTrue(diffs.all { abs(it - mean) < 60 }, date)
        }
    }

    @Test fun phaseRunsMatchUsnoCountOrderAndFutureScatter() {
        val rows = fixture("phases/usno-phases").jsonArray.map { it.obj() }.sortedBy { it.instant("utc") }
        val runs = mutableListOf<MutableList<JsonObject>>()
        for (row in rows) {
            if (runs.isEmpty() || row.instant("utc").epochSecond - runs.last().last().instant("utc").epochSecond > 40*86400)
                runs.add(mutableListOf(row))
            else runs.last().add(row)
        }
        var future = 0
        for (run in runs) {
            val found = searchMoonPhases(run.first().instant("utc").minusSeconds(6*3600), run.last().instant("utc").plusSeconds(6*3600))
            assertEquals(run.size, found.size)
            val diffs = found.mapIndexed { i, event ->
                assertEquals(run[i].string("phase"), event.phase.toString())
                (event.time.toEpochMilli() - run[i].instant("utc").toEpochMilli()) / 1000.0
            }
            if (run.first().string("utc").substring(0,4).toInt() > 2050) {
                future++
                assertTrue(abs(diffs.average()) < 120)
                assertTrue(diffs.all { abs(it - diffs.average()) < 60 })
            } else assertTrue(diffs.all { abs(it) < 60 })
        }
        assertTrue(future > 0)
        for (event in searchMoonPhases(start, start.plusSeconds(90*86400))) {
            near(angularDiff(moonIllumination(event.time).phase*360, event.phase.ordinal*90.0), 0.0, 360e-6)
        }
    }

    @Test fun horizonsTwilightAndArbitraryAltitudeCrossingsAreOneForOne() {
        val blocks = mutableListOf<MutableList<JsonObject>>()
        for (element in fixture("altaz/sun-airless-twilight").jsonArray) {
            val row = element.obj()
            val last = blocks.lastOrNull()?.lastOrNull()
            if (last == null || last.number("siteLatDeg") != row.number("siteLatDeg") || row.instant("utc").epochSecond - last.instant("utc").epochSecond != 60L)
                blocks.add(mutableListOf(row))
            else blocks.last().add(row)
        }
        var checked = 0
        for (block in blocks) {
            val site = Observer(block.first().number("siteLatDeg"), block.first().number("siteLonDeg"))
            for (level in listOf(-6.0, -12.0, -18.0, 6.0, -0.3, -4.0, -8.0)) {
                val expected = block.zipWithNext().mapNotNull { (a,b) ->
                    val fa = a.number("altDeg") - level
                    val fb = b.number("altDeg") - level
                    if ((fa < 0) == (fb < 0)) null
                    else (a.instant("utc").toEpochMilli() + 60000 * -fa / (fb-fa)) to if (fb >= 0) "rising" else "falling"
                }
                val found = sunAltitudeEvents(block.first().instant("utc"), block.last().instant("utc"), site, level)
                assertEquals(expected.map { it.second }, found.map { it.kind.toString() })
                for ((i, event) in found.withIndex()) {
                    near(event.time.toEpochMilli().toDouble(), expected[i].first, 60000.0)
                    checked++
                }
            }
        }
        assertTrue(checked > 80)
        for (element in fixture("altaz/transits").jsonArray) {
            val row = element.obj()
            val site = row.getValue("observer").obj().observer()
            val found = if (row.string("body") == "sun") sunTransits(row.instant("startUtc"), row.instant("endUtc"), site)
                else moonTransits(row.instant("startUtc"), row.instant("endUtc"), site)
            val expected = row.array("transits").map { it.obj() }
            assertEquals(expected.map { it.string("kind") }, found.map { it.kind.toString() })
            for ((i,event) in found.withIndex()) assertTrue(abs(event.time.toEpochMilli() - expected[i].instant("utc").toEpochMilli()) < 60000)
        }
    }

    @Test fun grazingPairsAndPolarNightAreReportedCorrectly() {
        val site = Observer(70.5, -123.052)
        val day = Instant.parse("2026-05-14T00:00:00Z")
        val found = sunEvents(day, day.plusSeconds(86400), site)
        val set = found.single { it.kind == SunEventKind.SET }.time
        val rise = found.single { it.kind == SunEventKind.RISE }.time
        assertTrue(set < rise)
        assertTrue(abs(set.toEpochMilli() - Instant.parse("2026-05-14T08:00:00Z").toEpochMilli()) < 60000)
        assertTrue(abs(rise.toEpochMilli() - Instant.parse("2026-05-14T08:16:00Z").toEpochMilli()) < 60000)
        assertTrue(sunEvents(day.plusSeconds(86400), day.plusSeconds(2*86400), site).all { it.kind == SunEventKind.TRANSIT })
        val night = Instant.parse("2026-12-21T00:00:00Z")
        assertEquals(1, sunEvents(night, night.plusSeconds(86400), site).count { it.kind == SunEventKind.TRANSIT })
        assertTrue(sunEvents(night, night.plusSeconds(86400), site).none { it.kind == SunEventKind.RISE || it.kind == SunEventKind.SET })
        for (date in listOf("2026-07-27", "2026-07-28", "2026-07-29")) {
            val a = Instant.parse(date + "T00:00:00Z")
            assertTrue(moonEvents(a, a.plusSeconds(86400), site).isEmpty())
        }
    }

    @Test fun everyLatitudeCrossingHasAResidualUnderOneSecond() {
        for (body in listOf("sun", "moon")) for (lat in listOf(-89.5, -35.0, 0.0, 48.7621, 70.5, 86.0, 88.0, 88.9, 89.5, 90.0)) {
            val site = Observer(lat, -123.052)
            val span = if (abs(lat) >= 85) 366L else 40L
            val found = events(body, start, start.plusSeconds(span*86400), site)
            assertTrue(found.zipWithNext().all { it.first.first <= it.second.first })
            val crossings = found.filter { it.second == "rise" || it.second == "set" }
            assertTrue(crossings.size > 1, "$body $lat")
            fun offset(time: Instant): Double {
                val pos = top(body, time, site)
                val radius = if (body == "sun") 695700.0 else 1737.4
                return pos.altDeg + 34.0/60 + RAD2DEG*asin(radius/(pos.distanceAu*KM_PER_AU))
            }
            for ((time,kind) in crossings) {
                val rate = abs(offset(time.plusSeconds(30)) - offset(time.minusSeconds(30))) / 60
                assertTrue(abs(offset(time))/rate < 1, "$body $lat $kind $time")
            }
        }
        for (lat in listOf(-89.5, -35.0, 0.0, 48.7621, 70.5, 86.0, 88.9, 90.0)) {
            val site = Observer(lat, -123.052)
            val flat = abs(lat) >= 85
            for (level in if (flat) listOf(-0.3, 2.0, -4.0) else listOf(12.5, -0.3, -8.0, 40.0)) {
                fun offset(time: Instant): Double = top("sun", time, site).altDeg-level
                for (e in sunAltitudeEvents(start, start.plusSeconds((if (flat) 366L else 40L)*86400), site, level)) {
                    val rate = (offset(e.time.plusSeconds(30)) - offset(e.time.minusSeconds(30)))/60
                    assertEquals(if (e.kind == AltitudeEventKind.RISING) 1.0 else -1.0, sign(rate))
                    assertTrue(abs(offset(e.time)/rate) < 1)
                }
            }
        }
    }

    @Test fun independentMinuteScansFindEveryFlatteningBandCrossing() {
        for (body in listOf("sun", "moon")) for (lat in listOf(-88.5, 86.0, 88.0, 88.9, 89.5)) {
            val site = Observer(lat, -123.052)
            val a = Instant.parse(if (body == "sun") "2026-03-10T00:00:00Z" else "2026-09-10T00:00:00Z")
            val b = a.plusSeconds(30*86400)
            fun offset(t: Instant): Double {
                val p = top(body, t, site)
                return p.altDeg + 34.0/60 + RAD2DEG*asin((if (body == "sun") 695700.0 else 1737.4)/(p.distanceAu*KM_PER_AU))
            }
            var previous = offset(a)
            var time = a.plusSeconds(60)
            val brute = mutableListOf<Pair<Instant, String>>()
            while (time <= b) {
                val current = offset(time)
                if ((previous < 0) != (current < 0)) brute.add(time to if (current >= 0) "rise" else "set")
                previous = current
                time = time.plusSeconds(60)
            }
            val found = events(body, a, b, site).filter { it.second == "rise" || it.second == "set" }
            assertEquals(brute.map { it.second }, found.map { it.second }, "$body $lat")
            for ((i,event) in found.withIndex()) assertTrue(abs(event.first.toEpochMilli()-brute[i].first.toEpochMilli()) < 60000)
        }
    }

    @Test fun windowsAreNormalizedHalfOpenAndValidatedBeforeEmptyResults() {
        val queries: List<(Instant, Instant) -> List<Pair<Instant, String>>> = listOf(
            { a,b -> events("sun",a,b,victoria) }, { a,b -> events("moon",a,b,victoria) },
            { a,b -> searchMoonPhases(a,b).map { it.time to it.phase.toString() } },
            { a,b -> sunAltitudeEvents(a,b,victoria,6.0).map { it.time to it.kind.toString() } },
            { a,b -> sunTransits(a,b,victoria).map { it.time to it.kind.toString() } },
            { a,b -> moonTransits(a,b,victoria).map { it.time to it.kind.toString() } }
        )
        for (query in queries) {
            val all = query(start, start.plusSeconds(31*86400))
            assertTrue(all.isNotEmpty())
            val split = all.first().first
            assertEquals(all, query(start,split) + query(split,start.plusSeconds(31*86400)))
            assertTrue(query(start,split).none { it.first.compareTo(split) == 0 })
            assertEquals(split, query(split,start.plusSeconds(31*86400)).first().first)
            assertTrue(query(start,start).isEmpty())
            assertTrue(query(end,start).isEmpty())
            assertFailsWith<AlmanacOutOfRangeException> { query(Instant.MIN, start) }
            assertFailsWith<AlmanacOutOfRangeException> { query(start, Instant.MAX) }
            for ((a,b) in listOf(Instant.ofEpochMilli(SUPPORTED_MIN) to Instant.ofEpochMilli(SUPPORTED_MIN).plusSeconds(2*86400), Instant.ofEpochMilli(SUPPORTED_MAX).minusSeconds(2*86400) to Instant.ofEpochMilli(SUPPORTED_MAX)))
                assertTrue(query(a,b).all { it.first >= a && it.first < b })
        }
        for (height in listOf(-1.0, Double.NaN)) {
            assertFailsWith<IllegalArgumentException> { sunEvents(start,start,victoria,height) }
            assertFailsWith<IllegalArgumentException> { moonEvents(start,start,victoria,height) }
        }
        for (alt in listOf(Double.NaN, Double.POSITIVE_INFINITY, -90.0001, 91.0))
            assertFailsWith<IllegalArgumentException> { sunAltitudeEvents(end,start,victoria,alt) }
        assertTrue(sunAltitudeEvents(start,end,victoria,90.0).isEmpty())
        assertTrue(sunAltitudeEvents(start,end,victoria,-90.0).isEmpty())
        val boundaryUt = utDays(Instant.ofEpochMilli(SUPPORTED_MIN))
        near(quantizedUt(boundaryUt - 0.0000003/86400), boundaryUt, 1e-9)
    }

    @Test fun heightChangesOnlyHorizonCrossingsAndTransitsAgree() {
        val site = Observer(48.4284,-123.3656,100.0)
        val a = Instant.parse("2026-03-20T00:00:00Z")
        val b = a.plusSeconds(2*86400)
        for (body in listOf("sun","moon")) {
            val ground = events(body,a,b,site)
            val raised = events(body,a,b,site,100.0)
            assertEquals(ground,events(body,a,b,site,0.0))
            assertTrue(raised.first { it.second == "rise" }.first < ground.first { it.second == "rise" }.first)
            assertTrue(raised.first { it.second == "set" }.first > ground.first { it.second == "set" }.first)
            assertEquals(ground.filter { it.second !in listOf("rise","set") }, raised.filter { it.second !in listOf("rise","set") })
        }
        for (site2 in listOf(victoria,Observer(70.5,-123.052),Observer(-88.5,10.0))) {
            val found = sunTransits(start,end,site2)
            assertEquals(sunEvents(start,end,site2).filter { it.kind == SunEventKind.TRANSIT }.map { it.time }, found.filter { it.kind == TransitEventKind.UPPER }.map { it.time })
            assertTrue(found.zipWithNext().all { it.first.kind != it.second.kind && it.first.time < it.second.time })
            assertEquals(sunEvents(start,end,site2).filter { it.kind in listOf(SunEventKind.CIVIL_DAWN,SunEventKind.CIVIL_DUSK) }.map { it.time }, sunAltitudeEvents(start,end,site2,-6.0).map { it.time })
        }
    }

    @Test fun boundedRootSolverRejectsUnprovenRootsAndIterationExhaustion() {
        assertNull(search({ 1.0 },0.0,1e-8,1.0))
        assertNull(search({ -1.0 },0.0,1e-8,1.0))
        assertNull(search({ -it },-1e-8,1e-8,1.0))
        near(search({ it-0.25 },0.0,1.0,0.1)!!,0.25,1e-6)
        assertFailsWith<IllegalStateException> { search({ it-0.25 },0.0,1.0,0.1,0) }
        assertFailsWith<IllegalStateException> { assertReached(false,"test iteration") }
        assertReached(true,"test iteration")
        val constantHourAngle: Sampler = { Sample(it,0.0,1.0,0.0) }
        assertFailsWith<IllegalStateException> { nextHourAngle(constantHourAngle,0.0,0.0,360.0) }
        assertFailsWith<IllegalStateException> { goldenExtremum(constantHourAngle,0.0,Double.NaN,true) }
    }

    @Test fun polarAltitudeAndTransitScansPreserveEveryOracleCrossing() {
        val site = Observer(88.5,-123.052)
        val a = Instant.parse("2026-03-10T00:00:00Z")
        val b = a.plusSeconds(20*86400)
        var previous = top("sun",a,site).altDeg+0.3
        var time = a.plusSeconds(60)
        val brute = mutableListOf<Pair<Instant,AltitudeEventKind>>()
        while (time <= b) {
            val current = top("sun",time,site).altDeg+0.3
            if ((previous < 0) != (current < 0)) brute.add(time to if (current >= 0) AltitudeEventKind.RISING else AltitudeEventKind.FALLING)
            previous = current
            time = time.plusSeconds(60)
        }
        assertTrue(brute.size > 1)
        val found = sunAltitudeEvents(a,b,site,-0.3)
        assertEquals(brute.map { it.second },found.map { it.kind })
        for ((i,e) in found.withIndex()) assertTrue(abs(e.time.toEpochMilli()-brute[i].first.toEpochMilli()) < 60000)
        for (body in listOf("sun","moon")) for (lat in listOf(-88.5,89.5)) {
            val observer = Observer(lat,-123.052)
            val start = Instant.parse("2026-09-10T00:00:00Z")
            val end = start.plusSeconds(30*86400)
            var last = top(body,start,observer).hourAngleDeg
            var probe = start.plusSeconds(60)
            val oracle = mutableListOf<Pair<Instant,TransitEventKind>>()
            while (probe <= end) {
                val current = top(body,probe,observer).hourAngleDeg
                if (current < last) oracle.add(probe to TransitEventKind.UPPER)
                else if (last < 180 && current >= 180) oracle.add(probe to TransitEventKind.LOWER)
                last = current
                probe = probe.plusSeconds(60)
            }
            val transits = if (body == "sun") sunTransits(start,end,observer) else moonTransits(start,end,observer)
            assertEquals(oracle.map { it.second },transits.map { it.kind })
            for ((i,e) in transits.withIndex()) assertTrue(abs(e.time.toEpochMilli()-oracle[i].first.toEpochMilli()) < 60000)
        }
    }

    @Test fun supportedRangeSearchesMeetExistingPerformanceBounds() {
        val a = Instant.ofEpochMilli(SUPPORTED_MIN)
        val b = Instant.ofEpochMilli(SUPPORTED_MAX)
        var clock = System.nanoTime()
        assertTrue(searchMoonPhases(a,b).size > 7000)
        assertTrue((System.nanoTime()-clock)/1e9 < 10)
        clock = System.nanoTime()
        assertTrue(sunEvents(start,end,victoria).size > 3000)
        assertTrue(moonEvents(start,end,victoria).size > 600)
        assertTrue((System.nanoTime()-clock)/1e9 < 5)
        clock = System.nanoTime()
        val sun = sunEvents(a,b,victoria)
        val moon = moonEvents(a,b,victoria)
        assertTrue(sun.size > 450000 && moon.size > 100000)
        val seconds = (System.nanoTime()-clock)/1e9
        println("Kotlin full-range events: ${sun.size} Sun + ${moon.size} Moon in $seconds seconds")
        assertTrue(seconds < 120)
    }
}
