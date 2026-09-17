import Foundation

// L1 solar position: geocentric Sun from the truncated VSOP87 Earth series,
// with light-travel and aberration correction.
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts. The
// `vsop.Earth` terms in `earthLon`/`earthLat`/`earthRad` below are
// generated from the table in typescript/src/sun.ts, never retyped, so this
// agrees bit-for-bit with the TS port. Operation order is likewise preserved.
//
// INTERNAL: not part of the curated public API (see Positions.swift).

/** UPSTREAM: astronomy.ts lines 3229-3232. */
private let DAYS_PER_MILLENNIUM = 365250.0

/**
 * UPSTREAM: `VsopFormula`, astronomy.ts lines 3191-3205, written out term by
 * term for `vsop.Earth`, mirroring the TypeScript port. Term order,
 * per-series scaling, clamping and accumulation match upstream's loop, so the
 * result is bit-for-bit the same; the parity corpus holds both ports to it.
 */
private func earthLon(_ t: Double) -> Double {
    var tpower = 1.0
    var coord = 0.0
    var sum: Double
    var incr: Double
    sum = 0
    sum += 1.75347045673   // cos(0) is 1 exactly
    sum += 0.03341656453 * cos(4.66925680415 + (t * 6283.07584999140))
    sum += 0.00034894275 * cos(4.62610242189 + (t * 12566.15169998280))
    sum += 0.00003417572 * cos(2.82886579754 + (t * 3.52311834900))
    sum += 0.00003497056 * cos(2.74411783405 + (t * 5753.38488489680))
    sum += 0.00003135899 * cos(3.62767041756 + (t * 77713.77146812050))
    sum += 0.00002676218 * cos(4.41808345438 + (t * 7860.41939243920))
    sum += 0.00002342691 * cos(6.13516214446 + (t * 3930.20969621960))
    sum += 0.00001273165 * cos(2.03709657878 + (t * 529.69096509460))
    sum += 0.00001324294 * cos(0.74246341673 + (t * 11506.76976979360))
    sum += 0.00000901854 * cos(2.04505446477 + (t * 26.29831979980))
    sum += 0.00001199167 * cos(1.10962946234 + (t * 1577.34354244780))
    sum += 0.00000857223 * cos(3.50849152283 + (t * 398.14900340820))
    sum += 0.00000779786 * cos(1.17882681962 + (t * 5223.69391980220))
    sum += 0.00000990250 * cos(5.23268072088 + (t * 5884.92684658320))
    sum += 0.00000753141 * cos(2.53339052847 + (t * 5507.55323866740))
    sum += 0.00000505267 * cos(4.58292599973 + (t * 18849.22754997420))
    sum += 0.00000492392 * cos(4.20505711826 + (t * 775.52261132400))
    sum += 0.00000356672 * cos(2.91954114478 + (t * 0.06731030280))
    sum += 0.00000284125 * cos(1.89869240932 + (t * 796.29800681640))
    sum += 0.00000242879 * cos(0.34481445893 + (t * 5486.77784317500))
    sum += 0.00000317087 * cos(5.84901948512 + (t * 11790.62908865880))
    sum += 0.00000271112 * cos(0.31486255375 + (t * 10977.07880469900))
    sum += 0.00000206217 * cos(4.80646631478 + (t * 2544.31441988340))
    sum += 0.00000205478 * cos(1.86953770281 + (t * 5573.14280143310))
    sum += 0.00000202318 * cos(2.45767790232 + (t * 6069.77675455340))
    sum += 0.00000126225 * cos(1.08295459501 + (t * 20.77539549240))
    sum += 0.00000155516 * cos(0.83306084617 + (t * 213.29909543800))
    incr = tpower * sum
    incr = incr.truncatingRemainder(dividingBy: PI2)
    coord += incr
    tpower *= t
    sum = 0
    sum += 6283.07584999140   // cos(0) is 1 exactly
    sum += 0.00206058863 * cos(2.67823455808 + (t * 6283.07584999140))
    sum += 0.00004303419 * cos(2.63512233481 + (t * 12566.15169998280))
    incr = tpower * sum
    incr = incr.truncatingRemainder(dividingBy: PI2)
    coord += incr
    tpower *= t
    sum = 0
    sum += 0.00008721859 * cos(1.07253635559 + (t * 6283.07584999140))
    incr = tpower * sum
    incr = incr.truncatingRemainder(dividingBy: PI2)
    coord += incr
    tpower *= t
    return coord
}

private func earthLat(_ t: Double) -> Double {
    var tpower = 1.0
    var coord = 0.0
    var sum: Double
    var incr: Double
    sum = 0
    incr = tpower * sum
    coord += incr
    tpower *= t
    sum = 0
    sum += 0.00227777722 * cos(3.41376620530 + (t * 6283.07584999140))
    sum += 0.00003805678 * cos(3.37063423795 + (t * 12566.15169998280))
    incr = tpower * sum
    coord += incr
    tpower *= t
    return coord
}

