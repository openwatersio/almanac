import Foundation

/// Apparent horizon altitude below the horizontal plane; eye height is measured above the unobstructed surface.
public func horizonDip(observer: Observer, heightAboveGroundM: Double) throws -> Double {
    let ground = observer.elevationM - heightAboveGroundM
    guard heightAboveGroundM >= 0, heightAboveGroundM <= 10000, ground >= -500, ground <= 10000 else {
        throw AlmanacError.invalidArgument("eye height or ground elevation out of range")
    }
    if heightAboveGroundM == 0 { return 0 }

    // Translated from HorizonDipAngle at cosinekitty/astronomy commit 865d3da7d8112bbc7911238052c6af4aaf877181.
    let phi = observer.latitudeDeg * DEG2RAD
    let sinphi = sin(phi)
    let cosphi = cos(phi)
    let c = 1 / hypot(cosphi, sinphi * EARTH_FLATTENING)
    let s = c * (EARTH_FLATTENING * EARTH_FLATTENING)
    let htKm = ground / 1000
    let ach = EARTH_EQUATORIAL_RADIUS_KM * c + htKm
    let ash = EARTH_EQUATORIAL_RADIUS_KM * s + htKm
    let radiusM = 1000 * hypot(ach * cosphi, ash * sinphi)
    let k = 0.175 * pow(1 - (6.5e-3 / 283.15) * (observer.elevationM - (2.0 / 3.0) * heightAboveGroundM), 3.256)
    return RAD2DEG * -(sqrt(2 * (1 - k) * heightAboveGroundM / radiusM) / (1 - k))
}
