---
name: "CLI Worktree"
description: "`-w/--worktree` 隔离的 git worktree，位于 `.wave/worktrees/`，支持安全退出"
order: 90
---

# 功能规格说明：CLI Worktree 支持

**创建日期**：2026-02-27

## 用户场景与测试 _（必填）_

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

1. **假设**我在 worktree 会话中有 1 个新提交，**当**我退出 CLI 时，**则**我看到提示："You have 1 commit on worktree-`<name>`. The branch will be deleted if you remove the worktree."
2. **假设**退出提示已显示，**当**我选择"Remove worktree"时，**则** worktree 及其关联分支被删除。

---

### 用户故事：干净退出（优先级：P2）

作为开发者，我希望如果我没有做任何更改，CLI 自动清理 worktree，这样我就不必手动删除空的 worktree。

**为什么是这个优先级**：通过为"只读"或"无更改"会话自动清理来改善用户体验。

**独立测试**：启动 worktree 会话，不做任何更改，退出 CLI，验证它立即退出且 worktree 目录和分支被删除。

**验收场景**：

1. **假设**我在 worktree 会话中没有未提交的更改和新提交，**当**我退出 CLI 时，**则**它立即退出，且 git worktree 及其关联分支被删除。

---

### 用户故事：Worktree 删除进度提示（优先级：P2）

作为在 Windows 上使用 Wave 的开发者，我希望删除 worktree 时能看到"正在删除"和"完成"的进度提示，以便我了解 CLI 正在执行删除而不是卡死。

**为什么是这个优先级**：Windows 上递归删除 worktree 目录（尤其含 node_modules 等深路径时，git 删除失败后的 fs.rmSync 兜底）可能耗时数十秒。CLI 退出对话框选择 "Remove worktree" 后 Ink 界面已卸载，删除是同步阻塞的，完成前终端无任何输出，用户会误以为 CLI 挂死。放弃 Windows 删除速度优化，改为提供明确的进度反馈（`WorktreeRemove` hook 接管删除同理可能耗时）。

**独立测试**：在 Windows 上进入含深路径依赖的 worktree 会话，Ctrl+C 退出并选择 "Remove worktree"，验证终端先显示 "Deleting worktree ..."、删除完成后显示 "Done." 并退出；再运行 `wave -p` 打印模式，clean worktree 退出时验证同样显示两种提示。

**验收场景**：

1. **假设** CLI 退出对话框选择 "Remove worktree"，**当** 删除执行前，**则** 终端显示删除进度提示（如 `Deleting worktree ...`），且提示持续显示直到删除完成。
2. **假设** 删除成功完成，**当** 删除结束时，**则** 终端显示完成提示（如 `Done.`），随后进程退出。
3. **假设** 删除失败（git 与 fs.rmSync 兜底均失败），**当** 删除结束时，**则** 显示错误信息而非完成提示，进程照常退出（删除为 best-effort，不阻塞退出）。
4. **假设** 由 `WorktreeRemove` hook 接管删除（hook 脚本可能耗时），**当** CLI 退出对话框选择 "Remove worktree" 时，**则** 同样显示删除进度提示与完成提示。
5. **假设** print 模式（`wave -p`）下 clean worktree 自动删除，**当** 删除执行时，**则** 同样显示删除进度提示与完成提示。
6. **假设** 退出对话框选择 "Keep worktree"，**当** 退出时，**则** 不显示任何删除提示（worktree 未被删除）。
7. **假设** 会话中 AI 调用 ExitWorktree 工具（`action: "remove"`），**当** 删除执行时，**则** 行为不变——工具结果文本本身就是反馈，不引入终端进度提示。

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
6. **假设**我不在 git 仓库中且未配置 `WorktreeCreate` hook，**当** AI 调用 EnterWorktree 时，**则**工具失败并显示错误，指示没有可用的 git 仓库。
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

### 用户故事：WorktreeCreate Hook 接管 Worktree 创建（优先级：P2）

作为在非 git 或自定义 VCS 环境中使用 Wave 的开发者，我希望配置 `WorktreeCreate` hook 后由 hook 脚本创建 worktree（wave 不再自行执行 `git worktree add`），以便 worktree 创建与外部资源初始化（如 MySQL schema、Redis 实例、docker compose 项目）在同一脚本中完成。