private func earthRad(_ t: Double) -> Double {
    var tpower = 1.0
    var coord = 0.0
    var sum: Double
    var incr: Double
    sum = 0
    sum += 1.00013988784   // cos(0) is 1 exactly
    sum += 0.01670699632 * cos(3.09846350258 + (t * 6283.07584999140))
    sum += 0.00013956024 * cos(3.05524609456 + (t * 12566.15169998280))
    sum += 0.00003083720 * cos(5.19846674381 + (t * 77713.77146812050))
    sum += 0.00001628463 * cos(1.17387558054 + (t * 5753.38488489680))
    sum += 0.00001575572 * cos(2.84685214877 + (t * 7860.41939243920))
    sum += 0.00000924799 * cos(5.45292236722 + (t * 11506.76976979360))
    sum += 0.00000542439 * cos(4.56409151453 + (t * 3930.20969621960))
    sum += 0.00000472110 * cos(3.66100022149 + (t * 5884.92684658320))
    sum += 0.00000085831 * cos(1.27079125277 + (t * 161000.68573767410))
    sum += 0.00000057056 * cos(2.01374292245 + (t * 83996.84731811189))
    sum += 0.00000055736 * cos(5.24159799170 + (t * 71430.69561812909))
    sum += 0.00000174844 * cos(3.01193636733 + (t * 18849.22754997420))
    sum += 0.00000243181 * cos(4.27349530790 + (t * 11790.62908865880))
    incr = tpower * sum
    coord += incr
    tpower *= t
    sum = 0
    sum += 0.00103018607 * cos(1.10748968172 + (t * 6283.07584999140))
    sum += 0.00001721238 * cos(1.06442300386 + (t * 12566.15169998280))
    incr = tpower * sum
    coord += incr
    tpower *= t
    sum = 0
    sum += 0.00004359385 * cos(5.78455133808 + (t * 6283.07584999140))
    incr = tpower * sum
    coord += incr
    tpower *= t
    return coord
}

/** UPSTREAM: `VsopRotate`, astronomy.ts lines 3234-3241 — VSOP ecliptic to J2000 equatorial. */
private func vsopRotate(_ eclip: Vec3) -> Vec3 {
    Vec3(
        x: eclip.x + 0.000000440360*eclip.y - 0.000000190919*eclip.z,
        y: -0.000000479966*eclip.x + 0.917482137087*eclip.y - 0.397776982902*eclip.z,
        z: 0.397776982902*eclip.y + 0.917482137087*eclip.z
    )
}

/** UPSTREAM: `VsopSphereToRect`, astronomy.ts lines 3243-3253. */
private func vsopSphereToRect(_ lon: Double, _ lat: Double, _ radius: Double) -> Vec3 {
    // Convert spherical coordinates to ecliptic cartesian coordinates.
    let r_coslat = radius * cos(lat)
    let coslon = cos(lon)
    let sinlon = sin(lon)
    return Vec3(
        x: r_coslat * coslon,
        y: r_coslat * sinlon,
        z: radius * sin(lat)
    )
}

/**
 * UPSTREAM: `CalcVsop`, astronomy.ts lines 3255-3262, specialised to
 * `vsop.Earth` — i.e. `HelioVector(Body.Earth, time)`. J2000 mean equator (EQJ).
 */
func earthHelioVector(_ tt: Double) -> Vec3 {
    let t = tt / DAYS_PER_MILLENNIUM   // millennia since 2000
    let lon = earthLon(t)
    let lat = earthLat(t)
    let rad = earthRad(t)
    let eclip = vsopSphereToRect(lon, lat, rad)
    return vsopRotate(eclip)
}

/**
 * UPSTREAM: `CorrectLightTravel` (astronomy.ts 4170-4191) driving
 * `BodyPosition.Position` (4193-4241) with observerBody = Earth,
 * targetBody = Sun, aberration = true — i.e. what
 * `GeoVector(Body.Sun, time, true)` computes via `BackdatePosition`.
 *
 * `HelioVector(Body.Sun, t)` is the zero vector, so the target position is
 * always the origin and the whole correction is the backdated Earth: the
 * light-time retardation and the ~20.5" annual aberration fall out of the same
 * iteration, exactly as upstream intends.
 *
 * Returns geocentric position in AU, J2000 mean equator (EQJ).
 */
func sunGeoVectorEqj(_ tt: Double) -> Vec3 {
    var ltime = tt
    var dt = 0.0
    for _ in 0..<10 {
        // BodyPosition.Position: (0,0,0) - HelioVector(Earth, ltime).
        let earth = earthHelioVector(ltime)
        let pos = Vec3(x: -earth.x, y: -earth.y, z: -earth.z)
        let lt = (pos.x*pos.x + pos.y*pos.y + pos.z*pos.z).squareRoot() / C_AUDAY

        // This solver does not support more than one light-day of distance,
        // because that would cause convergence problems and inaccurate
        // values for stellar aberration angles.
        if lt > 1.0 {
            // Unreachable inside the supported interval: the Sun is ~8 light-minutes
            // away, so `lt` never approaches a light-day at any `tt` assertSupported
            // admits — an internal invariant, like Events.swift's assertReached.
            fatalError("Object is too distant for light-travel solver.")
        }

        // Upstream backdates via `AstroTime.AddDays`, which subtracts from UT and
        // recomputes TT; subtracting from TT directly is what that intends (upstream
        // documents the UT detour as "slightly wrong" at AddDays, line 1329).
        let ltime2 = tt - lt
        dt = abs(ltime2 - ltime)
        if dt < 1.0e-9 {       // 86.4 microseconds
            return pos
        }
        ltime = ltime2
    }
    // Unreachable inside the supported interval: 10 iterations converges the
    // Sun's ~8-light-minute retardation to well under 1e-9 days at every `tt`
    // assertSupported admits — an internal invariant, like Events.swift's
    // assertReached.
    fatalError("Light-travel time solver did not converge: dt = \(dt)")
}

/**
 * UPSTREAM: `GeoVector(Body.Sun, time, aberration=true)` composed with the
 * `gyration(..., From2000)` of `Equator(ofdate=true)` (astronomy.ts 2803-2822).
 *
 * Returns geocentric position in AU, true equator & equinox of date.
 */
func sunGeoVector(_ tt: Double) -> Vec3 {
    gyration(sunGeoVectorEqj(tt), tt, .from2000)
}
