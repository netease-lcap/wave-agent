# 功能规格说明：CLI Worktree 支持

**特性分支**：`047-worktree`
**创建日期**：2026-02-27

## 用户场景与测试 *（必填）*

### 用户故事 1 - 使用名称创建 Worktree（优先级：P1）

作为开发者，我希望在专用的 git worktree 中启动 Wave 会话并指定名称，以便在不影响主工作目录的情况下开发功能。

**为什么是这个优先级**：这是该功能的核心功能。

**独立测试**：运行 `wave code -w my-feature`，验证 worktree 在 `.wave/worktrees/my-feature` 创建且 CLI 在该目录中启动。

**验收场景**：

1. **假设**我在一个 git 仓库中，**当**我运行 `wave code --worktree my-feat` 时，**则**一个新的 git worktree 在 `.wave/worktrees/my-feat` 创建。
2. **假设** worktree 已创建，**当** Wave CLI 启动时，**则**其工作目录设置为新的 worktree 路径。

---

### 用户故事 2 - 自动生成 Worktree 名称（优先级：P1）

作为开发者，我希望快速启动 worktree 会话而不用想名称，以便立即开始工作。

**为什么是这个优先级**：对易用性至关重要，符合请求的行为。

**独立测试**：运行 `wave code -w`，验证 worktree 使用生成的名称（例如 `gentle-swift-breeze`）在 `.wave/worktrees/<generated-name>` 创建。

**验收场景**：

1. **假设**我在一个 git 仓库中，**当**我运行 `wave code -w` 时，**则**系统生成类似 `merry-crafting-sutherland` 的名称。
2. **假设**名称已生成，**当** worktree 被创建时，**则**它使用生成的名称。

---

### 用户故事 3 - 带未提交更改退出（优先级：P1）

作为开发者，我希望在退出 worktree 会话时如果有未提交的更改收到警告，这样我就不会意外丢失工作。

**为什么是这个优先级**：防止数据丢失，对用户信任至关重要。

**独立测试**：启动 worktree 会话，创建新文件，退出 CLI，验证"Exiting worktree session"提示出现并带有"uncommitted file"消息。

**验收场景**：

1. **假设**我在 worktree 会话中有 1 个未提交文件，**当**我退出 CLI 时，**则**我看到提示："You have 1 uncommitted file. These will be lost if you remove the worktree."
2. **假设**退出提示已显示，**当**我选择"Keep worktree"时，**则** worktree 保留在其位置且 CLI 退出。
3. **假设**退出提示已显示，**当**我选择"Remove worktree"时，**则** worktree 被删除且 CLI 退出。

---

### 用户故事 4 - 带新提交退出（优先级：P2）

作为开发者，我希望在退出 worktree 会话时如果有新提交收到警告，这样我就知道如果移除 worktree 分支将被删除。

**为什么是这个优先级**：对管理 git 历史和分支很重要。

**独立测试**：启动 worktree 会话，进行提交，退出 CLI，验证提示提及提交和分支删除。

**验收场景**：

1. **假设**我在 worktree 会话中有 1 个新提交，**当**我退出 CLI 时，**则**我看到提示："You have 1 commit on worktree-<name>. The branch will be deleted if you remove the worktree."
2. **假设**退出提示已显示，**当**我选择"Remove worktree"时，**则** worktree 及其关联分支被删除。

---

### 用户故事 5 - 干净退出（优先级：P2）

作为开发者，我希望如果我没有做任何更改，CLI 自动清理 worktree，这样我就不必手动删除空的 worktree。

**为什么是这个优先级**：通过为"只读"或"无更改"会话自动清理来改善用户体验。

**独立测试**：启动 worktree 会话，不做任何更改，退出 CLI，验证它立即退出且 worktree 目录和分支被删除。

**验收场景**：

1. **假设**我在 worktree 会话中没有未提交的更改和新提交，**当**我退出 CLI 时，**则**它立即退出，且 git worktree 及其关联分支被删除。

---

### 用户故事 6 - 会话中 EnterWorktree 工具（优先级：P1）

作为使用 Wave 的开发者，我希望在会话中通过向 AI 请求来创建 worktree，以便在不重启会话的情况下隔离我的工作。

**为什么是这个优先级**：匹配 Claude Code 的 EnterWorktree 工具行为并支持 AI 驱动的工作流。

