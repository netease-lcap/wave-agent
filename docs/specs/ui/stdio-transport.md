---
name: "Stdio 传输层"
description: "编辑器插件与 `wave --stdio` 子进程的 JSON-RPC 通信，CLI 解析/安装/升级、多会话路由、错误诊断"
order: 220
---

# 功能规格说明：Stdio 传输层

**特性分支**：`stdio-transport`
**创建日期**：2026-07-24

## 概述

编辑器插件（VS Code 扩展、JetBrains 插件等）不在插件宿主进程中运行 Agent 逻辑，而是通过 JSON-RPC 2.0 over stdio 与 `wave --stdio` 子进程通信。本规格覆盖该传输层的完整生命周期：CLI 二进制文件的解析/安装/升级、JSON-RPC 通信协议、共享进程的多会话路由、以及错误诊断。本规格以 VSCE 实现为参考基准，JB 插件复用同一协议和架构。

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

## 用户场景与测试 *（必填）*

### 用户故事：CLI 二进制自动解析与安装（优先级：P1）

作为编辑器插件用户，我希望插件能自动找到或安装 `wave` CLI 二进制文件，以便无需手动配置即可开始使用。

**为什么是这个优先级**：这是整个 stdio 传输层的前提——没有 CLI 二进制文件，插件无法做任何事情。

**独立测试**：在一台未安装 `wave-code` 的机器上安装插件，打开聊天面板，验证插件自动通过 npm 安装 CLI 并启动子进程。

**验收场景**：

1. **假设** `wave` 已在系统 PATH 中，**当**插件初始化时，**则**通过 `which wave`（Unix）或 `where wave`（Windows）直接解析到二进制路径并使用它，不触发 npm 安装。
2. **假设** `wave` 不在 PATH 中但已通过 npm 全局安装，**当**插件初始化时，**则**通过 `npm prefix -g` 获取全局 bin 目录，在其中找到 `wave`（Unix）或 `wave.cmd`（Windows）并使用它。
3. **假设** `wave` 完全未安装，**当**插件初始化时，**则**自动执行 `npm install -g wave-code --registry=https://registry.npmmirror.com`，安装完成后重新解析二进制路径。
4. **假设** 二进制路径已解析成功，**当**同一插件生命周期内再次调用解析时，**则**直接返回缓存的路径，不重复查找。
5. **假设** 自动安装完成后二进制文件仍未出现在预期位置，**当**插件再次检查时，**则**再次尝试 PATH 查找作为兜底，仍失败则抛出明确错误。

---

### 用户故事：CLI 版本管理与升级（优先级：P1）

作为编辑器插件用户，我希望插件自动确保 CLI 版本与插件版本匹配，以便获得一致的功能体验。

**为什么是这个优先级**：CLI 和插件版本不匹配会导致协议不兼容、功能缺失或运行时崩溃。

**独立测试**：手动安装一个旧版本的 `wave-code` CLI，然后安装较新版本的插件，打开聊天面板，验证插件自动升级 CLI 到匹配版本。

**验收场景**：

1. **假设** 已安装 CLI 版本 >= 插件版本，**当**插件初始化时，**则**不执行升级，直接使用现有二进制。
2. **假设** 已安装 CLI 版本 < 插件版本，**当**插件初始化时，**则**自动执行 `npm install -g wave-code@<插件版本>` 升级到精确匹配版本。
3. **假设** CLI 二进制存在但损坏（`wave -v` 执行失败或返回空），**当**插件初始化时，**则**视为需要升级，执行升级流程。
4. **假设** 升级完成后，**当**插件重新解析二进制时，**则**缓存被清除并重新查找，确保使用新安装的二进制。
5. **假设** 目标版本字符串不匹配 semver 格式，**当**尝试升级时，**则**拒绝执行升级并抛出 "Invalid version" 错误，防止 shell 注入。

---

### 用户故事：初始化失败诊断（优先级：P1）

作为编辑器插件用户，我希望在 CLI 无法启动时获得明确的错误信息和可操作的修复指引，以便快速解决问题而不是面对晦涩的技术错误。

**为什么是这个优先级**：当前缺少 Node.js/npm 的用户会看到 "Failed to determine npm global directory" 这样令人困惑的错误，无法理解根本原因或如何修复。错误诊断是用户体验的关键环节。

**独立测试**：在一台未安装 Node.js 的 Windows 机器上安装插件，打开聊天面板，验证错误消息明确告知用户需要安装 Node.js。

**验收场景**：

