package io.openwaters.almanac

import java.time.Instant
import kotlin.math.abs
import kotlin.test.*
import kotlinx.serialization.json.*

internal fun lunarContacts(e: LunarEclipse): Map<String,Instant?> = linkedMapOf("p1" to e.p1,"u1" to e.u1,"u2" to e.u2,"peak" to e.peak,"u3" to e.u3,"u4" to e.u4,"p4" to e.p4)
internal fun lunarVisibleContacts(v: LunarEclipseVisibility): Map<String,Boolean?> = with(v.contactsVisible) { linkedMapOf("p1" to p1,"u1" to u1,"u2" to u2,"u3" to u3,"u4" to u4,"p4" to p4) }

internal class EclipseTest {
    companion object {
        private val catalog by lazy { fixture("eclipses/espenak-1950-2100").jsonArray.map { it.obj() } }
        private val walk by lazy {
            val found = mutableListOf<LunarEclipse>()
            var cursor = Instant.ofEpochMilli(SUPPORTED_MIN)
            while (true) {
                val e = try { nextLunarEclipse(cursor) } catch (_: AlmanacOutOfRangeException) { break }
                check(e.peak > cursor && found.size <= catalog.size)
                found.add(e)
                cursor = e.peak
            }
            found.toList()
        }
    }
    private val victoria = Observer(48.4284,-123.3656)
    private fun day(date: String): LunarEclipse = walk.single { it.peak.toString().startsWith(date) }

    @Test fun forwardWalkFindsEveryCatalogEclipseAndCircumstance() {
        assertEquals(344,walk.size)
        assertEquals(catalog.size,walk.size)
        assertTrue(walk.zipWithNext().all { it.first.peak < it.second.peak && it.second.peak.epochSecond-it.first.peak.epochSecond < 365*86400 })
        for ((i,e) in walk.withIndex()) {
            val row = catalog[i]
            assertTrue(abs(e.peak.toEpochMilli()-row.instant("peakUtc").toEpochMilli()) <= 60000)
            if (row.getValue("kindFirm").jsonPrimitive.boolean) assertEquals(row.string("kind"),e.kind.toString())
            near(e.magUmbral,row.number("magUmbral"),0.03)
            near(e.magPenumbral,row.number("magPenumbral"),0.03)
            assertTrue(e.p1 < e.peak && e.peak < e.p4)
            assertEquals(e.kind != LunarEclipseKind.PENUMBRAL,e.u1 != null && e.u4 != null)
            assertEquals(e.kind == LunarEclipseKind.TOTAL,e.u2 != null && e.u3 != null)
        }
        for (element in fixture("eclipses/contacts").jsonArray) {
            val row = element.obj()
            val contacts = lunarContacts(day(row.string("eclipse")))
            for ((name,actual) in contacts) {
                if (row.getValue(name) == JsonNull) assertNull(actual)
                else {
                    assertNotNull(actual)
                    assertTrue(abs(actual.toEpochMilli()-row.instant(name).toEpochMilli()) <= 60000,"$name $row")
                }
            }
        }
    }

    @Test fun backwardAndRangeSearchesReturnIdenticalCircumstances() {
        val backward = mutableListOf<LunarEclipse>()
        var cursor = Instant.ofEpochMilli(SUPPORTED_MAX-1)
        while (true) {
            val e = try { previousLunarEclipse(cursor) } catch (_: AlmanacOutOfRangeException) { break }
            assertTrue(e.peak < cursor && backward.size <= catalog.size)
            backward.add(e)
            cursor = e.peak
        }
        assertEquals(walk,backward.reversed())
        assertEquals(walk,lunarEclipses(Instant.ofEpochMilli(SUPPORTED_MIN),Instant.ofEpochMilli(SUPPORTED_MAX)))
        for (e in walk) {
            assertEquals(listOf(e),lunarEclipses(e.peak,e.peak.plusMillis(1)))
            assertTrue(lunarEclipses(e.peak.minusMillis(1),e.peak).isEmpty())
            assertEquals(e,nextLunarEclipse(e.peak.minusMillis(101)))
            assertEquals(e,previousLunarEclipse(e.peak.plusMillis(101)))
        }
    }

