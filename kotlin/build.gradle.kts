import groovy.json.JsonSlurper
import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    kotlin("jvm") version "2.2.0"
    jacoco
}

group = "io.openwaters"
version = (JsonSlurper().parse(file("../typescript/package.json")) as Map<*, *>)["version"] as String
repositories { mavenCentral() }
kotlin {
    explicitApi()
    jvmToolchain(17)
    compilerOptions { jvmTarget = JvmTarget.JVM_1_8 }
}
java {
    sourceCompatibility = JavaVersion.VERSION_1_8
    targetCompatibility = JavaVersion.VERSION_1_8
}
dependencies {
    testImplementation(platform("org.junit:junit-bom:5.12.2"))
    testImplementation(kotlin("test-junit5"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.8.1")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
tasks.test {
    useJUnitPlatform()
    systemProperty("fixtures", layout.projectDirectory.dir("../fixtures").asFile.absolutePath)
}
tasks.jar {
    from(files("../LICENSE", "../NOTICE")) { into("META-INF") }
}
jacoco { toolVersion = "0.8.13" }
tasks.jacocoTestReport {
    dependsOn(tasks.test)
    reports { xml.required = true; html.required = true }
    classDirectories.setFrom(sourceSets.main.get().output.asFileTree.matching {
        exclude("io/openwaters/almanac/MoonTablesKt.class", "io/openwaters/almanac/PlanetModelsKt.class")
    })
}
tasks.jacocoTestCoverageVerification {
    dependsOn(tasks.test)
    classDirectories.setFrom(tasks.jacocoTestReport.get().classDirectories)
    violationRules {
        rule { limit { counter = "LINE"; minimum = "1.0".toBigDecimal() } }
    }
}
