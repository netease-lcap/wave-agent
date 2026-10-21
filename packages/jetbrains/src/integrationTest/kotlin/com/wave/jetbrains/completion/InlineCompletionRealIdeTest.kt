package com.wave.jetbrains.completion

import com.intellij.driver.client.Driver
import com.intellij.driver.sdk.invokeAction
import com.intellij.driver.sdk.isProjectOpened
import com.intellij.driver.sdk.openFile
import com.intellij.driver.sdk.singleProject
import com.intellij.driver.sdk.waitFor
import com.intellij.driver.sdk.ui.components.editor
import com.intellij.driver.sdk.ui.components.ideFrame
import com.intellij.ide.starter.driver.engine.runIdeWithDriver
import com.intellij.ide.starter.ide.IdeProductProvider
import com.intellij.ide.starter.models.TestCase
import com.intellij.ide.starter.plugins.PluginConfigurator
import com.intellij.ide.starter.project.LocalProjectInfo
import com.intellij.ide.starter.project.NoProject
import com.intellij.ide.starter.runner.Starter
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Assertions.fail
import org.junit.jupiter.api.Test
import java.nio.file.Files
import java.nio.file.Path
import kotlin.time.Duration.Companion.minutes

/**
 * Real-IDE tests for ghost-text completion (`pnpm jb:test:ui`).
 *
 * These are the only tests that see what neither the JVM unit tests nor the
 * headless platform fixture can: the IDE accepting the plugin descriptor, the
 * `inline.completion.provider` extension point firing in a live editor, and
 * ghost text actually rendering — where the 2026-10-16 `SafeCollector cannot be
 * cast to FlowCollector` classloader bug surfaced only on a real machine.
 *
 * Everything here drives the IDE through its own APIs (Driver RPC + actions), not
 * through `java.awt.Robot`: the Driver can click and type, but on macOS those
 * events are dropped unless the process running the test has Accessibility
 * permission, and a permission the developer has to grant by hand is not
 * something the suite can depend on. What is left is a real IDE, a real editor
 * and the platform's real inline-completion machinery — only the keystroke is
 * replaced by the action the keystroke would invoke.
 */
class InlineCompletionRealIdeTest {

    @Test
    fun `loads the plugin in a real IDE`() {
        val context = newContext(NoProject)

        context.runIdeWithDriver().useDriverAndCloseIde {
            // Nothing to drive: the assertion is that the IDE starts with the
            // plugin installed at all.
        }

        PluginConfigurator(context).assertPluginIsInstalled(PLUGIN_ID)

        // `assertPluginIsInstalled` only checks the installed files; loading is
        // decided later by the IDE. The startup log is the one place that says it
        // out loud, and a rejected descriptor (bad since-build, missing
        // dependency) shows up there instead of as an exception.
        val ideaLog = context.paths.testHome.resolve("log").resolve("idea.log")
        assertTrue(Files.exists(ideaLog), "IDE log not found at $ideaLog")
        val log = Files.readString(ideaLog)
        assertTrue(
            log.contains("Loaded custom plugins") && log.contains(PLUGIN_NAME),
            "the IDE did not report loading $PLUGIN_NAME — see $ideaLog",
        )
    }

    @Test
    fun `completion at the caret renders ghost text that can be accepted`() {
        val project = tempProject(mapOf("math.ts" to SEED))

        val accepted = completeAtEndOf(project, "math.ts")

        assertTrue(
            accepted.startsWith(SEED),
            "accepted text must be inserted at the caret, not replace the buffer: '$accepted'",
        )
    }

    /**
     * The cross-file half: a definition the file only imports is collected by
     * `CompletionSnippets.kt` through the real PSI and has to reach the model.
     *
     * Java on purpose — IntelliJ IDEA Community has no TypeScript language
     * plugin, so a `.ts` import resolves to nothing and the collector would have
     * no cross-file definition to prove.
     */
    @Test
    fun `completion sees a definition imported from another file`() {
        val project = tempProject(
            mapOf(
                "src/demo/util/Helper.java" to HELPER,
                "src/demo/Main.java" to JAVA_SEED,
            ),
        )

        val accepted = completeAtEndOf(
            project,
            "src/demo/Main.java",
            // The model is free to answer something else; give it a few goes
            // rather than turning one unlucky sample into a red suite.
            attempts = 3,
            accept = { it.contains(IMPORTED_SYMBOL) },
        )

        assertTrue(
            accepted.contains(IMPORTED_SYMBOL),
            "no suggestion used the imported definition. Either the collector " +
                "found nothing for the import (check the `[SMOKE-TEMP] snippets=…` " +
                "line of the IDE's idea.log) or the model ignored the snippet. " +
                "Last accepted text: '$accepted'",
        )
    }

