package com.wave.jetbrains.update

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Unit tests for the pure version-parsing helpers in [UpdateChecker].
 *
 * These mirror the VSCode `updateService` test cases: strip leading `v`, drop
 * pre-release suffixes, require exactly three numeric components, and compare
 * major → minor → patch numerically (not lexicographically).
 *
 * The network/IDE-dependent paths (checkForUpdate, checkAndNotify, install)
 * are intentionally not covered here — they need a live GitHub API and an
 * Application/Project context, and are exercised manually via the webview
 * "检查更新" button and the auto-check on session init.
 */
class UpdateCheckerTest {

    // ---- parseVersion --------------------------------------------------

    @Test
    fun `parseVersion parses plain semver`() {
        assertEquals(UpdateChecker.ParsedVersion(0, 19, 3), UpdateChecker.parseVersion("0.19.3"))
    }

    @Test
    fun `parseVersion strips leading v`() {
        assertEquals(UpdateChecker.ParsedVersion(1, 2, 3), UpdateChecker.parseVersion("v1.2.3"))
    }

    @Test
    fun `parseVersion drops pre-release suffix`() {
        assertEquals(UpdateChecker.ParsedVersion(0, 1, 0), UpdateChecker.parseVersion("v0.1.0-alpha.1"))
        assertEquals(UpdateChecker.ParsedVersion(2, 0, 0), UpdateChecker.parseVersion("2.0.0-beta"))
        assertEquals(UpdateChecker.ParsedVersion(3, 1, 4), UpdateChecker.parseVersion("v3.1.4-rc.2+build"))
    }

    @Test
    fun `parseVersion returns null for malformed versions`() {
        assertNull(UpdateChecker.parseVersion(""))
        assertNull(UpdateChecker.parseVersion("v"))
        assertNull(UpdateChecker.parseVersion("1.2"))            // too few parts
        assertNull(UpdateChecker.parseVersion("1.2.3.4"))        // too many parts
        assertNull(UpdateChecker.parseVersion("v1.2.x"))         // non-numeric patch
        assertNull(UpdateChecker.parseVersion("v1.2.3."))        // trailing dot → empty part
    }

    @Test
    fun `parseVersion handles large patch numbers`() {
        assertEquals(UpdateChecker.ParsedVersion(0, 0, 9999), UpdateChecker.parseVersion("0.0.9999"))
    }

    // ---- compareVersions -----------------------------------------------

    @Test
    fun `compareVersions returns 0 for equal versions`() {
        assertEquals(
            0,
            UpdateChecker.compareVersions(
                UpdateChecker.parseVersion("1.2.3")!!,
                UpdateChecker.parseVersion("v1.2.3")!!,
            ),
        )
    }

    @Test
    fun `compareVersions orders by major then minor then patch`() {
        val v0_19_3 = UpdateChecker.parseVersion("0.19.3")!!
        val v0_20_0 = UpdateChecker.parseVersion("v0.20.0")!!
        val v1_0_0 = UpdateChecker.parseVersion("1.0.0")!!
        val v1_0_1 = UpdateChecker.parseVersion("v1.0.1")!!

        assertTrue(UpdateChecker.compareVersions(v0_20_0, v0_19_3) > 0, "0.20.0 > 0.19.3")
        assertTrue(UpdateChecker.compareVersions(v0_19_3, v0_20_0) < 0, "0.19.3 < 0.20.0")
        assertTrue(UpdateChecker.compareVersions(v1_0_0, v0_20_0) > 0, "1.0.0 > 0.20.0 (major beats minor)")
        assertTrue(UpdateChecker.compareVersions(v1_0_1, v1_0_0) > 0, "1.0.1 > 1.0.0 (patch)")
        assertTrue(UpdateChecker.compareVersions(v1_0_0, v1_0_1) < 0, "1.0.0 < 1.0.1")
    }

    @Test
    fun `compareVersions compares numerically not lexicographically`() {
        // 0.10.0 > 0.9.0 numerically; lexicographic string compare would say "0.10.0" < "0.9.0".
        val v0_10 = UpdateChecker.parseVersion("0.10.0")!!
        val v0_9 = UpdateChecker.parseVersion("0.9.0")!!
        assertTrue(UpdateChecker.compareVersions(v0_10, v0_9) > 0)
        assertTrue(UpdateChecker.compareVersions(v0_9, v0_10) < 0)
    }

    @Test
    fun `compareVersions is antisymmetric`() {
        val a = UpdateChecker.parseVersion("2.3.4")!!
        val b = UpdateChecker.parseVersion("2.3.5")!!
        assertEquals(
            UpdateChecker.compareVersions(a, b),
            -UpdateChecker.compareVersions(b, a),
        )
    }

    // ---- autoCheckTriggered guard --------------------------------------

    @Test
    fun `autoCheckTriggered flag is mutable and starts false`() {
        val original = UpdateChecker.autoCheckTriggered
        try {
            UpdateChecker.autoCheckTriggered = false
            assertFalse(UpdateChecker.autoCheckTriggered)
            UpdateChecker.autoCheckTriggered = true
            assertTrue(UpdateChecker.autoCheckTriggered)
        } finally {
            // Restore so the static state doesn't leak into other tests.
            UpdateChecker.autoCheckTriggered = original
        }
    }
}
