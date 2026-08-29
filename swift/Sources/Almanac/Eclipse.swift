import Foundation

// L3 lunar eclipses: the Earth's shadow cone against the Moon at every full
// moon — peak time, contact times, magnitudes, and whether an observer can see
// any of it.
//
// Translated from the cosinekitty/astronomy upstream, pinned sha
// 865d3da7d8112bbc7911238052c6af4aaf877181, source/js/astronomy.ts:
//   CalcShadow (~8458), EarthShadow (~8470), ShadowDistanceSlope (~8535),
//   PeakEarthShadow (~8553), ShadowSemiDurationMinutes (~8603),
//   MoonEclipticLatitudeDegrees (~8616) and SearchLunarEclipse (~8710).
// Constants and operation order are preserved so this stays a line-for-line
// translation of typescript/src/eclipse.ts.
//
// Two deliberate departures from upstream, both spec-driven:
//   - the full-moon probe is this package's `searchMoonPhase`, whose longitudes
//     are apparent rather than upstream's geometric (see Events.swift). It only
//     seeds a ±0.03 d peak search, so the ~40 s difference cannot change a
//     result.
//   - upstream reports semi-durations in minutes; the spec's public shape is
//     the contact instants themselves, and `obscuration` is not in it.
//
// One departure from the TS port, not upstream: Swift's type system makes
// `p1`/`peak`/`p4` non-optional Dates and `kind` a closed enum, so the
// TS validator's "unknown kind" and "undefined vs null" cases (see
// eclipse.test.ts's fix-round note) cannot occur here — there is nothing to
// guard. What remains meaningful, and is ported, is contact chronology among
// whichever contacts are present and kind↔contact-shape agreement.

/// A lunar eclipse: peak circumstances plus the contact instants around them.
public enum LunarEclipseKind: String, Sendable {
    case penumbral, partial, total
}

/// A lunar eclipse: peak circumstances plus the contact instants around them.
public struct LunarEclipse: Sendable {
    /// `total` if the Moon is fully inside the umbra, `partial` if it touches
    /// the umbra at all, otherwise `penumbral`.
    public let kind: LunarEclipseKind
    /// Greatest eclipse — when the Moon's centre passes closest to the shadow axis.
    public let peak: Date
    /// Fraction of the Moon's diameter inside the umbra at peak; negative when the umbra is missed entirely.
    public let magUmbral: Double
    /// Fraction of the Moon's diameter inside the penumbra at peak.
    public let magPenumbral: Double
    /// First penumbral contact.
    public let p1: Date
    /// First umbral contact — `nil` for a penumbral eclipse.
    public let u1: Date?
    /// Start of totality — `nil` unless the eclipse is total.
    public let u2: Date?
    /// End of totality — `nil` unless the eclipse is total.
    public let u3: Date?
    /// Last umbral contact — `nil` for a penumbral eclipse.
    public let u4: Date?
    /// Last penumbral contact.
    public let p4: Date

    public init(
        kind: LunarEclipseKind, peak: Date, magUmbral: Double, magPenumbral: Double,
        p1: Date, u1: Date?, u2: Date?, u3: Date?, u4: Date?, p4: Date
    ) {
        self.kind = kind; self.peak = peak; self.magUmbral = magUmbral; self.magPenumbral = magPenumbral
        self.p1 = p1; self.u1 = u1; self.u2 = u2; self.u3 = u3; self.u4 = u4; self.p4 = p4
    }
}

/// Per-contact horizon test; `nil` exactly where the eclipse has no such contact.
public struct LunarEclipseContactsVisible: Sendable {
    public let p1: Bool
    public let u1: Bool?
    public let u2: Bool?
    public let u3: Bool?
    public let u4: Bool?
    public let p4: Bool

    public init(p1: Bool, u1: Bool?, u2: Bool?, u3: Bool?, u4: Bool?, p4: Bool) {
        self.p1 = p1; self.u1 = u1; self.u2 = u2; self.u3 = u3; self.u4 = u4; self.p4 = p4
    }
}

