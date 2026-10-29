---
title: 其他功能
description: 斜杠命令、Bash 模式命令、SSO 认证、提示历史、Git 工具、文件搜索、计划模式与 Worktree 管理
---

# 其他功能 {#other-features}

## 斜杠命令 {#slash-commands}

```typescript
// 获取所有已注册的斜杠命令
const commands = agent.getSlashCommands();

// 检查命令是否存在
agent.hasSlashCommand("compact");

// 注册自定义斜杠命令
agent.registerSlashCommand({
  id: "my-command",
  name: "my-command",
  description: "我的自定义命令",
  handler: async (args, context) => {
    /* ... */
  },
});

// 重新加载自定义命令
await agent.reloadCustomCommands();

// 获取自定义命令
const cmd = agent.getCustomCommand("my-command");
const allCmds = agent.getCustomCommands();
```

## Bash 模式命令 {#bash-mode}

直接执行 Shell 命令，输出以 user 消息 bash tool block 形态注入对话（不触发 AI 回复）：

```typescript
await agent.bang("ls -la");
```

## SSO 认证 {#sso}

通过 `AuthService` 单例管理 SSO 认证流程：

```typescript
import { AuthService } from "wave-agent-sdk";

const auth = AuthService.getInstance();

// 设置服务端地址
auth.setServerUrl("https://wave-admin.example.com");

// 监听认证状态变化
const unsubscribe = auth.onAuthChange((event) => {
  console.log("Auth event:", event); // "login" | "logout"
});

// 检查认证状态
const isLoggedIn = auth.isLoggedIn();
const token = auth.getToken();
```

认证优先级：`AgentOptions.serverUrl` > `WAVE_SERVER_URL` 环境变量。

## 提示历史 {#prompt-history}

```typescript
import { PromptHistoryManager } from "wave-agent-sdk";
```

`PromptHistoryManager` 管理用户输入历史，支持上下箭头回忆。

## Git 工具 {#git-utils}

SDK 导出一组 Git 操作工具函数：

```typescript
import {
  isGitRepository, // 检查是否为 git 仓库
  getGitRepoRoot, // 获取仓库根目录
  getGitCommonDir, // 获取 .git 目录
  getGitMainRepoRoot, // 获取主仓库根目录（worktree 感知）
  resolveGitDir, // 解析 git 目录
  getDefaultRemoteBranch, // 获取默认远程分支
  hasUncommittedChanges, // 检查未提交更改
  hasNewCommits, // 检查新提交
} from "wave-agent-sdk";
```

## 文件搜索 {#file-search}

```typescript
import { fileSearch } from "wave-agent-sdk";
```

提供高性能文件搜索能力，支持 glob 模式和内容搜索。

## 计划模式 {#plan-mode}

```typescript
// 获取计划文件路径
const planPath = agent.getPlanFilePath();
```

计划模式下 Agent 专注于设计方案，限制文件修改操作。通过 `EnterPlanMode` / `ExitPlanMode` 工具切换。

## Worktree 管理 {#worktree}

```typescript
// 触发 worktree 移除钩子
await agent.triggerWorktreeRemoveHook("/path/to/worktree");
```
