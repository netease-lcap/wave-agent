package com.wave.jetbrains.nextEdit

import com.intellij.driver.client.Driver
import com.intellij.driver.sdk.invokeAction
import com.intellij.driver.sdk.isProjectOpened
import com.intellij.driver.sdk.openFile
import com.intellij.driver.sdk.singleProject
import com.intellij.driver.sdk.ui.components.editor
import com.intellij.driver.sdk.ui.components.ideFrame
import com.intellij.driver.sdk.waitFor
import com.intellij.ide.starter.driver.engine.runIdeWithDriver
import com.intellij.ide.starter.ide.IdeProductProvider
import com.intellij.ide.starter.models.TestCase
import com.intellij.ide.starter.plugins.PluginConfigurator
import com.intellij.ide.starter.project.LocalProjectInfo
import com.intellij.ide.starter.runner.Starter
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File
import java.nio.file.Files
import java.nio.file.Path
import kotlin.time.Duration.Companion.minutes

/**
 * Real-IDE test for next-edit suggestions (`pnpm jb:test:ui`).
 *
 * The scenario is the spec's: the user renames a field in the first function, and
 * the next occurrence of that field sits two functions down. Everything on the
 * path is real — a real IDE, the platform's document events, the CLI child
 * process talking to the real model, the popup and the accept action — so this is
 * the only place the whole loop (trajectory → debounce → request → diff →
 * popup → write) can be seen at once.
 *
 * Two things are deliberately not simulated as keystrokes:
 *
 * - the **edit** is one atomic whole-word replacement (select word + paste), which
 *   is what the user's rename *is* from the document's point of view. Typing it
 *   character by character would put nine single-character edits in the
 *   trajectory instead of one `price → unitPrice`;
 * - the **accept** goes through the plugin's own action id rather than the popup's
 *   Tab binding: the driver cannot reliably deliver a keystroke to a focus-owned
 *   popup, and the action is the same entry point (`acceptCurrent`).
 */
class NextEditRealIdeTest {

    @Test
    fun `a rename in one function becomes a suggestion in the next`() {
        val project = tempProject(mapOf("src/price.ts" to SEED))
        // Next edit is opt-in (spec 故事 6 场景 2) and the switch is a user
        // preference in settings.json, so the test turns it on the way the
        // settings tab does — and puts the file back afterwards.
        val settings = NextEditSwitch.enable()
        try {
            newContext(project).runIdeWithDriver().useDriverAndCloseIde {
                waitFor(2.minutes) { isProjectOpened() }
                val opened = singleProject()

                // The model configuration comes from the chat session inside the
                // plugin, so the panel has to exist (and finish its handshake)
                // before anything asks for a suggestion. The panel is opened
                // before the file: `openFile` focuses the editor it opens.
                invokeAction("com.wave.jetbrains.openWave")
                Thread.sleep(SESSION_READY_MS)
                openFile(FILE, opened)

                ideFrame { editor().text = SEED }
                // The model is free to answer with prose, or with nothing usable,
                // on any single attempt: a user would simply keep editing, so each
                // attempt makes the edit again (deleting and re-typing the name is
                // one more edit, which asks again).
                var accepted = ""
                var afterEdit = ""
                for (attempt in 1..MAX_ATTEMPTS) {
                    renameFirstField()
                    afterEdit = currentText()
                    assertTrue(
                        afterEdit.contains(EDITED_LINE_RENAMED),
                        "the rename did not land in the editor (attempt $attempt): '$afterEdit'",
                    )
                    // Nothing may be written behind the user's back (spec 故事 4
                    // 场景 3): the popup is a preview, the document only changes
                    // on accept — `acceptEventually` asserts exactly that.
                    accepted = acceptEventually(before = afterEdit)
                    if (accepted != afterEdit) break
                    println("[next-edit-ui] attempt $attempt: no suggestion appeared")
                }
                assertTrue(
                    accepted != afterEdit,
                    "no suggestion was accepted within $MAX_ATTEMPTS attempts of " +
                        "${SUGGESTION_WINDOW_MS / 1000}s — check the IDE log for the next-edit request",
                )
                assertTrue(
                    accepted.contains(SUGGESTED_LINE),
                    "the accepted suggestion did not rewrite the second occurrence: '$accepted'",
                )
                // The user's own edit must still be there: the suggestion replaces
                // the lines it names and nothing else (spec 故事 3 场景 4).
                assertTrue(
                    accepted.contains(EDITED_LINE_RENAMED),
                    "the suggestion overwrote the user's edit: '$accepted'",
                )
            }
        } finally {
            settings.restore()
        }
    }