/// Which of an eclipse's contacts happen with the Moon above the observer's horizon.
public struct LunarEclipseVisibility: Sendable {
    /// True when the Moon's centre is geometrically above the horizon at peak.
    public let visibleAtPeak: Bool
    /// Unrefracted topocentric altitude of the Moon's centre at peak, degrees.
    public let moonGeometricAltAtPeakDeg: Double
    public let contactsVisible: LunarEclipseContactsVisible

    public init(visibleAtPeak: Bool, moonGeometricAltAtPeakDeg: Double, contactsVisible: LunarEclipseContactsVisible) {
        self.visibleAtPeak = visibleAtPeak
        self.moonGeometricAltAtPeakDeg = moonGeometricAltAtPeakDeg
        self.contactsVisible = contactsVisible
    }
}

/** UPSTREAM: `EARTH_MEAN_RADIUS_KM` + `EARTH_ATMOSPHERE_KM`, astronomy.ts 142-144.
 *  The 88 km of atmosphere is what makes the umbra match observed eclipse
 *  magnitudes; it is not the geometric Earth radius. */
private let earthEclipseRadiusKm = 6371.0 + 88.0

/** UPSTREAM: `PruneLatitude`, inside `SearchLunarEclipse` — full-Moon ecliptic
 *  latitude above which no eclipse is possible. */
private let pruneLatitudeDeg = 1.8

/** Spec: the search gives up after two years. The catalog's longest gap between
 *  consecutive lunar eclipses over 1950-2100 is under a year. */
private let scanLimitDays = 730.0

/** Upstream's `PeakEarthShadow` window, in days, either side of the full moon. */
private let peakWindowDays = 0.03

/** Upstream's outermost `ShadowSemiDurationMinutes` window, in minutes. */
private let penumbralWindowMinutes = 200.0

private let minutesPerDay = 24.0 * 60.0

/** Root-finder tolerance for every shadow search, seconds — upstream's `Search` default. */
private let shadowTolSeconds = 1.0

/** UPSTREAM: `Search`'s default `iter_limit`. */
private let shadowIterCap = 20

/**
 * How close a candidate peak may sit to `after` and still be judged the same
 * eclipse, milliseconds.
 *
 * A peak is only reproducible to about a millisecond: the full-moon seed comes
 * from a root finder with a 0.1 s tolerance, and the ±0.03 d peak-shadow window
 * built around it therefore differs slightly between two calls that reach the
 * same eclipse from different starting times, which moves the interpolated root
 * by an observed ≤1 ms. A caller walking the catalog by feeding each peak back
 * in would otherwise re-find that eclipse whenever the second evaluation landed
 * a millisecond later.
 *
 * The band cuts both ways, and both are bounded:
 *   - it can never swallow a real eclipse — consecutive lunar eclipses are
 *     never less than a month apart, 25 million times this window;
 *   - it *can* skip an eclipse the caller genuinely wanted: `after` set inside
 *     the 100 ms before a peak returns the eclipse after it, not that one.
 *     That is the accepted cost, and 100 ms is its ceiling — against a peak
 *     model that agrees with the Espenak catalog to ~15 s, a caller cannot have
 *     meant a boundary that sharp.
 */
private let sameEclipseMs = 100.0

/**
 * UPSTREAM: `ShadowInfo` (astronomy.ts ~8445), reduced to what the lunar case
 * reads. Upstream's `target`/`dir` vectors are inputs kept for the solar-eclipse
 * paths this package does not implement, and its `time` is an `AstroTime`;
 * here the instant travels as days since J2000 UT, as everywhere in L3.
 */
private struct ShadowInfo {
    /** Days since J2000 (UT). */
    let ut: Double
    /** Shadow-axis parameter: distance to the shadow plane over the casting body's distance. */
    let u: Double
    /** Distance from the Moon's centre to the shadow axis, km. */
    let r: Double
    /** Umbra radius at the shadow plane, km. */
    let k: Double
    /** Penumbra radius at the shadow plane, km. */
    let p: Double
}