1. **假设** 系统未安装 Node.js（`where npm` / `which npm` 失败，且 `process.execPath` 同目录无 npm），**当**插件尝试解析二进制时，**则**抛出明确错误："未检测到 Node.js/npm。请先安装 Node.js (https://nodejs.org)，然后重启编辑器。"，并在编辑器通知中显示该消息。
2. **假设** 系统已安装 Node.js 但版本低于 20，**当**插件尝试解析二进制时，**则**抛出明确错误："Node.js 版本过低（当前 vX，需要 >= 20）。请升级 Node.js (https://nodejs.org)，然后重启编辑器。"，并在编辑器通知中显示该消息。
3. **假设** npm 存在但 `npm prefix -g` 执行失败，**当**插件尝试获取全局 bin 目录时，**则**抛出包含 npm 错误输出的问题描述，并建议用户检查 npm 配置。
4. **假设** npm install 执行失败（网络问题、权限不足等），**当**插件尝试自动安装 CLI 时，**则**抛出包含 npm 错误输出的描述，并建议用户手动执行安装命令。
5. **假设** CLI 子进程启动后立即退出（exit code 非 0），**当**插件检测到进程退出时，**则**在编辑器通知中显示错误，包含 stderr 输出（如果有），并建议用户检查 CLI 安装。
6. **假设** 任何初始化错误发生后，**当**用户查看编辑器输出面板的 Wave 通道时，**则**能看到完整的错误堆栈和上下文信息用于诊断。

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

**独立测试**：发送一条消息后立即读取 StdioAgent.messages，验证缓存已更新为最新消息列表。

**验收场景**：

1. **假设** CLI 推送 `messagesChange` 通知，**当**StdioAgent 处理该通知时，**则**更新 `this.messages` 缓存并触发 `onMessagesChange` 回调。
2. **假设** CLI 推送 `tasksChange` 通知，**当**StdioAgent 处理该通知时，**则**更新 `this.tasks` 缓存并触发 `onTasksChange` 回调。
3. **假设** CLI 推送 `permissionModeChange` 通知，**当**StdioAgent 处理该通知时，**则**更新 `this.permissionMode` 缓存并触发 `onPermissionModeChange` 回调。
4. **假设** CLI 推送 `loadingChange` 通知，**当**StdioAgent 处理该通知时，**则**更新 `this.latestTotalTokens` 缓存并触发 `onLoadingChange` 回调。
5. **假设** StdioAgent 的某个回调未设置（为 undefined），**当**对应通知到达时，**则**正常更新缓存但不触发回调，不抛出错误。
6. **假设** StdioAgent 收到 `sessionIdChange` 通知，**当**处理该通知时，**则**更新 `this.sessionId` 缓存、触发 `onSessionIdChange` 回调，同时 NotificationRouter 执行 rekey。
7. **假设** StdioAgent 收到 `workdirChange` 通知，**当**处理该通知时，**则**更新 `this.workingDirectory` 缓存并触发 `onWorkdirChange` 回调。

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
5. **假设**用户对某条排队消息点击"删除"，**当**操作发生时，**则**该消息立即从列表消失。
6. **假设**用户对某条排队消息点击"编辑"，**当**操作发生时，**则**消息内容载入输入框并显示"编辑队列消息"标记；用户修改后按回车，**则**原队列消息被替换为新内容；用户删除该标记，**则**退出编辑状态。
7. **假设**用户通过键盘方向上键尝试召回队列消息，**当**在 IDE 插件输入框中操作时，**则**不支持该召回方式（与 CLI 的产品差异：IDE 插件仅支持点击"编辑"按钮召回）。
8. **假设**有对话框打开或存在待处理的权限确认，**当**界面渲染时，**则**队列列表隐藏，避免遮挡。

---

### 边界情况

