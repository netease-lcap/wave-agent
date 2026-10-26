package com.wave.jetbrains.nextEdit

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.util.Alarm
import com.wave.jetbrains.WavePanelHolder
import com.wave.jetbrains.completion.CompletionOptions
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * 下一步编辑建议的 JetBrains 端：编辑轨迹 → 防抖 → 请求 → 浮层预览。
 *
 * 触发方式与 VS Code 端不同（spec 边界：渲染与触发方式两端各自实现，可观察行为一致）：
 * VS Code 挂在行内补全提供者上（平台按补全节奏调它），JetBrains 的行内补全是平台独占的、
 * 且只能往光标处插灰字，所以这里自己听文档事件、自己做防抖，预览走 [NextEditPreview] 浮层。
 *
 * 一切尽力而为：没有会话、超时、模型报错、解析不出来都只是「这次不提示」
 * （spec 边界情况「静默跳过」）。
 */
@Service(Service.Level.PROJECT)
class WaveNextEditService(private val project: Project) : Disposable {
    private val history = NextEditHistory()
    private val alarm = Alarm(Alarm.ThreadToUse.POOLED_THREAD, this)

    /** 每次新编辑就 +1：回到 EDT 时值变了说明已经不是最新那一次，结果作废。 */
    @Volatile
    private var generation = 0

    private var preview: NextEditPreview? = null

    private val listener = object : DocumentListener {
        // 轨迹要在改动前后各拿一次文本，`beforeDocumentChange` 里 `oldFragment` 才是被删的。
        override fun beforeDocumentChange(event: DocumentEvent) {
            if (event.document.isWritable) history.record(event)
        }

        override fun documentChanged(event: DocumentEvent) {
            schedule(event.document)
        }
    }

    init {
        EditorFactory.getInstance().eventMulticaster.addDocumentListener(listener, this)
    }

    override fun dispose() {
        alarm.cancelAllRequests()
        dismiss()
    }

    /** 一次编辑之后该做什么：先让旧预览消失，再按需排一次请求。 */
    private fun schedule(document: Document) {
        val editor = FileEditorManager.getInstance(project).selectedTextEditor ?: return
        if (editor.document !== document) return

        generation += 1
        alarm.cancelAllRequests()
        dismiss()

        val snapshot = snapshot(editor, document) ?: return
        val scheduled = generation
        alarm.addRequest({ request(snapshot, scheduled) }, DEBOUNCE_MS)
    }

    /**
     * 在 EDT 上把一次请求需要的全部输入取下来。之后整条链路只读这份快照：池化线程不碰
     * 文档（省掉 read action），回到 EDT 时用 `modificationStamp` 判它是否还是同一份内容。
     */
    private fun snapshot(editor: Editor, document: Document): Snapshot? {
        if (!document.isWritable) return null
        if (editor.caretModel.caretCount > 1) return null
        if (editor.selectionModel.hasSelection()) return null
        if (document.textLength > CompletionOptions.MAX_FILE_CHARS) return null

        val lastEditAt = history.lastEditAt(document) ?: return null
        if (System.currentTimeMillis() - lastEditAt > MAX_EDIT_AGE_MS) return null
        val edits = history.recent(document)
        // 没有轨迹就没有可预测的「下一步」：那正是补全该做的事（spec 故事 3 场景 5）。
        if (edits.isEmpty()) return null

        val lineCount = document.lineCount
        val caretLine = document.getLineNumber(editor.caretModel.offset.coerceIn(0, document.textLength)) + 1
        val windowStart = (caretLine - WINDOW_LINES).coerceAtLeast(1)
        val windowEnd = (caretLine + WINDOW_LINES).coerceAtMost(lineCount)
        val excerptStart = (windowStart - EXCERPT_LINES).coerceAtLeast(1)
        val excerptEnd = (windowEnd + EXCERPT_LINES).coerceAtMost(lineCount)

        val excerptLines = (excerptStart..excerptEnd).map { lineText(document, it) }
        val windowLines = excerptLines.subList(windowStart - excerptStart, windowEnd - excerptStart + 1)
        val vFile = FileDocumentManager.getInstance().getFile(document)

        return Snapshot(
            document = document,
            editor = editor,
            stamp = document.modificationStamp,
            edits = edits,
            windowStart = windowStart,
            windowEnd = windowEnd,
            windowText = windowLines.joinToString("\n"),
            excerptStart = excerptStart,
            excerptLines = excerptLines,
            language = vFile?.fileType?.name ?: "",
            filePath = vFile?.path,
        )
    }