**为什么是这个优先级**：对齐 Claude Code 的 WorktreeCreate replace 语义（官方文档决策控制为 "Path return"）。codechat 场景需要在 worktree 创建时同步初始化 MySQL schema/Redis，通知型 hook 无法保证资源与 worktree 同生命周期；replace 语义下创建本身由 hook 完成，资源初始化天然内聚。

**独立测试**：settings.json 配置 `WorktreeCreate` hook 为 `bash -c 'mkdir -p "$WAVE_PROJECT_DIR/.wave/worktrees/$(jq -r .name)" && echo "$WAVE_PROJECT_DIR/.wave/worktrees/$(jq -r .name)"'`（脚本自行创建目录并输出路径），运行 `wave code -w my-feat` 与 EnterWorktree 工具，验证 CLI 工作目录切换为 hook 输出的路径、wave 未执行 `git worktree add`；再配置一个输出空 stdout 的 hook，验证创建被阻止并报错 `WorktreeCreate hook failed: ...`。

**验收场景**：

1. **假设** settings.json 配置了 `WorktreeCreate` hook，**当** 通过 CLI `-w <name>` 启动会话时，**则** wave 不执行 `git worktree add`，改为执行 hook，stdin JSON 包含 `hook_event_name: "WorktreeCreate"` 与 `name`（worktree 名）。
2. **假设** 配置了多个 `WorktreeCreate` hook 且至少一个成功（退出码 0 且 stdout 非空），**当** 创建执行时，**则** 第一个成功 hook 的 stdout 去除首尾空白后即 worktree 绝对路径，会话工作目录切换到该路径，会话标记为 hook-based。
3. **假设** 所有 `WorktreeCreate` hook 均失败或 stdout 为空，**当** 创建执行时，**则** 创建被阻止，错误信息形如 `WorktreeCreate hook failed: <command>: <output>`，CLI `-w` 报错退出、EnterWorktree 工具返回失败。
4. **假设** 未配置 `WorktreeCreate` hook，**当** 通过 CLI `-w` 或 EnterWorktree 创建 worktree 时，**则** 行为与现状完全一致（wave 自行 `git worktree add`、复制 `settings.local.json` 与 `.worktreeinclude`、非 git 仓库报错）。
5. **假设** 我不在 git 仓库中但配置了 `WorktreeCreate` hook，**当** 通过 EnterWorktree 工具创建时，**则** 创建成功（不再要求 git 仓库），worktree 路径来自 hook stdout。
6. **假设** hook-based worktree 创建成功，**当** 会话启动或切换时，**则** 跳过 git worktree 的 post-creation setup（`settings.local.json` / `.worktreeinclude` 复制与 git hooks 配置），初始化由 hook 脚本自行负责（对齐 Claude Code）。
7. **假设** hook-based worktree 的路径本身就是 git worktree（hook 脚本内部执行了 `git worktree add`），**当** 会话期间使用 git 相关功能时，**则** 正常工作（路径即真实 git worktree，wave 不会重复创建）。

---

### 用户故事：WorktreeRemove Hook 接管 Hook-based Worktree 删除（优先级：P2）

作为使用 hook-based worktree（由 `WorktreeCreate` hook 创建）的开发者，我希望无论通过哪个入口删除 worktree，都由配置的 `WorktreeRemove` hook 接管删除（wave 不执行 `git worktree remove`），以便 hook 脚本在删除 worktree 的同时清理其创建的外部资源（如 MySQL 数据库 schema、Redis DB、docker compose 项目等）。

**为什么是这个优先级**：对齐 Claude Code 的 WorktreeRemove replace 语义。当前通知型实现下 WorktreeRemove 仅在 dirty 退出对话框选择 "Remove worktree" 时触发，clean 退出直接 `git worktree remove` 导致外部资源残留（如 MySQL schema）；replace 语义下删除本身由 hook 完成，资源清理与删除天然同生命周期，且 clean/dirty 两条退出分支与所有删除入口统一触发。

