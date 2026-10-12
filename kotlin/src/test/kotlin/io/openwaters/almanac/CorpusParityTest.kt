package io.openwaters.almanac

import java.nio.file.Files
import java.time.Instant
import kotlin.test.*
import kotlinx.serialization.json.*

private fun j(vararg fields: Pair<String,Any?>): JsonObject = buildJsonObject {
    for ((key,value) in fields) put(key,when(value) {
        null -> JsonNull
        is JsonElement -> value
        is Number -> JsonPrimitive(value)
        is Boolean -> JsonPrimitive(value)
        is String -> JsonPrimitive(value)
        else -> error("Unknown corpus value: $value")
    })
}
private fun List<JsonElement>.rows(): JsonArray = JsonArray(this)
private operator fun JsonObject.plus(other: JsonObject): JsonObject = JsonObject(toMap()+other.toMap())
private fun JsonObject.time(key: String = "tMs"): Instant = Instant.ofEpochMilli(getValue(key).jsonPrimitive.long)
private fun q(value: Double?): JsonElement = value?.let { JsonPrimitive(scaled(it,1e6)) } ?: JsonNull
private fun timed(time: Instant?,key: String): Pair<String,Any?> = key to time?.let(::eventMs)
private fun event(time: Instant,kind: String): JsonObject = j("tMs" to eventMs(time),"kind" to kind)
private fun aa(value: AltAz): JsonObject = j("azDeg" to q(value.azDeg),"altDeg" to q(value.altDeg))
private fun visible(v: LunarEclipseVisibility): JsonObject = j("visibleAtPeak" to v.visibleAtPeak,"moonGeometricAltAtPeakDeg" to q(v.moonGeometricAltAtPeakDeg),"contactsVisible" to j(*lunarVisibleContacts(v).map { it.key to it.value }.toTypedArray()))
private fun global(e: GlobalSolarEclipse): JsonObject = j("kind" to e.kind.toString(),timed(e.peak,"peakMs"),"axisDistanceKm" to scaled(e.axisDistanceKm,1e3),"latitudeDeg" to q(e.latitudeDeg),"longitudeDeg" to q(e.longitudeDeg),"obscuration" to q(e.obscuration),"greatestLatitudeDeg" to q(e.greatestLatitudeDeg),"greatestLongitudeDeg" to q(e.greatestLongitudeDeg),"greatestObscuration" to q(e.greatestObscuration))
private fun axis(p: SolarEclipseAxisPoint): JsonObject = j("latitudeDeg" to q(p.latitudeDeg),"longitudeDeg" to q(p.longitudeDeg),"kind" to p.kind.toString(),"obscuration" to q(p.obscuration))

