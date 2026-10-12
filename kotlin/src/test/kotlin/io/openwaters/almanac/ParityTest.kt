package io.openwaters.almanac

import java.time.Instant
import kotlin.math.floor
import kotlin.test.*
import kotlinx.serialization.json.*

internal fun scaled(value: Double, scale: Double): Long = floor(value * scale + 0.5).toLong()
internal fun scaledNear(actual: Double, expected: JsonObject, field: String, scale: Double) {
    near(scaled(actual, scale).toDouble(), expected.number(field), 5.0, "$field $expected")
}
internal fun eventMs(time: Instant): Long = scaled(time.toEpochMilli() / 100.0, 1.0) * 100
internal fun eventNear(time: Instant, expected: JsonObject, field: String = "tMs") {
    near(eventMs(time).toDouble(), expected.number(field), 100.0, "$field $expected")
}

internal class ParityTest {
    private val victoria = Observer(48.4284, -123.3656)

    @Test fun positionsReproduceScaledCorpus() {
        val rows = fixture("parity/positions").jsonArray
        assertEquals(6894, rows.size)
        for (element in rows) {
            val row = element.obj()
            val time = Instant.ofEpochMilli(row.getValue("tMs").jsonPrimitive.long)
            val sun = sunPosition(time)
            val moon = moonPosition(time)
            val expectedSun = row.getValue("sun").obj()
            val expectedMoon = row.getValue("moon").obj()
            scaledNear(sun.raDeg, expectedSun, "raDeg", 1e6)
            scaledNear(sun.decDeg, expectedSun, "decDeg", 1e6)
            scaledNear(sun.distanceAu, expectedSun, "distanceAu", 1e9)
            scaledNear(moon.raDeg, expectedMoon, "raDeg", 1e6)
            scaledNear(moon.decDeg, expectedMoon, "decDeg", 1e6)
            scaledNear(moon.distanceKm, expectedMoon, "distanceKm", 1e3)
        }
    }

    @Test fun appearanceReproducesScaledCorpus() {
        val rows = fixture("parity/altaz").jsonArray
        assertEquals(6894, rows.size)
        for (element in rows) {
            val row = element.obj()
            val time = Instant.ofEpochMilli(row.getValue("tMs").jsonPrimitive.long)
            val actual = mapOf("sun" to sunAltAz(time, victoria), "moon" to moonAltAz(time, victoria), "star" to starAltAz(88.792939, 7.407064, time, victoria))
            for ((body, value) in actual) {
                scaledNear(value.azDeg, row.getValue(body).obj(), "azDeg", 1e6)
                scaledNear(value.altDeg, row.getValue(body).obj(), "altDeg", 1e6)
            }
        }
        for (element in fixture("parity/illumination").jsonArray) {
            val row = element.obj()
            val value = moonIllumination(Instant.ofEpochMilli(row.getValue("tMs").jsonPrimitive.long))
            scaledNear(value.fraction, row, "fraction", 1e6)
            scaledNear(value.phaseAngleDeg, row, "phaseAngleDeg", 1e6)
            scaledNear(value.phase, row, "phase", 1e6)
            assertEquals(row.getValue("waxing").jsonPrimitive.boolean, value.waxing)
        }
        for (element in fixture("parity/suncalc").obj().array("orientation")) {
            val row = element.obj()
            val value = moonOrientation(Instant.ofEpochMilli(row.getValue("tMs").jsonPrimitive.long), victoria)
            scaledNear(value.brightLimbAngleDeg, row, "brightLimbAngleDeg", 1e6)
            scaledNear(value.parallacticAngleDeg, row, "parallacticAngleDeg", 1e6)
        }
        for (element in fixture("parity/horizon").jsonArray) {
            val row = element.obj()
            scaledNear(horizonDip(row.getValue("observer").obj().observer(), row.number("heightAboveGroundM")), row, "dipDeg", 1e6)
        }
    }

