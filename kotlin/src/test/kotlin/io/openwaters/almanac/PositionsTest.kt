package io.openwaters.almanac

import java.time.Instant
import java.io.File
import java.util.concurrent.Executors
import kotlin.math.*
import kotlin.test.*
import kotlinx.serialization.json.*

internal class PositionsTest {
    private fun separation(ra: Double, dec: Double, row: JsonObject): Double {
        val d1 = dec * PI / 180
        val d2 = row.number("decDeg") * PI / 180
        return acos((sin(d1) * sin(d2) + cos(d1) * cos(d2) * cos((ra - row.number("raDeg")) * PI / 180)).coerceIn(-1.0, 1.0)) * 180 / PI
    }

    @Test fun positionsMatchHorizonsAcrossSupportedYears() {
        for (body in listOf("sun", "moon")) for (grid in listOf("coarse", "dense")) {
            val rows = fixture("positions/$body-$grid").jsonArray
            assertTrue(rows.isNotEmpty())
            for (element in rows) {
                val row = element.obj()
                val time = row.instant(if (grid == "coarse") "tt" else "utc")
                if (body == "sun") {
                    val pos = if (grid == "coarse") sunApparentAtTT(utDays(time)) else sunPosition(time)
                    assertTrue(separation(pos.raDeg, pos.decDeg, row) <= 1.0 / 60, "sun $time")
                    near(pos.distanceAu, row.number("distanceAu"), 1e-4, "$body $time")
                } else {
                    val pos = if (grid == "coarse") moonApparentAtTT(utDays(time)) else moonPosition(time)
                    assertTrue(separation(pos.raDeg, pos.decDeg, row) <= 1.0 / 60, "moon $time")
                    near(pos.distanceKm, row.number("distanceKm"), 70.0, "$body $time")
                }
            }
        }
    }

    @Test fun positionsValidateAndNormalizeInstants() {
        for (time in listOf(Instant.parse("1949-12-31T23:59:59Z"), Instant.parse("2101-01-01T00:00:00Z"), Instant.MIN, Instant.MAX)) {
            assertFailsWith<AlmanacOutOfRangeException> { sunPosition(time) }
            assertFailsWith<AlmanacOutOfRangeException> { moonPosition(time) }
        }
        val time = Instant.ofEpochMilli(-1)
        assertEquals(sunPosition(time), sunPosition(time.minusNanos(500_000)))
        assertEquals(moonPosition(time), moonPosition(time.minusNanos(500_000)))
    }

    @Test fun framesRoundTripAndRejectZeroDirection() {
        val vector = Vec3(0.3, -0.8, 0.5)
        for (tt in listOf(-18262.0, 0.0, 36525.0)) {
            val actual = gyration(gyration(vector, tt, PrecessDirection.From2000), tt, PrecessDirection.Into2000)
            near(actual.x, vector.x, 1e-15)
            near(actual.y, vector.y, 1e-15)
            near(actual.z, vector.z, 1e-15)
        }
        assertFailsWith<IllegalStateException> { equatorialFromVector(Vec3(0.0, 0.0, 0.0)) }
        assertEquals(90.0, equatorialFromVector(Vec3(0.0, 0.0, 1.0)).decDeg)
        assertEquals(-90.0, equatorialFromVector(Vec3(0.0, 0.0, -1.0)).decDeg)
    }

    @Test fun wrapDeg360StaysBelow360WhenTheRemainderIsAnUlpUnderZero() {
        // 360 - 1e-14 rounds to 360 itself; a plain `+= 360` returns it.
        assertEquals(0.0, wrapDeg360(-1e-14))
        assertEquals(0.0, wrapDeg360(360.0))
        assertEquals(270.0, wrapDeg360(-90.0))
        assertEquals(5.0, wrapDeg360(725.0))
        assertEquals(359.5, wrapDeg360(359.5))
        assertEquals(0.0, equatorialFromVector(Vec3(1.0, -1e-300, 0.0)).raDeg)
    }

    @Test fun unrolledEarthMatchesSourceTableLoopBitForBit() {
        val source = File(File(System.getProperty("fixtures")).parentFile, "typescript/src/sun.ts").readText()
        val table = Json.parseToJsonElement(source.substringAfter("export const vsopEarth: VsopModel = ").substringBefore(';')).jsonArray
        var tt = -73048.0
        while (tt <= 36525.0) {
            val t = tt / 365250
            val coordinates = table.mapIndexed { i, formula ->
                var power = 1.0
                var coord = 0.0
                for (series in formula.jsonArray) {
                    var sum = 0.0
                    for (term in series.jsonArray) {
                        val row = term.jsonArray.map { it.jsonPrimitive.double }
                        sum += row[0] * cos(row[1] + t * row[2])
                    }
                    var increment = power * sum
                    if (i == 0) increment %= PI2
                    coord += increment
                    power *= t
                }
                coord
            }
            val actual = earthHelioVector(tt)
            val expected = vsopRotate(vsopSphereToRect(coordinates[0], coordinates[1], coordinates[2]))
            assertEquals(expected, actual, "tt=$tt")
            tt += 7.3
        }
    }

    @Test fun lightTravelFailsExplicitlyForInvalidInternalModelInputs() {
        assertFailsWith<IllegalStateException> { sunGeoVectorEqj(Double.NaN) }
        assertFailsWith<IllegalStateException> { sunGeoVectorEqj(1e12) }
    }

