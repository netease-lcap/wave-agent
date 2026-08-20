---
name: "Stdio 传输层"
description: "编辑器插件与 `wave --stdio` 子进程的 JSON-RPC 通信，CLI 解析/安装/升级、多会话路由、错误诊断"
order: 220
---

# 功能规格说明：Stdio 传输层

**创建日期**：2026-07-24

## 概述

编辑器插件（VS Code 扩展、JetBrains 插件等）不在插件宿主进程中运行 Agent 逻辑，而是通过 JSON-RPC 2.0 over stdio 与 `wave --stdio` 子进程通信。本规格覆盖该传输层的完整生命周期：CLI 的解析/运行、JSON-RPC 通信协议、共享进程的多会话路由、以及错误诊断。

**CLI 交付方式**：VSCE 将 wave CLI 内置进扩展包（三件套：`bin/wave-code.js` 版本探测 shim + `package.json` + `dist/bundle/wave.mjs`，合计约 2.9MB），运行时由扩展宿主自身的 Node 运行时（`process.execPath`）直接执行，不依赖客户系统安装 Node.js/npm；JB 插件同样内置三件套进插件包，但运行在 JVM 中、没有宿主 Node，运行时借用客户系统安装的 Node.js（≥ 22）执行内置 CLI。两个客户端均不再依赖 npm 全局安装的 `wave-code` 包，CLI 版本跟随各自插件版本发布。CLI 的 grep 工具依赖 `@vscode/ripgrep`（JS 包装 + 平台 rg 二进制，约 5.2MB）**不打包**，首次使用时按需从 npmmirror 下载到 `~/.wave/cli/node_modules/` 并缓存（两个客户端共享同一 runtime 目录，rg 缓存互用）；该包是 wave.mjs 的顶层 import，下载失败时 CLI 无法启动，必须向用户报错并提示检查网络后重试。两个客户端均通过同一套 stdio 协议与架构与 `wave --stdio` 通信。

### 架构

```
                     Editor Plugin (扩展入口)
                    /     |      \
          sidebarSession  tabSessions[]  windowSessions[]
                    \     |      /
                   ChatSession (每个会话一个)
                      │ 持有
                   StdioAgent (类型化包装层 + 状态缓存)
                      │
          ┌───────────┼───────────┐
          │           │           │
   NotificationRouter  │    FileService / SessionService / PluginService
          │           │           │ (utility 请求，无 session 上下文)
    register/unregister│
          │     StdioClient (单共享实例)
          │           │
    按 sessionId 分发   spawn
          │           │
    StdioAgent      wave --stdio (子进程)
```

**关键设计决策**：所有会话（sidebar/tab/window）共享同一个 `StdioClient` 子进程实例，通过 JSON-RPC 信封中的 `sessionId` 字段区分不同会话的请求和通知。

## 用户场景与测试 _（必填）_

### 用户故事：VSCE 使用内置 CLI（优先级：P1）

作为 VS Code 扩展用户，我希望扩展直接使用随扩展发布的内置 wave CLI，以便无需安装 Node.js/npm、无需任何手动配置即可开始使用。

**为什么是这个优先级**：这是整个 stdio 传输层的前提——没有 CLI，插件无法做任何事情。内置方案将 CLI 与扩展捆绑发布，消灭了对客户系统 Node.js（≥ 22）与 npm 的依赖；grep 依赖 rg 不打包，仅在需要时按需下载并缓存，避免安装包膨胀。

**独立测试**：在一台未安装 Node.js 且未安装 `wave-code` 的机器上安装插件，打开聊天面板，验证扩展直接运行内置 CLI 并启动子进程；首次启动后 `~/.wave/cli/node_modules/` 下出现下载的 rg 二进制，再次启动不重复下载。

**验收场景**：

