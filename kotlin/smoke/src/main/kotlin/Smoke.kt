import io.openwaters.almanac.*
import java.time.Instant

fun main() {
    check(Observer(48.4284, -123.3656).elevationM == 0.0)
    check(Planet.EARTH.toString() == "earth")
    val time = Instant.parse("2026-03-20T12:00:00Z")
    check(sunPosition(time).distanceAu > 0.9)
    check(moonPosition(time).distanceKm > 300_000)
    val observer = Observer(48.4284, -123.3656, 2.0)
    check(sunAltAz(time, observer).altDeg.isFinite())
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
    check(equationOfTime(time).isFinite())
    println("Almanac source consumer passed")
}