- **Windows `.cmd` 兼容性**：Node.js（CVE-2024-27980 补丁后）拒绝在没有 shell 的情况下 spawn `.cmd` 文件。所有执行 `npm.cmd` 和 `wave.cmd` 的地方必须设置 `shell: true`（或 `shell: process.platform === 'win32'`）。
- **`getCliVersion` 超时**：`wave -v` 执行有 5 秒超时，超时返回 `null`（视为二进制损坏，触发升级）。
- **semver 校验防注入**：`upgradeWaveBinary` 中的目标版本来自插件 `package.json`（可信源），但仍通过正则 `SEMVER_RE` 校验，因为 Windows 上 execFile 通过 cmd.exe 执行，严格的 semver 检查保留 "不对版本参数进行 shell 注入" 的保证。
- **npm 全局目录差异**：`npm prefix -g` 在 Windows 上直接返回全局 bin 目录（如 `C:\Users\xxx\AppData\Roaming\npm`），Unix 上返回 prefix 需要拼接 `/bin`。
- **utility 请求无 session 上下文**：FileService（搜索文件）、SessionService（列出会话）、PluginService（管理插件）的请求不需要 sessionId，直接通过共享 StdioClient 发送。
- **`authUrl` 全局通知**：SSO 登录流程中 CLI 推送的 `authUrl` 通知不带 sessionId，通过 `router.registerGlobal` 注册的处理器接收，直接打开系统浏览器。
- **CLI 子进程的 env 传递**：StdioClient 构造函数接受可选的 `env` 参数，未传时子进程继承插件宿主的 `process.env`。
- **消息队列列表编辑无重复入队**：IDE 插件中编辑排队消息时，将原消息删除并把内容载入输入框；若用户编辑后未发送，该消息不会自动回到队列。
- **消息队列列表无键盘召回**：IDE 插件输入框的方向上键不召回队列消息（与 CLI 不同），仅支持通过列表中的"编辑"按钮召回；这是刻意的平台产品差异。

## 需求 *（必填）*

### 功能需求

#### 二进制解析与安装

- 系统必须按以下优先级解析 `wave` CLI 二进制路径：① PATH 查找（`which`/`where`）→ ② npm 全局 bin 目录 → ③ 自动安装。
- 系统必须缓存已解析的二进制路径，在同一插件生命周期内不重复查找。
- 当 `wave` 未安装时，系统必须自动执行 `npm install -g wave-code --registry=https://registry.npmmirror.com`。
- 系统必须通过 `findNpm()` 定位 npm 可执行文件：先尝试 PATH（`which npm`/`where npm`），失败后回退到 `process.execPath` 同目录（`npm`/`npm.cmd`）和 `../bin/npm`。
- 当 `findNpm()` 所有查找路径均失败（即系统未安装 Node.js/npm）时，系统必须抛出明确错误，告知用户需要安装 Node.js，而非抛出 "Failed to determine npm global directory" 等技术性错误。
- 系统必须检查 Node.js 版本是否 >= 20。当版本低于 20 时，系统必须抛出明确错误，告知用户当前版本过低并需要升级到 >= 20，包含实际版本号和 Node.js 下载链接。
- 系统必须通过 `npm prefix -g` 获取 npm 全局 bin 目录，Windows 上直接使用返回值，Unix 上拼接 `/bin`。
- 所有执行 `.cmd` 文件的操作（Windows 平台）必须设置 `shell: true`，以兼容 Node.js CVE-2024-27980 补丁后的安全限制。
- 当系统执行 CLI 自动安装或升级（`npm install -g wave-code`）时，必须通过编辑器通知告知用户"正在安装/升级 wave-code，请稍候…"，安装完成后通知消失或提示完成。避免用户在长时间等待中无任何反馈。

#### 版本管理

- 系统必须通过执行 `<binaryPath> -v`（5 秒超时）读取已安装 CLI 的版本号。
- 当 `wave -v` 执行失败、返回空或超时时，系统必须返回 `null`（视为二进制损坏）。
- 系统必须比较已安装 CLI 版本与插件版本（来自 `package.json`），当 CLI 版本 >= 插件版本时不执行升级。
- 当 CLI 版本 < 插件版本或 CLI 版本为 `null`（损坏）时，系统必须执行升级到插件版本。
- 升级时系统必须通过 semver 正则 `^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$` 校验目标版本，拒绝不合法的版本字符串。
- 升级完成后系统必须清除缓存的二进制路径，重新执行解析流程以确保使用新安装的二进制。

#### 错误诊断

- 当 CLI 二进制解析失败时，系统必须通过编辑器通知显示用户可理解的错误消息和修复指引。
- 错误消息必须根据失败原因区分：① 未安装 Node.js → 提示安装 Node.js 的 URL；② Node.js 版本过低 → 提示升级到 >= 20 并给出当前版本；③ npm 命令失败 → 包含 npm 错误输出；④ 网络安装失败 → 建议手动执行安装命令。
- 系统必须将完整的错误堆栈和诊断信息输出到编辑器输出面板的 Wave 通道，便于高级用户和开发者排查。
- 当 CLI 子进程启动后立即退出时，系统必须捕获 stderr 输出（如果有）并包含在错误消息中。

#### JSON-RPC 通信

