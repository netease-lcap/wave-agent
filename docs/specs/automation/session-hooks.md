---
name: "会话生命周期钩子"
description: "恢复会话（运行时 `restoreSession` 与创建时 `restoreSessionId` / `continueLastSession`）时按序触发 SessionEnd/SessionStart 钩子并注入上下文"
order: 20
---

# 功能规格说明：会话生命周期钩子

**创建日期**：2026-08-02

## 用户场景与测试 _（必填）_

### 用户故事：运行时恢复会话触发生命周期钩子（优先级：P1）

作为使用插件端（VS Code 扩展、JetBrains 插件）或桌面端并在多个会话间切换的用户，我希望在运行时通过 `restoreSession` 恢复/切换会话时，Wave 先对当前会话执行 `SessionEnd` 钩子、再对恢复的会话执行 `SessionStart` 钩子（source 均为 `"resume"`），以便会话清理与初始化逻辑与 Claude Code 的 resume 序列完全对齐，钩子脚本（如环境切换、工作区状态通知、上下文清理）能在正确的会话上下文上按正确顺序运行。

**为什么是这个优先级**：这是本功能对齐 Claude Code 的核心行为。运行时切换会话是多会话使用路径（IDE/桌面端在多会话间来回切换）中最常见的操作，缺少该行为会导致钩子脚本在错误的会话上下文上运行或完全不运行。

**独立测试**：通过 `agent.restoreSession(targetSessionId)` 在运行时切换会话，配置 SessionEnd/SessionStart 钩子命令（如向标记文件写入执行时间与参数），验证执行顺序为 SessionEnd 先于 SessionStart，且两者分别在当前会话与目标会话的 transcript 上运行。

**验收场景**：

1. **假设**当前会话 A 正在运行且配置了 SessionEnd 与 SessionStart 钩子，**当**调用 `restoreSession(B)` 切换到会话 B 时，**则**先对会话 A 执行 SessionEnd 钩子（JSON 输入 `end_source` 为 `"resume"`），再对会话 B 执行 SessionStart 钩子（JSON 输入 `source` 为 `"resume"`）
2. **假设**传入的 sessionId 为空或与当前会话相同，**当**调用 `restoreSession` 时，**则**直接返回且不执行任何钩子（无操作路径）
3. **假设**当前会话有未保存的消息，**当**调用 `restoreSession` 切换会话时，**则**切换前自动保存当前会话，保存失败仅记录警告且不中断恢复
4. **假设**目标会话不存在，**当**调用 `restoreSession` 时，**则**抛出 `Session not found` 错误，恢复流程中止
5. **假设**SessionEnd 或 SessionStart 钩子执行失败，**当**调用 `restoreSession` 时，**则**记录警告日志且恢复流程继续完成（钩子失败不阻断会话切换）

### 用户故事：钩子消息追加到恢复后的对话（优先级：P1）

作为开发者，我希望 SessionStart 钩子输出的 `additionalContext` 作为 meta 用户消息追加到恢复后的会话消息列表末尾，以便恢复会话的 AI 立即可见钩子提供的上下文（与 Claude Code resume 时的注入方式一致）。

**为什么是这个优先级**：钩子输出的上下文只有在真正进入恢复后的对话消息流时才有价值；丢失注入会导致钩子语义不完整。消息以 meta 用户消息承载，不会作为真实用户输入参与后续流程。

**同一份内容不重复叠加（平台层去重）**：`resume` 是往**已有**对话尾部追加，所以「恢复一次多一份」会永久占着上下文（一段 ~2.6 KB 的上下文字节约合 0.8k token/次）。这件事由平台统一处理，钩子作者不需要自己判断，语义与 Claude Code 的平台层去重一致（changelog 2.1.295 / `SubagentStart` 的同套投递语义）：**同一份内容已在对话里就不再加；内容变了就刷新；压缩把副本丢了之后下次再加回来。** 四个注入点（`startup` / `resume` / `clear` / `compact`）共用同一份判断，不按 source 特判。

**独立测试**：配置输出 additionalContext 的 SessionStart 钩子，调用 `restoreSession` 后检查恢复会话的最后一条消息为 `isMeta: true` 的 user 消息且其文本块内容包含钩子输出的 additionalContext。

**验收场景**：