**独立测试**：settings.json 同时配置 `WorktreeCreate`（输出 `mktemp -d` 路径）与 `WorktreeRemove`（`bash -c 'jq -r ".hook_event_name, .worktree_path" >> /tmp/wave-hook-test.log && rm -rf "$(jq -r .worktree_path)"'`），分别通过 5 个入口删除 hook-based worktree（CLI 退出对话框选 Remove、CLI clean 退出、`wave -p` 打印模式、ExitWorktree 工具 `action: "remove"`、stdio RPC 删除后台会话），验证每个入口都触发 hook、删除由 hook 脚本完成、wave 未执行 `git worktree remove`、日志包含正确字段。

**验收场景**：

1. **假设** hook-based worktree 会话中没有任何更改，**当** 我退出 CLI 时，**则** `WorktreeRemove` hook 被触发（clean 退出同样触发），wave 不执行 `git worktree remove`，删除由 hook 脚本完成。
2. **假设** hook-based worktree 会话中有未提交更改或新提交，**当** 退出对话框选择 "Remove worktree" 时，**则** `WorktreeRemove` hook 被触发，wave 不执行 `git worktree remove`，删除由 hook 脚本完成。
3. **假设** hook-based worktree 会话中，**当** AI 调用 `ExitWorktree` 且 `action: "remove"` 时，**则** hook 被触发；若会话状态无法用 git 校验（hook-based 会话无 originalHeadCommit 基线，或目录本身不是 git 仓库），工具按 fail-closed 语义要求 `discard_changes: true` 才执行移除（对齐 Claude Code，与 git-based worktree 行为一致）。
4. **假设** hook-based worktree 会话中，**当** `wave -p` 打印模式会话结束时，**则** hook 被触发并接管删除。
5. **假设** hook-based worktree 属于 stdio 后台会话，**当** 前端通过 RPC 删除其 worktree 时，**则** hook 被触发并接管删除；RPC 校验跳过 repo-root containment 检查（repoRoot 是兜底值，hook 拥有路径）。
6. **假设** `WorktreeRemove` hook 执行时，**当** stdin JSON 被构造时，**则** 包含 `hook_event_name: "WorktreeRemove"` 与 `worktree_path`（worktree 绝对路径），不含 `name` 字段（名称由 hook 通过 `basename "$worktree_path"` 派生，与 Claude Code 官方输入格式一致）。
7. **假设** `WorktreeRemove` hook 失败（非 0 退出码）或超时，**当** 删除发生时，**则** 错误仅被记录（不显示为阻止性错误、不重试），worktree 目录是否残留由 hook 脚本负责（对齐 Claude Code：仅记录错误日志）。
8. **假设** worktree 创建时配置了 `WorktreeCreate` hook（hook-based）但删除时未配置 `WorktreeRemove` hook，**当** 删除发生时，**则** wave 不执行 `git worktree remove`，仅记录警告 "No WorktreeRemove hook configured, hook-based worktree left at: `<path>`"（对齐 Claude Code）。
9. **假设** worktree 由 wave 通过 git 创建（未配置 `WorktreeCreate` hook），**当** 任何入口删除该 worktree 时，**则** `WorktreeRemove` hook 不触发，wave 照常执行 `git worktree remove --force` 与 `git branch -D`（现有行为不变）。

---

### 用户故事：手动删除 worktree 后会话自动恢复（优先级：P1）

作为开发者，我希望在会话中手动执行 `git worktree remove` 删掉当前 worktree 目录后，会话的工作目录自动回退到主仓库，以便会话内需要 spawn 子进程的工具（Bash、Grep、后台任务）不会因 cwd 失效而全部 ENOENT 崩溃。

