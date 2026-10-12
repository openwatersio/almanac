package io.openwaters.almanac

import kotlin.test.*
import kotlinx.serialization.json.*

internal class HorizonTest {
    @Test fun dipMatchesPinnedUpstreamAtEveryLatitudeAndHeight() {
        val rows = fixture("horizon/dip").jsonArray
        assertEquals(25, rows.size)
        for (element in rows) {
            val row = element.obj()
            near(horizonDip(row.getValue("observer").obj().observer(), row.number("heightAboveGroundM")), row.number("dipDeg"), 1e-10)
        }
    }

    @Test fun eyeHeightAndGroundElevationAreValidated() {
        val sea = Observer(48.4284, -123.3656, 2.0)
        assertEquals(0.0.toBits(), horizonDip(sea, 0.0).toBits())
        assertTrue(horizonDip(Observer(48.4284, -123.3656, 10.0), 10.0) < horizonDip(sea, 2.0))
        for (height in listOf(Double.NaN, Double.POSITIVE_INFINITY, -1.0, 10001.0))
            assertFailsWith<IllegalArgumentException> { horizonDip(sea, height) }
        assertFailsWith<IllegalArgumentException> { horizonDip(Observer(0.0, 0.0, -499.0), 2.0) }
        assertTrue(horizonDip(Observer(0.0, 0.0, -499.0), 1.0) < 0)
    }
}
