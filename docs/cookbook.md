# Cookbook

## Day and night for a display

`sunIsUp` answers whether any part of the Sun clears the modeled, unobstructed horizon at an instant. It uses the same changing solar radius, standard refraction convention, topocentric position, and optional horizon dip as `sunEvents` sunrise and sunset. It works during midnight sun and polar night without searching for events or choosing a calendar day.

TypeScript:

```ts
import { sunIsUp } from '@openwaters/almanac';

const observer = { latitudeDeg: 70.5, longitudeDeg: 0 };
const mode = sunIsUp(new Date(), observer) ? 'day' : 'night';
```

Swift:

```swift
import Almanac
import Foundation

let observer = try Observer(latitudeDeg: 70.5, longitudeDeg: 0)
let mode = try sunIsUp(Date(), observer: observer) ? "day" : "night"
```

Kotlin:

```kotlin
import io.openwaters.almanac.*
import java.time.Instant

val observer = Observer(70.5, 0.0)
val mode = if (sunIsUp(Instant.now(), observer)) "day" else "night"
```

Eye height is separate from elevation. For a viewer two meters above sea level, set `observer.elevationM` to `2` and pass `heightAboveGroundM = 2`; omitting the height uses the horizontal plane at the observer. The function validates the same eye-height and ground-elevation limits as `horizonDip`.

The result describes the astronomical horizon; terrain, clouds, and eclipses do not change it. A fixed threshold on `sunAltAz().altDeg` is an approximation because that altitude includes position refraction and the Sun's radius changes with distance. `sunIsUp` instead compares unrefracted geometry with the event solver's upper-limb target.

An application chooses whether sunrise/set is the right display policy. Civil twilight can be useful when a screen should stay bright after sunset; `sunEvents` provides its dawn and dusk crossings. The application also chooses refresh timing and how to handle missing positions or errors. Invalid inputs and dates outside 1950–2100 throw the normal validation or out-of-range errors.