1. **假设** 扩展已安装且内置 CLI（`dist/wave-cli/bin/wave-code.js` + `package.json` + `dist/bundle/wave.mjs`）随扩展发布，**当**插件初始化时，**则**将内置 CLI 复制到用户可写的 `~/.wave/cli/`（扩展安装目录只读），解析到其中的 `bin/wave-code.js` 作为入口，用扩展宿主运行时（`process.execPath`）执行 `bin/wave-code.js --stdio`，不查找系统 PATH、不执行 npm。
2. **假设** `WAVE_CLI_PATH` 环境变量指向一个存在的工作区构建（开发场景），**当**插件初始化时，**则**优先使用该路径而非内置 CLI，便于本地开发调试。
3. **假设** 二进制路径已解析成功，**当**同一插件生命周期内再次调用解析时，**则**直接返回缓存的路径，不重复查找、不重复复制。
4. **假设** 内置 CLI 文件缺失或不可读（安装损坏），**当**插件初始化时，**则**抛出明确错误并提示用户重新安装扩展，不尝试从网络安装。
5. **假设** 内置 CLI 的 grep 依赖 rg 尚未下载，**当**插件首次启动 CLI 时，**则**从 npmmirror 下载 `@vscode/ripgrep` JS 包装与当前平台的 rg 二进制到 `~/.wave/cli/node_modules/@vscode/`（wave.mjs 通过 createRequire 向上解析该目录），并提示用户正在下载。
6. **假设** rg 已下载过（`~/.wave/cli/node_modules/@vscode/` 下存在当前平台的 rg 二进制），**当**插件再次启动 CLI 时，**则**直接复用缓存，不重复下载。
7. **假设** rg 下载失败（网络不可达、registry 超时等），**当**插件初始化时，**则**初始化失败并显示明确错误（提示检查网络后重试）——`@vscode/ripgrep` 是 wave.mjs 的顶层依赖，缺失时 CLI 无法启动，不存在"仅 grep 暂不可用"的降级路径。

---

### 用户故事：JB 插件使用内置 CLI（优先级：P1）

作为 JetBrains 插件用户，我希望插件直接使用随插件发布的内置 wave CLI，以便无需安装 npm 包、无需任何手动配置即可开始使用。

**为什么是这个优先级**：这是整个 stdio 传输层的前提——没有 CLI，插件无法做任何事情。内置方案将 CLI 与插件捆绑发布，消灭了对 npm 全局安装 `wave-code` 的依赖（PATH 查找、`npm install -g` 自动安装/升级、版本检查全部移除）；插件仍借用客户系统的 Node.js（≥ 22）作为运行时执行内置 CLI，无需自带 Node。grep 依赖 rg 不打包，仅在需要时按需下载并缓存，避免安装包膨胀。

**独立测试**：在一台未安装 `wave-code` npm 包的机器上安装插件（仅需系统 Node.js ≥ 22），打开聊天面板，验证插件直接运行内置 CLI 并启动子进程；首次启动后 `~/.wave/cli/node_modules/` 下出现下载的 rg 二进制，再次启动不重复下载。

**验收场景**：

1. **假设** 插件已安装且内置 CLI（`resources/wave-cli/bin/wave-code.js` + `package.json` + `dist/bundle/wave.mjs`）随插件 jar/zip 发布，**当**插件初始化时，**则**将内置 CLI 复制到用户可写的 `~/.wave/cli/`（插件安装目录只读），解析到其中的 `bin/wave-code.js` 作为入口，用系统 Node.js 执行 `node <entry> --stdio`，不查找系统 PATH 的 `wave`、不执行 npm。
2. **假设** `WAVE_CLI_PATH` 环境变量指向一个存在的工作区构建（开发场景），**当**插件初始化时，**则**优先使用该路径而非内置 CLI，便于本地开发调试。
3. **假设** 二进制路径已解析成功，**当**同一插件生命周期内再次调用解析时，**则**直接返回缓存的路径，不重复查找、不重复复制。
4. **假设** 内置 CLI 文件缺失或不可读（安装损坏），**当**插件初始化时，**则**抛出明确错误并提示用户重新安装插件，不尝试从网络安装。
5. **假设** 内置 CLI 的 grep 依赖 rg 尚未下载，**当**插件首次启动 CLI 时，**则**从 npmmirror 下载 `@vscode/ripgrep` JS 包装与当前平台的 rg 二进制到 `~/.wave/cli/node_modules/@vscode/`（wave.mjs 通过 createRequire 向上解析该目录），并提示用户正在下载。
6. **假设** rg 已下载过（`~/.wave/cli/node_modules/@vscode/` 下存在当前平台的 rg 二进制），**当**插件再次启动 CLI 时，**则**直接复用缓存，不重复下载。
7. **假设** rg 下载失败（网络不可达、registry 超时等），**当**插件初始化时，**则**初始化失败并显示明确错误（提示检查网络后重试）——`@vscode/ripgrep` 是 wave.mjs 的顶层依赖，缺失时 CLI 无法启动，不存在"仅 grep 暂不可用"的降级路径。
8. **假设** 系统未安装 Node.js，**当**插件尝试解析二进制时，**则**抛出明确错误："未检测到 Node.js。请先安装 Node.js (https://nodejs.org)，然后重启编辑器。"——JB 插件借用系统 Node 作为 CLI 运行时，Node 是必需的。
9. **假设** 系统 Node.js 版本低于 22，**当**插件尝试解析二进制时，**则**抛出明确错误："Node.js 版本过低（当前 vX，需要 >= 22）。请升级 Node.js (https://nodejs.org)，然后重启编辑器。"

