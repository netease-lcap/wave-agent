---
title: 会话管理
description: 创建与恢复会话、会话 API、历史操作，以及会话 jsonl 的文件存储与保留期
---

# 会话管理 {#session-management}

## 创建会话 {#session-create}

Agent 创建时自动开始新会话，每个会话有唯一 ID：

```typescript
const agent = await Agent.create({ workdir: "/path/to/project" });
console.log(agent.sessionId); // 自动生成的会话 ID
```

## 恢复会话 {#session-restore}

两种方式恢复历史会话：

```typescript
// 方式 1：通过 restoreSessionId 恢复指定会话
const agent = await Agent.create({
  restoreSessionId: "session-id-to-restore",
  workdir: "/path/to/project",
});

// 方式 2：通过 continueLastSession 恢复最近会话
const agent = await Agent.create({
  continueLastSession: true,
  workdir: "/path/to/project",
});

// 方式 3：运行时恢复
await agent.restoreSession("another-session-id");
```

## 会话查询 API {#session-api}

SDK 提供独立的会话查询函数：

```typescript
import {
  listSessions, // 列出所有会话
  listSessionsFromJsonl, // 列出会话（JSONL 格式）
  loadSessionFromJsonl, // 加载指定会话数据
  getLatestSessionFromJsonl, // 获取最近活跃会话
  getSessionFilePath, // 获取会话文件路径
  deleteSession, // 删除会话
} from "wave-agent-sdk";

// 列出所有会话
const sessions = await listSessions("/path/to/project");
// 返回 SessionMetadata[]: { id, createdAt, lastActiveAt, messageCount, ... }

// 加载指定会话
const data = await loadSessionFromJsonl("session-id", "/path/to/project");
// 返回 SessionData: { messages, metadata, ... }
```

## 会话历史操作 {#session-history}

```typescript
// 截断历史到指定位置（用于回退/rewind）
await agent.truncateHistory(messageIndex);

// 获取完整消息链（含压缩前的父会话消息）
const thread = await agent.getFullMessageThread();
```

## 会话文件存储 {#session-storage}

会话以 JSONL 格式存储在 `~/.wave/sessions/` 目录下：

- 文件路径经过工作目录编码，确保不同项目隔离
- 每条消息为一行独立 JSON 记录
- 压缩后创建新会话，通过 `parentSessionId` 链接到旧会话，保持历史可追溯
- 子代理会话使用独立文件名（`subagent_` 前缀）

**过期会话清理（对齐 Claude Code）：**

Wave 启动时会在后台执行一次全局会话清理：删除 `~/.wave/projects` 下 mtime 早于保留期的会话 jsonl（含 `subagent-*.jsonl`），清理后为空的项目目录一并删除（目录中仍有文件如 `memory/` 时保留）。

- **保留期**：默认 **30 天**，可通过 settings.json 的 `cleanupPeriodDays` 配置（见 [其他设置](./settings#settings-other)）；jsonl 追加写使 mtime 反映最后活动时间。
- **`cleanupPeriodDays: 0`**：跳过清理。
- **记忆保护**：不触碰项目目录下的 `memory/`（auto-memory 数据）。
- **容错**：`~/.wave/projects` 不存在或不可读时静默跳过，不中断启动。
