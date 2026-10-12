package io.openwaters.almanac

import java.time.Instant
import kotlin.math.*
import kotlin.test.*
import kotlinx.serialization.json.*

internal class MigrationGuideTest {
    private data class Place(val site: Observer,val date: Instant,val at: Instant,val offset: Int,val phaseName: String)
    private val places = mapOf(
        "victoria" to Place(Observer(48.4284,-123.3656),Instant.parse("2026-03-20T12:00:00Z"),Instant.parse("2026-03-20T20:00:00Z"),-420,"Waxing Crescent"),
        "sydney" to Place(Observer(-33.8688,151.2093),Instant.parse("2026-12-21T00:00:00Z"),Instant.parse("2026-12-21T09:00:00Z"),660,"Waxing Gibbous"),
        "tromsoSummer" to Place(Observer(69.6492,18.9553),Instant.parse("2026-06-21T12:00:00Z"),Instant.parse("2026-06-21T10:00:00Z"),120,"First Quarter"),
        "tromsoWinter" to Place(Observer(69.6492,18.9553),Instant.parse("2026-12-21T12:00:00Z"),Instant.parse("2026-12-21T10:00:00Z"),60,"Waxing Gibbous")
    )
    private val references = fixture("../typescript/test/suncalc-2.1.1").obj()
    private fun day(p: Place,civil: Boolean): Pair<Instant,Instant> {
        if (civil) {
            val offset = p.offset*60000L
            val start = floor((p.date.toEpochMilli()+offset)/86400000.0).toLong()*86400000-offset
            return Instant.ofEpochMilli(start) to Instant.ofEpochMilli(start+86400000)
        }
        val transits = sunTransits(p.date.minusSeconds(36*3600),p.date.plusSeconds(36*3600),p.site)
        val noon = transits.filter { it.kind == TransitEventKind.UPPER }.minBy { abs(it.time.toEpochMilli()-p.date.toEpochMilli()) }.time
        val lower = transits.filter { it.kind == TransitEventKind.LOWER }.map { it.time }
        return lower.last { it < noon } to lower.first { it > noon }
    }
    private fun sunTimes(p: Place,civil: Boolean): Map<String,Any?> {
        val (start,end) = day(p,civil)
        val result = mutableMapOf<String,Any?>()
        val events = sunEvents(start,end,p.site)
        result["sunrise"] = events.firstOrNull { it.kind == SunEventKind.RISE }?.time
        result["sunset"] = events.firstOrNull { it.kind == SunEventKind.SET }?.time
        val levels = listOf(Triple(-.3,"sunriseEnd","sunsetStart"),Triple(-6.0,"dawn","dusk"),Triple(-12.0,"nauticalDawn","nauticalDusk"),Triple(-18.0,"nightEnd","night"),Triple(6.0,"goldenHourEnd","goldenHour"),Triple(-4.0,"blueHourEnd","blueHour"))
        for ((angle,rise,set) in levels) {
            val crossings = sunAltitudeEvents(start,end,p.site,angle+horizonDip(p.site,0.0))
            result[rise] = crossings.firstOrNull { it.kind == AltitudeEventKind.RISING }?.time
            result[set] = crossings.firstOrNull { it.kind == AltitudeEventKind.FALLING }?.time
        }
        val middle = Instant.ofEpochMilli((start.toEpochMilli()+end.toEpochMilli())/2)
        val noon = sunTransits(middle.minusSeconds(13*3600),middle.plusSeconds(13*3600),p.site).filter { it.kind == TransitEventKind.UPPER }.minBy { abs(it.time.toEpochMilli()-middle.toEpochMilli()) }.time
        result["solarNoon"] = noon
        result["nadir"] = sunTransits(noon.minusSeconds(13*3600),noon,p.site).first { it.kind == TransitEventKind.LOWER }.time
        if (result["sunrise"] == null && result["sunset"] == null) {
            val up = sunAltAz(noon,p.site).altDeg+.27 > 0
            result["alwaysUp"] = up; result["alwaysDown"] = !up
        }
        return result
    }
    private fun moonTimes(p: Place,civil: Boolean): Map<String,Any?> {
        val (start,end) = day(p,civil)
        val result = mutableMapOf<String,Any?>()
        for (e in moonEvents(start,end,p.site)) result.putIfAbsent(e.kind.toString(),e.time)
        for (e in moonTransits(start,end,p.site)) result.putIfAbsent(if (e.kind == TransitEventKind.UPPER) "transit" else "lowerTransit",e.time)
        if ("rise" !in result && "set" !in result) {
            val up = moonAltAz(start,p.site).altDeg+.26 > 0
            result["alwaysUp"] = up; result["alwaysDown"] = !up
        }
        return result
    }
    @Test fun translatedDayAdaptersKeepNamesNullsPolarStatesAndTimeTolerances() {
        for ((name,p) in places) for (civil in listOf(true,false)) {
            val row = references.getValue(name).obj()
            for ((mine,key) in listOf(sunTimes(p,civil) to if (civil) "times" else "solarDayTimes",moonTimes(p,civil) to if (civil) "moonTimes" else "solarDayMoonTimes")) {
                val expected = row.getValue(key).obj()
                assertEquals(expected.keys,mine.keys,"$name $key")
                for ((field,value) in expected) {
                    if (value == JsonNull) assertNull(mine[field])
                    else if (value.jsonPrimitive.isString) {
                        val tolerance = if (key.contains("Moon") || key == "moonTimes") { if (field.endsWith("ransit")) 2000.0 else 5000.0 } else if (field == "nadir") 20000.0 else 10000.0
                        near((mine[field] as Instant).toEpochMilli().toDouble(),Instant.parse(value.jsonPrimitive.content).toEpochMilli().toDouble(),tolerance,"$name $key $field")
                    } else assertEquals(value.jsonPrimitive.boolean,mine[field])
                }
            }
        }
    }
    @Test fun translatedPositionIlluminationAndTiltCallsRetainDocumentedDifferences() {
        val phaseNames = listOf("New Moon","Waxing Crescent","First Quarter","Waxing Gibbous","Full Moon","Waning Gibbous","Last Quarter","Waning Crescent")
        for ((name,p) in places) {
            val row = references.getValue(name).obj()
            for ((actual,key) in listOf(sunAltAz(p.at,p.site) to "position",moonAltAz(p.at,p.site) to "moonPosition")) {
                val expected = row.getValue(key).obj()
                assertTrue(angularDiff(actual.azDeg,expected.number("azimuth")) < .2)
                near(actual.altDeg,expected.number("altitude"),.2,name)
            }
            val moon = row.getValue("moonPosition").obj()
            near(moonPosition(p.at).distanceKm,moon.number("distance"),20.0,name)
            val orientation = moonOrientation(p.at,p.site)
            assertTrue(angularDiff(orientation.parallacticAngleDeg,moon.number("parallacticAngle")) < .25)
            val illumination = moonIllumination(p.at)
            val expected = row.getValue("moonIllumination").obj()
            near(illumination.fraction,expected.number("fraction"),1e-3,name)
            near(illumination.phase,expected.number("phase"),1e-3,name)
            assertEquals(expected.getValue("waxing").jsonPrimitive.boolean,illumination.waxing)
            assertTrue(angularDiff(orientation.brightLimbAngleDeg,expected.number("angle")) < 2)
            assertEquals(p.phaseName,phaseNames[floor(illumination.phase*8+.5).toInt()%8])
            assertTrue(angularDiff(orientation.brightLimbAngleDeg-orientation.parallacticAngleDeg,expected.number("angle")-moon.number("parallacticAngle")) < 2)
        }
    }
}
