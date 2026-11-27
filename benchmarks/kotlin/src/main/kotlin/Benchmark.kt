import io.openwaters.almanac.*
import java.io.File
import java.time.Instant
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.max
import kotlinx.serialization.json.*

private fun JsonObject.string(key: String) = getValue(key).jsonPrimitive.content
private fun JsonObject.number(key: String) = get(key)?.jsonPrimitive?.double

private fun workload(spec: JsonObject, observer: Observer): () -> Double {
    val from = Instant.parse(spec.string("from"))
    val to = spec["to"]?.let { Instant.parse(it.jsonPrimitive.content) } ?: from
    val count = spec["count"]?.jsonPrimitive?.int ?: 1
    val operation = spec.string("operation")
    val times = if (operation == "starCatalog") emptyList() else List(count) { from.plusSeconds(it * 3600L) }
    val planets = listOf(Planet.MERCURY, Planet.VENUS, Planet.MARS, Planet.JUPITER, Planet.SATURN)

    return when (operation) {
        "sunPosition" -> ({ times.sumOf { sunPosition(it).raDeg } })
        "moonPosition" -> ({ times.sumOf { moonPosition(it).raDeg } })
        "sky" -> ({ times.fold(0.0) { sum, t ->
            sum + sunAltAz(t, observer).altDeg + moonAltAz(t, observer).altDeg + moonIllumination(t).fraction
        } })
        "planetSky" -> ({ times.fold(0.0) { sum, t ->
            sum + planets.fold(0.0) { inner, planet ->
                val illumination = planetIllumination(planet, t)
                inner + planetAltAz(planet, t, observer).altDeg + illumination.fraction +
                    illumination.magnitude + illumination.elongationDeg
            }
        } })
        "planetEvents" -> ({ planets.sumOf { planetEvents(it, from, to, observer).size }.toDouble() })
        "sunAltitudeEvents" -> {
            val altitude = checkNotNull(spec.number("altitudeDeg"))
            ({ sunAltitudeEvents(from, to, observer, altitude).size.toDouble() })
        }
        "sunTransits" -> ({ sunTransits(from, to, observer).size.toDouble() })
        "moonTransits" -> ({ moonTransits(from, to, observer).size.toDouble() })
        "moonOrientation" -> ({ times.fold(0.0) { sum, t ->
            val orientation = moonOrientation(t, observer)
            sum + orientation.brightLimbAngleDeg + orientation.parallacticAngleDeg
        } })
        "seasons" -> ({ seasons(from, to).size.toDouble() })
        "moonApsides" -> ({ moonApsides(from, to).size.toDouble() })
        "equationOfTime" -> ({ times.sumOf(::equationOfTime) })
        "starTrack" -> {
            val ra = checkNotNull(spec.number("raDeg"))
            val dec = checkNotNull(spec.number("decDeg"))
            ({ times.sumOf { starAltAz(ra, dec, it, observer).altDeg } })
        }
        "starCatalog" -> {
            val stars = List(count) { i ->
                (i * 137.50776405003785) % 360 to (asin(1 - 2 * (i + 0.5) / count) * 180 / Math.PI)
            }
            ({ stars.sumOf { (ra, dec) -> starAltAz(ra, dec, from, observer).altDeg } })
        }
        "sunEvents" -> ({ sunEvents(from, to, observer).size.toDouble() })
        "moonEvents" -> ({ moonEvents(from, to, observer).size.toDouble() })
        "searchMoonPhases" -> ({ searchMoonPhases(from, to).size.toDouble() })
        "nextLunarEclipse" -> ({ nextLunarEclipse(from).peak.toEpochMilli() / 1000.0 })
        "previousLunarEclipse" -> ({ previousLunarEclipse(to).peak.toEpochMilli() / 1000.0 })
        "lunarEclipses" -> ({ lunarEclipses(from, to).size.toDouble() })
        "nextSolarEclipse" -> ({ nextSolarEclipse(from, observer).peak.toEpochMilli() / 1000.0 })
        "previousSolarEclipse" -> ({ previousSolarEclipse(to, observer).peak.toEpochMilli() / 1000.0 })
        "solarEclipses" -> ({ solarEclipses(from, to, observer).size.toDouble() })
        "solarObscuration" -> ({ times.sumOf { solarObscuration(it, observer) } })
        "nextGlobalSolarEclipse" -> ({ nextGlobalSolarEclipse(from).peak.toEpochMilli() / 1000.0 })
        "previousGlobalSolarEclipse" -> ({ previousGlobalSolarEclipse(to).peak.toEpochMilli() / 1000.0 })
        "globalSolarEclipses" -> ({ globalSolarEclipses(from, to).size.toDouble() })
        "solarEclipseCentralLine" -> ({ solarEclipseCentralLine(from).size.toDouble() })
        else -> error("Unknown benchmark operation: $operation")
    }
}

fun main(args: Array<String>) {
    val suite = Json.parseToJsonElement(File(args[0]).readText()).jsonObject
    val spec = suite.getValue("cases").jsonArray[args[1].toInt()].jsonObject
    val site = suite.getValue("observer").jsonObject
    val observer = Observer(
        spec.number("latitudeDeg") ?: checkNotNull(site.number("latitudeDeg")),
        checkNotNull(site.number("longitudeDeg")),
        site.number("elevationM") ?: 0.0,
    )
    val name = spec.string("name")
    val work = workload(spec, observer)
    val checksum = work()
    check(checksum.isFinite()) { "$name: invalid output" }
    spec.number("expected")?.let { check(checksum == it) { "$name: expected $it, got $checksum" } }

    fun batch(iterations: Int): Double {
        var sum = 0.0
        val start = System.nanoTime()
        repeat(iterations) { sum += work() }
        val millis = (System.nanoTime() - start) / 1e6
        check(abs(sum / iterations - checksum) <= max(1.0, abs(checksum)) * 1e-9) {
            "$name: output changed during measurement"
        }
        return millis
    }

    val warmup = System.nanoTime()
    val warmupMs = checkNotNull(suite.number("warmupMs"))
    do { batch(1) } while ((System.nanoTime() - warmup) / 1e6 < warmupMs)
    var iterations = args.getOrNull(2)?.toInt() ?: 1
    check(iterations > 0)
    if (args.size == 2) {
        val sampleMs = checkNotNull(suite.number("sampleMs"))
        while (batch(iterations) < sampleMs) iterations = Math.multiplyExact(iterations, 2)
    }
    println(buildJsonObject {
        put("name", name)
        put("iterations", iterations)
        put("checksum", checksum)
        put("samplesMs", buildJsonArray { add(batch(iterations) / iterations) })
    })
}
