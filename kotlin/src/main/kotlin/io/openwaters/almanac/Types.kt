package io.openwaters.almanac

import java.time.Instant

public data class Observer(public val latitudeDeg: Double, public val longitudeDeg: Double, public val elevationM: Double = 0.0) {
    init {
        require(latitudeDeg.isFinite() && latitudeDeg in -90.0..90.0) { "latitudeDeg out of range: $latitudeDeg" }
        require(longitudeDeg.isFinite() && longitudeDeg in -180.0..180.0) { "longitudeDeg out of range: $longitudeDeg" }
        require(elevationM.isFinite() && elevationM in -500.0..10000.0) { "elevationM out of range: $elevationM" }
    }
}

public enum class Planet(private val rawValue: String) {
    MERCURY("mercury"), VENUS("venus"), EARTH("earth"), MARS("mars"), JUPITER("jupiter"), SATURN("saturn"), URANUS("uranus"), NEPTUNE("neptune");
    override fun toString(): String = rawValue
}

public class AlmanacOutOfRangeException(message: String = "time outside supported interval 1950-01-01T00:00Z ≤ t < 2101-01-01T00:00Z") : IllegalArgumentException(message)

internal val SUPPORTED_MIN: Long = Instant.parse("1950-01-01T00:00:00Z").toEpochMilli()
internal val SUPPORTED_MAX: Long = Instant.parse("2101-01-01T00:00:00Z").toEpochMilli()

internal fun assertPlanet(planet: Planet, earthAllowed: Boolean = false) {
    require(earthAllowed || planet != Planet.EARTH) { "Earth has no Earth-based planetary direction" }
}

internal fun normalized(time: Instant): Instant {
    val ms = try {
        val floorMs = Math.addExact(Math.multiplyExact(time.epochSecond, 1000L), time.nano / 1000000L)
        // Instant floors negative milliseconds; TimeClip truncates toward zero.
        if (time.epochSecond < 0 && time.nano % 1000000 != 0) floorMs + 1 else floorMs
    } catch (_: ArithmeticException) {
        throw AlmanacOutOfRangeException()
    }
    return Instant.ofEpochMilli(ms)
}

internal fun assertSupported(time: Instant) {
    val ms = normalized(time).toEpochMilli()
    if (ms < SUPPORTED_MIN || ms >= SUPPORTED_MAX) throw AlmanacOutOfRangeException()
}

internal fun assertSupportedWindowEnd(time: Instant) {
    val ms = normalized(time).toEpochMilli()
    if (ms < SUPPORTED_MIN || ms > SUPPORTED_MAX) throw AlmanacOutOfRangeException()
}
