package io.openwaters.almanac

import java.time.Instant
import kotlin.math.*
import kotlin.test.*
import kotlinx.serialization.json.*

internal class GlobalSolarTest {
    private val catalog = fixture("eclipses/solar-catalog").jsonArray
    private val all by lazy { globalSolarEclipses(Instant.ofEpochMilli(SUPPORTED_MIN),Instant.ofEpochMilli(SUPPORTED_MAX)) }
    private fun unit(lat: Double, lon: Double): Vec3 = Vec3(cos(lat*DEG2RAD)*cos(lon*DEG2RAD),cos(lat*DEG2RAD)*sin(lon*DEG2RAD),sin(lat*DEG2RAD))
    private fun dot(a: Vec3,b: Vec3): Double = a.x*b.x+a.y*b.y+a.z*b.z
    private fun cross(a: Vec3,b: Vec3): Vec3 = Vec3(a.y*b.z-a.z*b.y,a.z*b.x-a.x*b.z,a.x*b.y-a.y*b.x)
    private fun norm(a: Vec3): Double = hypot(hypot(a.x,a.y),a.z)
    private fun angle(a: Vec3,b: Vec3): Double = atan2(norm(cross(a,b)),dot(a,b))
    private fun groundKm(aLat: Double,aLon: Double,bLat: Double,bLon: Double): Double = 6371.0088*angle(unit(aLat,aLon),unit(bLat,bLon))
    private fun nearest(lat: Double,lon: Double,line: List<SolarEclipseAxisPoint>): Pair<Double,Double> {
        val p = unit(lat,lon)
        var best = Double.POSITIVE_INFINITY to Double.NaN
        for ((start,end) in line.zipWithNext()) {
            val a = unit(start.latitudeDeg,start.longitudeDeg)
            val b = unit(end.latitudeDeg,end.longitudeDeg)
            val n = cross(a,b)
            val nLen = norm(n)
            val ab = angle(a,b)
            val s = if (nLen > 0) dot(p,n)/nLen else 0.0
            val divisor = if (nLen == 0.0) 1.0 else nLen
            val foot = Vec3(p.x-s*n.x/divisor,p.y-s*n.y/divisor,p.z-s*n.z/divisor)
            val af = angle(a,foot)
            val fb = angle(foot,b)
            val (rad,frac) = if (nLen > 0 && abs(af+fb-ab) < 1e-9) abs(asin(s.coerceIn(-1.0,1.0))) to af/ab else {
                val pa = angle(p,a); val pb = angle(p,b)
                if (pa <= pb) pa to 0.0 else pb to 1.0
            }
            if (6371.0088*rad < best.first) best = 6371.0088*rad to (start.time.toEpochMilli()+frac*(end.time.toEpochMilli()-start.time.toEpochMilli()))
        }
        return best
    }

    @Test fun everyCatalogEclipseMatchesAndGreatestPointAgreesWithLocalSearch() {
        assertEquals(337,catalog.size)
        assertEquals(catalog.size,all.size)
        val differing = mutableListOf<String>()
        for ((i,e) in all.withIndex()) {
            val row = catalog[i].obj()
            val kind = if (row.string("kind") == "partial" || !row.getValue("central").jsonPrimitive.boolean) "partial" else if (row.string("kind") == "hybrid") "total" else row.string("kind")
            assertEquals(kind,e.kind.toString(),"$row")
            near(e.peak.toEpochMilli().toDouble(),row.instant("peakUtc").toEpochMilli().toDouble(),60000.0,"$row")
            near(e.axisDistanceKm,abs(row.number("gamma"))*6378.137,5.0,"$row")
            assertTrue(e.greatestLatitudeDeg in -90.0..90.0)
            assertTrue(e.greatestLongitudeDeg > -180 && e.greatestLongitudeDeg <= 180)
            assertTrue(e.greatestObscuration > 0 && e.greatestObscuration <= 1)
            val site = Observer(e.greatestLatitudeDeg,e.greatestLongitudeDeg)
            val local = solarEclipses(e.peak.minusSeconds(86400),e.peak.plusSeconds(86400),site).single()
            near(local.peak.toEpochMilli().toDouble(),e.peak.toEpochMilli().toDouble(),2000.0,"local $row")
            near(solarObscuration(e.peak,site),e.greatestObscuration,1e-6,"obscuration $row")
            if (kind == "partial") {
                assertNull(e.latitudeDeg); assertNull(e.longitudeDeg); assertNull(e.obscuration)
                assertTrue(groundKm(site.latitudeDeg,site.longitudeDeg,row.number("latitudeDeg"),row.number("longitudeDeg"))*RAD2DEG/6371.0088 <= 1,"$row")
                near(sunAltAz(e.peak,site).altDeg,refractionDeg(0.0),.01,"horizon $row")
                assertEquals(row.string("kind"),local.kind.toString())
            } else {
                assertEquals(e.latitudeDeg,e.greatestLatitudeDeg)
                assertEquals(e.longitudeDeg,e.greatestLongitudeDeg)
                assertEquals(e.obscuration,e.greatestObscuration)
                assertTrue(e.axisDistanceKm < 6378.1366)
                if (e.axisDistanceKm < 6100) assertTrue(groundKm(site.latitudeDeg,site.longitudeDeg,row.number("latitudeDeg"),row.number("longitudeDeg"))*RAD2DEG/6371.0088 <= 1,"$row")
                if (e.kind.toString() != local.kind.toString()) differing.add("${e.peak.toString().take(10)} global ${e.kind} local ${local.kind}")
            }
        }
        assertEquals(122,all.count { it.kind == SolarEclipseKind.PARTIAL })
        assertEquals(listOf("1966-05-20 global annular local partial"),differing)
    }

