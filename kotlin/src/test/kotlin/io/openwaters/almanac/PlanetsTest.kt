package io.openwaters.almanac

import java.time.Instant
import kotlin.math.*
import kotlin.test.*
import kotlinx.serialization.json.*

internal fun JsonObject.planet(): Planet = Planet.entries.single { it.toString() == string("planet") }

internal class PlanetsTest {
    private val victoria = Observer(48.4284, -123.3656)

    @Test fun heliocentricVectorsMatchHorizonsAtSupportedEdges() {
        val rows = fixture("planets/heliocentric").jsonArray.map { it.obj() }
        for (planet in Planet.entries) {
            val samples = rows.filter { it.planet() == planet }
            assertEquals("1950-01-01T00:00:00Z", samples.first().string("tt"))
            assertEquals("2100-12-31T23:59:59Z", samples.last().string("tt"))
            for (row in samples) {
                val value = planetHelioVector(planet, utDays(row.instant("tt")))
                val dx = value.x - row.number("xAu")
                val dy = value.y - row.number("yAu")
                val dz = value.z - row.number("zAu")
                assertTrue(sqrt(dx*dx + dy*dy + dz*dz) < 1e-3, "$row")
            }
        }
    }

    @Test fun apparentDirectionsAndDistancesMatchHorizons() {
        val rows = fixture("planets/positions").jsonArray.map { it.obj() }
        for (planet in Planet.entries.filter { it != Planet.EARTH }) {
            val samples = rows.filter { it.planet() == planet }
            assertTrue(samples.any { it.number("raDeg") < 1 || it.number("raDeg") > 359 })
            for (row in samples) {
                val value = planetApparentAtTT(planet, utDays(row.instant("tt")))
                val d1 = value.decDeg * DEG2RAD
                val d2 = row.number("decDeg") * DEG2RAD
                val sep = acos((sin(d1)*sin(d2) + cos(d1)*cos(d2)*cos((value.raDeg-row.number("raDeg"))*DEG2RAD)).coerceIn(-1.0, 1.0)) * RAD2DEG * 60
                assertTrue(sep < 1, "$row")
                near(value.distanceAu, row.number("distanceAu"), 1e-3, "$row")
                assertTrue(value.raDeg >= 0 && value.raDeg < 360 && abs(value.decDeg) <= 90)
            }
        }
    }

    @Test fun horizontalTracksMatchAirlessAndRefractedEvidence() {
        for (element in fixture("planets/altaz").jsonArray) {
            val row = element.obj()
            if (row.string("mode") == "refracted" && row.number("altDeg") <= 10) continue
            val time = row.instant("utc")
            val ut = utDays(time)
            val observer = row.getValue("observer").obj().observer()
            val alt: Double
            val az: Double
            if (row.string("mode") == "airless") {
                val p = topoAltAzUnrefracted(planetGeoVectorEqj(row.planet(), ttDaysFromUt(ut)), ut, observer)
                alt = p.altDeg; az = p.azDeg
            } else {
                val p = planetAltAz(row.planet(), time, observer)
                alt = p.altDeg; az = p.azDeg
            }
            near(alt, row.number("altDeg"), 1.0 / 60, "$row")
            assertTrue(angularDiff(az, row.number("azDeg")) * cos(row.number("altDeg") * DEG2RAD) * 60 < 1, "$row")
        }
    }

    @Test fun photometryMatchesGeometryAndPinnedMagnitudeBranches() {
        var highVenus = 0
        for (element in fixture("planets/illumination").jsonArray) {
            val row = element.obj()
            val p = planetIlluminationAtTT(row.planet(), utDays(row.instant("tt")))
            near(p.fraction, row.number("fraction"), 0.01)
            near(p.elongationDeg, row.number("elongationDeg"), 1.0 / 60)
            near(p.fraction, (1 + cos(p.phaseAngleDeg * DEG2RAD)) / 2, 1e-12)
            assertTrue(p.elongationDeg in 0.0..180.0)
            if (row.planet() == Planet.VENUS && row.number("phaseAngleDeg") >= 163.6) highVenus++
            else near(p.magnitude, row.number("magnitude"), 0.3, "$row")
        }
        assertTrue(highVenus > 5)
        var ringCases = 0
        for (element in fixture("planets/photometry-reference").obj().array("rows")) {
            val row = element.obj()
            val p = planetIlluminationAtTT(row.planet(), utDays(row.instant("tt")))
            near(p.magnitude, row.number("magnitude"), 1e-10)
            near(p.fraction, row.number("fraction"), 1e-10)
            near(p.phaseAngleDeg, row.number("phaseAngleDeg"), 1e-8)
            near(p.elongationDeg, row.number("elongationDeg"), 1e-8)
            if (row.planet() == Planet.SATURN && abs(row.number("ringTiltDeg")) > 10) {
                ringCases++
                assertTrue(p.magnitude < row.number("globeMagnitude") - 0.3)
            }
        }
        assertTrue(ringCases > 0)
    }

