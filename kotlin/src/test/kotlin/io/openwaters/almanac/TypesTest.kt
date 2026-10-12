package io.openwaters.almanac

import java.time.Instant
import kotlin.test.*

class TypesTest {
    @Test fun validatesObserver() {
        assertEquals(0.0, Observer(0.0, 0.0).elevationM)
        Observer(-90.0, -180.0, -500.0)
        Observer(90.0, 180.0, 10000.0)
        for (n in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
            assertFailsWith<IllegalArgumentException> { Observer(n, 0.0) }
            assertFailsWith<IllegalArgumentException> { Observer(0.0, n) }
            assertFailsWith<IllegalArgumentException> { Observer(0.0, 0.0, n) }
        }
        assertFailsWith<IllegalArgumentException> { Observer(90.1, 0.0) }
        assertFailsWith<IllegalArgumentException> { Observer(0.0, -180.1) }
        assertFailsWith<IllegalArgumentException> { Observer(0.0, 0.0, 10000.1) }
    }

    @Test fun validatesTimeBoundsAfterTimeClip() {
        val min = Instant.parse("1950-01-01T00:00:00Z")
        val max = Instant.parse("2101-01-01T00:00:00Z")
        assertSupported(normalized(min.minusNanos(1)))
        assertSupported(max.minusMillis(1))
        assertSupportedWindowEnd(max)
        for (t in listOf(min.minusMillis(1), max, Instant.MIN, Instant.MAX))
            assertFailsWith<AlmanacOutOfRangeException> { assertSupported(t) }
        assertFailsWith<AlmanacOutOfRangeException> { assertSupportedWindowEnd(max.plusMillis(1)) }
        for (planet in Planet.values()) {
            assertPlanet(planet, true)
            if (planet == Planet.EARTH) assertFailsWith<IllegalArgumentException> { assertPlanet(planet) }
            else assertPlanet(planet)
        }
    }
}
