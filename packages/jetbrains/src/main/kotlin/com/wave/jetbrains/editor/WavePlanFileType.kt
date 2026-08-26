package com.wave.jetbrains.editor

import com.intellij.icons.AllIcons
import com.intellij.openapi.fileTypes.FileType
import javax.swing.Icon

/**
 * File type backing [WavePlanVirtualFile] editor tabs. Registered in code (not via the
 * `com.intellij.fileType` extension point) so it never surfaces in "New File" or language
 * association lists; its only job is to give the plan tab an icon and to mark the file
 * as binary so the platform never tries to open it with a text editor.
 */
object WavePlanFileType : FileType {
    override fun getName(): String = "Wave Plan"
    override fun getDescription(): String = "Wave 计划预览"
    override fun getDefaultExtension(): String = "waveplan"
    override fun getIcon(): Icon = AllIcons.General.Web
    override fun isBinary(): Boolean = true
}
