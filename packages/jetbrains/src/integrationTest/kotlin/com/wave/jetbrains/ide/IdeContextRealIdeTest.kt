package com.wave.jetbrains.ide

import com.intellij.driver.client.Driver
import com.intellij.driver.sdk.invokeAction
import com.intellij.driver.sdk.isProjectOpened
import com.intellij.driver.sdk.singleProject
import com.intellij.driver.sdk.ui.components.ideFrame
import com.intellij.driver.sdk.ui.components.jcef
import com.intellij.driver.sdk.waitFor
import com.intellij.ide.starter.driver.engine.runIdeWithDriver
import com.intellij.ide.starter.ide.IdeProductProvider
import com.intellij.ide.starter.models.TestCase
import com.intellij.ide.starter.plugins.PluginConfigurator
import com.intellij.ide.starter.project.LocalProjectInfo
import com.intellij.ide.starter.runner.Starter
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.fail
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
import kotlin.time.Duration.Companion.minutes

/**
 * Real-IDE test for `@终端` (`pnpm jb:test:ui -- --tests "*IdeContextRealIdeTest*"`).
 *
 * The headless platform fixture (`src/test/.../IdeContextReaderTest.kt`) can prove
 * the diagnostics half — it has a real `DocumentMarkupModel` — but not the terminal
 * half: the fixture's `ToolWindowManager` is `ToolWindowHeadlessManagerImpl`, so
 * there is no Terminal tool window and no `ShellTerminalWidget` to read
 * (`getToolWindow("Terminal")` is always null there). The only place a widget
 * really exists is a full IDE.
 *
 * So this test drives the whole user-visible chain in a live IDE: open the
 * Terminal tool window and print a marker → open the Wave panel → type `@` and
 * pick 终端 → send → click the tag in the user bubble → assert the marker is in
 * the preview. Nothing between the terminal buffer and the modal is stubbed: the
 * reader, the host↔webview contract, the message assembly and the preview are the
 * production code paths.
 *
 * Cost: sending a message starts a real model turn. The test does not wait for the
 * answer — the user bubble (with the tag) comes back from the host as soon as the
 * message is accepted — but the turn is still billed once per run.
 */
class IdeContextRealIdeTest {

    @Test
    fun `terminal output reaches the user bubble and its preview`() {
        val projectDir = tempProject()

        newContext(LocalProjectInfo(projectDir)).runIdeWithDriver().useDriverAndCloseIde {
            waitFor(2.minutes) { isProjectOpened() }

            // 1) The terminal the reader is supposed to pick up: the action the
            //    user's "Terminal" click runs. It creates a shell session and
            //    makes its content the selected one in the tool window.
            invokeAction("ActivateTerminalToolWindow")
            Thread.sleep(TERMINAL_READY_MS)
            ideFrame { keyboard { enterText("echo $MARKER"); enter() } }
            Thread.sleep(TERMINAL_OUTPUT_MS)

            // 2) Open the panel and wait for the webview to be alive. The JCEF
            //    page needs both the tool window content and a CLI session before
            //    a message can be accepted, hence the generous window.
            invokeAction("com.wave.jetbrains.openWave")
            Thread.sleep(SESSION_READY_MS)
            describeJcef()
            awaitJcef("the chat composer", WEBVIEW_READY_MS) {
                jcefExists(COMPOSER)
            }

            // 3) `@` in the composer → the fixed 终端 entry → Enter inserts the
            //    tag into the input. The dropdown's fixed entries carry
            //    `data-ide-context`, so this can only select 终端, never a file
            //    suggestion that happens to sort first.
            jcefClick(COMPOSER)
            // A DOM click alone does not move the Swing focus into the JCEF canvas,
            // and the typed `@` would go nowhere.
            ideFrame { jcef { setFocus() } }
            ideFrame { keyboard { enterText("@") } }
            awaitJcef("the 终端 suggestion", SUGGESTION_WINDOW_MS) {
                jcefExists(TERMINAL_SUGGESTION)
            }
            println("[ide-context-ui] suggestions=${jcefCount(SUGGESTION_ITEM)}")
            ideFrame { keyboard { enter() } }
            awaitJcef("the 终端 tag in the composer", SUGGESTION_WINDOW_MS) {
                jcefExists(COMPOSER_TAG)
            }

            // 4) Send. The webview asks the host for the terminal text, the host
            //    reads the selected widget, the text is assembled into the message
            //    body and only then is the message dispatched.
            jcefClick(SEND_BUTTON)
            awaitJcef("the user bubble's 终端 tag", SEND_WINDOW_MS) {
                jcefExists(BUBBLE_TAG)
            }
            println("[ide-context-ui] bubble tag rendered")

            // 5) The block is not rendered inline: the marker only shows up in the
            //    preview, which is what makes this assertion about the modal
            //    content rather than about the message markdown.
            assertTrue(
                !jcefDom().contains(MARKER),
                "the terminal text must live behind the tag, not in the message body",
            )

            jcefClick(BUBBLE_TAG)
            awaitJcef("the preview dialog", PREVIEW_WINDOW_MS) {
                jcefExists(PREVIEW_DIALOG)
            }
            val preview = jcefHtml(PREVIEW_DIALOG)
            assertTrue(
                preview.contains(MARKER),
                "the preview must show the terminal output; the dialog reads: ${preview.take(1_000)}",
            )
        }
    }

