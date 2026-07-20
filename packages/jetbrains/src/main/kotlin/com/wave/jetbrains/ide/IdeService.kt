package com.wave.jetbrains.ide

import com.intellij.ide.BrowserUtil
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.editor.LogicalPosition
import com.intellij.openapi.editor.ScrollType
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.fileChooser.FileChooserFactory
import com.intellij.openapi.fileChooser.FileSaverDescriptor
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.LocalFileSystem
import com.wave.jetbrains.util.Edt
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.awt.Desktop
import java.io.File
import java.nio.file.Files
import java.util.Base64

/**
 * IDE integration service: handles webview commands that touch IntelliJ IDE capabilities
 * (open file, preview image, download mermaid, error notification, upload artifacts).
 * Mirrors packages/vsce/src/session/messageHandler.ts handlers + fileService.ts.
 *
 * Field names and response commands follow the VSCE implementation so the shared webview
 * bundle works unchanged. Invoked by [com.wave.jetbrains.session.MessageHandler] on a
 * background coroutine; EDT-sensitive operations marshal themselves onto the EDT.
 */
object IdeService {
    private val LOG = logger<IdeService>()

    /** A file uploaded from the webview (name + raw bytes). */
    data class UploadedFile(val name: String, val data: ByteArray)

    /** Result of writing uploaded files to the temp artifacts dir (mirrors fileService.ts). */
    data class UploadResult(val uploadedFiles: List<String>, val errors: List<String>)

    /**
     * openFile — mirrors VSCE handleOpenFile (messageHandler.ts:221).
     * Params: path (String), optional startLine / endLine (1-based).
     * Opens the file and positions the caret / selection, revealing the range in center.
     */
    fun openFile(project: Project, params: JsonObject) {
        val path = params["path"]?.jsonPrimitive?.content
        if (path.isNullOrEmpty()) return
        val startLine = params["startLine"]?.jsonPrimitive?.content?.toIntOrNull()
        val endLine = params["endLine"]?.jsonPrimitive?.content?.toIntOrNull()

        Edt.invokeLater {
            try {
                val file = LocalFileSystem.getInstance().findFileByPath(path)
                if (file == null) {
                    showError(project, "打开文件失败: 文件不存在 $path")
                    return@invokeLater
                }
                val editors = FileEditorManager.getInstance(project).openFile(file, true)
                if (startLine != null) {
                    val textEditor = editors.filterIsInstance<TextEditor>().firstOrNull()
                    if (textEditor != null) {
                        val editor = textEditor.editor
                        val startLine0 = maxOf(0, startLine - 1)
                        val endLine0 = maxOf(0, (endLine ?: startLine) - 1)
                        val startOffset = editor.logicalPositionToOffset(LogicalPosition(startLine0, 0))
                        val endOffset = editor.logicalPositionToOffset(LogicalPosition(endLine0, 0))
                        editor.selectionModel.setSelection(startOffset, endOffset)
                        editor.caretModel.moveToOffset(endOffset)
                        editor.scrollingModel.scrollToCaret(ScrollType.CENTER)
                    }
                }
            } catch (e: Exception) {
                LOG.warn("openFile failed: ${e.message}", e)
                showError(project, "打开文件失败: ${e.message}")
            }
        }
    }