---

### 用户故事：CLI 版本管理与升级（优先级：P1）

作为编辑器插件用户，我希望 CLI 版本与插件版本始终匹配，以便获得一致的功能体验。

**为什么是这个优先级**：CLI 和插件版本不匹配会导致协议不兼容、功能缺失或运行时崩溃。VSCE 与 JB 均通过"内置 + 随插件发布"从机制上保证版本一致，无运行期独立升级流程。

**独立测试**：VSCE：安装扩展后确认内置 CLI 版本与扩展版本一致；JB：安装插件后确认内置 CLI 版本与插件版本一致，升级插件后内置 CLI 随新版本重新复制。

**验收场景**：

1. **假设** VSCE 扩展已安装，**当**插件初始化时，**则**直接使用内置 CLI，其版本与扩展版本一致（构建时由发布流程保证），无独立运行期升级流程。
2. **假设** VSCE 扩展升级到新版本（内置 CLI 版本变化），**当**插件初始化时，**则**重新复制内置 CLI 到 `~/.wave/cli/`，但保留 `node_modules/`（已缓存的 rg），不重复下载。
3. **假设** JB 插件已安装，**当**插件初始化时，**则**直接使用内置 CLI，其版本与插件版本一致（构建时由发布流程保证），无 npm 安装/升级流程。
4. **假设** JB 插件升级到新版本（内置 CLI 版本变化），**当**插件初始化时，**则**重新复制内置 CLI 到 `~/.wave/cli/`，但保留 `node_modules/`（已缓存的 rg），不重复下载。
5. **假设** JB 插件与其它客户端（VSCE/桌面端）共用 `~/.wave/cli/` runtime 目录，**当**各客户端内置 CLI 版本一致时，**则**互不覆盖，rg 缓存共享；版本不一致时后初始化的客户端按自身版本覆盖（保留 `node_modules/`）。

---

### 用户故事：初始化失败诊断（优先级：P1）

作为编辑器插件用户，我希望在 CLI 无法启动时获得明确的错误信息和可操作的修复指引，以便快速解决问题而不是面对晦涩的技术错误。

**为什么是这个优先级**：JB 插件借用系统 Node.js 作为 CLI 运行时，缺失或版本过低时应给出可理解的引导而非晦涩的进程错误；VSCE 内置 CLI 后不再受系统 Node 影响，但子进程启动失败与运行期崩溃仍需清晰诊断。

**独立测试**：JB：在一台未安装 Node.js 的 Windows 机器上安装插件，打开聊天面板，验证错误消息明确告知用户需要安装 Node.js。VSCE：删除扩展包内的内置 CLI 文件后打开聊天面板，验证错误提示重新安装扩展。

**验收场景**：