    // --- driver helpers -----------------------------------------------------

    private fun Driver.jcefDom(): String {
        var html = ""
        ideFrame { jcef { html = dom } }
        return html
    }

    private fun Driver.jcefExists(selector: String): Boolean {
        var found = false
        ideFrame { jcef { found = exist(selector) } }
        return found
    }

    private fun Driver.jcefClick(selector: String) {
        ideFrame { jcef { findElement(selector).click() } }
        println("[ide-context-ui] clicked $selector")
    }

    /**
     * The element's own `outerHTML`, read from `findElements` rather than
     * `findElement`: the latter re-queries with a 5 s wait and throws as soon as
     * the element is transient (a re-rendered dropdown closes under it), while
     * `findElements` returns whatever the current frame has.
     */
    private fun Driver.jcefHtml(selector: String): String {
        var html = ""
        ideFrame { jcef { html = findElements(selector).firstOrNull()?.html ?: "‹absent: $selector›" } }
        return html
    }

    private fun Driver.jcefCount(selector: String): Int {
        var count = 0
        ideFrame { jcef { count = findElements(selector).size } }
        return count
    }

    /** Which Swing component `jcef {}` resolved to — the first thing to check when a probe returns nothing. */
    private fun Driver.describeJcef() {
        val described = runCatching {
            var text = ""
            ideFrame { jcef { text = component.toString() } }
            text
        }
        println("[ide-context-ui] jcef component: ${described.getOrElse { "‹$it›" }.take(600)}")
        val length = runCatching { jcefDom().length }
        println("[ide-context-ui] dom length: ${length.getOrElse { "‹$it›" }}")
    }

    /**
     * Polls the webview DOM until [probe] is true. The driver cannot evaluate JS
     * (`JCefUI.callJs` is private), so "the UI is in state X" always means "this
     * XPath resolves", and every wait is a poll over real DOM queries.
     *
     * Selectors are **XPath**, not CSS: `JCefUI.findElements` evaluates them with
     * `document.evaluate`, so a CSS selector throws inside the browser and surfaces
     * as an empty result.
     */
    private fun Driver.awaitJcef(what: String, timeoutMs: Long, probe: () -> Boolean) {
        val deadline = System.currentTimeMillis() + timeoutMs
        var lastError: Throwable? = null
        while (System.currentTimeMillis() < deadline) {
            Thread.sleep(500)
            val result = runCatching(probe)
            if (result.getOrDefault(false)) return
            lastError = result.exceptionOrNull() ?: lastError
        }
        val dom = runCatching { jcefDom() }.getOrElse { "‹dom unavailable: $it›" }
        fail<Unit>(
            "timed out after ${timeoutMs / 1000}s waiting for $what. " +
                "Last probe error: $lastError. " +
                "Webview DOM (${dom.length} chars): " +
                dom.take(4_000),
        )
    }