    @Test fun planetaryQueriesReproduceScaledCorpus() {
        val file = fixture("parity/planets").obj()
        val heliocentric = file.array("heliocentric")
        val sky = file.array("sky")
        assertEquals(1280, heliocentric.size)
        assertEquals(1120, sky.size)
        for (element in heliocentric) {
            val row = element.obj()
            val value = planetHeliocentricPosition(row.planet(), Instant.ofEpochMilli(row.getValue("tMs").jsonPrimitive.long))
            scaledNear(value.xAu, row, "xAu", 1e9)
            scaledNear(value.yAu, row, "yAu", 1e9)
            scaledNear(value.zAu, row, "zAu", 1e9)
        }
        for (element in sky) {
            val row = element.obj()
            val time = Instant.ofEpochMilli(row.getValue("tMs").jsonPrimitive.long)
            val p = planetPosition(row.planet(), time)
            val a = planetAltAz(row.planet(), time, victoria)
            val i = planetIllumination(row.planet(), time)
            val ep = row.getValue("position").obj()
            val ea = row.getValue("altaz").obj()
            val ei = row.getValue("illumination").obj()
            scaledNear(p.raDeg, ep, "raDeg", 1e6)
            scaledNear(p.decDeg, ep, "decDeg", 1e6)
            scaledNear(p.distanceAu, ep, "distanceAu", 1e9)
            scaledNear(a.azDeg, ea, "azDeg", 1e6)
            scaledNear(a.altDeg, ea, "altDeg", 1e6)
            scaledNear(i.fraction, ei, "fraction", 1e6)
            scaledNear(i.phaseAngleDeg, ei, "phaseAngleDeg", 1e6)
            scaledNear(i.magnitude, ei, "magnitude", 1e6)
            scaledNear(i.elongationDeg, ei, "elongationDeg", 1e6)
        }
    }

    @Test fun eventFamiliesReproduceKindsCountsAndTimeQuanta() {
        val file = fixture("parity/events").obj()
        val sites = file.array("observers").map { it.obj().observer() }
        val sun = mutableListOf<Triple<Int,Instant,String>>()
        val moon = mutableListOf<Triple<Int,Instant,String>>()
        for ((i,site) in sites.withIndex()) for (month in 1..12) {
            val start = Instant.parse("2026-%02d-01T00:00:00Z".format(month))
            val end = if (month == 12) Instant.parse("2027-01-01T00:00:00Z") else Instant.parse("2026-%02d-01T00:00:00Z".format(month+1))
            sun.addAll(sunEvents(start,end,site).map { Triple(i,it.time,it.kind.toString()) })
            moon.addAll(moonEvents(start,end,site).map { Triple(i,it.time,it.kind.toString()) })
        }
        assertEquals(9449,sun.size)
        assertEquals(2115,moon.size)
        for ((values,name) in listOf(sun to "sunEvents",moon to "moonEvents")) {
            val rows = file.array(name)
            assertEquals(rows.size,values.size)
            for ((i,value) in values.withIndex()) {
                val row = rows[i].obj()
                assertEquals(row.number("observerIdx").toInt(),value.first)
                assertEquals(row.string("kind"),value.third)
                eventNear(value.second,row)
            }
        }
        val phases = searchMoonPhases(Instant.parse("2026-01-01T00:00:00Z"),Instant.parse("2027-01-01T00:00:00Z"))
        assertEquals(file.array("moonPhases").size,phases.size)
        for ((i,phase) in phases.withIndex()) {
            val row = file.array("moonPhases")[i].obj()
            assertEquals(row.string("phase"),phase.phase.toString())
            eventNear(phase.time,row)
        }
        for (element in fixture("parity/planets").obj().array("events")) {
            val row = element.obj()
            val found = planetEvents(row.planet(),Instant.ofEpochMilli(row.getValue("startMs").jsonPrimitive.long),Instant.ofEpochMilli(row.getValue("endMs").jsonPrimitive.long),row.getValue("observer").obj().observer(),row.number("heightAboveGroundM"))
            assertEquals(row.array("events").size,found.size)
            for ((i,e) in found.withIndex()) {
                val expected = row.array("events")[i].obj()
                assertEquals(expected.string("kind"),e.kind.toString())
                eventNear(e.time,expected)
            }
        }
        val height = fixture("parity/height").obj().getValue("events").obj()
        val start = Instant.ofEpochMilli(height.getValue("startMs").jsonPrimitive.long)
        val end = Instant.ofEpochMilli(height.getValue("endMs").jsonPrimitive.long)
        val site = height.getValue("observer").obj().observer()
        val eye = height.number("heightAboveGroundM")
        for ((values,name) in listOf(sunEvents(start,end,site,eye).map { it.time to it.kind.toString() } to "sun",moonEvents(start,end,site,eye).map { it.time to it.kind.toString() } to "moon")) {
            assertEquals(height.array(name).size,values.size)
            for ((i,e) in values.withIndex()) {
                val row = height.array(name)[i].obj()
                assertEquals(row.string("kind"),e.second)
                eventNear(e.first,row)
            }
        }
    }

