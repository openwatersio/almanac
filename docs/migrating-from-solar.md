# Migrating from Solar

Almanac's Swift package computes everything [Solar](https://github.com/ceeK/Solar) 4.0.1 does, so replacing Solar takes no new dependency and no new math. The main changes: events come back as a sorted list for any time window you choose, instead of eight optional properties for one day, so your code decides which day it wants; a place is an `Observer(latitudeDeg:longitudeDeg:)`, which throws `AlmanacError.invalidObserver` where Solar's initializer returns `nil`; every time is a UTC `Date`; and the supported interval is 1950 through 2100, where any instant outside it throws `AlmanacError.outOfRange`. Almanac reports a missing event by leaving it out of the list.

To swap Solar out mechanically, paste the `Solar` adapter below into your app, remove the Solar package, and change each `Solar(for: date, coordinate: coordinate)` to `Solar(for: date, latitude: coordinate.latitude, longitude: coordinate.longitude)`. Code that reads `coordinate` reads `latitude` and `longitude` instead. Everything else keeps compiling and gets the same day's events, within a minute away from the poles. The adapter takes latitude and longitude instead of a `CLLocationCoordinate2D` because CoreLocation is not available on Linux; on Apple platforms you can pass a coordinate's two fields as shown. If your code really wants today's events in the user's time zone, which is usually the case, use `dayEvents` instead.

Every Swift example here runs in the test suite (`swift/Tests/AlmanacTests/MigrationGuideTests.swift`), which checks the adapter against output recorded from Solar 4.0.1 (`swift/Tests/solar-4.0.1.json`) within the differences stated below.

## Mapping

| Solar 4.0.1 | Almanac | Notes |
| --- | --- | --- |
| `Solar(for: date, coordinate:)`, which returns `nil` for an invalid coordinate | `Observer(latitudeDeg:longitudeDeg:)`, which throws `AlmanacError.invalidObserver` | The adapter's `init?(for:latitude:longitude:)` returns `nil` instead, as Solar does. `date` defaults to now in both. |
| `coordinate` | `latitude` and `longitude` on the adapter, or `latitudeDeg` and `longitudeDeg` on `Observer` | |
| `date` | The adapter's `date` | Solar's `date` can't be set from outside the type, and neither can the adapter's. Make a new value for a new date. |
| `sunrise`, `sunset` | `sunEvents(from:to:observer:)` kinds `.rise`, `.set` | Solar uses a fixed zenith of 90.83°. Almanac uses the Sun's upper limb with its true semidiameter at its current distance, plus 34′ of refraction. |
| `civilSunrise`, `civilSunset` | `.civilDawn`, `.civilDusk` | The Sun's center 6° below the horizon (Solar's zenith 96°). |
| `nauticalSunrise`, `nauticalSunset` | `.nauticalDawn`, `.nauticalDusk` | 12° below (zenith 102°). |
| `astronomicalSunrise`, `astronomicalSunset` | `.astroDawn`, `.astroDusk` | 18° below (zenith 108°). |
| `calculate()` | Call `sunEvents` with a new window | Because `date` can't change from outside, Solar's `calculate()` recomputes the same values. The adapter keeps it so existing calls compile. |
| `isDaytime` | `sunAltAz(_:observer:).altDeg > -0.27`, the Sun's upper limb above the horizon | Solar needs both a sunrise and a sunset to call it daytime, so it reports night all through polar day; the adapter reports day. |
| `isNighttime` | `!isDaytime` | |

Solar's days are not your calendar days. Solar takes the UTC calendar day of `date` and looks for each morning event near 06:00 and each evening event near 18:00 local mean solar time, the clock time the Sun keeps at that longitude. West of Greenwich an evening event can fall on the next UTC date, and east of it a morning event on the previous one. In Victoria, `Solar(for:)` at 7 pm on June 21 local time already has a UTC day of June 22, and reports June 22's sunrise and the sunset after that, more than a day ahead. The adapter reproduces this; `dayEvents` gives the local day instead.

## Accuracy

Solar uses the approximate sunrise algorithm from the US Naval Observatory's *Almanac for Computers*, works out the Sun's position once for each event at its 06:00 or 18:00 starting point, and drops fractions of a second. Almanac solves each event from the Sun's position at that moment. The worst differences between the adapter and Solar 4.0.1 across the recorded cases, rounded up to the whole second:

| Event | Victoria, Sydney, Suva, Pago Pago (34°S to 49°N) | Longyearbyen (78°N) |
| --- | --- | --- |
| `sunrise` | 48 s | 160 s |
| `sunset` | 43 s | 172 s |
| `civilSunrise` | 44 s | 144 s |
| `civilSunset` | 48 s | 244 s |
| `nauticalSunrise` | 41 s | 449 s |
| `nauticalSunset` | 52 s | 7 s |
| `astronomicalSunrise` | 40 s | 9 s |
| `astronomicalSunset` | 59 s | 5 s |

The cases are the March and September equinoxes and the June and December solstices of 2026 at each place, plus Victoria at 7 pm local time on June 21. Near the poles the Sun crosses each altitude at a shallow angle, so a small difference in its computed position moves the time by minutes; Longyearbyen's largest difference is the nautical dawn at the March equinox, when the Sun barely dips below 12°. In every recorded case, including Longyearbyen's polar day and polar night, Solar and the adapter agree on which events happen and which are `nil`. Suva (178.4°E) and Pago Pago (170.7°W) check the previous- and next-UTC-date cases.

## The adapter

