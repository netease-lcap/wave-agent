package com.wave.jetbrains.completion

import com.intellij.codeInsight.TargetElementUtil
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.project.Project
import com.intellij.psi.PsiElement
import com.intellij.psi.PsiFile
import com.intellij.util.concurrency.AppExecutorUtil
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.concurrent.Callable
import java.util.concurrent.TimeUnit

/**
 * Tuning knobs for the cross-file definition snippets. Mirrors the VS Code side
 * (`packages/vscode/src/services/completionSnippets.ts`) so both hosts put the
 * same shape and the same budget in front of the model.
 */
object SnippetOptions {
    /** Definitions are a bonus, never a reason to make the user wait. */
    const val TIMEOUT_MS = 100L

    /** Spec: at most 3 segments. */
    const val MAX_SNIPPETS = 3

    /** A declaration longer than this is a whole file's worth of noise. */
    const val MAX_SNIPPET_LINES = 15
    const val MAX_SNIPPET_CHARS = 2000

    /** Guard against a file with a thousand import lines. */
    const val MAX_CANDIDATES = 24
}

/**
 * One definition the model should see: where it came from and its body.
 *
 * The protocol type is identical to the SDK's `CompletionSnippet`; the wire is
 * JSON, so the two hosts only have to agree on field names.
 */
data class CompletionSnippet(
    val path: String,
    val text: String,
)

/** Keeps the first lines only — a declaration's signature is at the top. */
fun truncateSnippet(
    text: String,
    maxLines: Int = SnippetOptions.MAX_SNIPPET_LINES,
    maxChars: Int = SnippetOptions.MAX_SNIPPET_CHARS,
): String = text.split('\n').take(maxLines).joinToString("\n").take(maxChars).trimEnd()

/**
 * The character offsets worth asking the IDE about — every identifier on a line
 * that opens an import statement.
 *
 * Deliberately language-agnostic: instead of parsing each language's import
 * syntax, this hands every plausible name to [TargetElementUtil] and lets the
 * IDE answer. Names that are not references (the `a` and `b` in `import a.b.C`,
 * or a word inside a quoted module path) simply resolve to nothing.
 */
fun importCandidateOffsets(
    text: CharSequence,
    maxCandidates: Int = SnippetOptions.MAX_CANDIDATES,
): List<Int> {
    val offsets = mutableListOf<Int>()
    var lineStart = 0
    while (lineStart < text.length && offsets.size < maxCandidates) {
        val newline = text.indexOf('\n', lineStart)
        val lineEnd = if (newline < 0) text.length else newline
        val line = text.subSequence(lineStart, lineEnd)

        if (IMPORT_LINE.containsMatchIn(line)) {
            for (match in IDENTIFIER.findAll(line)) {
                if (offsets.size >= maxCandidates) break
                val word = match.value
                if (word in IMPORT_KEYWORDS || word.length < 2) continue
                offsets += lineStart + match.range.first
            }
        }
        lineStart = lineEnd + 1
    }
    return offsets
}

private val IMPORT_LINE = Regex("""^\s*(?:import|from|using|use|require)\b""")
private val IDENTIFIER = Regex("""[A-Za-z_$][A-Za-z0-9_$]*""")
private val IMPORT_KEYWORDS = setOf(
    "import", "from", "using", "use", "require", "as",
    "static", "type", "typeof", "export", "default", "package",
)

/**
 * Collects up to [SnippetOptions.MAX_SNIPPETS] definitions the file currently
 * references but does not contain — the enclosing scopes are skipped because
 * their bodies are usually already inside the prefix window.
 *
 * Returns `null` when the snippets could not be collected (timeout, no virtual
 * file, PSI failure) and an empty list when there was simply nothing to add; the
 * caller only distinguishes "no snippets" from "some snippets", so both ends up
 * as a request without them.
 *
 * Every PSI read happens inside one `ReadAction`, which is what the platform
 * requires; the timeout covers the whole batch because `findTargetElement`
 * cannot be cancelled once it starts.
 */
suspend fun collectDefinitionSnippets(
    project: Project,
    editor: Editor,
    file: PsiFile,
    offset: Int,
): List<CompletionSnippet>? {
    val currentPath = file.virtualFile?.path ?: return null

    val future = ReadAction.nonBlocking(
        Callable {
            // Reading the file text is a PSI access like any other, so it belongs
            // inside this block rather than above it.
            val text = file.text
            val cursor = offset.coerceIn(0, text.length)
            val candidates = buildList {
                if (cursor > 0) add(cursor - 1)
                add(cursor)
                addAll(importCandidateOffsets(text))
            }.distinct()

            val found = LinkedHashMap<String, CompletionSnippet>()
            for (candidate in candidates) {
                if (found.size >= SnippetOptions.MAX_SNIPPETS) break
                val target = try {
                    TargetElementUtil.getInstance().findTargetElement(editor, FLAGS, candidate)
                } catch (_: Exception) {
                    null
                } ?: continue
                addSnippet(found, target, currentPath)
            }
            found.values.toList()
        },
    ).inSmartMode(project).submit(AppExecutorUtil.getAppExecutorService())

    return try {
        // Waiting must not hold the coroutine dispatcher: the platform calls
        // this from the EDT-adjacent completion coroutine.
        withContext(Dispatchers.IO) {
            future.get(SnippetOptions.TIMEOUT_MS, TimeUnit.MILLISECONDS)
        }
    } catch (_: Exception) {
        // A timer that already fired, or PSI refusing to answer: either way the
        // request goes out without snippets rather than not going out at all.
        null
    }
}

private fun addSnippet(
    found: MutableMap<String, CompletionSnippet>,
    target: PsiElement,
    currentPath: String,
) {
    // `findTargetElement` already returns the declaration, not the reference.
    if (target is PsiFile) return
    val path = target.containingFile?.virtualFile?.path ?: return
    // Same file means the text is almost certainly already in the prefix.
    if (path == currentPath) return
    val body = truncateSnippet(target.text)
    if (body.isBlank()) return
    found.putIfAbsent("$path#$body", CompletionSnippet(path, body))
}

private val FLAGS =
    TargetElementUtil.ELEMENT_NAME_ACCEPTED or TargetElementUtil.REFERENCED_ELEMENT_ACCEPTED