1. **假设** VSCE 内置 CLI 文件缺失或无法用宿主运行时执行（安装损坏），**当**插件尝试启动子进程时，**则**在编辑器通知中显示明确错误，提示重新安装扩展，不涉及任何 Node.js 安装指引。
2. **假设** VSCE 的 rg 下载失败（网络不可达等），**当**插件初始化时，**则**显示明确错误"grep 搜索依赖（ripgrep）下载失败，请检查网络连接后重试"，下次启动自动重试下载。
3. **假设** JB 系统未安装 Node.js（`which/where node` 失败，且 nvm、JBR 均无可用 node），**当**插件尝试解析二进制时，**则**抛出明确错误："未检测到 Node.js。请先安装 Node.js (https://nodejs.org)，然后重启编辑器。"，并在编辑器通知中显示该消息。
4. **假设** JB 系统已安装 Node.js 但版本低于 22，**当**插件尝试解析二进制时，**则**抛出明确错误："Node.js 版本过低（当前 vX，需要 >= 22）。请升级 Node.js (https://nodejs.org)，然后重启编辑器。"，并在编辑器通知中显示该消息。
5. **假设** JB 内置 CLI 文件缺失或不可读（安装损坏），**当**插件尝试启动子进程时，**则**在编辑器通知中显示明确错误，提示重新安装插件，不尝试从网络安装。
6. **假设** JB 的 rg 下载失败（网络不可达等），**当**插件初始化时，**则**显示明确错误"grep 搜索依赖（ripgrep）下载失败，请检查网络连接后重试"，下次启动自动重试下载。
7. **假设** CLI 子进程启动后立即退出（exit code 非 0），**当**插件检测到进程退出时，**则**在编辑器通知中显示错误，包含 stderr 输出（如果有），并建议用户检查 CLI 安装。
8. **假设** 任何初始化错误发生后，**当**用户查看编辑器输出面板的 Wave 通道时，**则**能看到完整的错误堆栈和上下文信息用于诊断。

---

### 用户故事：JSON-RPC 通信（优先级：P1）

作为扩展开发者，我希望通过标准 JSON-RPC 2.0 协议与 CLI 子进程进行双向通信，以便发送请求、接收响应和订阅通知。

**为什么是这个优先级**：JSON-RPC 是整个传输层的通信基础，所有上层功能（发消息、执行命令、状态同步）都依赖它。

**独立测试**：启动插件后发送一条消息，验证请求通过 stdin 发出、响应从 stdout 返回、通知被正确分发。

**验收场景**：

1. **假设** 插件向 CLI 发送一个请求，**当**请求发出时，**则**stdin 写入一行 JSON，格式为 `{"id": <自增整数>, "method": "<方法名>", "params": {...}, "sessionId": "<会话ID>"}`。
2. **假设** CLI 返回一个响应，**当**stdout 收到一行 JSON 时，**则**通过 `id` 字段匹配到 pending 请求，`result` 字段 resolve 请求 Promise，`error` 字段 reject 请求 Promise。
3. **假设** CLI 推送一个通知，**当**stdout 收到包含 `method` 但无 `id` 的 JSON 时，**则**将其作为通知分发到已注册的处理器，不创建 pending 请求。
4. **假设** stdout 收到一行无法解析为 JSON 的内容，**当**处理该行时，**则**静默忽略该行，不影响后续消息处理。
5. **假设** stdout 收到一行 JSON 但值为 `null` 或非对象类型，**当**处理该行时，**则**静默忽略该行，不影响后续消息处理。
6. **假设** 插件发送一个通知（非请求），**当**通知发出时，**则**stdin 写入一行 JSON，格式为 `{"method": "<方法名>", "params": {...}, "sessionId": "<会话ID>"}`，不含 `id` 字段，不期待响应。

---

### 用户故事：共享进程与多会话路由（优先级：P1）

作为同时打开多个聊天面板（sidebar + tab + window）的用户，我希望所有会话共享同一个 CLI 子进程，通过 sessionId 区分各自的消息流，以便减少资源占用同时保持会话隔离。

**为什么是这个优先级**：共享进程是多面板架构的基础，路由错误会导致消息串台、状态混乱。

**独立测试**：打开 sidebar 聊天和一个 tab 聊天，在两个面板分别发送消息，验证各自收到正确的响应和通知，不串台。

**验收场景**：

1. **假设** 插件初始化完成，**当**创建多个 ChatSession（sidebar/tab/window）时，**则**所有 session 共享同一个 StdioClient 实例，不创建多个子进程。
2. **假设** 某个 session 发送请求，**当**请求携带该 session 的 sessionId 时，**则**CLI 返回的响应通过 id 匹配直接返回给发起者，不经过路由。
3. **假设** CLI 推送一个带 sessionId 的通知，**当**NotificationRouter 收到时，**则**将通知分发到 sessionId 对应的 StdioAgent，不分发给其他 session。
4. **假设** CLI 推送一个不带 sessionId 的全局通知（如 `authUrl`），**当**NotificationRouter 收到时，**则**将其分发到已注册的全局处理器。
5. **假设** session 的 sessionId 发生变更（如 restoreSession），**当**收到 `sessionIdChange` 通知时，**则**NotificationRouter 将旧 sessionId 的映射迁移到新 sessionId，确保后续通知仍能正确路由。
6. **假设** 某个 session 被销毁（关闭 tab/window），**当**执行 destroy 时，**则**从 NotificationRouter 取消注册该 session，但**不**销毁共享的 StdioClient（其他 session 仍在使用）。
7. **假设** 所有 session 都已销毁，**当**插件本身被关闭时，**则**ChatProvider.dispose() 先销毁所有 session，再 dispose 共享的 StdioClient。

