# Almanac for Kotlin

Native Kotlin/JVM implementation of the [Almanac contract](../docs/CONTRACT.md): all 35 astronomy functions, the same immutable result fields, and the shared JPL Horizons, USNO, NASA/Espenak, and cross-port parity fixtures.

The library uses `java.time.Instant`, Kotlin 2.2.0, JDK 17 to build, and JVM 8 bytecode. Android consumers need minSdk 26. Runtime dependencies are the Kotlin standard library and platform APIs; there are no runtime data files, network calls, or JavaScript engine. Android device validation is pending.

## Consume from source

Check out the repository at a reviewed commit SHA under your project's `vendor/almanac` directory, retaining `typescript/package.json`, `LICENSE`, and `NOTICE`. The manifest supplies the library version. A Git submodule can pin that SHA; Maven publication is deferred.

In the consumer's `settings.gradle.kts`:

```kotlin
includeBuild("vendor/almanac/kotlin") {
    dependencySubstitution {
        substitute(module("io.openwaters:almanac")).using(project(":"))
    }
}
```

In `build.gradle.kts`, use the version from the pinned checkout's `typescript/package.json`:

```kotlin
dependencies {
    implementation("io.openwaters:almanac:0.8.0")
}
```

The independent [`smoke`](smoke) composite build demonstrates source consumption without accessing internal helpers.

```kotlin
import io.openwaters.almanac.*
import java.time.Instant

val observer = Observer(48.4284, -123.3656, elevationM = 2.0)
val start = Instant.parse("2026-03-20T00:00:00Z")
val end = start.plusSeconds(86400)
val sun = sunAltAz(start, observer)
val events = sunEvents(start, end, observer, heightAboveGroundM = 2.0)
val golden = sunAltitudeEvents(start, end, observer, altitudeDeg = 6.0)
val moon = moonIllumination(start)
val venus = planetPosition(Planet.VENUS, start)
val eclipse = nextGlobalSolarEclipse(start)
val line = solarEclipseCentralLine(eclipse.peak, stepSeconds = 60)
val eotMinutes = equationOfTime(start)
```

Functions keep the TypeScript names and parameter order. Result fields have the same names; kinds are uppercase enum members such as `SunEventKind.RISE`, and `toString()` gives the shared contract string (`rise`). Optional contacts and ground points are nullable.

Inputs and outputs truncate to integer epoch milliseconds toward zero. Ordinary instants must be in `[1950-01-01T00:00Z, 2101-01-01T00:00Z)`; a window end may equal the upper bound. Windows are half-open and validated before empty results. Next/previous eclipse searches skip peaks within 100 ms of their anchor.

Invalid arguments throw `IllegalArgumentException`; unsupported instants or an eclipse search reaching the supported boundary throw `AlmanacOutOfRangeException`, its subtype. Internal non-convergence throws `IllegalStateException`.

## Verify

From `kotlin/`, with JDK 17 available:

```bash
./gradlew test jacocoTestReport jacocoTestCoverageVerification
./gradlew -p smoke run
./gradlew jar
```

JaCoCo requires 100% handwritten LINE coverage. Only coefficient declarations in `MoonTables.kt` and `PlanetModels.kt` are excluded; integrity tests compare every copied value to TypeScript by IEEE-754 bits and source order. Parity recomputes all 13 corpus families, writes and reads temporary JSON, and compares exact structures with at most five scaled units or one 100 ms quantum. External fixtures retain their existing physical tolerances.

The JAR includes MIT `LICENSE` and upstream `NOTICE`. Kotlin benchmarking and Maven publishing are deferred; the existing performance harness continues to cover TypeScript and Swift.
