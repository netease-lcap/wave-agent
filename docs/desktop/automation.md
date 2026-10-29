---
title: 自动化：钩子与定时任务
description: Hooks 生命周期钩子与 loop 定时循环任务
---

# 自动化：钩子与定时任务

## 钩子（Hooks）

钩子（Hooks）是把自动化脚本挂在 Wave 生命周期事件上：事件触发时自动执行命令，实现"无需人工干预的自动化"。配置在 settings.json 的 hooks 字段，修改后实时生效。

### 1）支持的事件

| 事件名称          | 触发时机                                                         |
| ----------------- | ---------------------------------------------------------------- |
| PreToolUse        | 工具执行前（可用于校验、拦截或预处理）                           |
| PostToolUse       | 工具执行完成后（可用于后处理或日志记录）                         |
| UserPromptSubmit  | 用户提交 Prompt 时                                               |
| PermissionRequest | Wave 请求工具权限时                                              |
| Stop              | Wave 完成响应周期（无更多工具调用）时                            |
| SubagentStop      | 子代理完成响应周期时                                             |
| WorktreeCreate    | 创建新 worktree 时                                               |
| WorktreeRemove    | 删除 worktree 之前触发（通知型，非阻塞，可读取 worktree 内文件） |
| SessionStart      | 会话开始时（来源：startup/resume/compact）                       |
| SessionEnd        | 会话结束时（来源：exit/stop/compact）                            |
| CwdChanged        | 工作目录变化时（如进入/退出 worktree，非阻塞）                   |
| PreCompact        | 压缩前触发（stdout 作为附加指令合并进压缩 prompt）               |
| PostCompact       | 压缩完成后触发（接收压缩摘要文本）                               |

### 2）配置结构

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          {
            "command": "echo '{\"hookSpecificOutput\": {\"hookEventName\": \"SessionStart\", \"additionalContext\": \"项目规范：原型必须单文件 HTML，主色 #4A90D9，端口 8899\"}}'",
            "description": "会话启动时注入项目规范"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "command": "echo \"[$(date)] Write tool: $(cat | jq -r '.tool_input.file_path')\" >> /tmp/hooks.log",
            "description": "记录每次文件写入"
          }
        ]
      }
    ]
  }
}
```

要点：

- **模式匹配**：支持通过 matcher 匹配工具名（如 Write、Read\*、/^Edit/），适用于 PreToolUse、PostToolUse 和 PermissionRequest。
- **异步执行**：支持 async 字段配置后台异步执行，避免阻塞工作流。
- **超时控制**：支持 timeout 字段设置最大执行时间（默认 600 秒）。
- **退出码控制**：0=成功继续；2=阻塞错误，阻止操作；其他=非阻塞错误，继续但显示警告。
- **输入上下文**：Wave 通过 stdin 向钩子进程传递 JSON 格式的详细信息。
- **热加载**：配置文件修改后即时生效，无需重启 Wave。

**退出码控制行为**

- 0：成功，正常继续
- 2：阻塞错误（PreToolUse 会阻止工具执行并反馈；UserPromptSubmit 会拦截该消息）
- 1：非阻塞警告，继续执行

**配置位置**

- 项目级 `.wave/settings.json`（团队共享）
- 用户级 `~/.wave/settings.json`（个人习惯）
- 本机覆盖 `.wave/settings.local.json`（不提交 git，适合个人机器专属钩子）

![钩子设置页](/screenshots/desktop-settings-hooks.webp)

## 定时循环任务（loop）

`/loop` 是定时循环执行指令的命令：间隔到达时自动再次执行，适合轮询、监控、定期检查。

### 1）基本用法

`/loop [间隔] <要执行的指令>`

- 间隔格式：5m（分钟）、2h（小时）、1d（天），最小粒度 1 分钟；不写间隔默认 10 分钟。

三种写法（自动解析）：

| 写法                     | 解析结果                         |
| ------------------------ | -------------------------------- |
| /loop 5m /check          | 前导间隔 → 每 5 分钟执行 /check  |
| /loop 检查部署 every 20m | 尾部 every 从句 → 每 20 分钟执行 |
| /loop 检查部署           | 默认 → 每 10 分钟执行            |

实际示例：

- `/loop 5m 检查 http://127.0.0.1:8899 是否正常返回，异常时报告`
- `/loop 30m /standup 1`
- `/loop 1h 检查是否有新的失败测试`
- `/loop 检查磁盘空间`（默认 10 分钟）

### 2）执行行为

- **立即执行一次**：安排后马上先跑一遍，不等第一个周期
- **周期触发**：按 cron 表达式循环，每次在 Wave 空闲时执行
- **7 天自动过期**：到期前最后执行一次后自动删除
- **随时取消**：告诉我要取消，会返回 job ID 用 CronDelete 删除

### 3）注意事项

- 间隔会转为 cron 表达式；无法整除的间隔（如 7 分钟）会自动就近取整并告知你
- 避免整点/半点（:00/:30）触发，除非你指定精确时刻
- 循环只在本会话有效，退出 Wave 即停止（如需持久化可设置 durable）