**为什么是这个优先级**：手动 `git worktree remove` 绕过 wave 的退出流程（ExitWorktree 工具 / CLI 退出对话框 / stdio RPC），会话的 "Workdir" 仍指向已删除目录。Node `spawn()` 会先 chdir 到 `cwd`，cwd 不存在直接抛 ENOENT——Bash（`spawn /bin/bash ENOENT`）、Grep（`spawn rg ENOENT`）、后台任务全部失效，而 Read/Write/Glob 正常，会话直接残废。Claude Code 的处理是 Shell.ts 在 spawn 前对 cwd 做 `realpath()` 检查并回退到 originalCwd，但其 originalCwd 在 worktree 会话中期就是 worktree 路径本身，回退同样失败，只能给出"目录不存在，请重启"的干净报错；wave 的 `getOriginalWorkdir()` 稳定指向主仓库（进入 worktree 时不改写），可以真正自动回退，比 Claude Code 更彻底。

**独立测试**：进入 EnterWorktree 会话，在会话内用 Bash 执行 `git worktree remove --force <name>` 删除当前 worktree 目录，再执行任意 Bash/Grep 命令，验证命令正常执行、工作目录已回退到主仓库、工具结果包含回退提示；再调用 ExitWorktree，验证返回无操作消息（不报错）。

**验收场景**：

1. **假设** 会话在 EnterWorktree 创建的 worktree 中，**当** 用户在会话内手动执行 `git worktree remove --force` 删除当前 worktree 目录，**则** 下一次工具调用构建上下文时检测到会话 cwd 失效，自动回退到主仓库（原始 cwd），不再指向已删除目录。
2. **假设** 回退已发生，**当** 会话内继续执行 Bash / Grep / 后台任务等需要 spawn 子进程的工具时，**则** 工具正常执行，不再出现 `spawn /bin/bash ENOENT` 或 `spawn rg ENOENT`。
3. **假设** 回退已发生，**当** 下一个 spawn 工具执行时，**则** 工具结果开头包含提示："Note: working directory `<已删除路径>` no longer exists; session working directory recovered to `<主仓库路径>`"（该提示仅出现一次）。
4. **假设** 回退已发生，**当** AI 调用 ExitWorktree 工具时，**则** 返回无操作消息（会话的 worktree 状态已随回退清除），不进行任何文件系统更改、不报错。
5. **假设** 回退已发生，**当** AI 调用 EnterWorktree 工具时，**则** 能正常创建新的 worktree 会话（旧会话状态已清除，不会被误拒为"已在 worktree 会话中"）。
6. **假设** 会话原始工作目录（主仓库）本身也不存在（极端场景），**当** 检测到当前 cwd 失效时，**则** 不进行回退，保持原值（没有有效的回退目标）。
7. **假设** 原始工作目录是有效的主仓库，**当** 检测到当前 cwd 失效并回退时，**则** 日志记录 warn 级 "Working directory ... no longer exists; recovered session workdir to ..."，且宿主（CLI/webview）通过 workdirChange 通知更新会话工作目录显示。
8. **假设** 用户在会话内手动删除 worktree 目录，**当** 删除发生时，**则** WorktreeRemove hook 不补触发——hook 契约要求目录仍存在（git 移除**之前**）以便 hook 读取目录内文件定位外部资源，且触发时机落在任意下一次工具调用对用户是意外副作用；与 Claude Code 行为一致（CC 也不检测手动删除、不补触发 hook）。用户通过工具提示获知目录已失效并完成回退。

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

### 用户故事：bypassPermissions 模式下 Worktree 安全拦截仍生效（优先级：P1）

作为开发者，我希望即使开启了"跳过权限确认"（bypassPermissions）模式，worktree 会话中修改主仓库文件仍被拦截，以便安全隔离不因权限模式而失效。

**为什么是这个优先级**：worktree 隔离是防数据破坏的安全机制（防止误写主仓库），与权限模式无关。read-before-edit 校验也是不区分权限模式的无条件安全检查——worktree 安全拦截应遵循同样的语义。bypassPermissions 的语义是"跳过权限确认"，不是"跳过安全校验"。

**独立测试**：在 worktree 会话中通过 webview 或 CLI 将权限模式切换为 bypassPermissions，要求 AI 用 Write/Edit 修改主仓库（worktree 外）文件，验证操作被拒绝且出现 worktree 安全错误消息；再要求修改 worktree 内文件，验证正常写入。

**验收场景**：