---

### 用户故事：进程生命周期与崩溃处理（优先级：P2）

作为用户，我希望 CLI 子进程的异常退出能被妥善处理，pending 请求不会永远挂起，以便插件在进程崩溃时能给出明确反馈而不是无限等待。

**为什么是这个优先级**：当前进程崩溃后 pending 请求会被 reject（已实现），但没有自动恢复机制，且 stderr 输出对用户不可见。

**独立测试**：在插件运行期间手动 kill CLI 子进程，验证 pending 请求被 reject、后续操作给出明确错误。

**验收场景**：

1. **假设** CLI 子进程意外退出（非正常 dispose），**当**进程 `exit` 事件触发时，**则**所有 pending 请求被 reject（错误信息包含退出码），StdioClient 标记为 disposed。
2. **假设** StdioClient 已 disposed，**当**尝试发送新请求时，**则**立即 reject，不尝试写入 stdin。
3. **假设** CLI 子进程向 stderr 输出内容，**当**stderr 收到数据时，**则**输出到编辑器输出面板的 Wave 通道（而非仅 console.error），便于用户和开发者诊断。
4. **假设** dispose() 被调用，**当**执行销毁时，**则**杀掉子进程、标记 disposed，且多次调用 dispose() 是幂等的。
5. **假设** CLI 子进程退出后 StdioClient 已 disposed，**当**用户尝试在聊天面板发送消息时，**则**显示明确的错误消息告知用户连接已断开，需要重启插件。

---

### 用户故事：状态缓存与同步读取（优先级：P2）

作为扩展 UI 层，我希望 StdioAgent 在本地缓存最新状态（消息列表、任务、权限模式等），以便在渲染时同步读取，无需 await 异步请求。

**为什么是这个优先级**：React 组件渲染是同步的，异步获取状态会导致渲染闪烁和竞态条件。本地缓存确保 UI 始终有最新状态可读。

**独立测试**：调用 `getMessages` 拉取后读取 StdioAgent.messages，验证缓存已更新为 CLI 侧的最新消息列表。

**验收场景**：

1. **假设** UI 需要完整消息列表（webviewReady、compact、rewind、clearChat、restoreSession），**当**调用 `getMessages` 请求时，**则**StdioAgent 向 CLI 发起请求，将返回的 `Message[]` 更新到 `this.messages` 缓存。`messagesChange` 通知已从协议中移除，消息缓存不再由推送维护。
2. **假设** CLI 推送 `tasksChange` 通知，**当**StdioAgent 处理该通知时，**则**更新 `this.tasks` 缓存并触发 `onTasksChange` 回调。
3. **假设** CLI 推送 `permissionModeChange` 通知，**当**StdioAgent 处理该通知时，**则**更新 `this.permissionMode` 缓存并触发 `onPermissionModeChange` 回调。
4. **假设** CLI 推送 `loadingChange` 通知，**当**StdioAgent 处理该通知时，**则**更新 `this.latestTotalTokens` 缓存并触发 `onLoadingChange` 回调。
5. **假设** StdioAgent 的某个回调未设置（为 undefined），**当**对应通知到达时，**则**正常更新缓存但不触发回调，不抛出错误。
6. **假设** StdioAgent 收到 `sessionIdChange` 通知，**当**处理该通知时，**则**更新 `this.sessionId` 缓存、触发 `onSessionIdChange` 回调，同时 NotificationRouter 执行 rekey。
7. **假设** StdioAgent 收到 `workdirChange` 通知，**当**处理该通知时，**则**更新 `this.workingDirectory` 缓存并触发 `onWorkdirChange` 回调。

---

### 用户故事：Webview 按需拉取全量消息（优先级：P1）