- 系统必须通过 stdin/stdout 以行分隔的 JSON 进行通信，每行一个 JSON-RPC 2.0 消息。
- 请求消息必须包含 `id`（自增整数）、`method`、可选 `params` 和可选 `sessionId`。
- 响应消息必须通过 `id` 匹配到 pending 请求，`result` 字段 resolve，`error` 字段 reject（包含 `code` 和 `message`）。
- 通知消息必须包含 `method` 但不包含 `id`，fire-and-forget，不创建 pending 请求。
- 系统必须支持为同一通知方法注册多个处理器。
- 系统必须静默忽略 stdout 中无法解析为 JSON、值为 `null` 或非对象类型的行，不影响后续消息处理。
- 系统必须使用 `readline.createInterface` 逐行读取 stdout，确保跨平台换行符兼容。

#### 进程生命周期

- 系统必须通过 `spawn(binaryPath, args)` 启动 CLI 子进程，Windows 上设置 `shell: true`。
- 当 CLI 子进程退出时，系统必须 reject 所有 pending 请求（错误信息包含退出码）并标记 StdioClient 为 disposed。
- 当 StdioClient 已 disposed 时，系统必须立即 reject 新请求，不尝试写入 stdin。
- `dispose()` 必须杀掉子进程、标记 disposed，且幂等（多次调用不报错）。
- 系统必须将 CLI 子进程的 stderr 输出转发到编辑器输出面板的 Wave 通道。
- 当 StdioClient disposed 后用户尝试操作时，系统必须显示明确的"连接已断开"错误消息。

#### 多会话路由

- 所有 ChatSession 必须共享同一个 StdioClient 实例，通过 JSON-RPC 信封中的 `sessionId` 区分会话。
- NotificationRouter 必须维护 `sessionId → StdioAgent` 的映射表，将带 sessionId 的通知分发到对应 agent。
- NotificationRouter 必须支持全局通知处理器（无 sessionId 的通知），如 `authUrl`。
- 当收到 `sessionIdChange` 通知时，NotificationRouter 必须将旧 sessionId 的映射迁移到新 sessionId（rekey）。
- StdioAgent.destroy() 必须从 NotificationRouter 取消注册，但不 dispose 共享的 StdioClient。
- ChatProvider.dispose() 必须先销毁所有 ChatSession，再 dispose 共享的 StdioClient。
- NotificationRouter.attach() 必须一次性订阅所有已知通知类型，且幂等（多次调用不重复订阅）。

#### 状态缓存

- StdioAgent 必须在本地缓存以下状态字段：`sessionId`、`workingDirectory`、`latestTotalTokens`、`permissionMode`、`messages`、`queuedMessages`、`tasks`。
- StdioAgent 必须处理以下通知类型并更新对应缓存：`messagesChange`→messages、`queuedMessagesChange`→queuedMessages、`tasksChange`→tasks、`sessionIdChange`→sessionId、`permissionModeChange`→permissionMode、`workdirChange`→workingDirectory、`loadingChange`→latestTotalTokens。
- 当回调函数未设置（undefined）时，StdioAgent 必须正常更新缓存但不触发回调，不抛出错误。
- StdioAgent 必须处理以下无缓存更新的通知类型（仅触发回调）：`userMessageAdded`、`assistantMessageAdded`、`assistantContentUpdated`、`assistantReasoningUpdated`、`toolBlockUpdated`、`errorBlockAdded`、`compactBlockAdded`、`commandRunningChange`、`mcpServersChange`、`bangMessageAdded`、`bangMessageUpdated`、`bangMessageCompleted`、`notificationMessageAdded`、`permissionRequest`。

#### 消息队列列表（IDE 插件）

以下 FR 仅适用于 IDE 插件 webview（VSCE / JB），CLI 的队列交互由 CLI 自身规格覆盖。

- 当队列中有消息时，IDE 插件 webview 必须在输入框上方显示可折叠的"消息队列 (N)"列表；队列为空时不渲染。
- 折叠状态仅显示第一条排队消息；展开状态显示全部，超过最大高度（180px）时列表内滚动。
- 每条排队消息必须单行截断显示摘要，shell 命令带 `!` 前缀，悬停时可查看完整内容。
- 点击某条的"发送"必须立即发送该消息（不等当前处理完成顺序出队）并将其从队列中移除。
- 点击某条的"删除"必须立即将其从列表移除，不等后端确认。
- 点击某条的"编辑"必须将其内容载入输入框，并在输入框中显示"编辑队列消息"标记；输入框按回车提交后原队列消息被替换为新内容；删除该标记则退出编辑状态。
- IDE 插件输入框不得支持通过键盘方向上键召回队列消息（与 CLI 的产品差异）；仅支持通过"编辑"按钮召回。
- 有对话框打开或存在待处理的权限确认时，队列列表必须隐藏。
- 队列内容必须与 CLI 侧队列状态保持同步，依赖 `queuedMessagesChange` 通知驱动的缓存更新。
- 发送/删除/编辑操作必须映射到对应的队列消息协议请求，修改结果通过缓存同步回 UI。

