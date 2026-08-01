---
name: "CLI Worktree"
description: "`-w/--worktree` 隔离的 git worktree，位于 `.wave/worktrees/`，支持安全退出"
order: 90
---

# 功能规格说明：CLI Worktree 支持

**创建日期**：2026-02-27

## 用户场景与测试 *（必填）*

### 用户故事：使用名称创建 Worktree（优先级：P1）

作为开发者，我希望在专用的 git worktree 中启动 Wave 会话并指定名称，以便在不影响主工作目录的情况下开发功能。

**为什么是这个优先级**：这是该功能的核心功能。

**独立测试**：运行 `wave code -w my-feature`，验证 worktree 在 `.wave/worktrees/my-feature` 创建且 CLI 在该目录中启动。

**验收场景**：

1. **假设**我在一个 git 仓库中，**当**我运行 `wave code --worktree my-feat` 时，**则**一个新的 git worktree 在 `.wave/worktrees/my-feat` 创建。
2. **假设** worktree 已创建，**当** Wave CLI 启动时，**则**其工作目录设置为新的 worktree 路径。

---

### 用户故事：自动生成 Worktree 名称（优先级：P1）

作为开发者，我希望快速启动 worktree 会话而不用想名称，以便立即开始工作。

**为什么是这个优先级**：对易用性至关重要，符合请求的行为。

**独立测试**：运行 `wave code -w`，验证 worktree 使用生成的名称（例如 `gentle-swift-breeze`）在 `.wave/worktrees/<generated-name>` 创建。

**验收场景**：

1. **假设**我在一个 git 仓库中，**当**我运行 `wave code -w` 时，**则**系统生成类似 `merry-crafting-sutherland` 的名称。
2. **假设**名称已生成，**当** worktree 被创建时，**则**它使用生成的名称。

---

### 用户故事：带未提交更改退出（优先级：P1）

作为开发者，我希望在退出 worktree 会话时如果有未提交的更改收到警告，这样我就不会意外丢失工作。

**为什么是这个优先级**：防止数据丢失，对用户信任至关重要。

**独立测试**：启动 worktree 会话，创建新文件，退出 CLI，验证"Exiting worktree session"提示出现并带有"uncommitted file"消息。

**验收场景**：

1. **假设**我在 worktree 会话中有 1 个未提交文件，**当**我退出 CLI 时，**则**我看到提示："You have 1 uncommitted file. These will be lost if you remove the worktree."
2. **假设**退出提示已显示，**当**我选择"Keep worktree"时，**则** worktree 保留在其位置且 CLI 退出。
3. **假设**退出提示已显示，**当**我选择"Remove worktree"时，**则** worktree 被删除且 CLI 退出。

---

### 用户故事：带新提交退出（优先级：P2）

作为开发者，我希望在退出 worktree 会话时如果有新提交收到警告，这样我就知道如果移除 worktree 分支将被删除。

**为什么是这个优先级**：对管理 git 历史和分支很重要。

**独立测试**：启动 worktree 会话，进行提交，退出 CLI，验证提示提及提交和分支删除。

**验收场景**：

1. **假设**我在 worktree 会话中有 1 个新提交，**当**我退出 CLI 时，**则**我看到提示："You have 1 commit on worktree-\<name\>. The branch will be deleted if you remove the worktree."
2. **假设**退出提示已显示，**当**我选择"Remove worktree"时，**则** worktree 及其关联分支被删除。

---

### 用户故事：干净退出（优先级：P2）

作为开发者，我希望如果我没有做任何更改，CLI 自动清理 worktree，这样我就不必手动删除空的 worktree。

**为什么是这个优先级**：通过为"只读"或"无更改"会话自动清理来改善用户体验。

**独立测试**：启动 worktree 会话，不做任何更改，退出 CLI，验证它立即退出且 worktree 目录和分支被删除。

**验收场景**：

1. **假设**我在 worktree 会话中没有未提交的更改和新提交，**当**我退出 CLI 时，**则**它立即退出，且 git worktree 及其关联分支被删除。

---

### 用户故事：会话中 EnterWorktree 工具（优先级：P1）

作为使用 Wave 的开发者，我希望在会话中通过向 AI 请求来创建 worktree，以便在不重启会话的情况下隔离我的工作。

