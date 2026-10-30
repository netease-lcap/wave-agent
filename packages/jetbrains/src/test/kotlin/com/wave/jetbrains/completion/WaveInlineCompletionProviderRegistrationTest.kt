package com.wave.jetbrains.completion

import com.intellij.codeInsight.inline.completion.InlineCompletionProvider
import com.intellij.openapi.extensions.ExtensionPointName
import com.intellij.testFramework.fixtures.BasePlatformTestCase

/**
 * Loads the plugin the way the IDE does and checks that ghost-text completion is
 * actually wired up.
 *
 * Why this needs the platform fixture (and not the JVM-only tests next door):
 * the failure mode we hit in the sandbox — kotlinx-coroutines bundled into the
 * plugin colliding with the platform's copy — only shows up once the platform
 * instantiates our provider and hands it a suggestion, i.e. after the extension
 * point, the plugin descriptor and the plugin classloader are all real. A plain
 * unit test cannot see any of that.
 *
 * What it does *not* cover: the model round-trip and the rendered ghost text.
 * Those need a running CLI session; the real-machine smoke procedure lives in
 * `reference_jb_sandbox_real_machine_smoke` (pnpm jb:run + idea.log).
 */
class WaveInlineCompletionProviderRegistrationTest : BasePlatformTestCase() {

    fun testProviderIsRegisteredWithThePlatform() {
        val providers = inlineCompletionProviders()

        assertTrue(
            "the plugin's <inline.completion.provider> is not registered. Providers: ${providers.map { it.javaClass.name }}",
            providers.any { it is WaveInlineCompletionProvider },
        )
    }

    fun testProviderReportsItsStableId() {
        // Telemetry and the user's disable toggle key off this id — renaming it
        // silently would split both.
        val provider = inlineCompletionProviders().filterIsInstance<WaveInlineCompletionProvider>().single()

        assertEquals("com.wave.jetbrains.inline", provider.id.id)
    }

    fun testProviderDeclaresAnInsertHandlerForAcceptanceMetrics() {
        // The accept hook is how "suggestion accepted" reaches the CLI
        // (docs/specs/ide/code-completion.md); without it every suggestion would
        // be reported as displayed-only.
        val provider = inlineCompletionProviders().filterIsInstance<WaveInlineCompletionProvider>().single()

        assertNotNull("insertHandler must be set for accepted-outcome reporting", provider.insertHandler)
    }

    private fun inlineCompletionProviders(): List<InlineCompletionProvider> =
        ExtensionPointName.create<InlineCompletionProvider>(INLINE_COMPLETION_EP).extensionList

    private companion object {
        /** `com.intellij.` prefix is implied for platform extension points. */
        const val INLINE_COMPLETION_EP = "com.intellij.inline.completion.provider"
    }
}
