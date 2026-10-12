package io.openwaters.almanac

import java.time.Instant
import kotlin.math.*
import kotlin.test.*

internal class SearchEdgesTest {
    @Test fun eclipseExhaustionDistinguishesSupportedBoundaryFromModelFailure() {
        val anchor = Instant.parse("2026-01-01T00:00:00Z")
        assertFailsWith<AlmanacOutOfRangeException> { throw lunarSearchFailure(anchor,0L,SUPPORTED_MAX,1) }
        assertFailsWith<AlmanacOutOfRangeException> { throw lunarSearchFailure(anchor,SUPPORTED_MIN,0L,-1) }
        assertFailsWith<IllegalStateException> { throw lunarSearchFailure(anchor,anchor.toEpochMilli(),anchor.plusSeconds(730*86400L).toEpochMilli(),1) }
    }
    @Test fun quadraticInterpolationRejectsAbsentAmbiguousAndOutsideRoots() {
        assertNull(quadInterp(0.0,1.0,1.0,1.0,1.0))
        assertNull(quadInterp(0.0,1.0,1.0,2.0,3.0))
        assertNull(quadInterp(0.0,1.0,2.0,1.0,2.0))
        assertNull(quadInterp(0.0,1.0,.75,-.25,.75))
        assertNull(quadInterp(0.0,1.0,9.0,4.0,1.0))
        val descending = assertNotNull(quadInterp(0.0,1.0,3.0,0.0,-1.0))
        near(descending.t,0.0,0.0)
        assertTrue(descending.dfdt < 0)
    }
    @Test fun extremumAndCrossingFallbacksRemainBounded() {
        val invalid: Sampler = { Sample(it,Double.NaN,0.0,0.0) }
        assertNull(brentExtremum(invalid,0.0,Double.NaN,true))
        assertFailsWith<IllegalStateException> { solveCrossing(invalid,0.0,Sample(0.0,-1.0,0.0,0.0),Sample(Double.NaN,1.0,0.0,0.0)) }
        for (slope in listOf(1.0,10.0,100.0,1000.0,10000.0)) {
            val sample: Sampler = { Sample(it,tanh(slope*(it-.313333333)),0.0,0.0) }
            val root = solveCrossing(sample,0.0,sample(0.0),sample(1.0))
            near(root,.313333333,1.0/86400,"steep crossing")
        }
        for (frequency in 1..60) {
            secantCrossing({ sin(frequency*it)-.2 },0.0,1.0,Sample(0.0,-1.0,0.0,0.0),Sample(1.0,1.0,0.0,0.0),0.0)
        }
        assertNull(secantCrossing({ Double.NaN },0.0,1.0,Sample(0.0,-1.0,0.0,0.0),Sample(1.0,1.0,0.0,0.0),0.0))
    }
    @Test fun poleAndAxisResidualValidation() {
        val shadow = calcShadow(1737.4,0.0,Vec3(.01,0.0,0.0),Vec3(1.0,0.0,0.0))
        assertEquals(90.0,geodeticPlace(shadow,ttDaysFromUt(0.0),0.0,0.0,1.0).latitudeDeg)
        assertEquals(-90.0,geodeticPlace(shadow,ttDaysFromUt(0.0),0.0,0.0,-1.0).latitudeDeg)
        assertFailsWith<IllegalStateException> { axisGround(shadow,DilatedAxis(ttDaysFromUt(0.0),Vec3(1.0,1.0,1.0),Vec3(0.0,0.0,0.0),3.0,0.0,0.0),1.0) }
    }
}
