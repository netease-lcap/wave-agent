---
paths:
  - "packages/agent-sdk/src/**/*"
  - "packages/code/src/**/*"
  - "packages/desktop/src/**/*"
  - "packages/vscode/src/**/*"
  - "packages/jetbrains/src/main/kotlin/**/*"
  - "packages/webview/remote/**/*"
---

- 会话目录有**三个**值，选哪个决定这条路会不会被 `cd` 带偏（同一个坑已经踩过多次：遥测 `vcs.repository.*`、审计锚点、路径相对化、宿主会话分组、桌面端差异面板）：
  - 「**会动**的那个」：SDK 侧的容器 token `CurrentWorkdir`、`Agent.currentWorkdir`、`AIManager.getCurrentWorkdir()`、工具上下文里的 `workdir`；协议侧是 `initialize` 回执的 `currentWorkdir`、`workdirChange` 通知的 `workdir`、各宿主 `StdioAgent.currentWorkdir`。Bash 里 `cd` 后重新注册、`EnterWorktree` 换成 worktree 路径、workdir 丢失时的恢复路径也会重写它。工具的 spawn cwd、项目规则加载、相对路径解析、**文件面板里相对路径的解析基准**（打开 `../x.ts` 这类路径时以谁为基准）、内嵌终端的初始目录、远控页 `@file` 拼接用它。
  - 「**会话工作根**」：SDK 侧的容器 token `WorkspaceRoot`、`Agent.workspaceRoot`、`AIManager.getWorkspaceRoot()`；协议侧是 `initialize` 回执与 `workspaceRootChange` 通知的 `workspaceRoot`、各宿主 `StdioAgent.workspaceRoot`。起点等于会话打开时的目录，**只有会话自己搬家时才动**——`EnterWorktree` / `ExitWorktree` 各写一次（`AIManager.setWorkspaceRoot`），Bash 里 `cd` 一个字都不动。回答「这条会话现在在哪个工作区里干活」。**桌面端差异面板的数据源、文件面板目录树的根（以及它的过滤范围）、`@` 文件搜索的锚点**用它——用户把这些当「我在哪个项目里」看，`cd` 只是 agent 的临时动作，不该让面板换项目；而进工作树是真的换了地方，该跟。对齐 CC 的 `originalCwd` 语义。
  - 「**不动**的那个」：SDK 侧的容器 token `SessionWorkdir`、`Agent.sessionWorkdir`、`AIManager.getOriginalWorkdir()`；协议侧是 `initialize` 回执的 `sessionCwd`、`listDaemonSessions` / `getSessionInfo` 行里的 `sessionCwd`、各宿主 `StdioAgent.sessionCwd`。只有 `Agent.switchSessionWorkdir` 把另一个会话恢复进来时才重置。回答「这个会话是在哪个目录开的」。侧边栏分组、项目级配置（AGENTS.md / settings / hooks / MCP）、遥测仓库归属、审计锚点、会话文件（transcript）定位用它；会话起点是 worktree 时它就是那个 worktree。
  - 判据两句话：**这个值会不会随 `cd` 变？** 会 → 「会动」的那个。**不会的话，它在会话搬进/搬出工作树时该不该跟？** 该跟（用户眼前的面板）→ 「会话工作根」；不该跟（身份 / 归属 / 审计 / 遥测维度 / 会话分组 / 项目级配置 / 会话文件定位）→ 「不动」的那个。
  - 反射动作：写 `.workdir` / `workdir` / `cwd` 之前先问一句「这里会不会因为会话里 `cd` 过一次就指错目录」。会指错就换成会话工作根或会话起点，并在注释里点名这三个名字之一。