    /**
     * previewImage — mirrors VSCE handlePreviewImage (messageHandler.ts:241).
     * Params: path (String). JetBrains has no built-in image viewer, so open the file with
     * the OS default app (Desktop.open); fall back to the system browser.
     */
    fun previewImage(project: Project, params: JsonObject) {
        val path = params["path"]?.jsonPrimitive?.content
        if (path.isNullOrEmpty()) return
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                val file = File(path)
                if (!file.exists()) {
                    showError(project, "预览图片失败: 文件不存在 $path")
                    return@executeOnPooledThread
                }
                if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.OPEN)) {
                    Desktop.getDesktop().open(file)
                } else {
                    BrowserUtil.browse(file.toURI().toString())
                }
            } catch (e: Exception) {
                LOG.warn("previewImage failed: ${e.message}", e)
                showError(project, "预览图片失败: ${e.message}")
            }
        }
    }

    /**
     * openExternal — mirrors VSCE handleOpenExternal (messageHandler.ts:133/openExternal).
     * Params: url (String). Opens the URL in the system default browser.
     */
    fun openExternal(project: Project, params: JsonObject) {
        val url = params["url"]?.jsonPrimitive?.content
        if (url.isNullOrEmpty()) return
        try {
            BrowserUtil.browse(url)
        } catch (e: Exception) {
            LOG.warn("openExternal failed: ${e.message}", e)
            showError(project, "打开外部链接失败: ${e.message}")
        }
    }

    /**
     * downloadMermaid — mirrors VSCE handleDownloadMermaid (messageHandler.ts:388).
     * Params: content (String), format ("svg" | "png"). For png, content is a data URL
     * (data:image/png;base64,...); for svg, content is the raw SVG text.
     * Shows a native save dialog, writes the file, and pushes downloadSuccess / downloadError
     * back to the webview (VSCE shows an info message instead; the response commands are
     * harmless extras the webview ignores).
     */
    fun downloadMermaid(
        project: Project,
        params: JsonObject,
        onResult: (command: String, payload: JsonObject) -> Unit,
    ) {
        val content = params["content"]?.jsonPrimitive?.content
        val format = params["format"]?.jsonPrimitive?.content ?: "svg"
        if (content.isNullOrEmpty()) {
            onResult("downloadError", buildJsonObject { put("error", "缺少图表内容") })
            return
        }
        val defaultFileName = "mermaid-diagram-${System.currentTimeMillis()}.$format"
        val defaultDir = project.basePath?.let { java.nio.file.Paths.get(it) }

        Edt.invokeLater {
            try {
                val descriptor = FileSaverDescriptor("保存 Mermaid 图表", "选择保存位置", format)
                val dialog = FileChooserFactory.getInstance().createSaveFileDialog(descriptor, project)
                val wrapper = dialog.save(defaultDir, defaultFileName) ?: return@invokeLater // user cancelled
                val target = wrapper.file
                val bytes = when (format) {
                    "svg" -> content.toByteArray(Charsets.UTF_8)
                    else -> {
                        // data URL: data:image/png;base64,<...>
                        val base64 = content.substringAfter(",", "")
                        if (base64.isEmpty()) {
                            onResult("downloadError", buildJsonObject { put("error", "无效的 PNG 数据") })
                            return@invokeLater
                        }
                        Base64.getDecoder().decode(base64)
                    }
                }
                Files.write(target.toPath(), bytes)
                onResult("downloadSuccess", buildJsonObject {
                    put("message", "图表已保存至: ${target.absolutePath}")
                })
            } catch (e: Exception) {
                LOG.warn("downloadMermaid failed: ${e.message}", e)
                onResult("downloadError", buildJsonObject { put("error", "保存图表失败: ${e.message}") })
            }
        }
    }

    /**
     * showError — mirrors VSCE showError (messageHandler.ts:80), which calls
     * vscode.window.showErrorMessage(message). Uses a balloon notification (closest IDE
     * equivalent to the VS Code error toast).
     */
    fun showError(project: Project, message: String) {
        try {
            NotificationGroupManager.getInstance()
                .getNotificationGroup("Wave")
                .createNotification("Wave", message, NotificationType.ERROR)
                .notify(project)
        } catch (e: Exception) {
            // Fallback if the notification group is unavailable.
            LOG.warn("showError notification failed: ${e.message}")
        }
    }

    /**
     * uploadFilesToArtifacts — mirrors VSCE fileService.uploadFilesToArtifacts.
     * Writes each file to <tmpdir>/wave-artifacts/<name> (appending _<n> on conflict) and
     * returns the list of written absolute paths plus per-file errors. The webview expects
     * uploadSuccess { uploadedFiles: string[] } / uploadError { errors: string[] }.
     */
    fun uploadFilesToArtifacts(files: List<UploadedFile>): UploadResult {
        val artifactsDir = File(System.getProperty("java.io.tmpdir"), "wave-artifacts").apply {
            if (!exists()) mkdirs()
        }
        val uploaded = mutableListOf<String>()
        val errors = mutableListOf<String>()
        for (file in files) {
            try {
                val ext = file.name.substringAfterLast('.', "")
                val baseName = if (ext.isEmpty()) file.name else file.name.substringBeforeLast(".$ext")
                val extPart = if (ext.isEmpty()) "" else ".$ext"
                var candidate = File(artifactsDir, "$baseName$extPart")
                var counter = 1
                while (candidate.exists()) {
                    candidate = File(artifactsDir, "${baseName}_$counter$extPart")
                    counter++
                }
                Files.write(candidate.toPath(), file.data)
                uploaded.add(candidate.absolutePath)
                LOG.info("Uploaded artifact to ${candidate.absolutePath}")
            } catch (e: Exception) {
                LOG.warn("uploadFilesToArtifacts failed for ${file.name}: ${e.message}", e)
                errors.add("${file.name}: ${e.message}")
            }
        }
        return UploadResult(uploaded, errors)
    }
}
