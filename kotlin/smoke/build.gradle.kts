import groovy.json.JsonSlurper
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.2.0"
    application
}
repositories { mavenCentral() }
kotlin {
    jvmToolchain(17)
    compilerOptions { jvmTarget = JvmTarget.JVM_1_8 }
}
java {
    sourceCompatibility = JavaVersion.VERSION_1_8
    targetCompatibility = JavaVersion.VERSION_1_8
}
val almanacVersion = (JsonSlurper().parse(file("../../typescript/package.json")) as Map<*, *>)["version"] as String
dependencies { implementation("io.openwaters:almanac:$almanacVersion") }
application { mainClass = "SmokeKt" }
