package com.wave.jetbrains.stdio

import com.intellij.openapi.project.Project
import com.intellij.openapi.startup.ProjectActivity

/**
 * Start the login-shell environment probe right after a project opens
 * (spec core/bash-tools.md「用户故事：登录 shell 环境注入」, scenario 1).
 *
 * The probe spawns the user's login shell (`-l -i`), which sources nvm,
 * Homebrew and the rest of the rc file and can take seconds — so it must never
 * sit on the startup path. [execute] only hands the work to a background task
 * and returns: IDE startup and the tool window never wait for it. The CLI spawn
 * later waits for the (normally already finished) result with a bounded timeout
 * — see [BinaryResolver.resolveEnv].
 */
class LoginShellEnvStartupActivity : ProjectActivity {
    override suspend fun execute(project: Project) {
        BinaryResolver.warmupLoginShellEnv()
    }
}
