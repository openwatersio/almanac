import io.openwaters.almanac.*

fun main() {
    check(Observer(48.4284, -123.3656).elevationM == 0.0)
    check(Planet.EARTH.toString() == "earth")
    println("Almanac source consumer passed")
}
