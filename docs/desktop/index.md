---
title: CodeWave IDE 桌面端
description: 桌面端概览与快速开始：安装、打开项目、智能输入；其余能力按主题分页
---

# CodeWave IDE 桌面端

桌面端把 CLI 的 agent 能力包进一个能看文件、看终端、看预览的图形界面。本页是快速开始，各能力按主题拆到下面几页。

## 按主题查看 {#topics}

| 主题                                                        | 内容                                                      |
| ----------------------------------------------------------- | --------------------------------------------------------- |
| [面板介绍](/desktop/panels)                                 | 会话区、侧边栏、文件面板、终端与预览各区域的作用与切换    |
| [对话、模型与上下文](/desktop/conversation)                 | 发消息与流式回复、模型选择、上下文占用与压缩              |
| [代码理解与权限](/desktop/code-and-permissions)             | 内置工具怎么读改代码，以及权限模式与安全区域如何放行      |
| [任务、多 Agent 与子代理](/desktop/tasks-and-agents)        | 任务列表、多会话并发、后台子代理与并发上限                |
| [技能、记忆与工作流](/desktop/skills-memory-workflow)       | 内置技能、AGENTS.md 记忆与 Workflow 工作流                |
| [自动化：钩子与定时任务](/desktop/automation)               | Hooks 生命周期钩子与 loop 定时循环任务                    |
| [编程辅助：SDD、原型预览与产物分享](/desktop/coding-assist) | 规格驱动开发、Localhost 原型预览与元素评论、Artifact 产物 |
| [扩展：MCP 与插件](/desktop/extensions)                     | MCP 服务器接入与插件市场、插件作用域                      |
| [设置](/desktop/settings)                                   | 账户卡片、全局设置、个性化、项目设置与更新                |

## 安装 CodeWave IDE 桌面端

登录企业运营平台，「产品下载」页面下载对应操作系统的安装包（macOS / Windows）。

![产品下载](/guide/product-download.webp)
_产品下载页面_

## 打开项目

### 1）导入本地文件夹

选择本地，选择工作目录 --> 点击"浏览"，打开本地文件夹；从本地选择一个文件夹并打开。

- 最近打开列表最多保留 10 个目录，按最近使用排序；hover 条目可点 × 移除
- 会话开始后如需换目录，点击侧边栏「新对话」或直接在会话树中切换
- 从选择器选定任意目录（最近打开列表项、「浏览…」选定的本地目录，或远程目录浏览面板确认的远端目录）**一律开始一个全新会话**，不会复用该目录下已存在的会话；要回到某条已有会话，请走侧边栏会话树

![工作目录选择](/screenshots/desktop-workdir-dropdown.webp)

### 2）连接SSH远程主机

点击"添加主机"，输入主机地址，接受 `ssh user@hostname -p port` 形式的连接串，连接成功后点击"浏览"，选择文件夹。

整个 CLI 子进程经 `ssh <host> -- wave --stdio` 在远端执行，agent 的读写、搜索、bash、git 等全部工具天然作用在远端文件系统，体验与 VS Code Remote-SSH 一致。

![主机选择器](/screenshots/desktop-ssh-host-selector.webp)

![添加主机](/screenshots/desktop-ssh-add-host.webp)

![远程目录浏览](/screenshots/desktop-remote-dir-browser.webp)

连接远端主机后，右侧面板同样作用在远端机器上：终端面板跑的是远端 shell 的 PTY，差异面板读的是远端工作区的 git 状态，都不需要先把代码同步到本地。

![远端终端面板](/screenshots/desktop-ssh-remote-terminal.webp)

![远端差异面板](/screenshots/desktop-ssh-remote-diff.webp)

### 3）工作目录为git仓库

当你选择的工作目录是 git 仓库、且处于新会话状态（消息列表为空）时，工作目录选择器旁会显示分支选择器与「worktree」勾选项，让你在基于所选分支创建的临时 worktree 中开会话，并行试验而不污染主工作区。

![worktree 控件](/screenshots/desktop-worktree-controls.webp)

![worktree 分支选择](/screenshots/desktop-worktree-branches.webp)

## 智能输入

### 1）图片/文件输入

- 点击"+"图标，选择上传文件，可以选择图片/文件上传。
- 可通过 Ctrl/Cmd+V 在对话输入框内粘贴剪贴板中的图片。
- 点击图片标签，可直接预览图片。

![添加菜单](/screenshots/desktop-plus-menu.webp)

### 2）指令输入

通过输入 `/`，用户可以快速调用预设的指令，如 `/explain`、`/fix` 等提高操作效率。

![指令菜单](/screenshots/desktop-slash-commands.webp)

### 3）@提及

通过输入 `@`，用户可以轻松地将项目中的文件添加到对话上下文中。标签会内联显示在输入框和消息中。

![@提及标签](/screenshots/desktop-inline-mentions.webp)

### 4）快捷终端命令

用户可以通过在输入框中以 `!` 开头直接执行终端命令。这允许用户在不离开聊天界面的情况下快速执行系统操作、运行脚本或检查环境。

- **快速触发**：只需在命令前加上 `!` 即可触发，如 `!ls -la`。
- **实时输出**：命令执行过程中的输出会实时显示在专用的 Bang 块中，风格与 AI 触发的终端工具保持一致。
- **状态反馈**：通过图标直观展示命令的运行状态（运行中、退出代码等）。
- **可中止性**：对于长时间运行的命令，用户可以点击"停止"按钮随时中止执行。

![快捷终端命令](/screenshots/desktop-bang-command.webp)

### 5）旁路提问

`/btw <question>` 向 AI 快速提问，AI 不会调用任何工具，仅基于已有上下文直接回答。适合快速确认思路或获取解释，不产生工具调用开销，也不会进入聊天历史。

- **旁路面板**：发送 `/btw` 后，问题与答案显示在输入框上方的独立面板中，不插入消息列表，聊天上下文不受干扰。
- **Markdown 渲染**：答案支持 Markdown 格式（代码块、列表、加粗等），面板内可滚动查看长内容。
- **随时关闭**：按 Esc 或点击面板右上角关闭按钮即可收起面板；关闭后迟到的回答会被丢弃。
- **错误提示**：接口异常时面板内显示 `(API error: ...)` 提示。

![旁路提问面板](/screenshots/desktop-btw-panel.webp)