    /**
     * Renames `price` to `unitPrice` the way a typist does: delete the word, type
     * the new one. Two document events, both meaningful (`price →` nothing, then
     * the new name), which is what the trajectory wants to see.
     *
     * Deliberately not "select word + paste over it": a paste over a selection
     * leaves the pasted text selected, and the listener skips a document while a
     * selection exists (spec 故事 3 场景 5) — the user's next keystroke would have
     * to happen before any suggestion could. Deleting first keeps every moment
     * selection-free.
     *
     * The clipboard is filled through the platform's own clipboard tool rather
     * than AWT: the Gradle test JVM runs headless, and a headless `Toolkit` throws
     * on `systemClipboard` even when the IDE on the other end of the driver has
     * a display.
     */
    private fun Driver.renameFirstField() {
        // The caret goes just after the field name on the edit line, wherever that
        // name ends now — `price` on the first attempt, `unitPrice` on a retry.
        val lineText = currentText().lines()[EDIT_LINE - 1]
        val fieldEnd = lineText.indexOf(' ', lineText.indexOf(FIELD_PREFIX))
        assertTrue(fieldEnd > 0, "no field after '$FIELD_PREFIX' on line $EDIT_LINE: '$lineText'")
        ideFrame { editor().setCaretPosition(EDIT_LINE, fieldEnd + 1) }
        invokeAction("EditorDeleteToWordStart")
        setClipboard(RENAMED)
        invokeAction("EditorPaste")
    }

    private fun setClipboard(text: String) {
        // `xclip` forks and keeps serving the selection, so it returns at once.
        for (command in listOf(listOf("xclip", "-selection", "clipboard"), listOf("pbcopy"))) {
            try {
                val process = ProcessBuilder(command).redirectErrorStream(true).start()
                process.outputStream.use { it.write(text.toByteArray()) }
                if (process.waitFor() == 0) return
            } catch (_: Exception) {
                // Tool not installed: try the next one.
            }
        }
        error("no clipboard tool found (xclip / pbcopy) to paste '$text'")
    }

    /**
     * Waits for a suggestion and takes it. Acceptance is retried rather than
     * awaited through some popup handle: the action is a no-op while nothing is
     * showing, so polling it cannot corrupt the document, and the first document
     * change is the proof that a suggestion had arrived and was taken.
     *
     * The wait is split in two on purpose: the first phase is the stretch in which
     * the popup should be up (and in which nothing may be written), which is also
     * the only moment a screenshot of the preview can be taken; only after that
     * does the test start accepting.
     */
    private fun Driver.acceptEventually(before: String): String {
        val start = System.currentTimeMillis()
        while (System.currentTimeMillis() - start < SHOT_AFTER_MS) {
            Thread.sleep(WAIT_SLICE_MS)
            assertEquals(
                before,
                currentText(),
                "the document changed before the user accepted the suggestion",
            )
        }
        takeShot("next-edit-jb-popup.png")

        while (System.currentTimeMillis() - start < SUGGESTION_WINDOW_MS) {
            Thread.sleep(POLL_MS)
            assertEquals(
                before,
                currentText(),
                "the document changed before the user accepted the suggestion",
            )
            invokeAction(ACCEPT_ACTION)
            val after = currentText()
            if (after != before) {
                takeShot("next-edit-jb-accepted.png")
                return after
            }
        }
        return before
    }

    private fun Driver.currentText(): String {
        var text = ""
        ideFrame { text = editor().text }
        return text
    }

    /**
     * Optional screenshot of the whole screen, same convention as the VS Code e2e
     * (`WAVE_E2E_SHOT_DIR` unset = no screenshots, and a capture failure never
     * fails the test: the screenshot is for a human, not an assertion).
     */
    private fun takeShot(name: String) {
        val dir = SHOT_DIR ?: return
        val target = File(dir).apply { mkdirs() }.resolve(name)
        val ok = try {
            ProcessBuilder("import", "-window", "root", target.absolutePath).start().waitFor() == 0
        } catch (_: Exception) {
            false
        }
        println(
            if (ok) "[next-edit-ui] screenshot: $target"
            else "[next-edit-ui] screenshot failed (is ImageMagick installed?): $target",
        )
    }