1. **假设**SessionStart 钩子输出了 `additionalContext`，**当**运行时恢复会话完成后，**则**该上下文以 `<system-reminder>` 包裹的 meta 用户消息追加到恢复会话消息列表末尾，且位于该会话原有消息之后
2. **假设**恢复出的对话里已经有一条**完全相同**的 SessionStart 上下文（上一次运行恢复时注入的那份），**当**本次恢复的钩子输出内容相同时，**则**不追加第二份，恢复后的列表里仍然只有那一份
3. **假设**恢复出的对话里那份副本的内容与本次钩子输出不同（钩子输出变了，或插件改写了正文），**当**本次恢复完成时，**则**追加新的那份，旧副本保留在历史里
4. **假设**SessionStart 钩子未输出 `additionalContext`，**当**运行时恢复会话完成时，**则**不注入任何额外消息
5. **假设**钩子执行失败（如命令不存在），**当**运行时恢复会话时，**则**不注入消息、记录警告日志，且恢复流程继续完成

### 用户故事：创建时恢复会话：先恢复、再跑钩子（优先级：P1）

作为通过 `Agent.create({ restoreSessionId })`（IM 桥接、`wave --resume`、宿主池化会话）创建 Agent 的用户，我希望 SessionStart 钩子在**会话恢复完成之后**执行、`source` 为 `"resume"`，以便钩子提供的上下文真正落到恢复出的对话尾部，而不是在会话加载后被整表替换冲掉。

**为什么是这个优先级**：恢复会替换整个消息列表，所以「先注入、后恢复」等于永远拿不到上下文——长命会话（进程重启/续聊）会静默丢掉派活口径。Claude Code 的顺序是「恢复出的对话先出现，钩子仍在后台跑，但模型的第一句话等钩子跑完才发，所以它们的上下文一定能到达模型」（`hooks.md`），且 `SessionStart` 在 resume 时以 `source: "resume"` 再跑一次以便刷新上下文；changelog 2.1.295 修的「每次 resume 都重复追加同一份上下文」也只在这个顺序下才会出现。

**独立测试**：`Agent.create({ restoreSessionId })` 并让 SessionStart 钩子输出 `additionalContext`，检查恢复会话消息列表的最后一条为 `isMeta: true` 的 user 消息、位于历史消息之后，且钩子调用参数为（`"resume"`, 恢复出的 sessionId, 该会话的 transcriptPath）。

**验收场景**：

1. **假设**以 `Agent.create({ restoreSessionId })` 启动且 SessionStart 钩子输出了 `additionalContext`，**当**初始化完成时，**则**该上下文以 `<system-reminder>` 包裹的 meta 用户消息落在恢复出的消息**之后**（列表末尾）
2. **假设**以 `Agent.create({ restoreSessionId })` 启动，**当**钩子执行时，**则** `source` 为 `"resume"`，且钩子的 `sessionId` / `transcriptPath` 指向**恢复出来的那个会话**（不是创建时那个新会话）
3. **假设**以 `Agent.create({ continueLastSession: true })` 启动，**当**初始化完成时，**则**行为与场景 1、2 相同（`source` 为 `"resume"`、上下文落在恢复出的消息之后）
4. **假设**不恢复（新会话），**当**初始化完成时，**则** `source` 仍为 `"startup"`，上下文注入到（空的）消息列表，`initialUserMessage` 照旧注入
5. **假设**恢复出的对话里已有一条完全相同的 SessionStart 上下文，**当**本次初始化的钩子输出内容相同时，**则**不追加第二份（同一套平台层去重，不按 source 特判）
6. **假设**创建时恢复**不**触发 `SessionEnd` 钩子（对话还没开始过），**当**初始化完成时，**则**只有 `SessionStart` 执行过一次

### 用户故事：与 Claude Code 对齐的防重复触发（优先级：P2）

作为开发者，我希望运行时会话切换与创建时恢复两条路径严格分离、互不重叠，以便从根本上避免 Claude Code 曾出现的会话恢复时 SessionStart 钩子重复触发问题（gh-30825 双触发缺陷）。

**为什么是这个优先级**：双触发会污染恢复后的对话（注入两次相同上下文）。Wave 通过结构性分离（两条独立代码路径）而非运行时标记来避免该问题，与 Claude Code 在运行时通过跳过 `"startup"` source 实现的最终效果一致。

