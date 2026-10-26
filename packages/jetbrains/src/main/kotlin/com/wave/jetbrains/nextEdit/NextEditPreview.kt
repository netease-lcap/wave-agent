package com.wave.jetbrains.nextEdit

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.colors.EditorFontType
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBLabel
import com.intellij.util.ui.JBUI
import java.awt.BorderLayout
import java.awt.Dimension
import java.awt.event.ActionEvent
import java.awt.event.KeyEvent
import javax.swing.AbstractAction
import javax.swing.BorderFactory
import javax.swing.BoxLayout
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.KeyStroke

/**
 * 下一步编辑建议的差异预览。
 *
 * JetBrains 平台的行内补全只能往光标处插灰字（替换任意区间、显示删除都做不到），所以
 * 这里的渲染走自己的路：一个贴在建议区间旁边的浮层，把「要删的行」与「要加的行」分开
 * 列出来（spec 故事 1 场景 4），Tab 接受、Esc 拒绝（spec 故事 2）。
 *
 * 接受是唯一写文档的动作，并且是一次独立的撤销步骤（`WriteCommandAction`）；渲染、拒绝
 * 都不碰文档（spec 边界情况「接受是唯一写入文档的动作」）。
 */
class NextEditPreview(
    private val project: Project,
    private val editor: Editor,
    private val startOffset: Int,
    private val endOffset: Int,
    private val newText: String,
    private val removedLines: List<String>,
    private val addedLines: List<String>,
    private val onOutcome: (String) -> Unit,
) {
    private var popup: JBPopup? = null

    /** 浮层显示时文档的版本：接受前它变了，说明偏移已经失效，不写。 */
    private val stamp = editor.document.modificationStamp

    /** 弹到建议区间附近；`shown` 在浮层真正显示后回调（用于上报 displayed）。 */
    fun show(shown: () -> Unit) {
        val panel = buildPanel()
        val created = JBPopupFactory.getInstance()
            .createComponentPopupBuilder(panel, panel)
            .setTitle("Wave 下一步编辑建议")
            .setResizable(false)
            .setMovable(false)
            .setRequestFocus(true)
            .setFocusable(true)
            .createPopup()
        popup = created
        created.showInBestPositionFor(editor)
        shown()
    }

    fun hide() {
        popup?.cancel()
        popup = null
    }

    private fun buildPanel(): JComponent {
        val panel = JPanel(BorderLayout())
        val lines = JPanel()
        lines.layout = BoxLayout(lines, BoxLayout.Y_AXIS)
        lines.border = JBUI.Borders.empty(4, 6)

        val font = editor.colorsScheme.getFont(EditorFontType.PLAIN)
        removedLines.take(MAX_DISPLAY_LINES)
            .forEach { lines.add(linePanel("- $it", removed = true, font = font)) }
        addedLines.take(MAX_DISPLAY_LINES)
            .forEach { lines.add(linePanel("+ $it", removed = false, font = font)) }

        panel.add(lines, BorderLayout.CENTER)
        panel.add(hintLabel(), BorderLayout.SOUTH)
        bindKeys(panel)
        panel.preferredSize = Dimension(
            minOf(lines.preferredSize.width + JBUI.scale(24), JBUI.scale(900)),
            lines.preferredSize.height + JBUI.scale(28),
        )
        return panel
    }

    private fun linePanel(text: String, removed: Boolean, font: java.awt.Font): JComponent {
        // 长行会把浮层撑成一面墙：截断即可，接受时写进文档的仍是完整文本。
        val shown = if (text.length > MAX_LINE_CHARS) text.take(MAX_LINE_CHARS) + " …" else text
        val label = JBLabel(if (shown.isBlank()) " " else shown)
        label.font = font
        if (removed) {
            label.foreground = JBColor.RED.darker()
            label.background = JBColor(ColorHolder.removedLight, ColorHolder.removedDark)
            label.isOpaque = true
        } else {
            label.foreground = JBColor(ColorHolder.addedLight, ColorHolder.addedDark)
        }
        return label
    }

    private fun hintLabel(): JComponent {
        val label = JBLabel("Tab 接受 · Esc 拒绝")
        label.font = JBUI.Fonts.smallFont()
        label.foreground = JBColor.GRAY
        label.border = BorderFactory.createEmptyBorder(2, 6, 4, 6)
        return label
    }

    private fun bindKeys(panel: JComponent) {
        panel.setFocusTraversalKeysEnabled(false)
        panel.getInputMap(JComponent.WHEN_FOCUSED).put(
            KeyStroke.getKeyStroke(KeyEvent.VK_TAB, 0),
            "wave.nextEdit.accept",
        )
        panel.actionMap.put("wave.nextEdit.accept", object : AbstractAction() {
            override fun actionPerformed(event: ActionEvent?) = accept()
        })
        panel.getInputMap(JComponent.WHEN_FOCUSED).put(
            KeyStroke.getKeyStroke(KeyEvent.VK_ESCAPE, 0),
            "wave.nextEdit.reject",
        )
        panel.actionMap.put("wave.nextEdit.reject", object : AbstractAction() {
            override fun actionPerformed(event: ActionEvent?) = hide()
        })
    }

    /** 接受建议。浮层的 Tab、以及工具栏/快捷键动作都走这里（[WaveNextEditService.acceptCurrent]）。 */
    fun accept() {
        // 文档在等待期间被别人改过：偏移已经失效，宁可不写。
        val document = editor.document
        if (document.modificationStamp != stamp || endOffset > document.textLength) {
            hide()
            return
        }
        hide()
        ApplicationManager.getApplication().invokeLater {
            WriteCommandAction.runWriteCommandAction(project) {
                document.replaceString(startOffset, endOffset, newText)
            }
            editor.caretModel.moveToOffset(minOf(startOffset + newText.length, document.textLength))
            onOutcome("accepted")
        }
    }

    private object ColorHolder {
        val removedLight = java.awt.Color(0xFF_E4_E4)
        val removedDark = java.awt.Color(0x4D_1B_1B)
        val addedLight = java.awt.Color(0x1B_5E_20)
        val addedDark = java.awt.Color(0x9B_E9_A4)
    }

    private companion object {
        /** 浮层最多列这么多行，再长就只列前几行。 */
        const val MAX_DISPLAY_LINES = 12

        /** 单行内容超过这个长度就截断显示。 */
        const val MAX_LINE_CHARS = 200
    }
}