    @Test fun walksAndHalfOpenWindowsAgreeExactly() {
        var forward = Instant.ofEpochMilli(SUPPORTED_MIN)
        var backward = Instant.ofEpochMilli(SUPPORTED_MAX-1)
        for (e in all) {
            assertEquals(e,nextGlobalSolarEclipse(forward)); forward = e.peak
            assertEquals(e,nextGlobalSolarEclipse(e.peak.minusMillis(101)))
            assertEquals(e,previousGlobalSolarEclipse(e.peak.plusMillis(101)))
            assertEquals(listOf(e),globalSolarEclipses(e.peak,e.peak.plusMillis(1)))
            assertTrue(globalSolarEclipses(e.peak.minusMillis(1),e.peak).isEmpty())
        }
        for (e in all.reversed()) { assertEquals(e,previousGlobalSolarEclipse(backward)); backward = e.peak }
        assertFailsWith<AlmanacOutOfRangeException> { nextGlobalSolarEclipse(forward) }
        assertFailsWith<AlmanacOutOfRangeException> { previousGlobalSolarEclipse(backward) }
        val e = all.first { it.peak > Instant.parse("2026-01-01T00:00:00Z") }
        for (offset in listOf(-100L,0L,100L)) {
            assertTrue(nextGlobalSolarEclipse(e.peak.plusMillis(offset)).peak > e.peak)
            assertTrue(previousGlobalSolarEclipse(e.peak.plusMillis(offset)).peak < e.peak)
        }
        assertEquals(all,globalSolarEclipses(Instant.ofEpochMilli(SUPPORTED_MIN),e.peak)+globalSolarEclipses(e.peak,Instant.ofEpochMilli(SUPPORTED_MAX)))
    }

    @Test fun centralLinesKeepContactsGridsHybridKindsAndAxisGeometry() {
        val hybrids = mutableListOf<String>()
        for ((i,e) in all.withIndex()) {
            val line = solarEclipseCentralLine(e.peak)
            val point = solarEclipseAxisPoint(e.peak)
            if (e.kind == SolarEclipseKind.PARTIAL) { assertTrue(line.isEmpty()); assertNull(point); continue }
            val p = assertNotNull(point)
            assertEquals(e.kind.toString(),p.kind.toString())
            near(p.latitudeDeg,e.latitudeDeg!!,1e-3,"latitude")
            assertTrue(angularDiff(p.longitudeDeg,e.longitudeDeg!!) < 1e-3)
            near(p.obscuration,e.obscuration!!,1e-6,"obscuration")
            assertTrue(line.size >= 2)
            val first = line.first().time.toEpochMilli()
            val last = line.last().time.toEpochMilli()
            assertTrue((last-first)/3600000.0 < 5)
            val expected = mutableListOf<Long>()
            var ms = (floor(first/60000.0).toLong()+1)*60000
            while (ms < last) { expected.add(ms); ms += 60000 }
            assertEquals(expected,line.drop(1).dropLast(1).map { it.time.toEpochMilli() })
            assertNull(solarEclipseAxisPoint(Instant.ofEpochMilli(first-2)))
            assertNull(solarEclipseAxisPoint(Instant.ofEpochMilli(last+2)))
            assertNotNull(solarEclipseAxisPoint(Instant.ofEpochMilli(first+2)))
            assertNotNull(solarEclipseAxisPoint(Instant.ofEpochMilli(last-2)))
            if (catalog[i].obj().string("kind") == "hybrid") {
                val sequence = line.map { it.kind.toString().first() }.fold("") { s,c -> if (s.lastOrNull() == c) s else s+c }
                hybrids.add("${e.peak.toString().take(10)} $sequence")
            }
        }
        assertEquals(listOf("1986-10-03 ata","1987-03-29 ata","2005-04-08 ata","2013-11-03 at","2023-04-20 ata","2031-11-14 ata","2049-11-25 ata","2050-05-20 ata","2067-12-06 ata"),hybrids)
        for (e in lunarEclipses(Instant.ofEpochMilli(SUPPORTED_MIN),Instant.ofEpochMilli(SUPPORTED_MAX))) assertNull(solarEclipseAxisPoint(e.peak))
        val peak = all.first { it.peak.toString().startsWith("2026-08-12") }.peak
        val fine = solarEclipseCentralLine(peak,10).associateBy { it.time }
        for (p in solarEclipseCentralLine(peak)) assertEquals(p,fine[p.time])
        assertTrue(solarEclipseCentralLine(peak,1).size > 5000)
        assertTrue(solarEclipseCentralLine(peak,3600).size >= 2)
        for (step in listOf(0,-60,3601,Int.MAX_VALUE)) assertFailsWith<IllegalArgumentException> { solarEclipseCentralLine(peak,step) }
    }