    private fun tempProject(files: Map<String, String>): Path {
        val dir = Files.createTempDirectory("wave-next-edit-ui-")
        for ((path, content) in files) {
            val target = dir.resolve(path)
            Files.createDirectories(target.parent)
            Files.writeString(target, content)
        }
        return dir
    }

    private fun newContext(projectDir: Path) =
        Starter.newContext(
            testName = "waveNextEdit",
            // Pinned to the version the plugin is compiled against (same as the
            // completion suite): the Starter default has expired.
            TestCase(IdeProductProvider.IC, projectInfo = LocalProjectInfo(projectDir))
                .withVersion("2024.2"),
        ).apply {
            PluginConfigurator(this).installPluginFromPath(Path.of(pluginPath()))
        }

    private fun pluginPath(): String =
        requireNotNull(System.getProperty("path.to.build.plugin")) {
            "path.to.build.plugin is not set — run this via the `integrationTest` Gradle task"
        }

    /**
     * Turns `nextEditEnabled` on in the CLI's user settings for the duration of
     * the test, and restores the file byte for byte afterwards.
     *
     * The switch is a user preference rather than a plugin setting on this side
     * (the settings tab writes it into settings.json), so the real machine has
     * to have it set the same way a user would; anything else would test a
     * configuration no user has.
     */
    private class NextEditSwitch private constructor(
        private val file: File,
        private val original: String?,
    ) {
        fun restore() {
            if (original == null) file.delete() else file.writeText(original)
        }

        companion object {
            fun enable(): NextEditSwitch {
                val file = File(System.getProperty("user.home"), ".wave/settings.json")
                val original = if (file.exists()) file.readText() else null
                val updated = when {
                    original == null -> """{"nextEditEnabled": true}"""
                    ENABLED.containsMatchIn(original) -> original
                    DISABLED.containsMatchIn(original) ->
                        DISABLED.replace(original, """"nextEditEnabled": true""")
                    else -> original.replaceFirst("{", """{"nextEditEnabled": true,""")
                }
                file.parentFile.mkdirs()
                file.writeText(updated)
                return NextEditSwitch(file, original)
            }

            private val ENABLED = Regex(""""nextEditEnabled"\s*:\s*true""")
            private val DISABLED = Regex(""""nextEditEnabled"\s*:\s*false""")
        }
    }

    private companion object {
        const val FILE = "src/price.ts"

        /**
         * The interface already knows the new name, so a suggestion that only
         * renamed the interface would prove nothing: both halves below are out of
         * date and the model has to notice the *other* one.
         */
        const val SEED = "export interface Price {\n" +
            "  unitPrice: number;\n" +
            "  qty: number;\n" +
            "}\n" +
            "\n" +
            "export function lineTotal(item: Price): number {\n" +
            "  return item.price * item.qty;\n" +
            "}\n" +
            "\n" +
            "export function cheapest(items: Price[]): Price {\n" +
            "  return items.reduce((min, item) =>\n" +
            "    item.price < min.price ? item : min,\n" +
            "  );\n" +
            "}\n"

        /**
         * 1-based line of the user's edit (the first function's body);
         * `setCaretPosition` counts from one, as the IDE's status bar does.
         */
        const val EDIT_LINE = 7

        /** Everything before the field name on the edit line (`item.`). */
        const val FIELD_PREFIX = "item."
        const val RENAMED = "unitPrice"
        const val EDITED_LINE_RENAMED = "return item.unitPrice * item.qty;"

        /** The rewrite we expect in the second function. */
        const val SUGGESTED_LINE = "min.unitPrice"

        /** The plugin's accept action; a no-op while nothing is showing. */
        const val ACCEPT_ACTION = "com.wave.jetbrains.nextEdit.accept"

        /** CLI spawn + session handshake, same order of magnitude as the completion suite. */
        const val SESSION_READY_MS = 15_000L
        /** How long one attempt waits for a suggestion (the model answers in ~3 s). */
        const val SUGGESTION_WINDOW_MS = 20_000L

        /** Attempts per run: a single model answer is not worth a red suite. */
        const val MAX_ATTEMPTS = 3
        const val POLL_MS = 2_000L

        /** Slice of the wait-for-the-popup phase (a screenshot is taken at its end). */
        const val WAIT_SLICE_MS = 1_000L

        /**
         * When to grab the popup screenshot: the model usually answers in 2–3 s, and
         * the popup has to be caught before the acceptance below takes it away.
         */
        const val SHOT_AFTER_MS = 4_000L

        val SHOT_DIR: String? = System.getenv("WAVE_E2E_SHOT_DIR")
    }
}
