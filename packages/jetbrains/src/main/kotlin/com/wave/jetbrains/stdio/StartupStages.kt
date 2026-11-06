package com.wave.jetbrains.stdio

/**
 * 首次启动的阶段 id 与面板文案（spec `ui/stdio-transport.md`「首次启动的进度文案」）。
 *
 * 阶段 id 是**跨进程的协议值**：CLI 经 `startupStage` 通知把「我现在在干什么」发出来，
 * 宿主自己也在阻塞点上报同一套 id。文案表在 SDK 侧只有一份
 * （`packages/agent-sdk/src/constants/startupStage.ts`），Kotlin 拿不到它，故这里按
 * 同一口径逐字对齐——改文案要两边一起改，否则同一个阶段在不同客户端会变成两句话。
 *
 * 文案口径同 SDK：只描述**正在做**的事，不带百分比与剩余时间（下载流没有可靠的
 * 总量，编一个进度就是假信息），单行、以省略号收尾。
 */
object StartupStages {
    const val CONNECTING = "connecting"
    const val CHECKING_ENVIRONMENT = "checkingEnvironment"
    const val DOWNLOADING_RUNTIME = "downloadingRuntime"
    const val INSTALLING_RUNTIME = "installingRuntime"
    const val SYNCING_CLI = "syncingCli"
    const val DOWNLOADING_TOOL_DEPS = "downloadingToolDeps"
    const val STARTING_SESSION = "startingSession"

    /**
     * 阶段 → 面板文案；未知阶段返回 null（界面按「没有文案」处理，不猜）。
     * [target] 只对 [CONNECTING] 有意义，插件端是本地会话，用不到。
     */
    fun text(stage: String, target: String? = null): String? = when (stage) {
        CONNECTING -> if (target.isNullOrEmpty()) "正在连接主机…" else "正在连接 $target…"
        CHECKING_ENVIRONMENT -> "正在检查远端环境…"
        DOWNLOADING_RUNTIME -> "正在下载 Node.js 运行时（约 50 MB）…"
        INSTALLING_RUNTIME -> "正在安装 Node.js 运行时…"
        SYNCING_CLI -> "正在同步 Wave CLI…"
        DOWNLOADING_TOOL_DEPS -> "正在下载工具依赖（搜索与图片处理）…"
        STARTING_SESSION -> "正在启动会话…"
        else -> null
    }
}
