package com.wave.jetbrains.editor

import com.intellij.icons.AllIcons
import com.intellij.openapi.fileTypes.FileType
import javax.swing.Icon

/**
 * File type backing [WaveSettingsVirtualFile] editor tabs. Registered in code (not via the
 * `com.intellij.fileType` extension point) so it never surfaces in "New File" or language
 * association lists; its only job is to give the settings tab an icon and to mark the file
 * as binary so the platform never tries to open it with a text editor.
 */
object WaveSettingsFileType : FileType {
    override fun getName(): String = "CodeWave IDE Settings"
    override fun getDescription(): String = "CodeWave IDE 设置"
    override fun getDefaultExtension(): String = "wavesettings"
    override fun getIcon(): Icon = AllIcons.General.Settings
    override fun isBinary(): Boolean = true
}
