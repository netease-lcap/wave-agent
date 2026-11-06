/**
 * 首次启动的进度文案（spec `ui/stdio-transport.md`「首次启动的进度文案」）。
 *
 * 为什么文案表放在 SDK 而不在各宿主：阶段 id 是**跨进程的协议值**（CLI 经
 * `startupStage` 通知发出来），文案若各宿主各存一份，四个界面迟早各说各话
 * （同一个阶段叫「正在下载运行时」还是「正在准备 Node」，用户看到的是两次
 * 不同的启动过程）。这里一处定义，宿主只负责决定「我现在处于哪个阶段」。
 * JetBrains（Kotlin）拿不到这份表，按同一口径在插件里对齐。
 *
 * 文案口径：只描述**正在做**的事，不带百分比与剩余时间（下载流没有可靠的
 * 总量，编一个进度就是假信息），单行、以省略号收尾。
 */
import type { StartupStage } from "../types/stdioProtocol.js";

/**
 * 阶段 → 展示文案。`target` 只对 `connecting` 有意义（「正在连接 <主机名>」，
 * 桌面端 WSL 用发行版名）；不给时退化成不带名字的「正在连接主机…」。
 */
export function startupStageText(stage: StartupStage, target?: string): string {
  switch (stage) {
    case "connecting":
      return target ? `正在连接 ${target}…` : "正在连接主机…";
    case "checkingEnvironment":
      return "正在检查远端环境…";
    case "downloadingRuntime":
      return "正在下载 Node.js 运行时（约 50 MB）…";
    case "installingRuntime":
      return "正在安装 Node.js 运行时…";
    case "syncingCli":
      return "正在同步 Wave CLI…";
    case "downloadingToolDeps":
      return "正在下载工具依赖（搜索与图片处理）…";
    case "startingSession":
      return "正在启动会话…";
  }
}
