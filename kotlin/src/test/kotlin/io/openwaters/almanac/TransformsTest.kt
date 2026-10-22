package io.openwaters.almanac

import java.time.Instant
import kotlin.math.*
import kotlin.test.*
import kotlinx.serialization.json.*

internal class TransformsTest {
    private val victoria = Observer(48.4284, -123.3656)

    @Test fun horizontalPositionsMatchPhysicalOracles() {
        for (body in listOf("sun", "moon", "stars")) {
            val file = if (body == "stars") "altaz/stars-usno" else "altaz/$body-victoria-2026-03"
            val rows = fixture(file).jsonArray
            assertTrue(rows.size > 100)
            for (element in rows) {
                val row = element.obj()
                if (row.number("altDeg") <= 10) continue
                val actual = when (body) {
                    "sun" -> sunAltAz(row.instant("utc"), victoria)
                    "moon" -> moonAltAz(row.instant("utc"), victoria)
                    else -> starAltAz(row.number("raDeg"), row.number("decDeg"), row.instant("utc"), row.observer())
                }
                near(actual.altDeg, row.number("altDeg"), 1.0 / 60, "$body $row")
                assertTrue(angularDiff(actual.azDeg, row.number("azDeg")) * cos(row.number("altDeg") * PI / 180) * 60 < 1, "$body $row")
            }
        }
    }

    @Test fun catalogCoordinatesAndTimeAreValidated() {
        val time = Instant.parse("2026-03-20T06:00:00Z")
        for (ra in listOf(-1.0, 360.0, Double.NaN, Double.POSITIVE_INFINITY))
            assertFailsWith<IllegalArgumentException> { starAltAz(ra, 0.0, time, victoria) }
        for (dec in listOf(-91.0, 90.5, Double.NaN, Double.NEGATIVE_INFINITY))
            assertFailsWith<IllegalArgumentException> { starAltAz(0.0, dec, time, victoria) }
        for (bad in listOf(Instant.MIN, Instant.MAX, Instant.parse("2101-01-01T00:00:00Z"))) {
            assertFailsWith<AlmanacOutOfRangeException> { sunAltAz(bad, victoria) }
            assertFailsWith<AlmanacOutOfRangeException> { moonAltAz(bad, victoria) }
            assertFailsWith<AlmanacOutOfRangeException> { starAltAz(0.0, 0.0, bad, victoria) }
        }
    }

    @Test fun siderealAndRefractionRespectTheirPhysicalLimits() {
        assertEquals(0.0,horizontalAzimuth(0.0,0.0))
        assertEquals(90.0,horizontalAzimuth(0.0,-1.0))
        assertEquals(270.0,horizontalAzimuth(0.0,1.0))
        near(siderealDeg(0.0), 280.4606, 0.01)
        assertTrue(refractionDeg(0.0) * 60 > 28)
        assertEquals(0.0, refractionDeg(-91.0))
        assertEquals(0.0, refractionDeg(91.0))
        assertEquals(0.0, refractionDeg(-90.0))
        for (alt in -90..90) assertTrue(alt + refractionDeg(alt.toDouble()) >= -90)
    }

    @Test fun greenwichSiderealTimeIsTheSiderealTimeTheTransformsUse() {
        assertEquals(siderealDeg(0.0), greenwichSiderealTime(Instant.parse("2000-01-01T12:00:00Z")))
        for (bad in listOf(Instant.parse("1949-12-31T00:00:00Z"), Instant.MIN, Instant.MAX))
            assertFailsWith<AlmanacOutOfRangeException> { greenwichSiderealTime(bad) }
        val time = Instant.ofEpochMilli(-1)
        assertEquals(greenwichSiderealTime(time), greenwichSiderealTime(time.minusNanos(500_000)))
    }
}