作为 webview UI 层，我希望完整消息列表只在主动请求时获取（webviewReady、compact、rewind、clearChat、restoreSession），而不是订阅持续的 `messagesChange` 全量推送，以便流式更新保持纯增量，长会话不因每次 chunk 全量序列化而下发。

**为什么是这个优先级**：移除 `onMessagesChange` 后，stdio 通道上的消息数据流必须是"增量通知 + 按需拉取"：流式期间只流动消息/块粒度的增量通知（bang 三回调 `onAddBangMessage`/`onUpdateBangMessage`/`onCompleteBangMessage` 携带 `messageId`，支持增量定位），全量列表仅作为对 webview 主动请求（`getMessages`）或初始化（`webviewReady` → `setInitialState`）的响应下发。这是消息流式化架构在传输层的核心诉求。

**独立测试**：打开插件聊天面板发送一条触发流式的消息，在 CLI 侧记录 stdout：流式期间仅出现 `assistantMessageAdded`/`assistantContentUpdated` 等增量通知，无 `messagesChange` 或等价的全量推送；面板初始化、执行 compact/rewind 后各出现一次 `getMessages` 请求，bang 命令期间仅出现携带 `messageId` 的增量通知（`bangMessageAdded`/`bangMessageUpdated`/`bangMessageCompleted`）。

**验收场景**：

1. **假设**插件 webview 首次加载，**当**发送 `webviewReady` 时，**则**宿主调用 `getMessages` 拉取完整消息列表，并在 `setInitialState` 响应中下发
2. **假设**助手正在流式响应，**当**CLI 产生新 chunk 时，**则**webview 仅收到增量通知（`userMessageAdded`/`assistantMessageAdded`/`assistantContentUpdated`/`toolBlockUpdated` 等）并就地更新对应消息块，全程无全量列表下发
3. **假设**用户执行 compact / rewind / clearChat / restoreSession，**当**操作完成时，**则**webview（或宿主代表 webview）主动发起 `getMessages` 请求，以返回的全量列表重建消息区
4. **假设** bang 信号（`bangMessageAdded`/`bangMessageUpdated`/`bangMessageCompleted`）到达，**当**宿主转发给 webview 时，**则**通知携带 `messageId`，webview 按 `messageId` 就地创建/更新/完成 bang 消息块，无需拉取全量列表
5. **假设** CLI 侧移除 `messagesChange` 通知，**当**StdioAgent 收到流式增量通知时，**则**不再通过任何全量消息推送更新缓存；`this.messages` 仅在 `getMessages` 响应或显式初始化时更新

---

### 用户故事：流式通知纯增量负载（优先级：P1）

作为 stdio 传输层，我希望跨进程增量通知只携带增量片段（delta）而非累积值，以便流式期间单条通知的序列化与传输成本与已流式内容总长度无关，长会话流式不再对子进程内存和管道带宽造成 O(n²) 压力。

**为什么是这个优先级**：移除 `messagesChange` 后通知条数已经与消息条数无关，但每个 `assistantContentUpdated` 通知仍携带与已流式内容等长的累积 `accumulated` payload（tool block 携带累积 `parameters`），节流只能减少条数、无法减少单条负载。改为纯 delta 后，`assistantContentUpdated`/`assistantReasoningUpdated` 只携带 `{messageId, chunk, stage}`（SDK 侧已计算 chunk = 新内容 − 旧内容），`toolBlockUpdated` 在 `stage="streaming"` 只携带 `parametersChunk`；消费端负责累积（追加），`getMessages` 全量响应作为权威对账通道自愈丢失的 delta。SDK 回调与 wire 通知统一为纯 delta（`accumulated` 已从 SDK 回调移除，2026-08-08），agentBridge 原样透传、无需剥离。

**独立测试**：构造长会话触发流式，在 CLI 侧记录 stdout 并测量通知负载大小：通知字节数随流式累积不增长（仅随 chunk 本身大小波动）；流式过程中 kill/重启任一宿主的 webview 转发层后，通过一次 `getMessages` 拉取即可恢复完整内容。

**验收场景**：

