/// Converts degrees to radians without wrapping the angle.
public func degreesToRadians(_ degrees: Double) throws -> Double {
    guard degrees.isFinite else { throw AlmanacError.invalidArgument("degrees must be finite") }
    return degrees * DEG2RAD
}

/// Converts radians to degrees without wrapping the angle.
public func radiansToDegrees(_ radians: Double) throws -> Double {
    guard radians.isFinite else { throw AlmanacError.invalidArgument("radians must be finite") }
    return radians * RAD2DEG
}
