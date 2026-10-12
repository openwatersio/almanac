import io.openwaters.almanac.*
import java.time.Instant

fun main() {
    check(Observer(48.4284, -123.3656).elevationM == 0.0)
    check(Planet.EARTH.toString() == "earth")
    val time = Instant.parse("2026-03-20T12:00:00Z")
    check(sunPosition(time).distanceAu > 0.9)
    check(moonPosition(time).distanceKm > 300_000)
    println("Almanac source consumer passed")
}
