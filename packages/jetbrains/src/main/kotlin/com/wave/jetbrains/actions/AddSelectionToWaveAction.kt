package com.wave.jetbrains.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileDocumentManager
import com.wave.jetbrains.WavePanelHolder
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put

/**
 * Takes the current editor selection and pushes it into the webview input as an inline
 * selection tag, mirroring VSCE's addToWave / addSelectionToInput (chatProvider.ts:156,
 * selectionService.ts). Registered in the editor popup menu, visible only when there is a
 * selection (when="editorHasSelection").
 *
 * The selection payload matches [SelectionInfo] the webview expects:
 * { filePath, fileName, startLine, endLine, lineCount, selectedText, isEmpty }.
 */
class AddSelectionToWaveAction : AnAction() {
    private val LOG = logger<AddSelectionToWaveAction>()

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val editor = e.getData(CommonDataKeys.EDITOR) ?: return
        val selection = editor.selectionModel
        val selectedText = selection.selectedText ?: ""
        if (selectedText.isEmpty()) return
        val document = editor.document
        val vFile = FileDocumentManager.getInstance().getFile(document)
        val filePath = vFile?.path ?: ""
        val fileName = vFile?.let { project.basePath?.let { base -> relativize(base, it.path) } } ?: vFile?.name ?: ""

        val startLine = selection.selectionStart.let { document.getLineNumber(it) + 1 }
        val endLine = selection.selectionEnd.let { document.getLineNumber(it) + 1 }
        val lineCount = maxOf(1, endLine - startLine + 1)

        val payload = buildJsonObject {
            put("filePath", filePath)
            put("fileName", fileName)
            put("startLine", startLine)
            put("endLine", endLine)
            put("lineCount", lineCount)
            put("selectedText", selectedText)
            put("isEmpty", false)
        }

        val panel = WavePanelHolder.getInstance(project).activePanel
        if (panel == null) {
            LOG.warn("Wave panel not available; selection not sent")
            return
        }
        panel.postMessage("addSelectionToInput", payload)
    }

    /** Only enabled when an editor has a non-empty selection (mirrors editorHasSelection). */
    override fun update(e: AnActionEvent) {
        val editor = e.getData(CommonDataKeys.EDITOR)
        val hasSelection = editor != null &&
            editor.selectionModel.hasSelection() &&
            !editor.selectionModel.selectedText.isNullOrEmpty()
        e.presentation.isEnabledAndVisible = hasSelection
    }

    private fun relativize(base: String, path: String): String {
        val basePath = base.removeSuffix("/")
        if (!path.startsWith(basePath + "/") && path != basePath) return path
        return path.substring(basePath.length + 1)
    }
}
