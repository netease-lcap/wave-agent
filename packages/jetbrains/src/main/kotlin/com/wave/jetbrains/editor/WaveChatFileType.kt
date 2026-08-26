package com.wave.jetbrains.editor

import com.intellij.icons.AllIcons
import com.intellij.openapi.fileTypes.FileType
import javax.swing.Icon

/**
 * File type backing [WaveChatVirtualFile] editor tabs. Registered in code (not via the
 * `com.intellij.fileType` extension point) so it never surfaces in "New File" or language
 * association lists; its only job is to give the editor tab an icon and to mark the file
 * as binary so the platform never tries to open it with a text editor.
 */
object WaveChatFileType : FileType {
    override fun getName(): String = "Wave Chat"
    override fun getDescription(): String = "Wave AI 聊天会话"
    override fun getDefaultExtension(): String = "wavechat"
    override fun getIcon(): Icon = AllIcons.General.Web
    override fun isBinary(): Boolean = true
}
