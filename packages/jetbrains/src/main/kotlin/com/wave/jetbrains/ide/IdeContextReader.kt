package com.wave.jetbrains.ide

import com.intellij.codeInsight.daemon.impl.HighlightInfo
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.application.EDT
import com.intellij.openapi.editor.Document
import com.intellij.openapi.editor.impl.DocumentMarkupModel
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.vfs.VfsUtilCore
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.wm.ToolWindowManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.jetbrains.plugins.terminal.ShellTerminalWidget
import org.jetbrains.plugins.terminal.TerminalToolWindowManager

/**
 * IDE 上下文读取（spec `ui/ide-context-mentions.md`，JetBrains 侧）。
 *
 * 只做「读数据」：终端给原始文本、诊断给结构化条目，标题/排序/上限/转义清理
 * 全在共享 webview 里做（`packages/webview/src/utils/ideContext.ts`）。两个宿主
 * 各写一份读取（IDE API 本就不同），但不各写一份格式。
 *
 * 回包结构与 `wave-webview-fixtures` 的 `IdeContextResult` 逐字段一致：
 * `{ provider, ok, terminalText? | problems? + filePath?, reason? }`。
 */
class IdeContextReader(private val project: Project) {

    suspend fun read(providers: List<String>): JsonArray = buildJsonArray {
        for (provider in providers) {
            when (provider) {
                "terminal" -> add(readTerminal())
                "problems" -> add(readProblems())
            }
        }
    }

    /**
     * 活动终端最后一条命令及其输出。
     *
     * 走经典 Shell 终端 widget 的文本缓冲（history + screen），因此**不要求
     * 2025.3 起的新 Terminal API**：取终端工具窗口里选中的那个标签，把缓冲里的
     * 行拼成纯文本。转义清理与截断在 webview 做。
     *
     * 选中的标签 → widget 必须用 `TerminalToolWindowManager.getWidgetByContent`：
     * 工具窗口的 `Content` 装的是终端**视图**（分组容器），widget 是它的子组件，
     * 所以 `contentManager.getContent(widget)` 永远是 null（真机上就退化成「没有
     * 活动终端」，而终端明明开着）。同名的 `findWidgetByContent` 返回的是新 API 的
     * 桥接对象（`JBTerminalWidget$TerminalWidgetBridge`），拿不到文本缓冲；真机
     * 日志里 `resolved=…TerminalWidgetBridge` 就是踩到这一层。
     */
    private suspend fun readTerminal(): JsonObject = withContext(Dispatchers.EDT) {
        try {
            val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Terminal")
            val widget = toolWindow?.contentManager?.selectedContent
                ?.let { TerminalToolWindowManager.getWidgetByContent(it) }
                as? ShellTerminalWidget

            if (widget == null) {
                return@withContext unavailable("terminal", "没有活动的终端标签")
            }

            val buffer = widget.terminalTextBuffer
            val builder = StringBuilder()
            for (i in 0 until buffer.historyLinesCount + buffer.screenLinesCount) {
                builder.append(buffer.getLine(i).text).append('\n')
            }
            val text = builder.toString()
            if (text.isBlank()) {
                return@withContext unavailable("terminal", "终端里没有可读的命令输出")
            }

            buildJsonObject {
                put("provider", "terminal")
                put("ok", true)
                put("terminalText", text)
            }
        } catch (e: Exception) {
            unavailable("terminal", "读取终端失败：${e.message ?: e.javaClass.simpleName}")
        }
    }

    /**
     * 活动编辑器所在文件的错误与警告。
     *
     * 读的是 daemon 写在文档 markup model 里的 highlighter —— `HighlightInfo` 与
     * `DocumentMarkupModel` 都属 `impl` 包（平台没有公开的诊断读取 API，Claude
     * Code 与 Continue 的 JetBrains 插件也都用这两个），跨 IDE 大版本可能失效；
     * 失效时降级为「不可用」一行说明，不影响另一个类别。
     */
    private suspend fun readProblems(): JsonObject = withContext(Dispatchers.EDT) {
        try {
            val editor = FileEditorManager.getInstance(project).selectedTextEditor
                ?: return@withContext unavailable(
                    "problems",
                    "没有活动编辑器（无法确定要读哪个文件）",
                )
            val document = editor.document
            val highlights = DocumentMarkupModel.forDocument(document, project, true)
                .allHighlighters
                .mapNotNull { HighlightInfo.fromRangeHighlighter(it) }

            val problems = highlights.mapNotNull { info ->
                val label = when (info.severity) {
                    HighlightSeverity.ERROR -> "error"
                    HighlightSeverity.WARNING -> "warning"
                    else -> return@mapNotNull null
                }
                val start = info.startOffset
                val line = document.getLineNumber(start) + 1
                val column = start - document.getLineStartOffset(line - 1) + 1
                ProblemEntry(line, column, label, info.description ?: "")
            }

            buildJsonObject {
                put("provider", "problems")
                put("ok", true)
                put(
                    "problems",
                    buildJsonArray {
                        for (problem in problems) {
                            add(
                                buildJsonObject {
                                    put("line", problem.line)
                                    put("column", problem.column)
                                    put("severity", problem.severity)
                                    put("message", problem.message)
                                },
                            )
                        }
                    },
                )
                filePathOf(document)?.let { put("filePath", it) }
            }
        } catch (e: Exception) {
            unavailable("problems", "读取诊断失败：${e.message ?: e.javaClass.simpleName}")
        }
    }

    /** 工作区相对路径优先（与 webview 里其它路径呈现一致），取不到则用文件名。 */
    private fun filePathOf(document: Document): String? {
        val file = FileDocumentManager.getInstance().getFile(document) ?: return null
        return relativePath(file)
    }

    private fun relativePath(file: VirtualFile): String {
        val baseDir = project.guessProjectDir() ?: return file.name
        return VfsUtilCore.getRelativePath(file, baseDir, '/') ?: file.name
    }

    private fun unavailable(provider: String, reason: String): JsonObject = buildJsonObject {
        put("provider", provider)
        put("ok", false)
        put("reason", reason)
    }

    private data class ProblemEntry(
        val line: Int,
        val column: Int,
        val severity: String,
        val message: String,
    )
}