/** UPSTREAM: `CalcShadow`, astronomy.ts ~8458. */
private func calcShadow(_ bodyRadiusKm: Double, _ ut: Double, _ target: Vec3, _ dir: Vec3) -> ShadowInfo {
    let u = (dir.x*target.x + dir.y*target.y + dir.z*target.z) / (dir.x*dir.x + dir.y*dir.y + dir.z*dir.z)
    let dx = (u * dir.x) - target.x
    let dy = (u * dir.y) - target.y
    let dz = (u * dir.z) - target.z
    let r = KM_PER_AU * (dx*dx + dy*dy + dz*dz).squareRoot()
    let k = sunRadiusKm - (1.0 + u)*(sunRadiusKm - bodyRadiusKm)
    let p = -sunRadiusKm + (1.0 + u)*(sunRadiusKm + bodyRadiusKm)
    return ShadowInfo(ut: ut, u: u, r: r, k: k, p: p)
}

/**
 * UPSTREAM: `EarthShadow`, astronomy.ts ~8470 — the Earth's shadow cone
 * evaluated where the Moon is. `e = -s` is the path of sunlight through the
 * centre of the Earth; both vectors are EQJ, and `CalcShadow` only ever takes
 * dot products and a norm of them, so the frame cancels.
 */
private func earthShadow(_ ut: Double) -> ShadowInfo {
    let tt = ttDaysFromUt(ut)
    // Light-travel and aberration corrected vector from the Earth to the Sun.
    let s = sunGeoVectorEqj(tt)
    let e = Vec3(x: -s.x, y: -s.y, z: -s.z)
    // Geocentric moon.
    let m = moonGeoVectorEqj(tt)
    return calcShadow(earthEclipseRadiusKm, ut, m, e)
}

/** UPSTREAM: `ShadowDistanceSlope`, astronomy.ts ~8535, bound to `EarthShadow`. */
private func earthShadowSlope(_ ut: Double) -> Double {
    let dt = 1.0 / 86400.0
    return (earthShadow(ut + dt).r - earthShadow(ut - dt).r) / dt
}

/**
 * UPSTREAM: `PeakEarthShadow`, astronomy.ts ~8553 — greatest eclipse is where
 * the Moon-to-axis distance stops shrinking, i.e. the ascending zero of its
 * time derivative.
 */
private func peakEarthShadow(_ centerUt: Double) -> ShadowInfo {
    guard let ut = search(
        earthShadowSlope, centerUt - peakWindowDays, centerUt + peakWindowDays,
        shadowTolSeconds, iterLimit: shadowIterCap, what: "peak earth shadow"
    ) else {
        fatalError("almanac internal: failed to find peak Earth shadow time")
    }
    return earthShadow(ut)
}

/**
 * UPSTREAM: `ShadowSemiDurationMinutes`, astronomy.ts ~8603 — searches
 * backwards and forwards from the peak for the crossings of `radiusLimitKm`,
 * then averages the two halves, so the contacts this package reports are
 * symmetric about the peak by construction (as upstream's are).
 */
private func shadowSemiDurationMinutes(_ centerUt: Double, _ radiusLimitKm: Double, _ windowMinutes: Double) -> Double {
    let window = windowMinutes / minutesPerDay
    guard
        let t1 = search({ ut in -(earthShadow(ut).r - radiusLimitKm) }, centerUt - window, centerUt,
                         shadowTolSeconds, iterLimit: shadowIterCap, what: "shadow semiduration (before)"),
        let t2 = search({ ut in +(earthShadow(ut).r - radiusLimitKm) }, centerUt, centerUt + window,
                         shadowTolSeconds, iterLimit: shadowIterCap, what: "shadow semiduration (after)")
    else {
        fatalError("almanac internal: failed to find shadow semiduration")
    }
    return (t2 - t1) * (minutesPerDay / 2.0)   // convert days to minutes and average the semi-durations
}

/** UPSTREAM: `MoonEclipticLatitudeDegrees`, astronomy.ts ~8616. */
private func moonEclipticLatitudeDeg(_ ut: Double) -> Double {
    RAD2DEG * calcMoon(ttDaysFromUt(ut)).geoEclipLat
}

/**
 * The first lunar eclipse whose peak falls strictly after `after`.
 *
 * Every full moon within the next two years is tested: the Moon's ecliptic
 * latitude prunes the ones no shadow can reach, and the rest get a peak-shadow
 * search. Magnitudes are the fraction of the Moon's diameter inside each
 * shadow at peak, so `magUmbral` goes negative when the umbra is missed and
 * above 1 for a total eclipse.
 *
 * - Throws: `AlmanacError.invalidArgument` if `after` is non-finite,
 *   `AlmanacError.outOfRange` if `after` is outside the supported interval or
 *   the next eclipse falls at or past the end of it.
 */