**独立测试**：在任何目录中启动 Wave 会话，要求 AI"create a worktree"，验证 worktree 被创建且会话的工作目录切换到新的 worktree。

**验收场景**：

1. **假设**我在一个 git 仓库中，**当**我要求 AI"create a worktree"时，**则** AI 调用 `EnterWorktree` 工具并创建新的 git worktree。
2. **假设** EnterWorktree 被调用，**当**工具执行时，**则**会话的工作目录切换到新的 worktree 路径。
3. **假设**我要求 AI 创建带有特定名称的 worktree，**当** AI 使用 `name` 调用 EnterWorktree 时，**则** worktree 使用该名称。
4. **假设**未提供名称，**当** EnterWorktree 被调用时，**则**生成随机名称（例如 `swift-fox-123`）。
5. **假设**我已经在 worktree 会话中，**当** AI 调用 EnterWorktree 时，**则**工具失败并显示错误，指示我已在 worktree 会话中。
6. **假设**我不在 git 仓库中，**当** AI 调用 EnterWorktree 时，**则**工具失败并显示错误，指示没有可用的 git 仓库。

---

### 用户故事 7 - 会话中 ExitWorktree 工具（优先级：P1）

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

### 边界情况

- **当 worktree 目录已存在时会发生什么？** 系统应该报错或询问是否重用。
- **系统如何处理 worktree 创建期间的 git 错误？** 应显示清晰的错误消息并优雅退出。
- **如果用户不在 git 仓库中怎么办？** `-w` 标志应失败并显示错误消息。

## 假设

- 系统已安装 `git` 并可在环境的 PATH 中访问。
- 使用 `-w` 时当前工作目录是 git 仓库。
- 自动生成的名称遵循 `generateRandomName` 工具的 `adjective-adjective-noun` 模式。
- "Remove worktree"意味着同时执行 `git worktree remove --force` 和 `git branch -D`，以确保即使存在更改或分支未合并也能清理。

## 需求 *（必填）*

### 功能需求