// Input times, sites, and windows may come from fixtures; no result is copied from them.
private fun recompute(): Map<String,JsonElement> {
    val out = linkedMapOf<String,JsonElement>()
    val min = Instant.ofEpochMilli(SUPPORTED_MIN); val max = Instant.ofEpochMilli(SUPPORTED_MAX)
    val year = Instant.parse("2026-01-01T00:00:00Z"); val nextYear = Instant.parse("2027-01-01T00:00:00Z")
    val victoria = Observer(48.4284,-123.3656)
    val times = generateSequence(SUPPORTED_MIN) { it+8*86400000L }.takeWhile { it < SUPPORTED_MAX }.toList()
    out["positions"] = times.map { ms ->
        val t = Instant.ofEpochMilli(ms); val s = sunPosition(t); val m = moonPosition(t)
        j("tMs" to ms,"sun" to j("raDeg" to q(s.raDeg),"decDeg" to q(s.decDeg),"distanceAu" to scaled(s.distanceAu,1e9)),"moon" to j("raDeg" to q(m.raDeg),"decDeg" to q(m.decDeg),"distanceKm" to scaled(m.distanceKm,1e3)))
    }.rows()
    out["altaz"] = times.map { ms -> val t = Instant.ofEpochMilli(ms)
        j("tMs" to ms,"sunIsUp" to sunIsUp(t,victoria),"sun" to aa(sunAltAz(t,victoria)),"moon" to aa(moonAltAz(t,victoria)),"star" to aa(starAltAz(88.792939,7.407064,t,victoria)))
    }.rows()
    out["illumination"] = times.map { ms -> val v = moonIllumination(Instant.ofEpochMilli(ms))
        j("tMs" to ms,"fraction" to q(v.fraction),"phaseAngleDeg" to q(v.phaseAngleDeg),"phase" to q(v.phase),"waxing" to v.waxing)
    }.rows()
    val sitesJson = fixture("parity/events").obj().array("observers")
    val sites = sitesJson.map { it.obj().observer() }
    val sun = mutableListOf<JsonElement>(); val moon = mutableListOf<JsonElement>()
    val months = (1..12).map { month -> Instant.parse("2026-%02d-01T00:00:00Z".format(month)) to if (month == 12) nextYear else Instant.parse("2026-%02d-01T00:00:00Z".format(month+1)) }
    for ((i,site) in sites.withIndex()) for ((a,b) in months) {
        sun.addAll(sunEvents(a,b,site).map { j("observerIdx" to i)+event(it.time,it.kind.toString()) })
        moon.addAll(moonEvents(a,b,site).map { j("observerIdx" to i)+event(it.time,it.kind.toString()) })
    }
    out["events"] = j("observers" to sitesJson,"sunEvents" to sun.rows(),"moonEvents" to moon.rows(),"moonPhases" to searchMoonPhases(year,nextYear).map { j("tMs" to eventMs(it.time),"phase" to it.phase.toString()) }.rows())
    out["eclipses"] = j("observers" to sitesJson,"eclipses" to lunarEclipses(min,max).map { e ->
        j("kind" to e.kind.toString(),"magUmbral" to q(e.magUmbral),"magPenumbral" to q(e.magPenumbral),*lunarContacts(e).map { timed(it.value,it.key+"Ms") }.toTypedArray(),"visibility" to sites.map { visible(lunarEclipseVisibility(e,it)) }.rows())
    }.rows())
    val solar = sites.flatMapIndexed { i,site -> solarEclipses(min,max,site).map { e ->
        j("observerIdx" to i,"kind" to e.kind.toString(),"obscuration" to q(e.obscuration),*solarContacts(e).map { timed(it.value,it.key+"Ms") }.toTypedArray(),"sunAltDeg" to j(*solarAltitudes(e).map { it.key to q(it.value) }.toTypedArray()))
    } }
    val obscuration = fixture("parity/solar").obj().array("obscuration").map { element -> val row = element.obj(); val i = row.number("observerIdx").toInt()
        j("observerIdx" to i,"tMs" to row.time().toEpochMilli(),"value" to q(solarObscuration(row.time(),sites[i])))
    }
    out["solar"] = j("observers" to sitesJson,"eclipses" to solar.rows(),"obscuration" to obscuration.rows())
    val global = fixture("parity/globalSolar").obj()
    out["globalSolar"] = j("anchors" to global.array("anchors").map { val r = it.obj()
        j("tMs" to r.time().toEpochMilli(),"next" to global(nextGlobalSolarEclipse(r.time())),"previous" to global(previousGlobalSolarEclipse(r.time())))
    }.rows(),"windows" to global.array("windows").map { val r = it.obj()
        j("startMs" to r.time("startMs").toEpochMilli(),"endMs" to r.time("endMs").toEpochMilli(),"eclipses" to globalSolarEclipses(r.time("startMs"),r.time("endMs")).map(::global).rows())
    }.rows())
    out["centralLine"] = j("axisTrack" to fixture("parity/centralLine").obj().array("axisTrack").map { val r = it.obj()
        j("tMs" to r.time().toEpochMilli(),"point" to solarEclipseAxisPoint(r.time())?.let(::axis))
    }.rows(),"centralLine" to solarEclipseCentralLine(Instant.parse("2044-08-23T01:15:34Z")).map { j("tMs" to eventMs(it.time))+axis(it) }.rows())
    out["horizon"] = fixture("horizon/dip").jsonArray.map { val r = it.obj()
        j("observer" to r.getValue("observer"),"heightAboveGroundM" to r.number("heightAboveGroundM"),"dipDeg" to q(horizonDip(r.getValue("observer").obj().observer(),r.number("heightAboveGroundM"))))
    }.rows()
    out["height"] = JsonObject(fixture("parity/height").obj().mapValues { (name,element) ->
        val r = element.obj(); val site = r.getValue("observer").obj().observer(); val eye = r.number("heightAboveGroundM")
        val input = j("observer" to r.getValue("observer"),"heightAboveGroundM" to eye)
        when (name) {
            "events" -> input+j("startMs" to r.time("startMs").toEpochMilli(),"endMs" to r.time("endMs").toEpochMilli(),"sun" to sunEvents(r.time("startMs"),r.time("endMs"),site,eye).map { event(it.time,it.kind.toString()) }.rows(),"moon" to moonEvents(r.time("startMs"),r.time("endMs"),site,eye).map { event(it.time,it.kind.toString()) }.rows())
            "solar" -> { val a = r.time("startMs"); val b = r.time("endMs"); val local = solarEclipses(a,b,site,eye)
                input+j("startMs" to a.toEpochMilli(),"endMs" to b.toEpochMilli(),"peaksMs" to JsonArray(local.map { JsonPrimitive(eventMs(it.peak)) }),"altitudes" to local.map { j("c1" to q(it.sunAltDeg.c1),"peak" to q(it.sunAltDeg.peak),"c4" to q(it.sunAltDeg.c4)) }.rows(),timed(nextSolarEclipse(a,site,eye).peak,"nextPeakMs"),timed(previousSolarEclipse(b,site,eye).peak,"previousPeakMs"))
            }
            "lunar" -> input+j("afterMs" to r.time("afterMs").toEpochMilli())+visible(lunarEclipseVisibility(nextLunarEclipse(r.time("afterMs")),site,eye))
            else -> error("Unknown height family $name")
        }
    })
    val planets = fixture("parity/planets").obj()
    out["planets"] = j("heliocentric" to planets.array("heliocentric").map { val r = it.obj(); val p = planetHeliocentricPosition(r.planet(),r.time())
        j("planet" to r.planet().toString(),"tMs" to r.time().toEpochMilli(),"xAu" to scaled(p.xAu,1e9),"yAu" to scaled(p.yAu,1e9),"zAu" to scaled(p.zAu,1e9))
    }.rows(),"sky" to planets.array("sky").map { val r = it.obj(); val p = planetPosition(r.planet(),r.time()); val i = planetIllumination(r.planet(),r.time())
        j("planet" to r.planet().toString(),"tMs" to r.time().toEpochMilli(),"position" to j("raDeg" to q(p.raDeg),"decDeg" to q(p.decDeg),"distanceAu" to scaled(p.distanceAu,1e9)),"altaz" to aa(planetAltAz(r.planet(),r.time(),victoria)),"illumination" to j("fraction" to q(i.fraction),"phaseAngleDeg" to q(i.phaseAngleDeg),"magnitude" to q(i.magnitude),"elongationDeg" to q(i.elongationDeg)))
    }.rows(),"events" to planets.array("events").map { val r = it.obj(); val site = r.getValue("observer").obj().observer(); val eye = r.number("heightAboveGroundM")
        j("planet" to r.planet().toString(),"observer" to r.getValue("observer"),"heightAboveGroundM" to eye,"startMs" to r.time("startMs").toEpochMilli(),"endMs" to r.time("endMs").toEpochMilli(),"events" to planetEvents(r.planet(),r.time("startMs"),r.time("endMs"),site,eye).map { event(it.time,it.kind.toString()) }.rows())
    }.rows())
    val sunCalcSites = fixture("parity/suncalc").obj().array("observers")
    val altitude = mutableListOf<JsonElement>(); val transits = mutableListOf<JsonElement>()
    for ((i,element) in sunCalcSites.withIndex()) for ((a,b) in months.filterIndexed { index,_ -> index%3 == 0 }) {
        val site = element.obj().observer()
        for (level in listOf(6.0,-.3,-4.0,-8.0)) altitude.addAll(sunAltitudeEvents(a,b,site,level).map { j("observerIdx" to i,"altitudeDeg" to level)+event(it.time,it.kind.toString()) })
        for (body in listOf("sun","moon")) transits.addAll((if (body == "sun") sunTransits(a,b,site) else moonTransits(a,b,site)).map { j("observerIdx" to i,"body" to body)+event(it.time,it.kind.toString()) })
    }
    out["suncalc"] = j("observers" to sunCalcSites,"altitudeEvents" to altitude.rows(),"transits" to transits.rows(),"orientation" to times.map { ms -> val o = moonOrientation(Instant.ofEpochMilli(ms),victoria)
        j("tMs" to ms,"brightLimbAngleDeg" to q(o.brightLimbAngleDeg),"parallacticAngleDeg" to q(o.parallacticAngleDeg))
    }.rows())
    out["cycles"] = j("seasons" to seasons(min,max).map { event(it.time,it.kind.toString()) }.rows(),"apsides" to moonApsides(year,nextYear).map { event(it.time,it.kind.toString())+j("distanceKm" to scaled(it.distanceKm,1e3)) }.rows(),"equationOfTime" to times.map { j("tMs" to it,"minutes" to q(equationOfTime(Instant.ofEpochMilli(it)))) }.rows())
    return out
}

