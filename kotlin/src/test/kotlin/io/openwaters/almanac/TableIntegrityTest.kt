package io.openwaters.almanac

import java.io.File
import kotlin.test.*
import kotlinx.serialization.json.*

internal class TableIntegrityTest {
    private val number = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?"
    private fun source(name: String): String = File(File(System.getProperty("fixtures")).parentFile, "typescript/src/$name.ts").readText()

    @Test fun moonCoefficientsAndIndicesRetainEverySourceBit() {
        val source = source("moon")
        val blocks = Regex("\\{\\s*let x = 1;\\s*let y = 0;.*?SINPI \\+=.*?\\n    \\}", RegexOption.DOT_MATCHES_ALL).findAll(source).toList()
        assertEquals(104, blocks.size)
        assertEquals(blocks.size, MOON_INDICES.size)
        assertEquals(blocks.size, MOON_COEFF.size)
        for ((i, block) in blocks.withIndex()) {
            val indices = Regex("c = coArray\\[(\\d+)]; si = siArray\\[(\\d+)];").findAll(block.value).map {
                assertEquals(it.groupValues[1], it.groupValues[2])
                it.groupValues[1].toInt()
            }.toList()
            assertTrue(indices.isNotEmpty())
            assertEquals(indices, MOON_INDICES[i].toList())
            val coefficients = listOf("DLAM", "DS", "GAM1C", "SINPI").map { name ->
                val matches = Regex("$name \\+= ($number) \\* [xy];").findAll(block.value).toList()
                assertEquals(1, matches.size, "unrecognized $name row $i")
                matches.single().groupValues[1].toDouble().toBits()
            }
            assertEquals(coefficients, MOON_COEFF[i].map { it.toBits() }, "term $i")
        }
        val n = Regex("N \\+= ADDN\\(([^)]+)\\);").findAll(source).toList()
        assertEquals(10, n.size)
        assertEquals(n.size, MOON_N_INDICES.size)
        assertEquals(n.size, MOON_N_COEFF.size)
        for ((i, row) in n.withIndex()) {
            val values = row.groupValues[1].split(',').map { it.trim() }
            assertEquals(5, values.size)
            assertTrue(values.all { Regex(number).matches(it) })
            assertEquals(values[0].toDouble().toBits(), MOON_N_COEFF[i].toBits())
            assertEquals(values.drop(1).map { it.toInt() }, MOON_N_INDICES[i].toList())
        }
    }

    @Test fun planetaryModelsRetainEveryCoefficientAndSeriesShape() {
        val declaration = source("planetModels").substringAfter("const models:").substringAfter("= ").substringBeforeLast(';')
        val json = declaration.replace(Regex("(\\w+):"), "\"$1\":").replace(Regex(",\\s*([}\\]])"), "$1")
        val models = Json.parseToJsonElement(json).jsonObject
        assertEquals(7, models.size)
        assertEquals(models.keys, PLANET_MODELS.keys.map { it.toString() }.toSet())
        var terms = 0
        for ((name, element) in models) {
            val expected = element.jsonArray
            val actual = PLANET_MODELS.getValue(Planet.entries.single { it.toString() == name })
            assertEquals(3, expected.size)
            assertEquals(expected.size, actual.size)
            for ((i, formula) in expected.withIndex()) {
                assertEquals(formula.jsonArray.size, actual[i].size)
                for ((j, series) in formula.jsonArray.withIndex()) {
                    assertEquals(series.jsonArray.size, actual[i][j].size)
                    for ((k, term) in series.jsonArray.withIndex()) {
                        assertEquals(3, term.jsonArray.size)
                        assertEquals(term.jsonArray.map { it.jsonPrimitive.double.toBits() }, actual[i][j][k].map { it.toBits() }, "$name $i $j $k")
                        terms++
                    }
                }
            }
        }
        assertEquals(1059, terms)
    }
}