1. **假设** 助手响应正在流式传输，**当** CLI 推送 `assistantContentUpdated`/`assistantReasoningUpdated` 通知时，**则** 通知负载为 `{messageId, chunk, stage}`，不含 `accumulated` 字段；内容由消费端按序追加累积
2. **假设** 工具参数正在流式传输，**当** CLI 推送 `toolBlockUpdated` 且 `stage="streaming"` 时，**则** 负载只含 `parametersChunk` 增量，不含累积 `parameters`；**当** `stage="end"` 时，**则** 负载携带全量 `parameters` + `result` 作为一次性权威值
3. **假设** 某条流结束，**当** CLI 推送最后一个增量通知时，**则** `chunk` 为空字符串（`chunk: ""`）且 `stage="end"`，消费端据此终结流式块
4. **假设** 宿主对增量通知做节流（如桌面 16ms / CLI 500ms 窗口），**当** 窗口内有多条 chunk 时，**则** 按到达顺序拼接为一个合并 delta 发送（window-concat），不丢弃中间值；进程内 CLI 同样使用 window-concat（SDK 回调已无 accumulated，不存在 last-value-wins 路径）
5. **假设** 增量通知中途丢失（传输异常），**当** 消费端发现内容不完整时，**则** 通过一次 `getMessages` 请求拉取全量权威快照整体替换自愈，管道 FIFO 保证拉取响应包含其之前发出的所有 chunk，不重复
6. **假设** 某个宿主需要将 delta 转发给 webview，**当** 转发时，**则** 透传 delta（消费端 webview reducer 追加），不在宿主侧重新累积为全量后再下发

---

### 用户故事：IDE 插件消息队列列表（优先级：P2）

作为 IDE 插件用户，我希望在 AI 处理期间发送的消息以队列列表形式展示，可以查看、立即发送、删除或重新编辑排队消息，以便在 AI 忙碌时管理我的待处理输入。

**为什么是这个优先级**：队列管理提升忙碌时的输入可控性，但消息仍可正常排队等待，属于体验增强。

**独立测试**：在 AI 响应期间发送两条消息，验证输入框上方出现"消息队列 (2)"列表；对其中一条点击删除，对另一条点击编辑修改后回车，验证队列内容相应更新。

**验收场景**：

1. **假设** AI 正在处理且用户发送了消息，**当**消息进入队列时，**则**输入框上方显示"消息队列 (N)"列表，N 为排队消息数。
2. **假设**队列列表已显示，**当**用户点击列表头部时，**则**在折叠（仅显示第一条）与展开（显示全部，超高可滚动）之间切换。
3. **假设**队列中某条为 shell 命令，**当**列表渲染时，**则**该条摘要带 `!` 前缀；所有条目单行截断显示，悬停时可查看完整内容。
4. **假设**用户对某条排队消息点击"发送"，**当**操作发生时，**则**该消息立即发送（不等当前处理完成顺序出队）并从队列中移除。
5. **假设** AI 处理中、队列里存在后台任务完成通知，且用户点击某条排队消息的"发送"，**当**操作发生时，**则**该消息立即发送并从队列移除；后台任务通知不触发额外的 AI 循环（不会出现两个并发的 agent loop），发送过程保持可中断，且被中断后通知仍保留在队列中不丢失。
6. **假设**用户对某条排队消息点击"删除"，**当**操作发生时，**则**该消息立即从列表消失。
7. **假设**用户对某条排队消息点击"编辑"，**当**操作发生时，**则**消息内容载入输入框并显示"编辑队列消息"标记；用户修改后按回车，**则**原队列消息被替换为新内容；用户删除该标记，**则**退出编辑状态。
8. **假设**用户通过键盘方向上键尝试召回队列消息，**当**在 IDE 插件输入框中操作时，**则**不支持该召回方式（与 CLI 的产品差异：IDE 插件仅支持点击"编辑"按钮召回）。
9. **假设**有对话框打开或存在待处理的权限确认，**当**界面渲染时，**则**队列列表隐藏，避免遮挡。

---

### 边界情况

