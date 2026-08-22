---
name: "会话文件保留清理"
description: "按可配置保留期清理过期的会话 jsonl 文件（对齐 Claude Code）"
order: 160
---

# 功能规格说明：会话文件保留清理

**创建日期**：2026-08-22

## 澄清

### 2026-08-22 决策确认（用户拍板）

- **触发位置**：`setupAgentContainer`（containerSetup.ts）fire-and-forget 后台执行，模块级 flag 保证每进程只扫一次（对齐 CC「启动时后台执行一次」）
- **旧机制**：删除 `cleanupExpiredSessionsFromJsonl`（14 天硬编码、per-workdir、session restore 时触发），统一由新的全局 30 天清理覆盖
- **`cleanupPeriodDays: 0`**：跳过清理（永不删除会话文件），防止 cutoff=now 误删全部历史
- **配置范围**：user → project → local 三 scope 合并（last-wins），与其他 scalar 配置（language/model 等）模式一致

## 用户场景与测试 _（必填）_

### 用户故事：过期会话文件后台清理（优先级：P1，对齐 Claude Code）

作为用户，我希望过期的会话记录被自动清理，以便 `~/.wave/projects` 不会无限膨胀。

**为什么是这个优先级**：对齐 Claude Code 的 `cleanupOldSessionFiles()`（默认 30 天保留期），是磁盘占用治理的基础能力；当前 jsonl 仅靠 14 天 per-workdir 清理兜底，无法覆盖全部项目目录。

**独立测试**：可以构造一个含旧 jsonl（mtime 早于 cutoff）与新 jsonl（mtime 晚于 cutoff）的项目目录，执行清理函数，验证只有旧文件被删除、新文件保留、删除计数正确。

**验收场景**：

1. **假设** `~/.wave/projects` 下存在 mtime 早于保留期 cutoff 的会话 jsonl（主会话 `<uuid>.jsonl` 与子代理 `subagent-<uuid>.jsonl`），**当**启动时后台清理执行，**则**这些文件必须被删除
2. **假设**会话 jsonl 的 mtime 晚于 cutoff，**当**清理执行，**则**该文件必须被保留（jsonl 追加写会使 mtime 反映最后活动时间，与 CC 的文件 mtime 判断一致）
3. **假设**项目目录在清理后为空，**当**清理执行完毕，**则**空项目目录必须被删除；目录中仍有文件（如 `memory/`）时必须保留
4. **假设**`~/.wave/projects` 目录不存在或不可读，**当**清理执行，**则**必须静默跳过，不得报错中断启动

---

### 用户故事：可配置保留期（优先级：P1，对齐 Claude Code）

作为用户，我希望通过 `settings.json` 的 `cleanupPeriodDays` 控制保留天数，以便按需延长或缩短会话保留期。

**为什么是这个优先级**：对齐 CC 的 `settings.cleanupPeriodDays ?? DEFAULT_CLEANUP_PERIOD_DAYS(30)`；默认 30 天，用户可覆盖。

**独立测试**：可以在 settings.json 中设置 `cleanupPeriodDays` 为不同值，验证清理 cutoff 随之变化；设置 `0` 时验证清理整体跳过。

**验收场景**：

1. **假设**用户未设置 `cleanupPeriodDays`，**当**清理执行，**则**保留期必须为默认 30 天
2. **假设**用户在 `~/.wave/settings.json` 设置 `cleanupPeriodDays: 60`，**当**清理执行，**则**保留期必须为 60 天（仅删 mtime 早于 60 天前 cutoff 的文件）
3. **假设**用户设置 `cleanupPeriodDays: 0`，**当**清理执行，**则**必须跳过清理，不得删除任何会话文件
4. **假设**project/local scope 的 settings.json 也设置了 `cleanupPeriodDays`，**当**清理执行，**则**按 user → project → local 优先级取最后一个非 undefined 值（last-wins）

---

### 用户故事：误删守卫（优先级：P1，对齐 Claude Code）

作为用户，我希望在 settings 配置异常时清理被安全跳过，以便不会因解析失败导致会话被误删。

**为什么是这个优先级**：对齐 CC 的守卫（`getSettingsWithAllErrors().errors.length > 0 && rawSettingsContainsKey('cleanupPeriodDays')` → 跳过清理）；用户显式设过保留期时，配置损坏回退默认值可能删除用户本想保留的文件。

**独立测试**：可以构造「settings.json 校验失败且含 cleanupPeriodDays 键」与「校验失败但无该键」两种场景，验证前者跳过清理、后者按默认值清理。

**验收场景**：

1. **假设**settings 校验存在错误且用户显式设置过 `cleanupPeriodDays`，**当**启动触发清理，**则**必须整体跳过清理（日志提示修复 settings 后清理才会启用）
2. **假设**settings 校验存在错误但用户未设置 `cleanupPeriodDays`，**当**启动触发清理，**则**按默认 30 天执行（用户未表达保留意图，默认值安全）
3. **假设**settings 文件为损坏的 JSON（无法解析），**当**启动触发清理，**则**必须跳过清理，不得基于残缺配置删除任何文件
4. **假设**清理仅记录删除/错误计数并输出 debug 日志，**当**执行完毕，**则**不得抛出异常影响 Agent 启动

---

### 用户故事：auto-memory 保护（优先级：P1）

作为用户，我希望会话清理只删除 jsonl 会话文件，不触碰项目的 auto-memory 文件，以便长期记忆不丢失。

**为什么是这个优先级**：`~/.wave/projects/<project>/memory/` 存放 auto-memory（`MEMORY.md` 等），是跨会话记忆的载体，一旦误删无法恢复。

**独立测试**：可以构造含 `memory/` 子目录与过期 jsonl 的项目目录，执行清理，验证 jsonl 被删、`memory/` 内容完整保留、目录不被删除。

**验收场景**：

1. **假设**项目目录含 `memory/` 子目录（内含 `MEMORY.md`），**当**清理执行，**则**`memory/` 及其内容必须原样保留
2. **假设**项目目录在删除所有过期 jsonl 后仍含 `memory/`，**当**清理执行完毕，**则**项目目录不得被删除（空目录清理只针对无残留内容的目录）
