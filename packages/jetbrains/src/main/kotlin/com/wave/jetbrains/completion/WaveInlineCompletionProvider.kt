package com.wave.jetbrains.completion

import com.intellij.codeInsight.inline.completion.InlineCompletionEvent
import com.intellij.codeInsight.inline.completion.InlineCompletionInsertEnvironment
import com.intellij.codeInsight.inline.completion.InlineCompletionInsertHandler
import com.intellij.codeInsight.inline.completion.InlineCompletionProvider
import com.intellij.codeInsight.inline.completion.InlineCompletionProviderID
import com.intellij.codeInsight.inline.completion.InlineCompletionRequest
import com.intellij.codeInsight.inline.completion.elements.InlineCompletionElement
import com.intellij.codeInsight.inline.completion.elements.InlineCompletionGrayTextElement
import com.intellij.codeInsight.inline.completion.suggestion.InlineCompletionSingleSuggestion
import com.intellij.codeInsight.inline.completion.suggestion.InlineCompletionSuggestion
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.wave.jetbrains.WavePanelHolder
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Ghost-text completion for the JetBrains editor, registered through the
 * platform's `<inline.completion.provider>` extension point (2024.2+).
 *
 * The platform owns debouncing and cancellation: it drives [getSuggestion] after
 * a typing pause and cancels the coroutine on the next keystroke, which is the
 * same contract the VS Code provider implements by hand. What is left here is
 * the cursor context, the session lookup and the truncation.
 *
 * Everything is best-effort — no session, a dead CLI, a timeout or a model error
 * all end as "no suggestion" (spec `docs/specs/ui/code-completion.md`).
 */
class WaveInlineCompletionProvider : InlineCompletionProvider {
    override val id: InlineCompletionProviderID =
        InlineCompletionProviderID("com.wave.jetbrains.inline")

    /**
     * 采纳信号：平台把建议真正插入文档后回调这里（IC-2024.2 起可用，Continue 的
     * JetBrains 插件走同一条路径），据上报 `{outcome=accepted}`；`displayed` 在
     * [getSuggestion] 返回非空建议时记。两端属性集一致，可同一口径聚合
     * （spec docs/specs/enterprise/opentelemetry.md「补全建议的采纳度量」）。
     */
    override val insertHandler: InlineCompletionInsertHandler = object : InlineCompletionInsertHandler {
        override fun afterInsertion(
            environment: InlineCompletionInsertEnvironment,
            elements: List<InlineCompletionElement>,
        ) {
            environment.editor.project
                ?.let { WavePanelHolder.getInstance(it).chatSession()?.agent }
                ?.reportCompletionOutcome("accepted")
        }
    }

    override fun isEnabled(event: InlineCompletionEvent): Boolean {
        val request = event.toRequest() ?: return false
        val editor = request.editor
        if (!editor.document.isWritable) return false
        if (editor.caretModel.caretCount > 1) return false
        if (editor.selectionModel.hasSelection()) return false
        return true
    }

    override suspend fun getSuggestion(request: InlineCompletionRequest): InlineCompletionSuggestion {
        val document = request.document
        val text = document.immutableCharSequence
        if (text.length > CompletionOptions.MAX_FILE_CHARS) return noSuggestion()

        val project = request.editor.project ?: return noSuggestion()
        val agent = WavePanelHolder.getInstance(project).chatSession()?.agent
            ?: return noSuggestion()

        val context = buildCompletionContext(text, request.startOffset)
        val vFile = FileDocumentManager.getInstance().getFile(document)
        val filePath = vFile?.path
        val language = request.file.language?.displayName ?: ""
        val snippets = collectDefinitionSnippets(
            project,
            request.editor,
            request.file,
            request.startOffset,
        ).orEmpty()

        val response = try {
            withTimeoutOrNull(CompletionOptions.REQUEST_TIMEOUT_MS) {
                agent.getCompletion(
                    buildJsonObject {
                        put("prefix", context.prefix)
                        put("suffix", context.suffix)
                        put("language", language)
                        if (filePath != null) put("filePath", filePath)
                        if (snippets.isNotEmpty()) {
                            put(
                                "snippets",
                                buildJsonArray {
                                    snippets.forEach { snippet ->
                                        add(
                                            buildJsonObject {
                                                put("path", snippet.path)
                                                put("text", snippet.text)
                                            },
                                        )
                                    }
                                },
                            )
                        }
                    },
                )
            }
        } catch (e: CancellationException) {
            // The user typed on: let the platform's cancellation through.
            throw e
        } catch (_: Exception) {
            null
        } ?: return noSuggestion()

        val suggestion = response["text"]
            ?.jsonPrimitive
            ?.contentOrNull
            ?.let { truncateSuggestion(it) }
            .orEmpty()
        if (suggestion.isEmpty()) return noSuggestion()

        // The document may have changed while the model was thinking; inserting
        // at the old offset would be wrong (spec: 响应返回时若文档已变化则丢弃).
        if (document.textLength < request.startOffset) return noSuggestion()

        agent.reportCompletionOutcome("displayed")

        return InlineCompletionSingleSuggestion.build {
            emit(InlineCompletionGrayTextElement(suggestion))
        }
    }

    /** An empty suggestion list: the platform renders nothing for it. */
    private suspend fun noSuggestion(): InlineCompletionSuggestion =
        InlineCompletionSingleSuggestion.build {}
}