internal class CorpusParityTest {
    companion object {
        private val meta by lazy { fixture("parity/meta").obj() }
        private val corpus by lazy { recompute() }
        private val families = setOf("positions","altaz","illumination","events","eclipses","solar","globalSolar","centralLine","horizon","height","planets","suncalc","cycles")
    }
    private fun compare(actual: JsonElement,expected: JsonElement,path: String,strict: Boolean) {
        when (expected) {
            is JsonObject -> { val a = actual.obj(); assertEquals(expected.keys,a.keys,path)
                for ((key,value) in expected) compare(a.getValue(key),value,"$path.$key",strict)
            }
            is JsonArray -> { val a = actual.jsonArray; assertEquals(expected.size,a.size,path)
                for ((i,value) in expected.withIndex()) compare(a[i],value,"$path[$i]",strict)
            }
            else -> {
                val e = expected.jsonPrimitive; val numeric = if (e.isString) null else e.doubleOrNull
                if (numeric == null) { assertEquals(expected,actual,path); return }
                val field = path.substringAfterLast('.').substringBefore('[')
                val inputTime = field == "tMs" && (path.startsWith("positions") || path.startsWith("altaz") || path.startsWith("illumination") || path.contains(".orientation[") || path.contains(".equationOfTime[") || path.contains(".obscuration[") || path.contains(".anchors[") || path.contains(".axisTrack[") || path.contains(".heliocentric[") || path.contains(".sky["))
                val exact = inputTime || field in setOf("startMs","endMs","afterMs","observerIdx","heightAboveGroundM","altitudeDeg","elevationM") || path.contains(".observer.") || path.contains(".observers[")
                val time = !exact && (field.endsWith("Ms") || field == "tMs")
                val quantity = when(field) { "distanceKm","axisDistanceKm" -> "distanceKm"; "distanceAu","xAu","yAu","zAu" -> "distanceAu"; "fraction","phase","magUmbral","magPenumbral","obscuration","greatestObscuration","value","magnitude","minutes" -> "fraction"; else -> "angleDeg" }
                val tolerance = if (exact) 0.0 else if (time) meta.number("eventTimeQuantumMs") else if (strict) 5.0 else meta.getValue("scales").obj().number(quantity)*meta.getValue("tolerances").obj().number(quantity)
                near(actual.jsonPrimitive.double,numeric,tolerance,path)
            }
        }
    }
    private fun compareAll(actual: Map<String,JsonElement>,strict: Boolean) {
        assertEquals(families,actual.keys)
        for ((name,file) in actual) compare(file,fixture("parity/$name"),name,strict)
    }
    @Test fun decodedCorpusMatchesMetadataTolerancesAndCounts() {
        compareAll(corpus,false)
        fun count(family: String,key: String): Int = corpus.getValue(family).obj().array(key).size
        val counts = mapOf("samples" to corpus.getValue("positions").jsonArray.size,"sunEvents" to count("events","sunEvents"),"moonEvents" to count("events","moonEvents"),"moonPhases" to count("events","moonPhases"),"eclipses" to count("eclipses","eclipses"),"solarEclipses" to count("solar","eclipses"),"obscurationSamples" to count("solar","obscuration"),"globalSolarAnchors" to count("globalSolar","anchors"),"globalSolarEclipses" to corpus.getValue("globalSolar").obj().array("windows").sumOf { it.obj().array("eclipses").size },"axisTrackSamples" to count("centralLine","axisTrack"),"centralLinePoints" to count("centralLine","centralLine"),"seasons" to count("cycles","seasons"),"apsides" to count("cycles","apsides"),"equationOfTimeSamples" to count("cycles","equationOfTime"),"planetHeliocentric" to count("planets","heliocentric"),"planetSky" to count("planets","sky"),"planetEventWindows" to count("planets","events"),"sunAltitudeEvents" to count("suncalc","altitudeEvents"),"transits" to count("suncalc","transits"),"moonOrientationSamples" to count("suncalc","orientation"))
        assertEquals(meta.getValue("counts").obj().keys,counts.keys)
        for ((name,value) in counts) assertEquals(meta.getValue("counts").obj().number(name).toInt(),value,name)
    }
    @Test fun writtenCorpusReproducesEveryFamilyWithinFiveUnitsOrOneQuantum() {
        val directory = Files.createTempDirectory("almanac-kotlin-parity")
        try {
            val decoded = corpus.mapValues { (name,value) -> val path = directory.resolve("$name.json")
                Files.writeString(path,value.toString())
                Json.parseToJsonElement(Files.readString(path))
            }
            compareAll(decoded,true)
        } finally {
            for (name in families) Files.deleteIfExists(directory.resolve("$name.json"))
            Files.delete(directory)
        }
    }
}