**为什么是这个优先级**：匹配 Claude Code 的 EnterWorktree 工具行为并支持 AI 驱动的工作流。

**独立测试**：在任何目录中启动 Wave 会话，要求 AI"create a worktree"，验证 worktree 被创建、会话的工作目录切换到新的 worktree，且主仓库中的 `.wave/settings.local.json` 与 `.worktreeinclude` 列出的文件被复制到新 worktree。

**验收场景**：

1. **假设**我在一个 git 仓库中，**当**我要求 AI"create a worktree"时，**则** AI 调用 `EnterWorktree` 工具并创建新的 git worktree。
2. **假设** EnterWorktree 被调用，**当**工具执行时，**则**会话的工作目录切换到新的 worktree 路径。
3. **假设**我要求 AI 创建带有特定名称的 worktree，**当** AI 使用 `name` 调用 EnterWorktree 时，**则** worktree 使用该名称。
4. **假设**未提供名称，**当** EnterWorktree 被调用时，**则**生成随机名称（例如 `swift-fox-123`）。
5. **假设**我已经在 worktree 会话中，**当** AI 调用 EnterWorktree 时，**则**工具失败并显示错误，指示我已在 worktree 会话中。
6. **假设**我不在 git 仓库中，**当** AI 调用 EnterWorktree 时，**则**工具失败并显示错误，指示没有可用的 git 仓库。
7. **假设**主仓库存在 `.wave/settings.local.json`，**当** EnterWorktree 创建新 worktree 时，**则** `.wave/settings.local.json` 被复制到新 worktree（与 CLI `-w` 路径行为一致）。
8. **假设**主仓库存在 `.worktreeinclude` 文件且列出了被 gitignore 的项目文件（如 `.env`、`.mcp.json`），**当** EnterWorktree 创建新 worktree 时，**则**这些文件被复制到新 worktree。
9. **假设**复用了已存在的 worktree 目录，**当** EnterWorktree 执行时，**则**不执行上述文件复制（避免覆盖既有 worktree 中的本地状态）。

---

### 用户故事：会话中 ExitWorktree 工具（优先级：P1）

作为使用 Wave 的开发者，我希望在会话中通过向 AI 请求来退出 worktree，以便在不结束会话的情况下返回原始工作目录。

**为什么是这个优先级**：匹配 Claude Code 的 ExitWorktree 工具行为并支持 AI 驱动的工作流。

**独立测试**：通过 EnterWorktree 启动 worktree 会话，要求 AI"exit the worktree"并使用 `action: "keep"`，验证会话返回原始目录且 worktree 被保留。

**验收场景**：

1. **假设**我在 EnterWorktree 创建的 worktree 会话中，**当**我要求 AI"exit the worktree"并使用 `action: "keep"` 时，**则**会话返回原始目录且 worktree 被保留。
2. **假设**我在 worktree 会话中，**当**我要求 AI"exit the worktree"并使用 `action: "remove"` 时，**则**会话返回原始目录且 worktree 被删除。
3. **假设**我在 worktree 会话中有未提交的更改，**当** AI 使用 `action: "remove"` 且无 `discard_changes` 调用 ExitWorktree 时，**则**工具拒绝并列出未提交的文件和提交。
4. **假设**我在 worktree 会话中有未提交的更改，**当**用户确认丢弃时，**则** AI 使用 `discard_changes: true` 重新调用并移除 worktree。
5. **假设**没有活跃的 EnterWorktree 会话，**当** AI 调用 ExitWorktree 时，**则**工具返回无操作消息而不进行任何文件系统更改。

---

### 用户故事：WorktreeRemove Hook 清理外部资源（优先级：P2）

作为开发者，我希望无论通过哪个入口删除 worktree，都能自动触发配置的清理 hook，以便自动清理该 worktree 创建的外部资源（如 MySQL 数据库 schema、Redis DB、docker compose 项目等）。

**为什么是这个优先级**：对齐 Claude Code 官方文档（code.claude.com/docs/en/hooks）的 WorktreeRemove 通知型（Notification）钩子设计。官方分类表标注其决策控制为 'None — No decision control. Used for side effects like logging or cleanup'：钩子无决策控制、仅用于副作用，**永不替代 `git worktree remove` 本身**——git 移除照常执行，钩子只是额外通知。这是「worktree 删除后自动清理外部资源」的必要能力。