#### Git 与 worktree（utility 请求）

以下方法为无 session 上下文的 utility 请求（与 `listSessions` 同类），供桌面端等宿主查询 git 状态、创建/清理 worktree，复用 CLI `wave -w` 的创建与命名逻辑。

- 协议必须提供 `listGitBranches` 请求方法：参数 `{workdir}`；响应 `{branches: string[], current: string | null}`（本地分支列表与当前分支）；`workdir` 不是 git 仓库或 git 不可用时必须返回错误（而非空列表），以便宿主隐藏分支相关 UI。
- 协议必须提供 `createWorktree` 请求方法：参数 `{workdir, baseBranch?, name?}`；未传 `name` 时必须使用与 `wave -w` 相同的双形容词-名词随机命名；worktree 路径为 `<repoRoot>/.wave/worktrees/<name>`、分支名为 `worktree-<name>`；`baseBranch` 缺省时回退到仓库默认远程分支（与 `wave -w` 一致）；响应 `{name, path, branch, repoRoot, baseBranch, isNew}`（`isNew` 表示 worktree 是否为本次新建，复用已存在的同名 worktree 时为 false）；创建失败必须返回包含原因的错误。
- 协议必须提供 `removeWorktree` 请求方法：参数 `{path, branch, repoRoot}`（`path` 为 worktree 路径，`branch` 为其临时分支名）；必须执行 `git worktree remove --force` 并删除对应 `worktree-<name>` 分支（复用 CLI 既有移除逻辑，含"当前分支已被切换"时的安全处理）；worktree 已被外部删除等清理失败场景不得报错，按幂等成功处理。
- `initialize` 请求必须接受可选的 `worktreeName` 与 `isNewWorktree` 参数并透传给 Agent（与 CLI `wave -w` 的语义一致）：`isNewWorktree` 为 true 时 Agent 初始化必须触发 WorktreeCreate 钩子；`updateConfig` 重建 Agent 时必须保留 `worktreeName` 上下文，但不得再次触发 WorktreeCreate 钩子。

### 关键实体

- **StdioClient**：低层 JSON-RPC 2.0 传输层。管理 `wave --stdio` 子进程的 stdin/stdout，提供 `request()`/`notify()`/`onNotification()`/`dispose()` 接口。单实例共享。
- **StdioAgent**：围绕 StdioClient 的类型化包装层。维护本地状态缓存，处理 20+ 种通知类型，提供与 Agent API 语义一致的高层接口（sendMessage/bang/abort/clear/rewind/权限/MCP 等）。每会话一个实例。
- **NotificationRouter**：通知分发路由器。维护 `sessionId → StdioAgent` 映射表，将带 sessionId 的通知分发到对应 agent，无 sessionId 的通知分发到全局处理器。处理 sessionIdChange rekey。
- **BinaryResolver**：CLI 二进制文件解析器。按 PATH → npm 全局 → 自动安装的优先级解析，支持版本检查和升级。模块级缓存。
- **JSON-RPC 信封**：行分隔的 JSON 消息格式。Request: `{id, method, params?, sessionId?}`；Response: `{id, result?|error?}`；Notification: `{method, params?, sessionId?}`。

### 假设

- 编辑器插件（VSCE / JB 等）运行在插件宿主进程中，该进程自带 Node.js 运行时（`process.execPath`），但该运行时不包含 npm。
- 用户系统可能安装了独立的 Node.js（含 npm），也可能完全未安装 Node.js，或安装了低于 20 的旧版本。
- `wave --stdio` 子进程要求 Node.js >= 20。
- `wave --stdio` 子进程实现了 JSON-RPC 2.0 服务端协议，通过 stdin 接收请求/通知，通过 stdout 返回响应/推送通知。
- 插件版本号来自 `package.json` 的 `version` 字段，遵循 semver 格式。
- npm 全局镜像 `https://registry.npmmirror.com` 适用于中国用户加速下载。
- 多个 ChatSession（sidebar/tab/window）共享同一个 CLI 子进程是刻意的设计决策，通过 sessionId 区分会话。
- 本规格以 VSCE 实现为参考基准，JB 插件复用同一协议和架构。
