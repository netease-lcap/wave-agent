---
title: Wave Code CLI
description: CLI 概览：三种运行模式、命令行选项，以及指向子命令与斜杠命令的分页目录
---

# Wave Code CLI

基于 React Ink 构建的 CLI 终端界面，提供交互式 AI 编程助手体验。

## 按主题查看 {#topics}

| 主题                                   | 内容                                                        |
| -------------------------------------- | ----------------------------------------------------------- |
| [子命令](/cli/subcommands)             | 插件市场、插件操作与 daemon 后台会话的全部子命令与退出码    |
| [斜杠命令](/cli/slash-commands)        | 交互式 TUI 里可用的斜杠命令清单与用途                       |
| [键盘快捷键](/cli/keyboard-shortcuts)  | 输入、编辑、历史与面板操作的快捷键                          |
| [权限模式与环境变量](/cli/permissions) | 权限模式的语义与切换方式，以及 CLI 读取的环境变量           |
| [特色功能](/cli/features)              | 安全区域、worktree、会话恢复、图像输入等 CLI 专有能力的用法 |

## 安装与启动 {#installation}

### 安装 {#install}

```bash
npm install wave-code -g
```

### 运行模式 {#run-modes}

Wave CLI 提供三种运行模式，适用于不同场景：

**交互模式**（默认）

启动基于 React Ink 的终端 UI，支持实时对话、流式输出和完整的交互体验。

```bash
wave
```

**打印模式**（`--print` / `-p`）

非交互式运行，接收输入并一次性输出结果，适用于脚本集成和自动化流水线。

```bash
wave -p "解释这个项目的架构"
echo "分析这段代码的问题" | wave -p
```

配合 `--show-stats` 可在输出末尾显示耗时和 Token 用量统计。

---

## 命令行选项 {#cli-options}

### 会话控制 {#session-options}

| 选项             | 简写 | 描述                                             |
| ---------------- | ---- | ------------------------------------------------ |
| `--restore <id>` | `-r` | 按 session ID 恢复会话；不指定 ID 则列出可用会话 |
| `--continue`     | `-c` | 自动继续上次会话                                 |

```bash
# 列出可恢复的会话
wave -r

# 恢复指定会话
wave -r <session-id>

# 继续上次会话
wave -c
```

### 模型与工具 {#model-tool-options}

| 选项                        | 描述                          |
| --------------------------- | ----------------------------- |
| `--model <name>`            | 指定 AI 模型                  |
| `--tools <list>`            | 启用的工具列表（逗号分隔）    |
| `--allowed-tools <list>`    | 始终允许的工具列表            |
| `--disallowed-tools <list>` | 始终禁用的工具列表            |
| `--mcp-config <json>`       | MCP 服务器配置（JSON 字符串） |

```bash
# 指定模型并限制工具
wave --model gpt-4o --disallowed-tools Bash,Write
```

### 权限与安全 {#permission-options}

| 选项                             | 描述                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------ |
| `--permission-mode <mode>`       | 设置权限模式：`default`、`acceptEdits`、`bypassPermissions`、`dontAsk`、`plan` |
| `--dangerously-skip-permissions` | 跳过所有权限检查（危险）                                                       |
| `--add-dir <path>`               | 将目录加入会话安全区域，可重复指定（仅当前会话生效）                           |

```bash
# 将 /data/exports 加入当前会话的安全区域
wave --add-dir /data/exports
```

### 工作目录 {#worktree-options}

| 选项                | 简写 | 描述                                 |
| ------------------- | ---- | ------------------------------------ |
| `--worktree [name]` | `-w` | 在 git worktree 中启动，可选指定名称 |

```bash
# 自动命名 worktree
wave -w

# 指定 worktree 名称
wave -w my-feature
```

### 其他 {#misc-options}

| 选项                  | 简写 | 描述                            |
| --------------------- | ---- | ------------------------------- |
| `--plugin-dir <path>` |      | 从指定目录加载插件              |
| `--show-stats`        |      | 打印模式下显示耗时和 Token 统计 |
| `--version`           | `-v` | 显示版本号                      |
| `--help`              | `-h` | 显示帮助信息                    |