    /**
     * Opens [file] in a driver-driven IDE and returns the text after accepting a
     * ghost-text suggestion at the end of it.
     *
     * Everything is driven through IDE actions rather than `java.awt.Robot`: the
     * driver can click and type, but on macOS those events are dropped unless the
     * process running the test has been granted Accessibility permission, and a
     * permission a developer must grant by hand is not something the suite can
     * rely on. What stays real is the IDE, the editor, PSI and the platform's own
     * inline-completion machinery — only the keystroke is replaced by the action
     * the keystroke would invoke.
     */
    private fun completeAtEndOf(
        projectDir: Path,
        file: String,
        attempts: Int = 1,
        accept: (String) -> Boolean = { true },
    ): String {
        val seed = Files.readString(projectDir.resolve(file))
        var accepted = ""

        newContext(LocalProjectInfo(projectDir)).runIdeWithDriver().useDriverAndCloseIde {
            waitFor(2.minutes) { isProjectOpened() }
            val project = singleProject()

            // Completion borrows the model configuration from the chat session
            // inside the plugin, so the Wave tool window has to exist first — and
            // it has to be opened *before* the file, because `openFile` focuses
            // the editor it opens and the completion actions act on the editor
            // that currently holds focus. Opening the panel last would leave the
            // webview focused.
            invokeAction("com.wave.jetbrains.openWave")
            Thread.sleep(SESSION_READY_MS)
            openFile(file, project)

            var attempt = 0
            while (attempt < attempts) {
                attempt++
                ideFrame { editor().text = seed }
                // Caret movement and completion both go through the actions the
                // key bindings run: the driver's offset-based setters do not
                // survive a text replacement.
                invokeAction("EditorTextEnd")
                logCaret()
                invokeAction("CallInlineCompletionAction")
                awaitGhostText()

                var before = ""
                ideFrame { before = editor().text }
                invokeAction("InsertInlineCompletionAction")
                var after = ""
                ideFrame { after = editor().text }
                assertNotEquals(
                    before,
                    after,
                    "accepting the ghost text did not insert it (attempt $attempt)",
                )
                accepted = after
                if (accept(after)) break
                println("[completion-ui] attempt $attempt did not use the context: '$after'")
            }
        }
        return accepted
    }

    private fun tempProject(files: Map<String, String>): Path {
        val dir = Files.createTempDirectory("wave-completion-ui-")
        for ((path, content) in files) {
            val target = dir.resolve(path)
            Files.createDirectories(target.parent)
            Files.writeString(target, content)
        }
        return dir
    }

    /**
     * Waits for the ghost text to appear. Ghost text is an inline inlay, so the
     * inlay model is the only programmatic way to see it: the document is
     * untouched until the suggestion is accepted (the same reason the VS Code e2e
     * can only assert on acceptance). The renderer is opaque to the driver — only
     * offsets come back — so the signal is "an inlay appeared at the caret".
     */
    private fun Driver.awaitGhostText() {
        val deadline = System.currentTimeMillis() + SUGGESTION_WINDOW_MS
        while (System.currentTimeMillis() < deadline) {
            Thread.sleep(1_000)
            if (ghostInlayOffsets().isNotEmpty()) return
        }
        fail<Unit>(
            "no ghost text rendered within ${SUGGESTION_WINDOW_MS / 1000}s — see the " +
                "[SMOKE-TEMP] lines of the IDE's idea.log for whether the provider ran",
        )
    }

    private fun Driver.ghostInlayOffsets(): List<Int> {
        var offsets: List<Int> = emptyList()
        ideFrame {
            val editor = editor().editor
            val length = editor.getDocument().getText().length
            offsets = editor.getInlayModel()
                .getInlineElementsInRange(0, length)
                .map { it.getOffset() }
            println("[completion-ui] inlayOffsets=$offsets (textLength=$length)")
        }
        return offsets
    }

    private fun Driver.logCaret() {
        ideFrame {
            val caret = editor().editor.getCaretModel().getLogicalPosition()
            println("[completion-ui] caret=${caret.getLine()}:${caret.getColumn()}")
        }
    }

    private fun newContext(projectInfo: com.intellij.ide.starter.project.ProjectInfoSpec) =
        Starter.newContext(
            testName = "waveInlineCompletion",
            // Pinned to the version the plugin is compiled against; the Starter
            // default (an EAP 253 build) has expired.
            TestCase(IdeProductProvider.IC, projectInfo = projectInfo).withVersion("2024.2"),
        ).apply {
            PluginConfigurator(this).installPluginFromPath(Path.of(pluginPath()))
        }

    private fun pluginPath(): String =
        requireNotNull(System.getProperty("path.to.build.plugin")) {
            "path.to.build.plugin is not set — run this via the `integrationTest` Gradle task"
        }

    private companion object {
        const val PLUGIN_ID = "com.wave.jetbrains"
        const val PLUGIN_NAME = "CodeWave IDE"
        const val SEED = "export function add(a: number, b: number): number {\n  "

        /** The symbol the model can only know about through the snippet. */
        const val IMPORTED_SYMBOL = "zetaOffsetOf"
        const val HELPER = "package demo.util;\n" +
            "\n" +
            "public class Helper {\n" +
            "    public static int $IMPORTED_SYMBOL(String name) {\n" +
            "        int weight = name.length() * 7;\n" +
            "        return weight + 41;\n" +
            "    }\n" +
            "}\n"
        const val JAVA_SEED = "package demo;\n" +
            "\n" +
            "import demo.util.Helper;\n" +
            "\n" +
            "public class Main {\n" +
            "    public static void main(String[] args) {\n" +
            "        int answer = "

        /** CLI spawn + session handshake, same order of magnitude as the VS Code e2e. */
        const val SESSION_READY_MS = 15_000L
        const val SUGGESTION_WINDOW_MS = 60_000L
    }
}