    @Test fun strictAnchorsSkipTheSameEclipseBandAndRangesUseExactBounds() {
        val e = nextLunarEclipse(Instant.parse("2026-01-01T00:00:00Z"))
        for (offset in listOf(-100L,0L,100L)) {
            assertTrue(nextLunarEclipse(e.peak.plusMillis(offset)).peak > e.peak)
            assertTrue(previousLunarEclipse(e.peak.plusMillis(offset)).peak < e.peak)
        }
        assertEquals(e,nextLunarEclipse(e.peak.minusMillis(1000)))
        val a = Instant.parse("2026-01-01T00:00:00Z")
        val b = Instant.parse("2027-01-01T00:00:00Z")
        assertEquals(lunarEclipses(a,b),lunarEclipses(a,e.peak)+lunarEclipses(e.peak,b))
        assertTrue(lunarEclipses(a,a).isEmpty())
        assertTrue(lunarEclipses(b,a).isEmpty())
        assertTrue(lunarEclipses(Instant.parse("2021-01-13T00:00:00Z"),Instant.parse("2021-01-26T11:00:04.846Z")).isEmpty())
        assertTrue(lunarEclipses(Instant.parse("2100-11-01T00:00:00Z"),Instant.ofEpochMilli(SUPPORTED_MAX)).isEmpty())
        assertFailsWith<AlmanacOutOfRangeException> { nextLunarEclipse(Instant.parse("2100-11-01T00:00:00Z")) }
        assertFailsWith<AlmanacOutOfRangeException> { previousLunarEclipse(Instant.ofEpochMilli(SUPPORTED_MIN)) }
        for (bad in listOf(Instant.MIN,Instant.MAX,Instant.ofEpochMilli(SUPPORTED_MIN-1),Instant.ofEpochMilli(SUPPORTED_MAX))) {
            assertFailsWith<AlmanacOutOfRangeException> { nextLunarEclipse(bad) }
            assertFailsWith<AlmanacOutOfRangeException> { previousLunarEclipse(bad) }
            assertFailsWith<AlmanacOutOfRangeException> { lunarEclipses(bad,a) }
        }
        assertFailsWith<AlmanacOutOfRangeException> { lunarEclipses(a,Instant.MAX) }
    }

    @Test fun visibilityUsesUnrefractedGeometryAndNullableContacts() {
        val partial = day("2026-08-28")
        assertEquals(LunarEclipseKind.PARTIAL,partial.kind)
        near(partial.magUmbral,0.93,0.03)
        assertTrue(lunarEclipseVisibility(partial,victoria).visibleAtPeak)
        assertFalse(lunarEclipseVisibility(partial,Observer(37.98,23.72)).visibleAtPeak)
        val total = day("2019-01-21")
        val v = lunarEclipseVisibility(total,victoria)
        assertTrue(lunarVisibleContacts(v).values.all { it == true })
        near(moonAltAz(total.peak,victoria).altDeg-v.moonGeometricAltAtPeakDeg,refractionDeg(v.moonGeometricAltAtPeakDeg),1e-12)
        assertTrue(abs(v.moonGeometricAltAtPeakDeg+sunAltAz(total.peak,victoria).altDeg) < 2.5)
        near(v.moonGeometricAltAtPeakDeg,41.71,0.05)
        val penumbral = lunarEclipseVisibility(day("2020-11-30"),victoria)
        assertEquals(listOf(null,null,null,null),with(penumbral.contactsVisible) { listOf(u1,u2,u3,u4) })
        val e = nextLunarEclipse(Instant.parse("2026-03-01T00:00:00Z"))
        val site = Observer(48.4284,-74.8,100.0)
        val ground = lunarEclipseVisibility(e,site)
        val raised = lunarEclipseVisibility(e,site,100.0)
        assertFalse(ground.visibleAtPeak)
        assertTrue(raised.visibleAtPeak)
        assertEquals(ground.moonGeometricAltAtPeakDeg,raised.moonGeometricAltAtPeakDeg)
        val contacts = lunarContacts(e)
        for ((name,visible) in lunarVisibleContacts(raised)) {
            val time = contacts.getValue(name)
            if (time == null) assertNull(visible)
            else {
                val ut = utDays(time)
                val alt = topoAltAzUnrefracted(moonGeoVectorEqj(ttDaysFromUt(ut)),ut,site).altDeg
                assertEquals(alt > horizonDip(site,100.0),visible)
            }
        }
    }

    @Test fun malformedShapesAndChronologyFailBeforeVisibility() {
        val total = day("2019-01-21")
        val malformed = listOf(total.copy(u3=null),total.copy(u2=null,u3=null),total.copy(kind=LunarEclipseKind.PARTIAL),total.copy(kind=LunarEclipseKind.PENUMBRAL),total.copy(peak=total.p1.minusMillis(1)),total.copy(u4=total.u3!!.minusMillis(1)),total.copy(u3=total.peak),total.copy(p4=Instant.MAX),total.copy(peak=Instant.MIN))
        for (e in malformed) assertFailsWith<IllegalArgumentException> { lunarEclipseVisibility(e,victoria) }
        assertFailsWith<IllegalArgumentException> { lunarEclipseVisibility(total,victoria,Double.NaN) }
        assertFailsWith<IllegalArgumentException> { lunarEclipseVisibility(total,victoria,-1.0) }
        assertTrue(lunarEclipseVisibility(total,victoria).visibleAtPeak)
    }
}
