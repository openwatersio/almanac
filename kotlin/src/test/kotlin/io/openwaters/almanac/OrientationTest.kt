package io.openwaters.almanac

import java.time.Instant
import kotlin.math.*
import kotlin.test.*
import kotlinx.serialization.json.*

internal class OrientationTest {
    @Test fun lunarDiscAnglesMatchHorizons() {
        val rows = fixture("altaz/moon-orientation").jsonArray
        assertTrue(rows.isNotEmpty())
        for (element in rows) {
            val row = element.obj()
            val actual = moonOrientation(row.instant("utc"), row.getValue("observer").obj().observer())
            val limit = 1 + (8.794 / 60) / sin(row.number("elongationDeg") * PI / 180)
            assertTrue(angularDiff(actual.brightLimbAngleDeg, row.number("brightLimbDeg")) * 60 < limit, "$row")
            assertTrue(angularDiff(actual.parallacticAngleDeg, row.number("parallacticDeg")) * 60 < 1, "$row")
        }
    }

    @Test fun parallacticAngleMatchesIndependentPolarTriangle() {
        for (lat in listOf(-89.5, -60.0, -35.0, 0.0, 20.0, 48.4284, 70.5, 89.5)) {
            val observer = Observer(lat, 31.3)
            val phi = lat * PI / 180
            var time = Instant.parse("2026-03-01T00:00:00Z")
            while (time < Instant.parse("2026-04-01T00:00:00Z")) {
                val ut = utDays(time)
                val pos = topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer)
                val a = pos.azDeg * PI / 180
                val h = pos.altDeg * PI / 180
                val sinDec = sin(phi) * sin(h) + cos(phi) * cos(h) * cos(a)
                val q = atan2(-sin(a) * cos(phi) * cos(h), sin(phi) - sinDec * sin(h)) * 180 / PI
                near(angularDiff(moonOrientation(time, observer).parallacticAngleDeg, q), 0.0, 1e-6, "lat=$lat $time")
                time = time.plusSeconds(3 * 3600)
            }
        }
    }

    @Test fun anglesStayInDocumentedRangesAndValidateTime() {
        var time = Instant.parse("2026-01-01T00:00:00Z")
        while (time < Instant.parse("2027-01-01T00:00:00Z")) {
            val pos = moonOrientation(time, Observer(-35.0, 150.0))
            assertTrue(pos.brightLimbAngleDeg >= 0 && pos.brightLimbAngleDeg < 360)
            assertTrue(pos.parallacticAngleDeg > -180 && pos.parallacticAngleDeg <= 180)
            time = time.plusSeconds(7 * 3600)
        }
        assertFailsWith<AlmanacOutOfRangeException> { moonOrientation(Instant.MAX, Observer(0.0, 0.0)) }
    }
}