public func nextLunarEclipse(after: Date) throws -> LunarEclipse {
    let after = try normalized(after)
    try assertSupported(after)
    let startUt = utDays(after)
    var fmUt = startUt

    while fmUt <= startUt + scanLimitDays {
        // Search for the next full moon. Any eclipse will be near it.
        guard let fullmoon = searchMoonPhase(180, fmUt, 40) else {
            fatalError("almanac internal: cannot find full moon")
        }
        // UPSTREAM `SearchLunarEclipse`: step past this full moon before the
        // next probe, so the same one cannot be found twice.
        fmUt = fullmoon + 10

        // Pruning: if the full Moon's ecliptic latitude is too large, a lunar
        // eclipse is not possible. Avoid needless work searching for the
        // minimum moon distance.
        if abs(moonEclipticLatitudeDeg(fullmoon)) >= pruneLatitudeDeg { continue }

        // Search near the full moon for the time when the center of the Moon
        // is closest to the line passing through the centers of the Sun and Earth.
        let shadow = peakEarthShadow(fullmoon)
        if shadow.r >= shadow.p + moonMeanRadiusKm { continue }   // not even penumbral
        // A full moon before `after` can still carry the eclipse the caller
        // already has; the spec's contract is strictly-later peaks.
        let peak = try normalized(dateFromUt(shadow.ut))
        if peak <= after.addingTimeInterval(sameEclipseMs / 1000.0) { continue }
        if peak >= supportedMax { throw AlmanacError.outOfRange }

        return try buildEclipse(shadow, peak)
    }
    // Not an AlmanacError.outOfRange: the interval is fine, the sky is not. The
    // longest real gap over 1950-2100 is 178 days, so exhausting 730 means the
    // shadow model is broken — an internal invariant, like every other
    // `almanac internal:` crash in this package.
    fatalError("almanac internal: no lunar eclipse within \(Int(scanLimitDays)) days of \(after)")
}

/** UPSTREAM: the classification and semi-duration block of `SearchLunarEclipse`, astronomy.ts ~8730-8755. */
private func buildEclipse(_ shadow: ShadowInfo, _ peak: Date) throws -> LunarEclipse {
    // This is at least a penumbral eclipse.
    var kind: LunarEclipseKind = .penumbral
    var sdTotal = 0.0
    var sdPartial = 0.0
    let sdPenum = shadowSemiDurationMinutes(shadow.ut, shadow.p + moonMeanRadiusKm, penumbralWindowMinutes)

    if shadow.r < shadow.k + moonMeanRadiusKm {
        // This is at least a partial eclipse.
        kind = .partial
        sdPartial = shadowSemiDurationMinutes(shadow.ut, shadow.k + moonMeanRadiusKm, sdPenum)

        if shadow.r + moonMeanRadiusKm < shadow.k {
            // This is a total eclipse.
            kind = .total
            sdTotal = shadowSemiDurationMinutes(shadow.ut, shadow.k - moonMeanRadiusKm, sdPartial)
        }
    }

    // Fraction of the Moon's diameter immersed in each shadow. Shadow radii,
    // axis distance and the Moon's radius all live in the same plane at the
    // Moon's distance, so the angles at that distance are these lengths over a
    // common divisor — it cancels, and the ratio is exact in km.
    let s = moonMeanRadiusKm
    let magPenumbral = (shadow.p + s - shadow.r) / (2 * s)
    let magUmbral = (shadow.k + s - shadow.r) / (2 * s)

    func at(_ offsetMinutes: Double) throws -> Date {
        try normalized(dateFromUt(shadow.ut + offsetMinutes / minutesPerDay))
    }
    let umbral = kind != .penumbral
    let total = kind == .total

    return LunarEclipse(
        kind: kind,
        peak: peak,
        magUmbral: magUmbral,
        magPenumbral: magPenumbral,
        p1: try at(-sdPenum),
        u1: umbral ? try at(-sdPartial) : nil,
        u2: total ? try at(-sdTotal) : nil,
        u3: total ? try at(+sdTotal) : nil,
        u4: umbral ? try at(+sdPartial) : nil,
        p4: try at(+sdPenum)
    )
}

