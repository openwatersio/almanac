package io.openwaters.almanac

import java.time.Instant
import kotlin.math.abs
import kotlin.math.cos
import kotlin.test.*

private fun briefingPositions(time: Instant, observer: Observer): Triple<AltAz, AltAz, AltAz> =
    Triple(sunAltAz(time, observer), moonAltAz(time, observer), planetAltAz(Planet.VENUS, time, observer))

private fun briefingMoon(time: Instant): Pair<Double, Double> {
    val illumination = moonIllumination(time)
    return illumination.phase * 360 to illumination.fraction
}

private fun passageCrossings(start: Instant, end: Instant, observer: Observer): Triple<List<SunEvent>, List<MoonEvent>, List<MoonPhaseEvent>> =
    Triple(sunEvents(start, end, observer), moonEvents(start, end, observer), searchMoonPhases(start, end))

private fun visibleLunarEclipses(start: Instant, end: Instant, observer: Observer): List<LunarEclipse> =
    lunarEclipses(start, end).filter { lunarEclipseVisibility(it, observer).visibleAtPeak }

// A milliarcsecond, in degrees: the ports agree with upstream's star path far below it.
private const val STAR_REFERENCE_TOL_DEG = 0.001 / 3600

private fun wrap180(d: Double): Double = ((d % 360) + 540) % 360 - 180

internal class AstronomyEngineMigrationTest {
    @Test fun starPlacesAndSiderealTimeMatchAstronomyEngineReferences() {
        val refs = fixture("../typescript/test/migration-references").obj().array("astronomyEngineStars")
        assertTrue(refs.isNotEmpty())
        for (element in refs) {
            val ref = element.obj()
            val time = ref.instant("time")
            val place = starPosition(ref.number("raDeg"), ref.number("decDeg"), time)
            val apparentDec = ref.number("apparentDecDeg")
            assertTrue(abs(wrap180(place.raDeg - ref.number("apparentRaDeg"))) * cos(Math.toRadians(apparentDec)) < STAR_REFERENCE_TOL_DEG, "RA @ $time")
            assertTrue(abs(place.decDeg - apparentDec) < STAR_REFERENCE_TOL_DEG, "dec @ $time")
            assertTrue(abs(wrap180(greenwichSiderealTime(time) - ref.number("siderealDeg"))) < STAR_REFERENCE_TOL_DEG, "GAST @ $time")
        }
    }

    @Test fun positionsAndMoonStateMatchAstronomyEngineReferences() {
        for (element in fixture("../typescript/test/migration-references").obj().array("astronomyEngine")) {
            val ref = element.obj()
            val time = ref.instant("time")
            val positions = briefingPositions(time, Observer(ref.number("latitudeDeg"), ref.number("longitudeDeg")))
            for ((body, actual) in listOf("sun" to positions.first, "moon" to positions.second, "venus" to positions.third)) {
                val expected = ref.getValue(body).obj()
                near(actual.altDeg, expected.number("altDeg"), 1.0 / 60)
                near(actual.azDeg, expected.number("azDeg"), 1.0 / 60)
            }
            val state = briefingMoon(time)
            near(state.first, ref.number("phaseDeg"), 1.0 / 60)
            near(state.second, ref.number("fraction"), 1e-6)
        }
    }

    @Test fun passageCrossingsAndPhasesStayInsideTheWindow() {
        val start = Instant.parse("2026-08-10T00:00:00Z")
        val end = Instant.parse("2026-08-14T00:00:00Z")
        val (sun, moon, phases) = passageCrossings(start, end, Observer(48.4284, -123.3656))
        assertEquals(4, sun.count { it.kind == SunEventKind.RISE })
        assertTrue(moon.any { it.kind == MoonEventKind.SET })
        assertEquals(MoonPhaseName.NEW, phases.single().phase)
        assertTrue(phases.single().time.toString().startsWith("2026-08-12T17:36:"))
        for (time in sun.map { it.time } + moon.map { it.time } + phases.map { it.time }) assertTrue(time >= start && time < end)
    }

    @Test fun lunarVisibilityDependsOnTheObserver() {
        val start = Instant.parse("2026-03-01T00:00:00Z")
        val end = Instant.parse("2026-03-05T00:00:00Z")
        val eclipse = visibleLunarEclipses(start, end, Observer(20.0, -160.0)).single()
        assertEquals(LunarEclipseKind.TOTAL, eclipse.kind)
        assertTrue(eclipse.peak.toString().startsWith("2026-03-03T11:33:"))
        assertTrue(visibleLunarEclipses(start, end, Observer(20.0, 60.0)).isEmpty())
    }
}