**独立测试**：settings.json 配置 `WorktreeRemove` hook 为 `bash -c 'jq -r ".hook_event_name, .worktree_path" >> /tmp/wave-hook-test.log'`，分别通过 4 个入口删除 worktree（CLI 退出对话框选 Remove、ExitWorktree 工具 `action: "remove"`、`wave -p` 打印模式、stdio RPC 删除后台会话），验证每个入口都在 git 移除**之前**触发 hook 且日志包含正确字段。

**验收场景**：

1. **假设** settings.json 配置了 `WorktreeRemove` hook，**当** CLI 退出对话框选择 "Remove worktree" 时，**则** hook 在 `git worktree remove --force` 与 `git branch -D` 执行之前触发，stdin JSON 包含 `hook_event_name: "WorktreeRemove"` 与 `worktree_path`（被删 worktree 的绝对路径），git 移除照常执行。
2. **假设** settings.json 配置了 `WorktreeRemove` hook，**当** AI 调用 `ExitWorktree` 工具且 `action: "remove"` 时，**则** hook 在 git 移除之前触发，此时 worktree 目录仍存在（hook 可读取目录内文件以定位要清理的资源），JSON 输入同场景 1。
3. **假设** settings.json 配置了 `WorktreeRemove` hook，**当** `wave -p` 打印模式会话结束且无更改/无新提交、自动清理 worktree 时，**则** hook 在移除之前触发，JSON 输入同场景 1。
4. **假设** settings.json 配置了 `WorktreeRemove` hook，**当** stdio 前端（如桌面应用）通过 RPC 删除后台会话的 worktree 时，**则** hook 在移除之前触发，JSON 输入同场景 1。
5. **假设** hook 返回退出码 2 或其它非 0 退出码并输出 stderr，**当** worktree 被删除时，**则** stderr 以错误块形式显示给用户，但 worktree 删除**不被阻止**（Notification 语义，无决策控制）。
6. **假设** 未配置 `WorktreeRemove` hook，**当** 任何入口删除 worktree 时，**则** 删除行为与现状完全一致，无额外开销、无 hook 进程启动。
7. **假设** hook 需要按 worktree 名称定位要清理的资源，**当** hook 执行时，**则** 它通过 `basename "$worktree_path"` 派生名称（JSON 输入不含 `name` 字段，与 Claude Code 官方输入格式一致：`session_id`、`transcript_path`、`cwd`、`hook_event_name`、`worktree_path`）。
8. **假设** stdio RPC 删除后台会话时传入的 worktree 路径是符号链接或解析后位于 repo root 之外，**当** 删除操作执行前校验时，**则** 删除被拒绝并返回 RPC 错误，hook 不触发（对齐 Claude Code v2.1.216+ 安全校验）。
9. **假设** stdio RPC 删除后台会话时传入的 worktree 路径位于 repo root 之内且不是符号链接，**当** 删除操作执行前校验时，**则** 校验通过，hook 触发且 worktree 被删除。

---

### 用户故事：stdio 多 Agent 并发下的 Worktree 会话隔离（优先级：P1）

作为通过 stdio 后端同时运行多个会话的用户（例如 VS Code 侧边栏 + 多个编辑器标签页 / 多个窗口，或 JetBrains 插件），我希望一个会话进入 worktree 不会影响其它并发会话的工作目录、worktree 状态或工具执行，以便每个会话彼此隔离、互不干扰。

**为什么是这个优先级**：stdio 后端为多个前端会话（各自持有独立的 Agent）多路复用同一个进程。当前 worktree 状态使用进程级全局状态（`process.chdir()` 与模块级单例），会导致跨会话污染甚至数据破坏（一个会话可能误删另一个会话的 worktree 分支），破坏多租户隔离这一核心约束。