**独立测试**：在同一进程内先以 `restoreSessionId` 创建 Agent，再多次调用 `restoreSession` 切换会话，计数 SessionStart 钩子执行次数，验证每次切换恰好执行一次。

**验收场景**：

1. **假设**同一进程中先发生创建时恢复（`restoreSessionId`）、随后发生运行时 `restoreSession`，**当**两次恢复分别完成时，**则**SessionStart 钩子恰好执行两次（均为 `"resume"`），无重复触发
2. **假设**连续多次调用 `restoreSession` 在不同会话间切换，**当**每次切换完成时，**则**每次切换恰好触发一次 SessionStart（`"resume"`）与一次 SessionEnd（`"resume"`），无遗漏或重复

## 边界情况

- 运行时恢复的目标会话与当前会话相同（或 sessionId 为空）时，`restoreSession` 为无操作，不执行任何钩子
- 恢复过程中 SessionEnd 钩子执行失败：仅记录警告，继续加载目标会话
- 恢复过程中 SessionStart 钩子执行失败：仅记录警告，不注入上下文，恢复的会话仍可用
- 钩子输出的 `additionalContext` 为空字符串：视为未输出，不注入消息
- 注入的 meta 用户消息仅存在于恢复后的会话内存消息流中；后续 `saveSession` 会将其持久化到该会话的 transcript
- **去重的判据是「最终要写入的那串文本」**：即经过 `prompt.attachment` 的 `session-start` 档改写之后、`<system-reminder>` 包裹之后的结果。插件改写掉正文时按改写后的文本判断；`rewritePromptAttachment` 返回 `null`（这条不要）时根本不写，也不参与去重
- **去重比的是内存里的当前列表**，不是会话文件：会话文件追加式保存，压缩后的旧行可能还在文件里，但它已不在列表中，所以下一次注入照常落地
- 四个 source 各就各位：`startup` / `clear` 时列表为空（或刚被清空）→ 照常注入；`compact` 之后列表被折成 `[摘要, ...最近两轮]`、旧副本已被折进摘要 → 照常注入；`resume` 时恢复出的列表里带着上次那份 → 内容相同则跳过
- 目标会话加载失败（不存在或文件损坏）：抛出 `Session not found`，当前会话状态不被修改
- **创建时恢复不注入 `initialUserMessage`**（保持现状）：Claude Code 文档把 `initialUserMessage` 定为非交互 `-p` 模式专用（`"becomes the first turn even if you pass no prompt"`），恢复出的对话已经有自己的第一轮，所以这条路径只在 `startup` 注入。这是 Wave 比 Claude Code 更宽的一处（`resume` 也注入），记录在案、本轮不改

### 测试验证需求

- 必须通过 `agent.restoreSession()` 触发并 spy `hookManager.executeSessionEndHooks` / `executeSessionStartHooks`，验证调用顺序为 SessionEnd 先于 SessionStart，且参数分别为（`"resume"`, 当前 sessionId, transcriptPath）与（`"resume"`, 目标 sessionId, transcriptPath）
- 必须通过检查恢复后最后一条消息为 `role: "user"`、`isMeta: true` 且 `blocks[0].content` 包含 additionalContext 文本来验证注入
- 必须通过「恢复出的对话末尾已有一条完全相同的上下文」的用例验证不追加第二份，并用「钩子输出变了」的对照组验证刷新；压缩后重新注入要用**真实 MessageManager** 实证（内存列表在压缩时被替换，这条不能只靠代码推断）
- 必须通过 `Agent.create({ restoreSessionId })`（以及 `continueLastSession`）验证：钩子在恢复**之后**执行（`additionalContext` 是恢复会话的最后一条消息）、`source` 为 `"resume"`、钩子的 sessionId/transcriptPath 指向恢复出的会话，且不执行 SessionEnd；对照组（不恢复）验证 `"startup"` 与空表注入不变
- 必须通过传入与当前会话相同的 sessionId 验证无操作路径不执行任何钩子
- 必须通过 `hookManager.executeSessionStartHooks("resume", ...)` 与 `executeSessionEndHooks("resume", ...)` 的单元测试验证钩子上下文中的 `source` / `end_source` 字段透传