1. **假设**我处于 bypassPermissions 模式且在 worktree 会话中（CLI `-w` 或 EnterWorktree 创建），**当** AI 调用 Write/Edit 修改主仓库（worktree 外）的文件时，**则**操作被拒绝，返回"Access denied: You are currently in a worktree session..."消息，且日志记录 Worktree safety violation。
2. **假设**我处于 bypassPermissions 模式且在 worktree 会话中，**当** AI 调用 Write/Edit 修改 worktree 内的文件时，**则**操作正常执行，无需任何权限确认（bypass 语义不变）。
3. **假设**我处于 bypassPermissions 模式但不在任何 worktree 会话中，**当** AI 调用 Write/Edit 修改任意文件时，**则**操作正常执行，无需权限确认（非 worktree 场景行为完全不变）。
4. **假设**我处于 acceptEdits 或 default 模式且在 worktree 会话中，**当** AI 调用 Write/Edit 修改主仓库文件时，**则**行为与现状一致，仍被 worktree 安全拦截。

---

### 边界情况

- **当 worktree 目录已存在时会发生什么？** 系统应该报错或询问是否重用。
- **系统如何处理 worktree 创建期间的 git 错误？** 应显示清晰的错误消息并优雅退出。
- **如果用户不在 git 仓库中怎么办？** 未配置 `WorktreeCreate` hook 时 `-w` 标志应失败并显示错误消息；配置了 hook 时由 hook 创建（hook-based），`-w` 正常工作。
- **当 WorktreeRemove hook 失败或超时时会发生什么？** 非阻塞：错误仅被记录，wave 不执行 `git worktree remove` 也不重试，worktree 目录是否残留由 hook 脚本负责。
- **当 stdio RPC 传入的 git-based worktree 路径为符号链接或逃逸 repo root 时会发生什么？** 删除被拒绝并返回 RPC 错误，hook 不触发；hook-based worktree 跳过该 containment 校验（hook 拥有路径）。
- **当用户在会话内手动 `git worktree remove` 删除当前 worktree 目录时会发生什么？** 会话工作目录在下一次工具调用时自动回退到主仓库（原始 cwd），spawn 工具恢复可用，工具结果包含一次性回退提示；WorktreeRemove hook 不补触发（与 Claude Code 一致；该场景针对 git-based worktree，hook-based worktree 由 hook 负责删除、不存在 wave 侧的 git 移除）。

## 假设

- 系统已安装 `git` 并可在环境的 PATH 中访问。
- 使用 `-w` 时当前工作目录是 git 仓库。
- 自动生成的名称遵循 `generateRandomName` 工具的 `adjective-adjective-noun` 模式。
- 对 git-based worktree，"Remove worktree"意味着同时执行 `git worktree remove --force` 和 `git branch -D`，以确保即使存在更改或分支未合并也能清理；对 hook-based worktree 则由 `WorktreeRemove` hook 接管删除。
- WorktreeCreate/WorktreeRemove 是 replace 型钩子：配置 `WorktreeCreate` 后由 hook 创建 worktree（第一个成功 hook 的 stdout 返回 worktree path），配置 `WorktreeRemove` 后由 hook 接管 hook-based worktree 的删除；未配置时 wave 保持现有 git 行为，`WorktreeRemove` 对 git-based worktree 不触发。
- WorktreeRemove hook 的 JSON 输入仅包含官方字段（`session_id`、`transcript_path`、`cwd`、`hook_event_name`、`worktree_path`），worktree 名称由 hook 通过 `basename "$worktree_path"` 派生。
- WorktreeCreate hook 的 JSON 输入包含官方公共字段（`session_id`、`transcript_path`、`cwd`、`hook_event_name`）与 `name`（worktree 名）。
- 删除后台会话（stdio RPC）的 git-based worktree 前会校验路径：拒绝符号链接或解析后位于 repo root 之外的路径；hook-based worktree 跳过该校验（hook 拥有路径，repoRoot 为兜底值）。
- 手动删除当前 worktree 目录不触发 WorktreeRemove hook（与 Claude Code 一致）；会话通过 cwd 失效检测 + 自动回退到主仓库 + 一次性工具提示恢复，回退时清除已失效的 worktree 会话状态。
