package io.openwaters.almanac

import kotlin.math.*

// The unrolled VSOP Earth evaluation preserves upstream term order: https://github.com/cosinekitty/astronomy/blob/865d3da7d8112bbc7911238052c6af4aaf877181/source/js/astronomy.ts#L555
private val DAYS_PER_MILLENNIUM = 365250

private fun earthLon(t: Double): Double {
    var tpower = 1.0
    var coord = 0.0
    var sum: Double
    var incr: Double
    sum = 0.0
    sum += 1.75347045673
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
    incr %= PI2
    coord += incr
    tpower *= t
    sum = 0.0
    sum += 6283.07584999140
    sum += 0.00206058863 * cos(2.67823455808 + (t * 6283.07584999140))
    sum += 0.00004303419 * cos(2.63512233481 + (t * 12566.15169998280))
    incr = tpower * sum
    incr %= PI2
    coord += incr
    tpower *= t
    sum = 0.0
    sum += 0.00008721859 * cos(1.07253635559 + (t * 6283.07584999140))
    incr = tpower * sum
    incr %= PI2
    coord += incr
    tpower *= t
    return coord
}

private fun earthLat(t: Double): Double {
    var tpower = 1.0
    var coord = 0.0
    var sum: Double
    var incr: Double
    sum = 0.0
    incr = tpower * sum
    coord += incr
    tpower *= t
    sum = 0.0
    sum += 0.00227777722 * cos(3.41376620530 + (t * 6283.07584999140))
    sum += 0.00003805678 * cos(3.37063423795 + (t * 12566.15169998280))
    incr = tpower * sum
    coord += incr
    tpower *= t
    return coord
}

private fun earthRad(t: Double): Double {
    var tpower = 1.0
    var coord = 0.0
    var sum: Double
    var incr: Double
    sum = 0.0
    sum += 1.00013988784
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
    sum = 0.0
    sum += 0.00103018607 * cos(1.10748968172 + (t * 6283.07584999140))
    sum += 0.00001721238 * cos(1.06442300386 + (t * 12566.15169998280))
    incr = tpower * sum
    coord += incr
    tpower *= t
    sum = 0.0
    sum += 0.00004359385 * cos(5.78455133808 + (t * 6283.07584999140))
    incr = tpower * sum
    coord += incr
    tpower *= t
    return coord
}

internal fun vsopRotate(eclip: Vec3): Vec3 {
    return Vec3(eclip.x + 0.000000440360*eclip.y - 0.000000190919*eclip.z, -0.000000479966*eclip.x + 0.917482137087*eclip.y - 0.397776982902*eclip.z, 0.397776982902*eclip.y + 0.917482137087*eclip.z)
}

internal fun vsopSphereToRect(lon: Double, lat: Double, radius: Double): Vec3 {

    val r_coslat = radius * cos(lat)
    val coslon = cos(lon)
    val sinlon = sin(lon)
    return Vec3(r_coslat * coslon, r_coslat * sinlon, radius * sin(lat))
}

internal fun earthHelioDistance(tt: Double): Double = earthRad(tt / 365250)

internal fun earthHelioVector(tt: Double): Vec3 {
    val t = tt / DAYS_PER_MILLENNIUM
    val lon = earthLon(t)
    val lat = earthLat(t)
    val rad = earthRad(t)
    val eclip = vsopSphereToRect(lon, lat, rad)
    return vsopRotate(eclip)
}

internal fun sunGeoVectorEqj(tt: Double): Vec3 {
    var ltime = tt
    var dt = 0.0
    repeat(10) {

        val earth = earthHelioVector(ltime)
        val pos = Vec3(-earth.x, -earth.y, -earth.z)
        val lt = sqrt(pos.x*pos.x + pos.y*pos.y + pos.z*pos.z) / C_AUDAY

        if (lt > 1.0)
            error("Object is too distant for light-travel solver.")

        val ltime2 = tt - lt
        dt = abs(ltime2 - ltime)
        if (dt < 1.0e-9)
            return pos
        ltime = ltime2
    }
    error("Light-travel time solver did not converge: dt = $dt")
}

internal fun sunGeoVector(tt: Double): Vec3 {
    return gyration(sunGeoVectorEqj(tt), tt, PrecessDirection.From2000)
}