    @Test fun earthIsOnlyAllowedHeliocentricallyAndInstantsAreValidated() {
        for (time in listOf(Instant.parse("1950-01-01T00:00:00Z"), Instant.ofEpochMilli(-1234), Instant.parse("2100-12-31T23:59:59.999Z"))) {
            val earth = earthHelioVector(ttDays(time))
            assertEquals(HeliocentricPosition(earth.x, earth.y, earth.z), planetHeliocentricPosition(Planet.EARTH, time))
            for (planet in Planet.entries.filter { it != Planet.EARTH }) {
                assertTrue(planetPosition(planet, time).raDeg.isFinite())
                assertTrue(planetAltAz(planet, time, victoria).altDeg.isFinite())
                assertTrue(planetIllumination(planet, time).magnitude.isFinite())
            }
            assertFailsWith<IllegalArgumentException> { planetPosition(Planet.EARTH, time) }
            assertFailsWith<IllegalArgumentException> { planetAltAz(Planet.EARTH, time, victoria) }
            assertFailsWith<IllegalArgumentException> { planetIllumination(Planet.EARTH, time) }
        }
        for (time in listOf(Instant.MIN, Instant.MAX, Instant.parse("2101-01-01T00:00:00Z"))) {
            assertFailsWith<AlmanacOutOfRangeException> { planetHeliocentricPosition(Planet.EARTH, time) }
            assertFailsWith<AlmanacOutOfRangeException> { planetPosition(Planet.VENUS, time) }
            assertFailsWith<AlmanacOutOfRangeException> { planetAltAz(Planet.VENUS, time, victoria) }
            assertFailsWith<AlmanacOutOfRangeException> { planetIllumination(Planet.VENUS, time) }
        }
        assertFailsWith<IllegalStateException> { planetGeoVectorEqj(Planet.NEPTUNE, Double.NaN) }
        assertFailsWith<IllegalStateException> { planetGeoVectorEqj(Planet.NEPTUNE, 1e12) }
        assertFailsWith<IllegalStateException> { visualMagnitude(Planet.SATURN, 0.0, 1.0, 1.0) }
    }

    @Test fun riseSetMatchesIndependentMinuteHorizonsGrids() {
        for (element in fixture("planets/events").jsonArray) {
            val row = element.obj()
            val found = planetEvents(row.planet(), row.instant("startUtc"), row.instant("endUtc"), row.getValue("observer").obj().observer(), row.number("heightAboveGroundM"))
            val expected = row.array("events").map { it.obj() }
            assertEquals(expected.map { it.string("kind") }, found.map { it.kind.toString() })
            for ((i,event) in found.withIndex()) assertTrue(abs(event.time.toEpochMilli()-expected[i].instant("utc").toEpochMilli()) < 60000, "$row")
            assertTrue(found.zipWithNext().all { it.first.time < it.second.time })
        }
    }