    @Test fun tiltCacheSupportsConcurrentCallers() {
        val times = listOf(-18262.0, 0.0, 10000.0, 36525.0)
        val expected = times.map { earthTilt(it) }
        val executor = Executors.newFixedThreadPool(4)
        try {
            val jobs = (0..99).map { i -> executor.submit<EarthTilt> { earthTilt(times[i % 4]) } }
            for ((i, job) in jobs.withIndex()) assertEquals(expected[i % 4], job.get())
        } finally {
            executor.shutdownNow()
        }
    }

    @Test fun equationOfTimeMatchesHorizonsAndMeeusSignConvention() {
        val rows = fixture("equation-of-time/horizons-eot").jsonArray
        assertTrue(rows.isNotEmpty())
        for (element in rows) {
            val row = element.obj()
            near(equationOfTime(row.instant("utc")),row.number("minutes"),2.0/60,"$row")
        }
        near(equationOfTimeAtTT(utDays(Instant.parse("1992-10-13T00:00:00Z"))),13+42.6/60,0.05)
        for (time in listOf(Instant.MIN,Instant.MAX,Instant.ofEpochMilli(SUPPORTED_MIN-1),Instant.ofEpochMilli(SUPPORTED_MAX)))
            assertFailsWith<AlmanacOutOfRangeException> { equationOfTime(time) }
    }

    // USNO's celestial-navigation GHA and declination for the navigational stars, from each star's SIMBAD J2000
    // position. The places include proper motion and starPosition does not, so the test first moves each star along its
    // catalog proper motion to the date, linearly, keeping the J2000 equinox. Every row is then held to 1″ on the sky;
    // annual aberration alone is up to 20.5″.
    @Test fun starsUsnoGhaAndDeclinationWithinOneArcsecond() {
        val rows = fixture("positions/stars-usno").jsonArray
        assertTrue(rows.size > 100)
        val j2000 = Instant.parse("2000-01-01T12:00:00Z").toEpochMilli()
        for (element in rows) {
            val row = element.obj()
            val t = row.instant("utc")
            val years = (t.toEpochMilli() - j2000) / (365.25 * 86400000)
            val decDeg = row.number("decDeg") + row.number("pmDecMasPerYear") * years / 3.6e6
            val raDeg = (row.number("raDeg") + row.number("pmRaMasPerYear") * years / 3.6e6 / cos(row.number("decDeg") * PI / 180) + 360) % 360
            val p = starPosition(raDeg, decDeg, t)
            val gha = greenwichSiderealTime(t) - p.raDeg
            val dGha = ((((gha - row.number("ghaDeg")) % 360) + 540) % 360) - 180
            val label = "${row.string("star")} @ ${row.string("utc")}"
            assertTrue(abs(dGha) * cos(p.decDeg * PI / 180) * 3600 < 1, "$label GHA: $dGha deg")
            assertTrue(abs(p.decDeg - row.number("decOfDateDeg")) * 3600 < 1, "$label dec: ${p.decDeg} vs ${row.number("decOfDateDeg")}")
        }
    }

    @Test fun starPositionReturnsRightAscensionInRange() {
        val t = Instant.parse("2026-03-20T06:00:00Z")
        for (ra in listOf(0.0, 0.001, 359.999)) {
            val p = starPosition(ra, 0.0, t)
            assertTrue(p.raDeg >= 0 && p.raDeg < 360, "$ra -> ${p.raDeg}")
        }
    }

    @Test fun starPositionRejectsOffSphereCatalogAndOutOfRangeTime() {
        val t = Instant.parse("2026-03-20T06:00:00Z")
        assertFailsWith<IllegalArgumentException> { starPosition(360.0, 0.0, t) }
        assertFailsWith<IllegalArgumentException> { starPosition(-1.0, 0.0, t) }
        assertFailsWith<IllegalArgumentException> { starPosition(0.0, -90.5, t) }
        assertFailsWith<IllegalArgumentException> { starPosition(0.0, Double.NaN, t) }
        for (bad in listOf(Instant.parse("2101-01-01T00:00:00Z"), Instant.MIN, Instant.MAX))
            assertFailsWith<AlmanacOutOfRangeException> { starPosition(0.0, 0.0, bad) }
        val time = Instant.ofEpochMilli(-1)
        assertEquals(starPosition(10.0, 20.0, time), starPosition(10.0, 20.0, time.minusNanos(500_000)))
    }

    @Test fun earthHelioStateVelocityIsTheDerivativeOfEarthHelioVector() {
        val h = 0.01 // days
        for (tt in listOf(-18262.0, 0.0, 9573.25, 36524.0)) {
            val state = earthHelioState(tt)
            assertSame(state, earthHelioState(tt), "cache hit on the exact instant")
            val a = earthHelioVector(tt - h); val b = earthHelioVector(tt + h)
            assertEquals(earthHelioVector(tt), state.pos)
            near(state.vel.x, (b.x - a.x) / (2 * h), 1e-9, "x tt=$tt") // AU per day; orbital speed is ~0.0172
            near(state.vel.y, (b.y - a.y) / (2 * h), 1e-9, "y tt=$tt")
            near(state.vel.z, (b.z - a.z) / (2 * h), 1e-9, "z tt=$tt")
        }
    }
}
