package com.wave.jetbrains.nextEdit

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware

/**
 * 接受当前显示的下一步编辑建议（spec 故事 2）。
 *
 * 浮层上 Tab 也能接受，但浮层必须先拿到焦点；这个动作让用户在任何时候都能用同一个快捷键
 * 接受（默认 Ctrl+Alt+Enter，与 VS Code 端一致，可在「设置 → 按键映射」里改）。没有建议
 * 时它是空操作。
 */
class AcceptNextEditAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        WaveNextEditService.getInstance(project).acceptCurrent()
    }
}
