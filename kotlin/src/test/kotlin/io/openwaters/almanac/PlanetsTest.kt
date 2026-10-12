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
}