    @Test fun sunCalcEventFamiliesReproduceTimeQuanta() {
        val file = fixture("parity/suncalc").obj()
        val altitude = mutableListOf<JsonObject>()
        val transits = mutableListOf<JsonObject>()
        for ((i,site) in file.array("observers").map { it.obj().observer() }.withIndex()) for (month in listOf(1,4,7,10)) {
            val start = Instant.parse("2026-%02d-01T00:00:00Z".format(month))
            val end = Instant.parse("2026-%02d-01T00:00:00Z".format(month+1))
            for (level in listOf(6.0,-0.3,-4.0,-8.0)) for (e in sunAltitudeEvents(start,end,site,level)) altitude.add(buildJsonObject {
                put("observerIdx",i); put("altitudeDeg",level); put("tMs",eventMs(e.time)); put("kind",e.kind.toString())
            })
            for (body in listOf("sun","moon")) for (e in if (body == "sun") sunTransits(start,end,site) else moonTransits(start,end,site)) transits.add(buildJsonObject {
                put("observerIdx",i); put("body",body); put("tMs",eventMs(e.time)); put("kind",e.kind.toString())
            })
        }
        assertEquals(3608,altitude.size)
        assertEquals(1932,transits.size)
        for ((values,name) in listOf(altitude to "altitudeEvents",transits to "transits")) {
            val rows = file.array(name)
            assertEquals(rows.size,values.size)
            for ((i,value) in values.withIndex()) {
                val row = rows[i].obj()
                assertEquals(row.string("kind"),value.string("kind"))
                assertEquals(row.number("observerIdx"),value.number("observerIdx"))
                if (name == "transits") assertEquals(row.string("body"),value.string("body"))
                else assertEquals(row.number("altitudeDeg"),value.number("altitudeDeg"))
                near(value.number("tMs"),row.number("tMs"),100.0,"$row")
            }
        }
    }

    @Test fun cyclesReproduceScaledCorpus() {
        val file = fixture("parity/cycles").obj()
        val seasons = seasons(Instant.ofEpochMilli(SUPPORTED_MIN),Instant.ofEpochMilli(SUPPORTED_MAX))
        assertEquals(604,seasons.size)
        assertEquals(file.array("seasons").size,seasons.size)
        for ((i,e) in seasons.withIndex()) {
            val row = file.array("seasons")[i].obj()
            assertEquals(row.string("kind"),e.kind.toString())
            eventNear(e.time,row)
        }
        val apsides = moonApsides(Instant.parse("2026-01-01T00:00:00Z"),Instant.parse("2027-01-01T00:00:00Z"))
        assertEquals(27,apsides.size)
        assertEquals(file.array("apsides").size,apsides.size)
        for ((i,e) in apsides.withIndex()) {
            val row = file.array("apsides")[i].obj()
            assertEquals(row.string("kind"),e.kind.toString())
            eventNear(e.time,row)
            scaledNear(e.distanceKm,row,"distanceKm",1e3)
        }
        assertEquals(6894,file.array("equationOfTime").size)
        for (element in file.array("equationOfTime")) {
            val row = element.obj()
            scaledNear(equationOfTime(Instant.ofEpochMilli(row.getValue("tMs").jsonPrimitive.long)),row,"minutes",1e6)
        }
    }
    @Test fun lunarEclipsesReproduceCircumstancesAndVisibility() {
        val file = fixture("parity/eclipses").obj()
        val sites = file.array("observers").map { it.obj().observer() }
        val values = lunarEclipses(Instant.ofEpochMilli(SUPPORTED_MIN), Instant.ofEpochMilli(SUPPORTED_MAX))
        assertEquals(344, values.size)
        assertEquals(file.array("eclipses").size, values.size)
        fun visibility(value: LunarEclipseVisibility, row: JsonObject) {
            assertEquals(row.getValue("visibleAtPeak").jsonPrimitive.boolean, value.visibleAtPeak)
            scaledNear(value.moonGeometricAltAtPeakDeg, row, "moonGeometricAltAtPeakDeg", 1e6)
            for ((field, actual) in lunarVisibleContacts(value)) {
                val expected = row.getValue("contactsVisible").obj().getValue(field)
                assertEquals(if (expected == JsonNull) null else expected.jsonPrimitive.boolean, actual)
            }
        }
        for ((i, value) in values.withIndex()) {
            val row = file.array("eclipses")[i].obj()
            assertEquals(row.string("kind"), value.kind.toString())
            scaledNear(value.magUmbral, row, "magUmbral", 1e6)
            scaledNear(value.magPenumbral, row, "magPenumbral", 1e6)
            for ((field, actual) in lunarContacts(value)) {
                val expected = row.getValue(field + "Ms")
                if (expected == JsonNull) assertNull(actual) else eventNear(assertNotNull(actual), row, field + "Ms")
            }
            for ((j, site) in sites.withIndex()) visibility(lunarEclipseVisibility(value, site), row.array("visibility")[j].obj())
        }
        val row = fixture("parity/height").obj().getValue("lunar").obj()
        val value = nextLunarEclipse(Instant.ofEpochMilli(row.getValue("afterMs").jsonPrimitive.long))
        visibility(lunarEclipseVisibility(value, row.getValue("observer").obj().observer(), row.number("heightAboveGroundM")), row)
    }

}
