package com.wave.jetbrains.util

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import javax.swing.SwingUtilities

object Edt {
    private val LOG = logger<Edt>()

    /** Run on the EDT (invokeLater). */
    fun invokeLater(action: () -> Unit) {
        if (SwingUtilities.isEventDispatchThread()) {
            action()
        } else {
            ApplicationManager.getApplication().invokeLater(action)
        }
    }

    /** Offload blocking work to a background thread. */
    suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }
}