    @Test fun eventWindowsAndHeightShareTheHorizonContract() {
        val start = Instant.parse("2026-03-20T00:00:00Z")
        val end = start.plusSeconds(2*86400)
        val site = Observer(48.4284,-123.3656,100.0)
        for (planet in Planet.entries.filter { it != Planet.EARTH }) {
            val ground = planetEvents(planet,start,end,site)
            val raised = planetEvents(planet,start,end,site,100.0)
            assertEquals(ground,planetEvents(planet,start,end,site,0.0))
            assertTrue(raised.first { it.kind == PlanetEventKind.RISE }.time < ground.first { it.kind == PlanetEventKind.RISE }.time)
            assertTrue(raised.first { it.kind == PlanetEventKind.SET }.time > ground.first { it.kind == PlanetEventKind.SET }.time)
            for (event in raised) {
                val ut = utDays(event.time)
                val p = topoAltAzUnrefracted(planetGeoVectorEqj(planet,ttDaysFromUt(ut)),ut,site)
                near(p.altDeg,horizonDip(site,100.0)-34.0/60,0.005)
            }
            val split = ground.first().time
            assertEquals(ground,planetEvents(planet,start,split,site)+planetEvents(planet,split,end,site))
            assertTrue(planetEvents(planet,start,start,site).isEmpty())
            assertTrue(planetEvents(planet,end,start,site).isEmpty())
            for (height in listOf(Double.NaN,-1.0)) assertFailsWith<IllegalArgumentException> { planetEvents(planet,start,start,site,height) }
            for ((a,b) in listOf(Instant.ofEpochMilli(SUPPORTED_MIN) to Instant.ofEpochMilli(SUPPORTED_MIN).plusSeconds(2*86400),Instant.ofEpochMilli(SUPPORTED_MAX).minusSeconds(2*86400) to Instant.ofEpochMilli(SUPPORTED_MAX)))
                assertTrue(planetEvents(planet,a,b,site).all { it.time >= a && it.time < b })
        }
        assertFailsWith<IllegalArgumentException> { planetEvents(Planet.EARTH,start,start,site) }
        assertFailsWith<AlmanacOutOfRangeException> { planetEvents(Planet.VENUS,Instant.MIN,end,site) }
        assertFailsWith<AlmanacOutOfRangeException> { planetEvents(Planet.VENUS,start,Instant.MAX,site) }
    }

    @Test fun polarSolverFindsBothHalvesOfEveryGrazingPair() {
        for (element in fixture("planets/grazing-cases").jsonArray) {
            val row = element.obj()
            val site = row.getValue("observer").obj().observer()
            val start = row.instant("startUtc")
            val end = row.instant("endUtc")
            fun offset(time: Instant): Double {
                val ut = utDays(time)
                return topoAltAzUnrefracted(planetGeoVectorEqj(row.planet(),ttDaysFromUt(ut)),ut,site).altDeg+34.0/60
            }
            var previous = offset(start)
            var time = start.plusSeconds(60)
            val brute = mutableListOf<Pair<Instant,PlanetEventKind>>()
            while (time <= end) {
                val current = offset(time)
                if ((previous < 0) != (current < 0)) brute.add(time to if (current >= 0) PlanetEventKind.RISE else PlanetEventKind.SET)
                previous = current
                time = time.plusSeconds(60)
            }
            assertEquals(2,brute.size)
            assertTrue(brute[1].first.epochSecond-brute[0].first.epochSecond < 30*60)
            val found = planetEvents(row.planet(),start,end,site)
            assertEquals(brute.map { it.second },found.map { it.kind })
            for ((i,event) in found.withIndex()) assertTrue(abs(event.time.toEpochMilli()-brute[i].first.toEpochMilli()) < 60000)
            assertTrue(planetEvents(row.planet(),start,end,Observer(site.latitudeDeg+0.1,site.longitudeDeg)).isEmpty())
        }
    }

    @Test fun outerPlanetQueriesAndAnnualEventWindowsKeepExistingPerformanceBound() {
        val clock = System.nanoTime()
        var checksum = 0.0
        var count = 0
        for (year in 1950..2100) for (planet in listOf(Planet.URANUS,Planet.NEPTUNE)) {
            for (month in 1..12) {
                val time = Instant.parse("%04d-%02d-01T00:00:00Z".format(year,month))
                checksum += planetHeliocentricPosition(planet,time).xAu + planetPosition(planet,time).raDeg + planetAltAz(planet,time,victoria).altDeg + planetIllumination(planet,time).magnitude
            }
            val start = Instant.parse("$year-01-01T00:00:00Z")
            count += planetEvents(planet,start,start.plusSeconds(2*86400),victoria).size
        }
        assertTrue(checksum.isFinite() && count > 0)
        assertTrue((System.nanoTime()-clock)/1e9 < 10)
        val time = Instant.parse("2026-03-20T00:00:00Z")
        for (planet in listOf(Planet.URANUS,Planet.NEPTUNE))
            assertEquals(listOf("set","rise","set","rise"),planetEvents(planet,time,time.plusSeconds(2*86400),victoria).map { it.kind.toString() })
    }
}
