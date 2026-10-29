---
title: 权限模式与环境变量
description: 权限模式的语义与切换方式，以及 CLI 读取的环境变量
---

# 权限模式与环境变量

Wave 提供五种权限管理模式，控制 AI 调用工具时的确认行为：

| 模式                | 描述                                            |
| ------------------- | ----------------------------------------------- |
| `default`           | 受限工具需要用户确认，最安全的模式              |
| `acceptEdits`       | 自动接受文件编辑操作，其他工具仍需确认          |
| `bypassPermissions` | 自动接受所有工具调用，无需任何确认（危险）      |
| `plan`              | 计划模式，AI 只能修改计划文件，适合项目规划阶段 |
| `dontAsk`           | 自动拒绝受限工具，AI 不会请求确认也不会执行     |

**切换方式：**

- 交互模式中按 `Shift+Tab` 循环切换
- 启动时通过 `--permission-mode` 指定
- 使用 `--dangerously-skip-permissions` 等同于 `bypassPermissions`

**默认自动放行的只读命令：**

`default` 模式下，以下只读 git 命令默认直接执行、不触发权限确认：`git status`、`git diff`、`git log`、`git show`、`git branch`（含 `--list` / `-a` / `-r` / `-v` 等变体）、`git tag`、`git remote`、`git ls-files`、`git rev-parse`、`git config --list`、`git cat-file`、`git count-objects`。命令带全局作用域参数（如 `git -C <path> status`、`git --work-tree <path> diff`）时同样匹配自动放行；写操作（`git push`、`git commit`、`git branch -D` 等）不受影响，仍按正常权限流程确认。

---

## 环境变量 {#environment-variables}

| 变量           | 默认值                 | 描述                                                                       |
| -------------- | ---------------------- | -------------------------------------------------------------------------- |
| `LOG_LEVEL`    | `INFO`                 | 日志级别：`DEBUG`、`INFO`、`WARN`、`ERROR`                                 |
| `LOG_KEYWORDS` | -                      | 日志关键词过滤，仅输出包含指定关键词的日志                                 |
| `LOG_FILE`     | `~/.wave/logs/cli.log` | 日志文件路径（桌面端/IDE 插件分别为 desktop.log/vscode.log/jetbrains.log） |

> 了解更多：详见 [SDK 文档 - 环境变量](/sdk/settings#settings-env)