    private fun tempProject(): Path {
        val dir = Files.createTempDirectory("wave-ide-context-ui-")
        // A file with a compile error, so the editor side has something to show;
        // this test only asserts the terminal half (diagnostics are covered by the
        // platform fixture), but the project should look like a real one.
        val broken = dir.resolve("src/demo/Broken.java")
        Files.createDirectories(broken.parent)
        Files.writeString(
            broken,
            "package demo;\n\npublic class Broken {\n    void f() {\n        int x = ;\n    }\n}\n",
        )
        return dir
    }

    private fun newContext(projectInfo: com.intellij.ide.starter.project.ProjectInfoSpec) =
        Starter.newContext(
            testName = "waveIdeContext",
            // Same pinned build as the completion suite: the Starter default (an
            // EAP 253 build) has expired, and the plugin targets 2024.2.
            TestCase(IdeProductProvider.IC, projectInfo = projectInfo).withVersion("2024.2"),
        ).apply {
            PluginConfigurator(this).installPluginFromPath(Path.of(pluginPath()))
            // The driver talks to a JCEF page through `JBCefJSQuery`, which can only
            // reuse a query slot reserved *before* the browser was created — and the
            // browser here belongs to the plugin (created when the tool window opens).
            // With the default pool size of 0, every `findElement`/`getDom` call
            // throws `IllegalStateException: Set the property
            // JBCefClient.Properties.JS_QUERY_POOL_SIZE …` on the IDE side and comes
            // back as "Error on remote driver call". JetBrains' own UI tests set the
            // same property; it is a test-run VM option, not a product change.
            applyVMOptionsPatch {
                addSystemProperty("ide.browser.jcef.jsQueryPoolSize", 100)
            }
        }

    private fun pluginPath(): String =
        requireNotNull(System.getProperty("path.to.build.plugin")) {
            "path.to.build.plugin is not set — run this via the `integrationTest` Gradle task"
        }

    private companion object {
        /** Distinct from the VS Code suite's marker: both may run in one session. */
        const val MARKER = "wave-jb-terminal-marker"

        // Selectors are the webview's own hooks (`data-testid` / `data-path`), the
        // same ones the e2e and vitest suites anchor on — but written as XPath,
        // because `JCefUI` evaluates them with `document.evaluate`.
        const val COMPOSER = "//*[@data-testid='message-input']"
        const val SEND_BUTTON = "//*[@data-testid='send-btn']"
        const val TERMINAL_SUGGESTION = "//*[@data-ide-context='terminal']"
        const val SUGGESTION_ITEM = "//*[contains(@class,'suggestion-item')]"
        const val COMPOSER_TAG = "//*[@data-path='ide:terminal']"
        const val BUBBLE_TAG =
            "//*[@data-testid='messages-container']//*[@data-path='ide:terminal']"
        const val PREVIEW_DIALOG = "//div[@role='dialog' and contains(@class,'ide-context-preview')]"

        /** Shell spawn + prompt on a loaded CI-ish machine. */
        const val TERMINAL_READY_MS = 5_000L
        const val TERMINAL_OUTPUT_MS = 2_000L

        /** CLI spawn + session handshake, same order of magnitude as the completion suite. */
        const val SESSION_READY_MS = 15_000L
        const val WEBVIEW_READY_MS = 90_000L
        const val SUGGESTION_WINDOW_MS = 30_000L

        /** Terminal read + host round trip + the message coming back from the CLI. */
        const val SEND_WINDOW_MS = 120_000L
        const val PREVIEW_WINDOW_MS = 10_000L
    }
}
