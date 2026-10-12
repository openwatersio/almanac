package io.openwaters.almanac

import java.time.Instant
import kotlin.math.*

/** Geometric Sun-centered AU vector in the fixed J2000 mean equatorial frame. */
public data class HeliocentricPosition(public val xAu: Double, public val yAu: Double, public val zAu: Double)
/** Apparent geocentric position on the true equator and equinox of date. */
public data class PlanetPosition(public val raDeg: Double, public val decDeg: Double, public val distanceAu: Double)
/** Geometric phase, approximate airless visual magnitude, and apparent solar separation. */
public data class PlanetIllumination(public val fraction: Double, public val phaseAngleDeg: Double, public val magnitude: Double, public val elongationDeg: Double)

// VSOP evaluation: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L3191
private fun vsopFormula(formula: Array<Array<DoubleArray>>, t: Double, clampAngle: Boolean): Double {
    var tpower = 1.0
    var coord = 0.0
    for (series in formula) {
        var sum = 0.0
        for ((ampl, phas, freq) in series) sum += ampl * cos(phas + (t * freq))
        var incr = tpower * sum
        if (clampAngle) incr %= PI2
        coord += incr
        tpower *= t
    }
    return coord
}

internal fun planetHelioVector(planet: Planet, tt: Double): Vec3 {
    if (planet == Planet.EARTH) return earthHelioVector(tt)
    val model = PLANET_MODELS.getValue(planet)
    val t = tt / 365250
    val lon = vsopFormula(model[0], t, true)
    val lat = vsopFormula(model[1], t, false)
    val rad = vsopFormula(model[2], t, false)
    return vsopRotate(vsopSphereToRect(lon, lat, rad))
}

// Backdating Earth with the planet supplies aberration: pinned astronomy.ts#L4170–L4313.
internal fun planetGeoVectorEqj(planet: Planet, tt: Double, aberration: Boolean = true): Vec3 {
    var ltime = tt
    var dt = 0.0
    val fixedEarth = if (aberration) null else earthHelioVector(tt)
    repeat(10) {
        val earth = fixedEarth ?: earthHelioVector(ltime)
        val target = planetHelioVector(planet, ltime)
        val pos = Vec3(target.x-earth.x, target.y-earth.y, target.z-earth.z)
        val lt = sqrt(pos.x*pos.x + pos.y*pos.y + pos.z*pos.z) / C_AUDAY
        if (lt > 1) error("Object is too distant for light-travel solver.")
        val next = tt - lt
        dt = abs(next-ltime)
        if (dt < 1e-9) return pos
        ltime = next
    }
    error("Light-travel time solver did not converge: dt = $dt")
}

// VisualMagnitude: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L4901
internal fun visualMagnitude(planet: Planet, phase: Double, helioDist: Double, geoDist: Double): Double {
    val c0: Double
    var c1 = 0.0
    var c2 = 0.0
    var c3 = 0.0
    when (planet) {
        Planet.MERCURY -> { c0 = -0.60; c1 = 4.98; c2 = -4.88; c3 = 3.02 }
        Planet.VENUS -> {
            if (phase < 163.6) { c0 = -4.47; c1 = 1.03; c2 = 0.57; c3 = 0.13 }
            else { c0 = 0.98; c1 = -1.02 }
        }
        Planet.MARS -> { c0 = -1.52; c1 = 1.60 }
        Planet.JUPITER -> { c0 = -9.40; c1 = 0.50 }
        Planet.URANUS -> { c0 = -7.19; c1 = 0.25 }
        Planet.NEPTUNE -> c0 = -6.87
        else -> error("unsupported planet in visualMagnitude")
    }
    val x = phase / 100
    var mag = c0 + x*(c1 + x*(c2 + x*c3))
    mag += 5*log10(helioDist*geoDist)
    return mag
}

// SaturnMagnitude and Ecliptic: pinned astronomy.ts#L4927 and #L3013.
private fun saturnMagnitude(phase: Double, helioDist: Double, geoDist: Double, gc: Vec3, tt: Double): Double {
    val ecl = eclipticToEquatorial(-earthTilt(tt).tobl, gyration(gc, tt, PrecessDirection.From2000))
    val lat = RAD2DEG*atan2(ecl.z, hypot(ecl.x, ecl.y))
    var lon = RAD2DEG*atan2(ecl.y, ecl.x)
    if (lon < 0) lon += 360
    val ir = DEG2RAD*28.06
    val nr = DEG2RAD*(169.51 + (3.82e-5*tt))
    val tilt = asin(sin(DEG2RAD*lat)*cos(ir) - cos(DEG2RAD*lat)*sin(ir)*sin(DEG2RAD*lon-nr))
    val sinTilt = sin(abs(tilt))
    var mag = -9 + 0.044*phase
    mag += sinTilt*(-2.6 + 1.2*sinTilt)
    mag += 5*log10(helioDist*geoDist)
    return mag
}

internal fun planetIlluminationAtTT(planet: Planet, tt: Double): PlanetIllumination {
    val earth = earthHelioVector(tt)
    val hc = planetHelioVector(planet, tt)
    val gc = Vec3(hc.x-earth.x, hc.y-earth.y, hc.z-earth.z)
    val phaseAngleDeg = angleBetweenDeg(gc, hc)
    val helioDist = sqrt(hc.x*hc.x + hc.y*hc.y + hc.z*hc.z)
    val geoDist = sqrt(gc.x*gc.x + gc.y*gc.y + gc.z*gc.z)
    val magnitude = if (planet == Planet.SATURN) saturnMagnitude(phaseAngleDeg, helioDist, geoDist, gc, tt) else visualMagnitude(planet, phaseAngleDeg, helioDist, geoDist)
    return PlanetIllumination((1+cos(DEG2RAD*phaseAngleDeg))/2, phaseAngleDeg, magnitude, angleBetweenDeg(sunGeoVectorEqj(tt), planetGeoVectorEqj(planet, tt)))
}

public fun planetIllumination(planet: Planet, time: Instant): PlanetIllumination {
    assertPlanet(planet)
    assertSupported(time)
    return planetIlluminationAtTT(planet, ttDays(time))
}

internal fun planetApparentAtTT(planet: Planet, tt: Double): PlanetPosition {
    val direction = equatorialFromVector(gyration(planetGeoVectorEqj(planet, tt), tt, PrecessDirection.From2000))
    // Aberration changes direction; physical range keeps Earth at reception.
    val range = planetGeoVectorEqj(planet, tt, false)
    return PlanetPosition(direction.raDeg, direction.decDeg, hypot(hypot(range.x, range.y), range.z))
}

public fun planetHeliocentricPosition(planet: Planet, time: Instant): HeliocentricPosition {
    assertPlanet(planet, true)
    assertSupported(time)
    val p = planetHelioVector(planet, ttDays(time))
    return HeliocentricPosition(p.x, p.y, p.z)
}

public fun planetPosition(planet: Planet, time: Instant): PlanetPosition {
    assertPlanet(planet)
    assertSupported(time)
    return planetApparentAtTT(planet, ttDays(time))
}

public fun planetAltAz(planet: Planet, time: Instant, observer: Observer): AltAz {
    assertPlanet(planet)
    assertSupported(time)
    val ut = utDays(time)
    return refract(topoAltAzUnrefracted(planetGeoVectorEqj(planet, ttDaysFromUt(ut)), ut, observer))
}
