import io.openwaters.almanac.*
import java.time.Instant

fun main() {
    check(degreesToRadians(180.0) == kotlin.math.PI)
    check(radiansToDegrees(kotlin.math.PI) == 180.0)
    check(Observer(48.4284, -123.3656).elevationM == 0.0)
    check(Planet.EARTH.toString() == "earth")
    val time = Instant.parse("2026-03-20T12:00:00Z")
    check(sunPosition(time).distanceAu > 0.9)
    check(moonPosition(time).distanceKm > 300_000)
    val observer = Observer(48.4284, -123.3656, 2.0)
    check(sunAltAz(time, observer).altDeg.isFinite())
    check(sunIsUp(Instant.parse("2024-06-21T12:00:00Z"), Observer(0.0, 0.0)))
    check(!sunIsUp(Instant.parse("2024-06-21T00:00:00Z"), Observer(0.0, 0.0, 2.0), 2.0))
    check(moonAltAz(time, observer).azDeg.isFinite())
    check(starAltAz(88.792939, 7.407064, time, observer).altDeg.isFinite())
    check(horizonDip(observer, 2.0) < 0)
    check(moonIllumination(time).phase in 0.0..1.0)
    check(moonOrientation(time, observer).brightLimbAngleDeg >= 0)
    for (planet in Planet.entries) {
        check(planetHeliocentricPosition(planet, time).xAu.isFinite())
        if (planet == Planet.EARTH) continue
        check(planetPosition(planet, time).distanceAu > 0)
        check(planetAltAz(planet, time, observer).azDeg.isFinite())
        check(planetIllumination(planet, time).magnitude.isFinite())
        check(planetEvents(planet, time, time.plusSeconds(2*86400), observer).isNotEmpty())
    }
    val end = time.plusSeconds(31*86400)
    check(sunEvents(time, end, observer).isNotEmpty())
    check(moonEvents(time, end, observer).isNotEmpty())
    check(sunAltitudeEvents(time, end, observer, 6.0).isNotEmpty())
    check(sunTransits(time, end, observer).isNotEmpty())
    check(moonTransits(time, end, observer).isNotEmpty())
    check(searchMoonPhases(time, end).isNotEmpty())
    check(seasons(time, end).isNotEmpty())
    check(moonApsides(time, end).isNotEmpty())
    check(earthApsides(time, time.plusSeconds(366*86400L)).isNotEmpty())
    check(equationOfTime(time).isFinite())
    val lunar = nextLunarEclipse(time)
    check(previousLunarEclipse(lunar.peak.plusMillis(101)).kind == lunar.kind)
    check(lunarEclipses(lunar.peak, lunar.peak.plusMillis(1)).single() == lunar)
    check(lunarEclipseVisibility(lunar, observer).moonGeometricAltAtPeakDeg.isFinite())
    val solar = nextSolarEclipse(time, observer)
    check(previousSolarEclipse(solar.peak.plusMillis(101), observer) == solar)
    check(solarEclipses(solar.peak, solar.peak.plusMillis(1), observer).single() == solar)
    check(solarObscuration(solar.peak, observer) > 0)
    val global = nextGlobalSolarEclipse(time)
    check(previousGlobalSolarEclipse(global.peak.plusMillis(101)) == global)
    check(globalSolarEclipses(global.peak, global.peak.plusMillis(1)).single() == global)
    check(solarEclipseAxisPoint(global.peak) != null)
    check(solarEclipseCentralLine(global.peak).isNotEmpty())
    val publicModels: List<Any> = listOf(
        SunPosition(0.0, 0.0, 1.0), MoonPosition(0.0, 0.0, 384400.0), AltAz(0.0, 0.0),
        HeliocentricPosition(1.0, 0.0, 0.0), PlanetPosition(0.0, 0.0, 1.0),
        PlanetIllumination(1.0, 0.0, 0.0, 90.0), MoonIllumination(.5, 90.0, .25, true), MoonOrientation(0.0, 0.0),
        SunEvent(time, SunEventKind.RISE), MoonEvent(time, MoonEventKind.SET), PlanetEvent(time, PlanetEventKind.RISE),
        AltitudeEvent(time, AltitudeEventKind.RISING), TransitEvent(time, TransitEventKind.UPPER), MoonPhaseEvent(time, MoonPhaseName.NEW),
        SeasonEvent(time, SeasonKind.MARCH_EQUINOX), MoonApsis(time, MoonApsisKind.PERIGEE, 384400.0), EarthApsis(time, EarthApsisKind.PERIHELION, 147100000.0),
        LunarEclipse(lunar.kind, lunar.peak, lunar.magUmbral, lunar.magPenumbral, lunar.p1, lunar.u1, lunar.u2, lunar.u3, lunar.u4, lunar.p4),
        LunarEclipseContactsVisible(true, null, null, null, null, false),
        LunarEclipseVisibility(true, 10.0, LunarEclipseContactsVisible(true, null, null, null, null, false)),
        SolarEclipseSunAltitudes(0.0, null, 10.0, null, 0.0),
        SolarEclipse(solar.kind, solar.obscuration, solar.c1, solar.c2, solar.peak, solar.c3, solar.c4, solar.sunAltDeg),
        GlobalSolarEclipse(global.kind, global.peak, global.axisDistanceKm, global.latitudeDeg, global.longitudeDeg, global.obscuration, global.greatestLatitudeDeg, global.greatestLongitudeDeg, global.greatestObscuration),
        SolarEclipseAxisPoint(time, 0.0, 0.0, SolarEclipseAxisKind.TOTAL, 1.0), AlmanacOutOfRangeException()
    )
    check(publicModels.size == 25)
    for (kinds in listOf(SunEventKind.entries, MoonEventKind.entries, PlanetEventKind.entries, AltitudeEventKind.entries, TransitEventKind.entries, MoonPhaseName.entries, SeasonKind.entries, MoonApsisKind.entries, EarthApsisKind.entries, LunarEclipseKind.entries, SolarEclipseKind.entries, SolarEclipseAxisKind.entries)) check(kinds.all { it.toString().first().isLowerCase() })
    println("Almanac source consumer passed")
}