    @Test fun nasaPathsMatchGroundTimeEndsObscurationAndLocalCircumstances() {
        var checked = 0
        for (element in fixture("eclipses/solar-paths").jsonArray) {
            val table = element.obj()
            val greatest = table.getValue("greatestEclipse").obj()
            val e = all.first { abs(it.peak.toEpochMilli()-greatest.instant("utc").toEpochMilli()) < 86400000 }
            val tolKm = if (e.axisDistanceKm >= 6100) 15.0 else 5.0
            assertTrue(groundKm(e.latitudeDeg!!,e.longitudeDeg!!,greatest.number("latitudeDeg"),greatest.number("longitudeDeg")) <= tolKm)
            val line = solarEclipseCentralLine(e.peak,10)
            for ((i,end) in listOf(line.first(),line.last()).withIndex()) {
                val row = table.array("limits")[i].obj()
                assertTrue(groundKm(end.latitudeDeg,end.longitudeDeg,row.number("latitudeDeg"),row.number("longitudeDeg")) <= tolKm,"end $table")
            }
            for (rowElement in table.array("centralLine")) {
                val row = rowElement.obj()
                val (km,timeMs) = nearest(row.number("latitudeDeg"),row.number("longitudeDeg"),line)
                val utc = row.instant("utc")
                val sameTd = Instant.ofEpochMilli((utc.toEpochMilli()+(table.number("deltaTSeconds")-deltaTSeconds(2000+utDays(utc)/365.25))*1000).toLong())
                assertTrue(km <= tolKm,"$row: $km km")
                near(timeMs,sameTd.toEpochMilli().toDouble(),60000.0,"$row")
                val point = solarEclipseAxisPoint(sameTd)
                if (point != null) {
                    if (table.string("kind") == "total") assertEquals(1.0,point.obscuration)
                    else near(point.obscuration,row.number("diameterRatio").pow(2),.002,"$row")
                }
            }
            for (p in line) assertEquals(table.string("kind"),p.kind.toString())
            for (p in solarEclipseCentralLine(e.peak).drop(1).dropLast(1)) {
                checked++
                val local = solarEclipses(p.time.minusSeconds(86400),p.time.plusSeconds(86400),Observer(p.latitudeDeg,p.longitudeDeg)).single()
                near(local.peak.toEpochMilli().toDouble(),p.time.toEpochMilli().toDouble(),2000.0,"local axis")
                assertEquals(p.kind.toString(),local.kind.toString())
            }
        }
        assertTrue(checked > 900)
    }

    @Test fun quietEmptyUnsupportedAndPoleInputs() {
        val quiet = Instant.parse("2026-01-15T20:00:00Z")
        assertNull(solarEclipseAxisPoint(quiet))
        assertTrue(solarEclipseCentralLine(quiet).isEmpty())
        assertTrue(globalSolarEclipses(quiet,quiet).isEmpty())
        assertTrue(globalSolarEclipses(quiet,quiet.minusSeconds(1)).isEmpty())
        assertTrue(globalSolarEclipses(Instant.parse("2026-09-01T00:00:00Z"),Instant.parse("2027-01-01T00:00:00Z")).isEmpty())
        for (bad in listOf(Instant.MIN,Instant.MAX,Instant.ofEpochMilli(SUPPORTED_MAX),Instant.ofEpochMilli(SUPPORTED_MIN-1))) {
            assertFailsWith<AlmanacOutOfRangeException> { solarEclipseAxisPoint(bad) }
            assertFailsWith<AlmanacOutOfRangeException> { solarEclipseCentralLine(bad) }
            assertFailsWith<AlmanacOutOfRangeException> { nextGlobalSolarEclipse(bad) }
            assertFailsWith<AlmanacOutOfRangeException> { previousGlobalSolarEclipse(bad) }
            assertFailsWith<AlmanacOutOfRangeException> { globalSolarEclipses(bad,quiet) }
        }
        assertFailsWith<AlmanacOutOfRangeException> { globalSolarEclipses(quiet,Instant.ofEpochMilli(SUPPORTED_MAX+1)) }
    }
}
