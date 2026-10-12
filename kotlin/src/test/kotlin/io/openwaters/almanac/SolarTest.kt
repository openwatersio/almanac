package io.openwaters.almanac

import java.time.Instant
import kotlin.math.*
import kotlin.test.*
import kotlinx.serialization.json.*

internal fun solarContacts(e: SolarEclipse): Map<String, Instant?> = linkedMapOf("c1" to e.c1, "c2" to e.c2, "peak" to e.peak, "c3" to e.c3, "c4" to e.c4)
internal fun solarAltitudes(e: SolarEclipse): Map<String, Double?> = linkedMapOf("c1" to e.sunAltDeg.c1, "c2" to e.sunAltDeg.c2, "peak" to e.sunAltDeg.peak, "c3" to e.sunAltDeg.c3, "c4" to e.sunAltDeg.c4)

internal class SolarTest {
    private val victoria = Observer(48.4284, -123.3656)
    private val catalog = fixture("eclipses/solar-catalog").jsonArray
    private val local = fixture("eclipses/solar-local").jsonArray

    @Test fun catalogObscurationAndCentralCircumstances() {
        assertTrue(catalog.size > 300)
        for (element in catalog) {
            val row = element.obj()
            val time = row.instant("peakUtc")
            val site = row.observer()
            val obs = solarObscuration(time, site)
            val wide = row["pathWidthKm"] != JsonNull && row.number("pathWidthKm") >= 200
            val magnitude = row.number("magnitude")
            when (row.string("kind")) {
                "partial" -> assertTrue(obs > 0, "$row")
                "annular" -> if (wide) near(obs, magnitude*magnitude, .01, "$row") else assertTrue(obs >= magnitude*magnitude-.1, "$row")
                else -> if (wide) assertEquals(1.0, obs, "$row") else assertTrue(obs >= .9, "$row")
            }
            if (row.string("kind") == "partial" || !row.getValue("central").jsonPrimitive.boolean) continue
            val found = solarEclipses(time.minusSeconds(86400), time.plusSeconds(86400), site)
            val e = found.single()
            near(e.peak.toEpochMilli().toDouble(), time.toEpochMilli().toDouble(), 300000.0, "$row")
            val kinds = if (row.string("kind") == "hybrid") mutableListOf("total", "annular") else mutableListOf(row.string("kind"))
            if (!wide) kinds.add("partial")
            assertTrue(e.kind.toString() in kinds, "$row: $e")
            near(e.sunAltDeg.peak, row.number("sunAltDeg"), 2.0, "$row")
            if (abs(row.number("gamma")) < .2) {
                val antipode = Observer(-site.latitudeDeg, if (site.longitudeDeg > 0) site.longitudeDeg-180 else site.longitudeDeg+180)
                assertTrue(solarObscuration(time, antipode) > 0)
                assertTrue(solarEclipses(time.minusSeconds(86400), time.plusSeconds(86400), antipode).isEmpty())
            }
        }
    }

    @Test fun usnoLocalContactsAltitudesAndObscuration() {
        for (element in local) {
            val row = element.obj()
            val day = Instant.parse(row.string("eclipse") + "T00:00:00Z")
            val site = row.observer()
            val found = solarEclipses(day.minusSeconds(86400), day.plusSeconds(2*86400), site)
            if (!row.getValue("visible").jsonPrimitive.boolean) { assertTrue(found.isEmpty(), "$row"); continue }
            val e = found.single()
            assertEquals(row.string("kind"), e.kind.toString())
            near(e.obscuration, row.number("obscuration"), .01, "$row")
            for ((key, actual) in solarContacts(e)) {
                val expected = row[key]
                if (expected == null || expected == JsonNull) {
                    if (key in listOf("c2", "c3")) assertNull(actual) else assertTrue(solarAltitudes(e).getValue(key)!! < 0)
                    continue
                }
                val contact = expected.obj()
                near(assertNotNull(actual).toEpochMilli().toDouble(), contact.instant("utc").toEpochMilli().toDouble(), if (key == "peak") 300000.0 else 60000.0, "$key $row")
                if (contact["sunAltDeg"] != JsonNull) {
                    val geometric = contact.number("sunAltDeg")
                    near(solarAltitudes(e).getValue(key)!!, geometric+refractionDeg(geometric), if (key == "peak") 1.5 else .5, "$key $row")
                }
            }
            near(solarObscuration(e.peak, site), e.obscuration, 1e-6, "$row")
            if (e.kind == SolarEclipseKind.TOTAL) {
                assertEquals(1.0, solarObscuration(Instant.ofEpochMilli((e.c2!!.toEpochMilli()+e.c3!!.toEpochMilli())/2), site))
                assertEquals(0.0, solarObscuration(e.c1.minusSeconds(60), site))
            }
        }
    }