- **Windows spawn 方式**（JB 适用）：JB 插件以 `node <entry> --stdio` 方式执行内置 CLI（入口是 `.js` 脚本，无需 shell），不再 spawn 任何 `npm.cmd`/`wave.cmd` shim，规避 Node.js CVE-2024-27980 补丁后无 shell 拒绝执行 `.cmd` 的限制；`getCliVersion` 探测同样以 `node <entry> -v` 执行。
- **`getCliVersion` 超时**（JB 适用）：`node <entry> -v` 执行有超时，超时返回 `null`（视为入口损坏，触发重新复制内置 CLI）。
- **内置 CLI 的宿主运行时**：VSCE 扩展宿主的 `process.execPath` 是有效的 Node 二进制（Electron 扩展宿主运行时），直接以 `process.execPath <bin/wave-code.js> --stdio` 方式 spawn，Windows 上无需 shell、无 `.cmd` 路径注入风险；JB 插件无宿主 Node，以系统 Node.js（`which/where node` → nvm → JBR 逐级查找）执行内置 CLI，Windows 上同样无需 shell。
- **内置 CLI 布局**（VSCE/JB 通用）：内置内容为三件套——`bin/wave-code.js`（版本探测 shim，处理 `-v` 后 import `../dist/bundle/wave.mjs`）、`package.json`、`dist/bundle/wave.mjs`。wave.mjs 运行时经 `createRequire(import.meta.url)` 向上解析 `@vscode/ripgrep-<platform>-<arch>/bin/rg`，因此下载的 rg 必须放在 CLI 目录的 `node_modules/@vscode/` 下。
- **可写区复制**（VSCE/JB 通用）：插件安装目录只读，内置 CLI 在首次启动（或版本变更）时复制到用户目录 `~/.wave/cli/`；复制前只删除 `dist/`、入口与 `package.json`，保留 `node_modules/`（rg 缓存），升级插件不会强制重新下载 rg。VSCE 与 JB 共享同一 runtime 目录。
- **rg 按需下载与缓存**：rg（`@vscode/ripgrep` JS 包装 + 平台二进制）首次使用时从 npmmirror 下载到 `~/.wave/cli/node_modules/@vscode/`，版本取 CLI 声明的 `^range` 内的最高版本（semver `maxSatisfying`）；平台包名 `@vscode/ripgrep-<platform>-<arch>`，rg 二进制存在于预期路径即视为缓存命中，不重复下载。
- **rg 下载失败即初始化失败**：`@vscode/ripgrep` 是 wave.mjs 的顶层 import（JS 包装加载时就解析平台二进制），JS 包装或平台包任一缺失都会导致 CLI 无法启动。rg 下载失败必须作为初始化错误抛出（提示检查网络后重试），不能静默降级；下次启动自动重试下载。
- **开发覆盖**（VSCE/JB 通用）：`WAVE_CLI_PATH` 环境变量指向工作区构建的 CLI 文件时优先使用，便于本地开发调试；生产环境不设置该变量。
- **CLI 版本同步**（VSCE/JB 通用）：内置 CLI 与插件版本由发布流程绑定（插件构建时复制对应版本的三件套进包），无运行期独立升级；用户升级插件即获得新 CLI。构建顺序必须先构建 `packages/code`（生成 `dist/bundle/wave.mjs`）再打包插件。
- **utility 请求无 session 上下文**：FileService（搜索文件）、SessionService（列出会话）、PluginService（管理插件）的请求不需要 sessionId，直接通过共享 StdioClient 发送。
- **`authUrl` 全局通知**：SSO 登录流程中 CLI 推送的 `authUrl` 通知不带 sessionId，通过 `router.registerGlobal` 注册的处理器接收，直接打开系统浏览器。
- **CLI 子进程的 env 传递**：StdioClient 构造函数接受可选的 `env` 参数，未传时子进程继承插件宿主的 `process.env`。
- **消息队列列表编辑无重复入队**：IDE 插件中编辑排队消息时，将原消息删除并把内容载入输入框；若用户编辑后未发送，该消息不会自动回到队列。
- **消息队列列表无键盘召回**：IDE 插件输入框的方向上键不召回队列消息（与 CLI 不同），仅支持通过列表中的"编辑"按钮召回；这是刻意的平台产品差异。
- **增量通知不携带累积值**：`assistantContentUpdated`/`assistantReasoningUpdated` 通知只携带 `chunk` 增量；`toolBlockUpdated` 在 `streaming` 阶段只携带 `parametersChunk`。任何依赖 `accumulated`/`parameters` 累积字段的旧消费端需改为本地累积或使用 `getMessages` 拉取全量。
- **end 通知是全量权威值**：`toolBlockUpdated` 的 `stage="end"` 通知携带完整 `parameters` + `result`，消费端应以该值为准终结工具块，不能仅凭 streaming 阶段的拼接结果。
