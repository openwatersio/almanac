plugins {
    kotlin("jvm") version "2.4.21"
    application
}

repositories { mavenCentral() }
kotlin { jvmToolchain(17) }
dependencies {
    implementation("io.openwaters:almanac")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.13.0")
}
application {
    mainClass = "BenchmarkKt"
    applicationDefaultJvmArgs = listOf("-Xms64m", "-Xmx256m")
}