    @Test fun fullRangeMatchesBothWalksAndSplitRanges() {
        val range = solarEclipses(Instant.ofEpochMilli(SUPPORTED_MIN), Instant.ofEpochMilli(SUPPORTED_MAX), victoria)
        assertTrue(range.size > 30)
        var forward = Instant.ofEpochMilli(SUPPORTED_MIN)
        var backward = Instant.ofEpochMilli(SUPPORTED_MAX-1)
        for (e in range) {
            assertEquals(e, nextSolarEclipse(forward, victoria)); forward = e.peak
            assertEquals(listOf(e), solarEclipses(e.peak, e.peak.plusMillis(1), victoria))
            assertTrue(solarEclipses(e.peak.minusMillis(1), e.peak, victoria).isEmpty())
            val contacts = solarContacts(e).values.filterNotNull()
            assertTrue(contacts.zipWithNext().all { (a,b) -> a < b })
            assertEquals(e.kind == SolarEclipseKind.PARTIAL, e.c2 == null)
            assertEquals(e.kind == SolarEclipseKind.PARTIAL, e.c3 == null)
            for ((key, time) in solarContacts(e)) if (time != null) assertEquals(sunAltAz(time, victoria).altDeg, solarAltitudes(e).getValue(key))
            assertTrue(e.sunAltDeg.c1 > 0 || e.sunAltDeg.peak > 0 || e.sunAltDeg.c4 > 0)
            assertTrue(e.obscuration > 0 && e.obscuration <= 1)
        }
        for (e in range.reversed()) { assertEquals(e, previousSolarEclipse(backward, victoria)); backward = e.peak }
        assertFailsWith<AlmanacOutOfRangeException> { nextSolarEclipse(forward, victoria) }
        assertFailsWith<AlmanacOutOfRangeException> { previousSolarEclipse(backward, victoria) }
        val e = range.first { it.peak > Instant.parse("2000-01-01T00:00:00Z") }
        assertTrue(nextSolarEclipse(e.peak.minusMillis(100), victoria).peak > e.peak)
        assertEquals(e, nextSolarEclipse(e.peak.minusMillis(101), victoria))
        assertTrue(previousSolarEclipse(e.peak.plusMillis(100), victoria).peak < e.peak)
        assertEquals(e, previousSolarEclipse(e.peak.plusMillis(101), victoria))
        assertEquals(range, solarEclipses(Instant.ofEpochMilli(SUPPORTED_MIN), e.peak, victoria)+solarEclipses(e.peak, Instant.ofEpochMilli(SUPPORTED_MAX), victoria))
    }

    @Test fun polarNoonAndRaisedHorizonAreRetained() {
        val polar = solarEclipses(Instant.parse("1956-12-01T00:00:00Z"), Instant.parse("1956-12-04T00:00:00Z"), Observer(68.0,60.0)).single()
        assertTrue(polar.sunAltDeg.c1 < 0 && polar.sunAltDeg.peak > 0 && polar.sunAltDeg.c4 < 0)
        val start = Instant.parse("2026-08-12T00:00:00Z")
        val end = start.plusSeconds(86400)
        val site = Observer(20.0,5.5,100.0)
        assertTrue(solarEclipses(start,end,site).isEmpty())
        val e = solarEclipses(start,end,site,100.0).single()
        assertEquals(e,nextSolarEclipse(start,site,100.0))
        assertEquals(e,previousSolarEclipse(end,site,100.0))
        assertTrue(e.sunAltDeg.c1 < 0 && e.sunAltDeg.c1 > horizonDip(site,100.0))
    }

    @Test fun validationAndDiscGeometry() {
        val time = Instant.parse("2026-01-15T20:00:00Z")
        assertEquals(0.0,solarObscuration(time,victoria))
        assertTrue(solarEclipses(time,time,victoria).isEmpty())
        assertTrue(solarEclipses(time,time.minusSeconds(1),victoria).isEmpty())
        for (bad in listOf(Instant.MIN,Instant.MAX,Instant.ofEpochMilli(SUPPORTED_MAX))) {
            assertFailsWith<AlmanacOutOfRangeException> { solarObscuration(bad,victoria) }
            assertFailsWith<AlmanacOutOfRangeException> { nextSolarEclipse(bad,victoria) }
            assertFailsWith<AlmanacOutOfRangeException> { previousSolarEclipse(bad,victoria) }
        }
        assertFailsWith<AlmanacOutOfRangeException> { solarEclipses(Instant.ofEpochMilli(SUPPORTED_MIN-1),time,victoria) }
        assertFailsWith<AlmanacOutOfRangeException> { solarEclipses(time,Instant.ofEpochMilli(SUPPORTED_MAX+1),victoria) }
        for (height in listOf(-1.0,Double.NaN,10001.0)) {
            assertFailsWith<IllegalArgumentException> { solarEclipses(time,time,victoria,height) }
            assertFailsWith<IllegalArgumentException> { nextSolarEclipse(time,victoria,height) }
            assertFailsWith<IllegalArgumentException> { previousSolarEclipse(time,victoria,height) }
        }
        assertEquals(0.0,discOverlap(1.0,1.0,2.0))
        assertEquals(1.0,discOverlap(1.0,2.0,0.0))
        assertEquals(.25,discOverlap(2.0,1.0,0.0))
        assertEquals(1.0,discOverlap(1.0,2.0,1.0))
        assertEquals(.25,discOverlap(2.0,1.0,1.0))
        near(discOverlap(1.0,1.0,1.0), 2.0/3-sqrt(3.0)/(2*Math.PI), 1e-15, "lens")
        for (args in listOf(Triple(0.0,1.0,1.0),Triple(1.0,0.0,1.0),Triple(1.0,1.0,-1.0))) assertFailsWith<IllegalStateException> { discOverlap(args.first,args.second,args.third) }
        assertFailsWith<IllegalStateException> { solarAngleBetweenDeg(Vec3(0.0,0.0,0.0),Vec3(1.0,0.0,0.0)) }
        assertFailsWith<IllegalStateException> { solarAngleBetweenDeg(Vec3(1.0,0.0,0.0),Vec3(0.0,0.0,0.0)) }
        assertEquals(0.0,solarAngleBetweenDeg(Vec3(1.0,0.0,0.0),Vec3(1.0,0.0,0.0)))
        assertEquals(180.0,solarAngleBetweenDeg(Vec3(1.0,0.0,0.0),Vec3(-1.0,0.0,0.0)))
    }
}