/**
 * Trust boundary: `lunarEclipseVisibility` takes a plain value, which callers
 * can hand-build. A contact out of order, or missing/present against its
 * kind, would otherwise produce a silently wrong visibility answer, so the
 * shape is checked before any of it is used.
 *
 * The TS validator's "unknown kind" and "undefined-as-Date" holes have no
 * Swift equivalent: `kind` is a closed enum and `p1`/`peak`/`p4` are
 * non-optional, so those two failure classes cannot be constructed in the
 * first place. What is ported is the part that is still a real trust
 * boundary: kind↔contact-shape agreement, and chronology among whichever
 * contacts are present.
 */
private func assertLunarEclipse(_ e: LunarEclipse) throws {
    let umbral = e.kind != .penumbral
    let total = e.kind == .total
    if (e.u1 != nil) != umbral {
        throw AlmanacError.invalidArgument("\(e.kind.rawValue) lunar eclipse must \(umbral ? "" : "not ")have u1")
    }
    if (e.u2 != nil) != total {
        throw AlmanacError.invalidArgument("\(e.kind.rawValue) lunar eclipse must \(total ? "" : "not ")have u2")
    }
    if (e.u3 != nil) != total {
        throw AlmanacError.invalidArgument("\(e.kind.rawValue) lunar eclipse must \(total ? "" : "not ")have u3")
    }
    if (e.u4 != nil) != umbral {
        throw AlmanacError.invalidArgument("\(e.kind.rawValue) lunar eclipse must \(umbral ? "" : "not ")have u4")
    }

    // Strictly ascending, skipping the absent ones. Strict is safe: the
    // closest two contacts of any eclipse over 1950-2100 are five minutes
    // apart. `p1`/`peak`/`p4` are always present (non-optional), so they
    // always take part in this chain.
    let ordered: [(name: String, d: Date?)] = [
        ("p1", e.p1), ("u1", e.u1), ("u2", e.u2), ("peak", e.peak),
        ("u3", e.u3), ("u4", e.u4), ("p4", e.p4)
    ]
    var prevName = ""
    var prevMs = -Double.infinity
    for (name, maybeD) in ordered {
        guard let d = maybeD else { continue }
        let ms = d.timeIntervalSince1970 * 1000
        guard ms.isFinite else { throw AlmanacError.invalidArgument("lunar eclipse \(name) is not a valid Date") }
        guard ms > prevMs else {
            throw AlmanacError.invalidArgument("lunar eclipse contacts out of order: \(prevName) not before \(name)")
        }
        prevName = name
        prevMs = ms
    }
}

/**
 * Whether an observer can see each phase of a lunar eclipse — purely geometric:
 * the Moon's unrefracted topocentric centre must be above the horizon. A lunar
 * eclipse looks the same from everywhere it is visible at all, so there is
 * nothing else to compute.
 *
 * `contactsVisible` is `nil` exactly where `eclipse` has no such contact, so
 * its shape mirrors the eclipse's.
 *
 * - Throws: `AlmanacError.invalidArgument` if `eclipse` is structurally invalid.
 */
public func lunarEclipseVisibility(_ eclipse: LunarEclipse, observer: Observer) throws -> LunarEclipseVisibility {
    try assertLunarEclipse(eclipse)

    func altAt(_ d: Date) -> Double {
        let ut = utDays(d)
        return topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)), ut, observer).altDeg
    }
    func up(_ d: Date?) -> Bool? { d.map { altAt($0) > 0 } }

    let peakAltDeg = altAt(eclipse.peak)
    return LunarEclipseVisibility(
        visibleAtPeak: peakAltDeg > 0,
        moonGeometricAltAtPeakDeg: peakAltDeg,
        contactsVisible: LunarEclipseContactsVisible(
            p1: altAt(eclipse.p1) > 0,
            u1: up(eclipse.u1),
            u2: up(eclipse.u2),
            u3: up(eclipse.u3),
            u4: up(eclipse.u4),
            p4: altAt(eclipse.p4) > 0
        )
    )
}