    /** 池化线程：发请求、解析、算最小改动，再把结果交回 EDT。 */
    private fun request(snapshot: Snapshot, scheduled: Int) {
        val agent = WavePanelHolder.getInstance(project).chatSession()?.agent ?: return
        val params = buildJsonObject {
            put(
                "edits",
                buildJsonArray {
                    snapshot.edits.forEach { (oldText, newText) ->
                        add(
                            buildJsonObject {
                                put("oldText", oldText)
                                put("newText", newText)
                            },
                        )
                    }
                },
            )
            put(
                "region",
                buildJsonObject {
                    put("startLine", snapshot.windowStart)
                    put("endLine", snapshot.windowEnd)
                    put("text", snapshot.windowText)
                },
            )
            put(
                "excerpt",
                buildJsonObject {
                    put("startLine", snapshot.excerptStart)
                    put("text", snapshot.excerptLines.joinToString("\n"))
                },
            )
            put("language", snapshot.language)
            snapshot.filePath?.let { put("filePath", it) }
        }

        val response = runCatching {
            runBlocking {
                withTimeoutOrNull(CompletionOptions.REQUEST_TIMEOUT_MS) { agent.getNextEdit(params) }
            }
        }.getOrNull() ?: return

        val suggestion = (response["suggestion"] as? JsonObject) ?: return
        val startLine = suggestion["startLine"]?.jsonPrimitive?.intOrNull ?: return
        val endLine = suggestion["endLine"]?.jsonPrimitive?.intOrNull ?: return
        val text = suggestion["text"]?.jsonPrimitive?.contentOrNull ?: return

        val replacement = buildNextEditReplacement(
            excerptStartLine = snapshot.excerptStart,
            excerptLines = snapshot.excerptLines,
            suggestionStartLine = startLine,
            suggestionEndLine = endLine,
            suggestionText = text,
        ) ?: return

        val document = snapshot.document
        ApplicationManager.getApplication().invokeLater {
            // 文档已变（或又不是最新的一次编辑）：行号是照着旧版本算的，丢掉。
            if (scheduled != generation) return@invokeLater
            if (document.modificationStamp != snapshot.stamp) return@invokeLater
            if (snapshot.editor.isDisposed) return@invokeLater
            present(snapshot, replacement)
        }
    }

    private fun present(snapshot: Snapshot, replacement: NextEditReplacement) {
        val document = snapshot.document
        if (replacement.startLine > document.lineCount + 1) return
        if (replacement.endLineExclusive > document.lineCount + 1) return

        val from = offsetOfLine(document, replacement.startLine)
        val atEndOfFile = replacement.endLineExclusive > document.lineCount
        val to = if (atEndOfFile) document.textLength else offsetOfLine(document, replacement.endLineExclusive)
        val newText = replacementText(document, replacement, from, to)

        val shown = NextEditPreview(
            project = project,
            editor = snapshot.editor,
            startOffset = from,
            endOffset = to,
            newText = newText,
            removedLines = replacement.removedLines,
            addedLines = replacement.addedLines,
            onOutcome = ::reportOutcome,
        )
        preview = shown
        shown.show { reportOutcome("displayed") }
    }

    /** 接受当前显示的建议；没有建议时什么也不做，动作可以放心绑快捷键。 */
    fun acceptCurrent() {
        preview?.accept()
    }

    /**
     * 替换文本的换行形态：区间止于某行行首时，被替换的每一行都带着自己的结尾换行，所以
     * 文本必须补一个；一直替换到文件末尾时不补——文件原来没有结尾换行的话，补了就凭空
     * 多出一行。
     */
    private fun replacementText(
        document: Document,
        replacement: NextEditReplacement,
        from: Int,
        to: Int,
    ): String {
        val added = replacement.newText
        if (added.isEmpty()) return ""
        val atEndOfFile = to >= document.textLength
        if (replacement.startLine == replacement.endLineExclusive) {
            // 纯插入：在行边界插入整行。文件末尾插入时，按文件是否以换行结尾决定换行放在
            // 前还是后，保留原有的行尾形态。
            if (atEndOfFile) {
                return if (document.textLength > 0 && !document.text.endsWith("\n")) "\n$added" else "$added\n"
            }
            return "$added\n"
        }
        return if (atEndOfFile) added else "$added\n"
    }

    /** 1-based 行号 → 该行行首偏移；超出末行时落到文件末尾（追加）。 */
    private fun offsetOfLine(document: Document, line: Int): Int =
        if (line > document.lineCount) document.textLength else document.getLineStartOffset(line - 1)

    private fun lineText(document: Document, line: Int): String {
        val start = document.getLineStartOffset(line - 1)
        val end = document.getLineEndOffset(line - 1)
        return document.text.substring(start, end)
    }

    private fun dismiss() {
        preview?.hide()
        preview = null
    }

    /**
     * 建议生命周期的一个事件（`displayed` | `accepted`），用于 `wave.next_edit.outcome`。
     * 与补全分开计（spec docs/specs/enterprise/opentelemetry.md），上报本身不阻塞界面。
     */
    private fun reportOutcome(outcome: String) {
        WavePanelHolder.getInstance(project).chatSession()?.agent?.reportNextEditOutcome(outcome)
    }

    /** 一次请求的全部输入，取自 EDT、之后只读。 */
    private data class Snapshot(
        val document: Document,
        val editor: Editor,
        val stamp: Long,
        val edits: List<Pair<String, String>>,
        val windowStart: Int,
        val windowEnd: Int,
        val windowText: String,
        val excerptStart: Int,
        val excerptLines: List<String>,
        val language: String,
        val filePath: String?,
    )

    companion object {
        fun getInstance(project: Project): WaveNextEditService =
            project.getService(WaveNextEditService::class.java)

        /** 打字停顿多久才值得问一次（与 VS Code 端的 baseDebounceMs 同一量级）。 */
        private const val DEBOUNCE_MS = 200

        /** 光标上下各几行是模型可以改写的窗口。 */
        private const val WINDOW_LINES = 5

        /** 窗口之外再送多少行只读上下文。 */
        private const val EXCERPT_LINES = 40

        /** 一次编辑过了这么久就不再预测下一步：那是补全该做的事。 */
        private const val MAX_EDIT_AGE_MS = 30_000L
    }
}