```swift
/// Solar 4.0.1's `Solar`, computed by Almanac. It takes `latitude` and `longitude` where Solar takes a `CLLocationCoordinate2D`, because CoreLocation is not available on Linux.
struct Solar {
    let latitude: Double
    let longitude: Double
    private(set) var date: Date

    private(set) var sunrise: Date?
    private(set) var sunset: Date?
    private(set) var civilSunrise: Date?
    private(set) var civilSunset: Date?
    private(set) var nauticalSunrise: Date?
    private(set) var nauticalSunset: Date?
    private(set) var astronomicalSunrise: Date?
    private(set) var astronomicalSunset: Date?

    private let observer: Observer

    init?(for date: Date = Date(), latitude: Double, longitude: Double) {
        guard let observer = try? Observer(latitudeDeg: latitude, longitudeDeg: longitude) else { return nil }
        self.date = date
        self.latitude = latitude
        self.longitude = longitude
        self.observer = observer
        calculate()
    }

    mutating func calculate() {
        let morning = events(near: 6)
        let evening = events(near: 18)
        sunrise = morning[.rise]
        sunset = evening[.set]
        civilSunrise = morning[.civilDawn]
        civilSunset = evening[.civilDusk]
        nauticalSunrise = morning[.nauticalDawn]
        nauticalSunset = evening[.nauticalDusk]
        astronomicalSunrise = morning[.astroDawn]
        astronomicalSunset = evening[.astroDusk]
    }

    /// Whether the Sun's upper limb is above the horizon at `date`: the refracted altitude of its center is above minus its semidiameter, about 0.27°.
    var isDaytime: Bool {
        guard let altitude = try? sunAltAz(date, observer: observer).altDeg else { return false }
        return altitude > -0.27
    }

    var isNighttime: Bool { !isDaytime }

    /// Solar's day: the UTC calendar day of `date`, searched 12 hours either side of `hour` o'clock local mean solar time. West of Greenwich a sunset can fall on the next UTC date, and east of it a sunrise on the previous one.
    private func events(near hour: Double) -> [SunEventKind: Date] {
        let midnight = (date.timeIntervalSince1970 / 86400).rounded(.down) * 86400
        let seed = Date(timeIntervalSince1970: midnight + (hour - longitude / 15) * 3600)
        let found = (try? sunEvents(from: seed.addingTimeInterval(-43200), to: seed.addingTimeInterval(43200), observer: observer)) ?? []
        var nearest: [SunEventKind: Date] = [:]
        for event in found where nearest[event.kind].map({ abs(event.time.timeIntervalSince(seed)) < abs($0.timeIntervalSince(seed)) }) ?? true {
            nearest[event.kind] = event.time
        }
        return nearest
    }
}
```

A property is `nil` when the Sun doesn't reach that altitude in the window, as in Solar. Near the poles a window can hold two of an event, when the Sun sets and rises again minutes later; the adapter keeps the one nearest the 06:00 or 18:00 starting point. For a date outside 1950 through 2100 every property is `nil` and `isDaytime` is `false`, since Almanac doesn't compute there.

## Examples

### Today's sunset

```swift
// Solar
import CoreLocation
import Solar

func sunsetToday(at coordinate: CLLocationCoordinate2D) -> Date? {
    Solar(coordinate: coordinate)?.sunset
}
```

```swift
func sunsetToday(latitude: Double, longitude: Double) -> Date? {
    Solar(latitude: latitude, longitude: longitude)?.sunset
}
```

On an Apple platform, call it as `sunsetToday(latitude: coordinate.latitude, longitude: coordinate.longitude)`.

### Events for the local calendar day

Solar's UTC day is rarely the day a user means. `dayEvents` searches the calendar day containing `date` in a time zone, from local midnight to the next, so a daylight saving change is handled by `Calendar`. It returns the first of each kind, keyed by `SunEventKind`, and includes `.transit`, the Sun's highest point, which Solar doesn't compute.

```swift
/// The first of each Sun event in the calendar day containing `date` in `timeZone`. A kind is missing when the Sun does not reach its altitude that day.
func dayEvents(on date: Date, in timeZone: TimeZone, latitude: Double, longitude: Double) throws -> [SunEventKind: Date] {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = timeZone
    let day = calendar.dateInterval(of: .day, for: date)!
    let observer = try Observer(latitudeDeg: latitude, longitudeDeg: longitude)
    var first: [SunEventKind: Date] = [:]
    for event in try sunEvents(from: day.start, to: day.end, observer: observer) where first[event.kind] == nil {
        first[event.kind] = event.time
    }
    return first
}
```

```swift
// Solar
let solar = Solar(for: date, coordinate: CLLocationCoordinate2D(latitude: 48.4284, longitude: -123.3656))
let sunset = solar?.sunset
let civilDusk = solar?.civilSunset
```

```swift
func eveningInVictoria(_ date: Date) throws -> (sunset: Date?, civilDusk: Date?) {
    let times = try dayEvents(on: date, in: TimeZone(identifier: "America/Vancouver")!, latitude: 48.4284, longitude: -123.3656)
    return (times[.set], times[.civilDusk])
}
```

At 7 pm on June 21 in Victoria, Solar's `sunset` is June 22's, while `eveningInVictoria` returns the sunset at 9:18 pm that same evening.

### Other altitudes and positions

For an altitude Solar has no property for, such as golden hour at 6°, use `sunAltitudeEvents(from:to:observer:altitudeDeg:)`, which returns every crossing in the window as `.rising` or `.falling`. For the Sun's position at any instant, use `sunAltAz(_:observer:)`, which gives refracted altitude and azimuth in degrees, azimuth measured from north through east.
