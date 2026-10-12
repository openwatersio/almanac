package io.openwaters.almanac

import kotlin.math.PI
import kotlin.test.*

internal class AnglesTest {
    @Test fun overflowIsRejectedWhileLargeRepresentableConversionsRemainValid() {
        for (value in listOf(Double.MAX_VALUE, -Double.MAX_VALUE)) {
            assertTrue(degreesToRadians(value).isFinite())
            assertTrue(radiansToDegrees(value / 64).isFinite())
            val error = assertFailsWith<IllegalArgumentException> { radiansToDegrees(value) }
            assertFalse(error is AlmanacOutOfRangeException)
        }
    }

    @Test fun signedAnglesDoNotWrapFullTurns() {
        for ((degrees, radians) in listOf(0.0 to 0.0, 90.0 to PI / 2, -180.0 to -PI, 720.0 to 4 * PI)) {
            assertEquals(radians, degreesToRadians(degrees), 1e-14)
            assertEquals(degrees, radiansToDegrees(radians), 1e-12)
        }
        assertEquals((-0.0).toBits(), degreesToRadians(-0.0).toBits())
        assertEquals((-0.0).toBits(), radiansToDegrees(-0.0).toBits())
    }

    @Test fun nonFiniteAnglesAreValidationErrors() {
        for (convert in listOf(::degreesToRadians, ::radiansToDegrees)) {
            for (value in listOf(Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY)) {
                val error = assertFailsWith<IllegalArgumentException> { convert(value) }
                assertFalse(error is AlmanacOutOfRangeException)
            }
        }
    }
}
