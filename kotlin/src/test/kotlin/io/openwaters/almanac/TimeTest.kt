package io.openwaters.almanac

import java.time.Instant
import kotlin.test.*

class TimeTest {
    @Test fun deltaTPiecewiseMatchesLeadingPort() {
        val rows = listOf(-600.0 to 18720.48, -200.0 to 12792.159792390397, 800.0 to 2955.6915844032005,
            1650.0 to 50.194015991022596, 1750.0 to 13.370070272572404, 1825.0 to 9.997221484375004,
            1880.0 to -5.00848698849785, 1910.0 to 10.388399999999999, 1930.0 to 24.1329,
            1955.0 to 31.04678120855808, 1970.0 to 40.19294086136705, 2000.0 to 63.86,
            2025.0 to 74.467375, 2075.0 to 145.86999999999998, 2200.0 to 442.08)
        for ((year, expected) in rows) assertEquals(expected, deltaTSeconds(year), 1e-10)
    }
    @Test fun timeClipTruncatesTowardZero() {
        assertEquals(Instant.EPOCH, normalized(Instant.ofEpochSecond(-1, 999500000)))
        assertEquals(Instant.ofEpochMilli(-1), normalized(Instant.ofEpochSecond(-1, 998500000)))
        assertEquals(Instant.ofEpochMilli(1), normalized(Instant.ofEpochSecond(0, 1500000)))
        assertEquals(Instant.parse("1950-01-01T00:00:00Z"), normalized(Instant.parse("1950-01-01T00:00:00Z").minusNanos(1)))
    }
    @Test fun j2000AndUtTtRoundTrip() {
        val epoch = Instant.parse("2000-01-01T12:00:00Z")
        assertEquals(0.0, utDays(epoch))
        assertEquals(2451545.0, julianDay(epoch))
        assertEquals(63.86, deltaTSeconds(2000.0), 1e-12)
        assertEquals(63.86 / 86400.0, ttDays(epoch), 1e-12)
        for (t in listOf("1950-01-01T00:00:00Z", "2026-03-20T12:00:00Z", "2100-12-31T23:59:59Z")) {
            val d = Instant.parse(t)
            assertEquals(d, dateFromUt(utDays(d)))
        }
    }
}
