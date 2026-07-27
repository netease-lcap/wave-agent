package com.wave.jetbrains.session

import com.intellij.notification.Notification
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.project.Project

/**
 * Shows a single native notification while conversation compaction is in
 * progress and expires (closes) it when compaction completes — instead of
 * stacking separate "starting" and "complete" balloons.
 *
 * Mirrors packages/vsce/src/session/compactionNotifier.ts.
 *
 * [createAndShow] / [dismiss] are swappable seams so the lifecycle can be unit
 * tested without the IntelliJ Platform (cf. UpdateChecker.httpGet).
 */
class CompactionNotifier<T : Any>(
    private val createAndShow: (String) -> T,
    private val dismiss: (T) -> Unit,
) {
    private var handle: T? = null

    fun onCompactionStateChange(isCompacting: Boolean) {
        if (isCompacting) {
            handle = createAndShow("正在压缩对话…")
        } else {
            handle?.let(dismiss)
            handle = null
        }
    }

    companion object {
        fun forProject(project: Project): CompactionNotifier<Notification> =
            CompactionNotifier(
                createAndShow = { message ->
                    NotificationGroupManager.getInstance()
                        .getNotificationGroup("Wave")
                        .createNotification("Wave", message, NotificationType.INFORMATION)
                        .also { it.notify(project) }
                },
                dismiss = { it.expire() },
            )
    }
}