- **FR-001**：系统必须支持 `-w` 和 `--worktree [feat-name]` 命令行参数。
- **FR-002**：如果未提供 `<feat-name>`，系统必须生成唯一的功能名称（例如 `adjective-adjective-noun`）。
- **FR-003**：系统必须在 `.wave/worktrees/<feat-name>`（绝对路径）创建 git worktree，相对于**主仓库根目录**（即使从 worktree 内运行），从默认远程分支分支。默认分支必须使用文件系统读取（`.git/refs/remotes/origin/HEAD`）而非子进程调用来解析。如果 `origin/HEAD` 指向不再存在的分支（陈旧引用），系统必须回退到从 origin 获取 `refs/heads/HEAD` 并解析结果 SHA。
- **FR-004**：系统必须将 worktree 分支命名为 `worktree-<feat-name>`。
- **FR-005**：系统必须调用 `process.chdir()` 到 worktree 路径，以确保进程的工作目录与 worktree 匹配，便于 tmux 和其他窗口复制功能。
- **FR-006**：系统必须在退出时检测 worktree 中的未提交更改（已暂存或未暂存，通过 `git status --porcelain` 识别）。
- **FR-007**：系统必须在退出时检测 worktree 中不在默认远程分支中的提交（通过 `git log @{u}..HEAD` 识别）。
- **FR-008**：如果退出时存在未提交的更改或新提交，系统必须显示交互式提示。
- **FR-009**：退出提示必须提供两个选项："Keep worktree"和"Remove worktree"。
- **FR-010**："Keep worktree"必须退出 CLI 同时保持 worktree 目录完整。
- **FR-011**："Remove worktree"必须删除 git worktree（使用 `git worktree remove --force`）和 worktree 分支（使用 `git branch -D`）。
- **FR-012**：如果未检测到更改或提交，系统必须无提示退出并删除 git worktree 和分支。
- **FR-013**：如果在 git 仓库之外使用 `-w` 或 `--worktree`，系统必须报错并退出。
- **FR-014**：系统必须处理 `SIGINT`（Ctrl+C）和 `SIGTERM` 信号，触发退出检测和提示流程。
- **FR-015**：如果用户取消退出提示（例如通过 Esc），CLI 必须返回活动会话。
- **FR-016**：如果同名 worktree 已存在，系统必须重用它并跳过创建步骤。
- **FR-017**：退出检测必须在 500ms 内完成，以避免用户可感知的延迟。
- **FR-018**：系统必须在新 worktree 创建时触发 `WorktreeCreate` 钩子事件。
- **FR-019**：`WorktreeCreate` 钩子必须通过 stdin 提供包含 `name` 字段的 JSON 输入。钩子必须在新创建的 worktree 目录中执行。
- **FR-020**：重用现有 worktree 时不得触发 `WorktreeCreate` 钩子。
- **FR-021**：在 worktree 会话期间，系统必须自动拒绝尝试修改主仓库（当前 worktree 之外）文件的 `Write` 和 `Edit` 工具操作。
- **FR-022**：自动拒绝机制必须提供描述性错误消息，说明在 worktree 会话期间对主仓库的修改受到限制。
- **FR-023**：自动拒绝机制不得限制对当前计划文件的修改，即使它位于 worktree 之外。
- **FR-024**：系统必须在 worktree 会话期间在系统提示中包含 worktree 隔离指导，警告 agent 它在隔离的 git worktree 中工作，不应修改 worktree 之外的文件。
- **FR-025**：系统提示指导必须包含 worktree 路径、原始 CWD 路径和分支名称，以便 agent 可以从先前上下文转换绝对路径。
- **FR-026**：`-w` CLI 标志必须注册 worktree 会话状态（通过 `setCurrentWorktreeSession`），以便提示指导包含在系统提示中。
- **FR-027**：系统必须提供 `EnterWorktree` 工具，创建 git worktree 并将会话的工作目录切换到该处。
- **FR-028**：`EnterWorktree` 工具必须接受可选的 `name` 参数。如果未提供，必须生成随机名称。
- **FR-029**：`EnterWorktree` 工具必须验证 worktree 名称以防止路径遍历和无效字符（最多 64 个字符，仅允许字母、数字、点、下划线、短横线和 `/` 用于嵌套）。
- **FR-030**：如果已在活动 worktree 会话中（模块级状态），`EnterWorktree` 工具必须失败。
- **FR-031**：如果不在 git 仓库中，`EnterWorktree` 工具必须失败，并显示建议使用 WorktreeCreate/WorktreeRemove 钩子的错误消息。
- **FR-032**：`EnterWorktree` 工具必须通过 `AIManager.setWorkdir()` 更新会话的工作目录（更新 DI 容器并调用 `process.chdir()`）。
- **FR-033**：系统必须提供 `ExitWorktree` 工具，退出 worktree 会话并恢复原始工作目录。
- **FR-034**：`ExitWorktree` 工具必须接受必需的 `action` 参数：`"keep"`（保留 worktree）或 `"remove"`（删除 worktree）。
- **FR-035**：`ExitWorktree` 工具必须接受可选的 `discard_changes` 参数（默认 `false`）。当 `action` 为 `"remove"` 且 worktree 有未提交文件或新提交时，工具必须拒绝，除非 `discard_changes: true`。
- **FR-036**：如果没有活跃的 EnterWorktree 会话，`ExitWorktree` 工具必须是无操作（无文件系统更改）。
- **FR-037**：`ExitWorktree` 工具必须通过 `AIManager.setWorkdir()` 将会话的工作目录恢复到原始 CWD。
- **FR-038**：当 `action` 为 `"remove"` 时，系统必须使用 `git worktree remove --force` 删除 worktree 目录，并使用 `git branch -D` 删除关联分支。
- **FR-039**：`EnterWorktree` 工具不得触发 `WorktreeCreate` 钩子事件（钩子支持不在会话中工具的范围内）。
- **FR-040**：系统必须验证从 `origin/HEAD` 解析的分支存在于 `refs/remotes/origin/` 中。如果分支不存在（陈旧的 `origin/HEAD`），系统必须尝试 `git fetch origin HEAD` 来解析正确的默认分支。

### 关键实体

- **Worktree**：代表一个 git worktree 会话。
    - **Name**：worktree 和分支的标识符。
    - **Path**：worktree 所在的文件系统路径（`.wave/worktrees/<name>`）。
    - **Status**：是否有未提交的更改或新提交。