**独立测试**：在同一个 stdio 进程内启动两个会话 A 和 B。让 A 调用 `EnterWorktree`，验证 B 的工作目录、`EnterWorktree` 可用性、以及 B 的工具（bash/read/write/glob/grep）解析相对路径的基准目录均不受影响；再让 B 也调用 `EnterWorktree`，验证 B 能独立进入自己的 worktree（不被 A 的状态误拒）；最后让 B 调用 `ExitWorktree`，验证它只操作 B 自己的 worktree，绝不影响 A 的目录或分支。

**验收场景**：

1. **假设** stdio 进程内有并发会话 A 和 B，**当** A 调用 `EnterWorktree` 时，**则** B 的工作目录保持不变，B 的工具仍以 B 自己的工作目录为基准解析路径。
2. **假设** A 已进入 worktree 会话，**当** B 调用 `EnterWorktree` 时，**则** B 能成功进入自己的 worktree，不会因 A 的 worktree 会话状态而被误拒。
3. **假设** A 和 B 各自处于自己的 worktree 会话中，**当** B 调用 `ExitWorktree` 时，**则**只有 B 的工作目录被恢复、只有 B 的 worktree 被处理（keep/remove），A 的工作目录、worktree 目录和分支完全不受影响。
4. **假设** 只有 A 处于 worktree 会话中，**当** B（从未进入 worktree）调用 `ExitWorktree` 时，**则** B 得到无操作结果，A 的 worktree 会话状态不受影响。

---

### 用户故事：基于本地 HEAD 创建 Worktree（优先级：P2）

作为在本地分支上工作的开发者，我希望新 worktree 可基于当前本地 HEAD（而非 origin 默认分支）创建，以便基于尚未推送的本地分支工作、并避免联网 fetch。

**为什么是这个优先级**：对齐 Claude Code 2.1.203 的 `worktree.baseRef` 设置。默认 `fresh` 保持现有行为，`head` 覆盖"基于本地分支"诉求。

**独立测试**：临时仓库 `git checkout` 到某本地分支，settings.json 设置 `worktree.baseRef: "head"`，运行 `wave code -w` 或要求 AI 调用 `EnterWorktree`，验证新 worktree 的 HEAD 等于该本地分支的提交，且全程未发起网络请求；再改回 `"fresh"` 验证走 origin 默认分支。

**验收场景**：

1. **假设** settings.json 设置 `worktree.baseRef: "head"`，**当**通过 CLI `-w` 或 `EnterWorktree` 创建新 worktree 时，**则**新分支基于当前本地 HEAD 创建，不解析 `origin/<默认分支>` 也不发起 fetch。
2. **假设** `worktree.baseRef` 未设置或为 `"fresh"`，**当**创建新 worktree 时，**则**沿用现有 `fresh` 行为（基于 `origin/<默认分支>`，fetch→HEAD 兜底），与既有 fresh 行为一致。

---

### 边界情况

- **当 worktree 目录已存在时会发生什么？** 系统应该报错或询问是否重用。
- **系统如何处理 worktree 创建期间的 git 错误？** 应显示清晰的错误消息并优雅退出。
- **如果用户不在 git 仓库中怎么办？** `-w` 标志应失败并显示错误消息。
- **当 WorktreeRemove hook 失败或超时时会发生什么？** 非阻塞：stderr 以错误块显示给用户，worktree 删除照常进行。
- **当 stdio RPC 传入的 worktree 路径为符号链接或逃逸 repo root 时会发生什么？** 删除被拒绝并返回 RPC 错误，hook 不触发。

## 假设

- 系统已安装 `git` 并可在环境的 PATH 中访问。
- 使用 `-w` 时当前工作目录是 git 仓库。
- 自动生成的名称遵循 `generateRandomName` 工具的 `adjective-adjective-noun` 模式。
- "Remove worktree"意味着同时执行 `git worktree remove --force` 和 `git branch -D`，以确保即使存在更改或分支未合并也能清理。
- WorktreeRemove 是通知型钩子（Notification）：无决策控制，永不替代 `git worktree remove --force` + `git branch -D`。
- WorktreeRemove hook 的 JSON 输入仅包含官方字段（`session_id`、`transcript_path`、`cwd`、`hook_event_name`、`worktree_path`），worktree 名称由 hook 通过 `basename "$worktree_path"` 派生。
- 删除后台会话（stdio RPC）的 worktree 前会校验路径：拒绝符号链接或解析后位于 repo root 之外的路径。

