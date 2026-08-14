---
name: "会话生命周期钩子"
description: "SessionStart / SessionEnd 钩子在会话启动与运行时恢复时的行为"
order: 20
---

# 功能规格说明：会话生命周期钩子

**创建日期**：2026-08-02

## 用户场景与测试 _（必填）_

### 用户故事：运行时恢复会话触发生命周期钩子（优先级：P1）

作为使用 IDE 插件（VS Code 扩展、JetBrains 插件）或桌面端并在多个会话间切换的用户，我希望在运行时通过 `restoreSession` 恢复/切换会话时，Wave 先对当前会话执行 `SessionEnd` 钩子、再对恢复的会话执行 `SessionStart` 钩子（source 均为 `"resume"`），以便会话清理与初始化逻辑与 Claude Code 的 resume 序列完全对齐，钩子脚本（如环境切换、工作区状态通知、上下文清理）能在正确的会话上下文上按正确顺序运行。

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

**独立测试**：配置输出 additionalContext 的 SessionStart 钩子，调用 `restoreSession` 后检查恢复会话的最后一条消息为 `isMeta: true` 的 user 消息且其文本块内容包含钩子输出的 additionalContext。

**验收场景**：

1. **假设**SessionStart 钩子输出了 `additionalContext`，**当**运行时恢复会话完成后，**则**该上下文以 `<system-reminder>` 包裹的 meta 用户消息追加到恢复会话消息列表末尾，且位于该会话原有消息之后
2. **假设**SessionStart 钩子未输出 `additionalContext`，**当**运行时恢复会话完成时，**则**不注入任何额外消息
3. **假设**钩子执行失败（如命令不存在），**当**运行时恢复会话时，**则**不注入消息、记录警告日志，且恢复流程继续完成

### 用户故事：启动恢复行为保持不变（优先级：P2）

作为开发者，我希望通过 `Agent.create({ restoreSessionId })` 启动时恢复会话的行为保持现状不变（SessionStart 钩子 source 为 `"startup"`、不触发 SessionEnd），以便本次对齐运行时恢复不引入启动路径的回归。

**为什么是这个优先级**：启动恢复路径（`InitializationService.initialize` → `handleSessionRestoration`）与运行时 `restoreSession` 是完全独立的代码路径。保持启动路径行为不变是回归保护，非新功能本身。

**独立测试**：通过 `Agent.create({ restoreSessionId })` 启动并配置 SessionStart 钩子，验证钩子以 `"startup"` source 执行且全程不执行 SessionEnd 钩子；与运行时 `restoreSession` 的 `"resume"` source 行为对比。

**验收场景**：

1. **假设**以 `Agent.create({ restoreSessionId })` 启动，**当**初始化完成时，**则**SessionStart 钩子以 source `"startup"` 执行，且不执行任何 SessionEnd 钩子
2. **假设**钩子配置了 `SessionStart` 事件，**当**启动恢复与运行时 `restoreSession` 分别触发时，**则**两条路径各自独立执行钩子，参数（source、sessionId、transcriptPath）分别对应各自路径的会话

### 用户故事：与 Claude Code 对齐的防重复触发（优先级：P2）

作为开发者，我希望运行时会话切换与启动恢复两条路径严格分离、互不重叠，以便从根本上避免 Claude Code 曾出现的会话恢复时 SessionStart 钩子重复触发问题（gh-30825 双触发缺陷）。

**为什么是这个优先级**：双触发会污染恢复后的对话（注入两次相同上下文）。Wave 通过结构性分离（两条独立代码路径）而非运行时标记来避免该问题，与 Claude Code 在运行时通过跳过 `"startup"` source 实现的最终效果一致。

**独立测试**：在同一进程内先以启动恢复创建 Agent，再多次调用 `restoreSession` 切换会话，计数 SessionStart 钩子执行次数，验证每次切换恰好执行一次。

**验收场景**：

1. **假设**同一进程中先发生启动恢复、随后发生运行时 `restoreSession`，**当**两次恢复分别完成时，**则**SessionStart 钩子恰好执行两次（一次 `"startup"`、一次 `"resume"`），无重复触发
2. **假设**连续多次调用 `restoreSession` 在不同会话间切换，**当**每次切换完成时，**则**每次切换恰好触发一次 SessionStart（`"resume"`）与一次 SessionEnd（`"resume"`），无遗漏或重复

## 边界情况

- 运行时恢复的目标会话与当前会话相同（或 sessionId 为空）时，`restoreSession` 为无操作，不执行任何钩子
- 恢复过程中 SessionEnd 钩子执行失败：仅记录警告，继续加载目标会话
- 恢复过程中 SessionStart 钩子执行失败：仅记录警告，不注入上下文，恢复的会话仍可用
- 钩子输出的 `additionalContext` 为空字符串：视为未输出，不注入消息
- 注入的 meta 用户消息仅存在于恢复后的会话内存消息流中；后续 `saveSession` 会将其持久化到该会话的 transcript
- 目标会话加载失败（不存在或文件损坏）：抛出 `Session not found`，当前会话状态不被修改

### 测试验证需求

- 必须通过 `agent.restoreSession()` 触发并 spy `hookManager.executeSessionEndHooks` / `executeSessionStartHooks`，验证调用顺序为 SessionEnd 先于 SessionStart，且参数分别为（`"resume"`, 当前 sessionId, transcriptPath）与（`"resume"`, 目标 sessionId, transcriptPath）
- 必须通过检查恢复后最后一条消息为 `role: "user"`、`isMeta: true` 且 `blocks[0].content` 包含 additionalContext 文本来验证注入
- 必须通过 `Agent.create({ restoreSessionId })` 验证启动路径 SessionStart 以 `"startup"` source 执行且不执行 SessionEnd
- 必须通过传入与当前会话相同的 sessionId 验证无操作路径不执行任何钩子
- 必须通过 `hookManager.executeSessionStartHooks("resume", ...)` 与 `executeSessionEndHooks("resume", ...)` 的单元测试验证钩子上下文中的 `source` / `end_source` 字段透传
