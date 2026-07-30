# Wave 桌面版

Wave 桌面版是一个独立的 Electron 应用，无需安装 IDE 即可使用 Wave 代码智聊。它复用与 IDE 插件完全相同的聊天界面，通过 stdio 连接内置的 CLI 后端。

> 核心交互（对话、工具调用、权限确认、斜杠命令、配置等）与 IDE 插件完全一致，请参考 [VS Code 扩展 / JetBrains 插件](/vsce) 文档。本页只介绍桌面版独有的功能。

## 下载与安装

桌面版安装包随版本发布到 [GitHub Releases](https://github.com/netease-lcap/wave-agent/releases)（与 VS Code 扩展、JetBrains 插件同一发布页）：

| 平台 | 文件 |
| --- | --- |
| macOS（Apple Silicon） | `Wave-*-arm64.dmg`（或 `*-arm64-mac.zip`） |
| Windows | `Wave Setup *.exe` |

注意事项：

- **macOS 未签名**：首版未做 Apple 代码签名，首次打开需在「访达」中右键应用图标选择「打开」，或在「系统设置 → 隐私与安全性」中点击「仍要打开」。
- **需要 Node.js ≥ 20**：应用通过 npm 自动安装/升级内置 CLI 后端；机器上没有 Node.js 时应用会给出安装引导。

## 与 IDE 插件的差异

| 能力 | IDE 插件 | 桌面版 |
| --- | --- | --- |
| 工作目录 | 跟随 IDE 打开的项目 | 应用内自选（见下文） |
| 会话历史 | 会话列表弹窗 | 侧边栏二级会话树 |
| 启动行为 | 恢复上次会话 | 每次全新开始 |
| 运行依赖 | VS Code / JetBrains | 无（独立窗口） |

## 首次启动：选择工作目录

每次启动都是全新开始 —— 不记住上次的工作目录和会话。未选择工作目录时，输入区（含 +、斜杠、权限、发送按钮）整体禁用，侧边栏展示会话树的目录分组（默认全部展开）：

![首次启动](/screenshots/desktop-first-launch.png)

在输入框左上角点击「选择工作目录…」，从最近打开列表中挑选，或点击「浏览…」打开系统目录选择器：

![工作目录下拉](/screenshots/desktop-workdir-dropdown.png)

- 最近打开列表最多保留 10 个目录，按最近使用排序；hover 条目可点 × 移除
- 选择目录后输入区立即解锁，该目录置顶到最近列表
- 工作目录选择器只在新会话（还没有消息）时显示；会话开始后如需换目录，点击侧边栏「新对话」或直接在会话树中切换

## 侧边栏会话树

侧边栏以二级树展示会话历史，无需打开弹窗即可跨目录切换会话：

- **一级**：目录分组，可折叠/展开；启动时默认全部展开
- **二级**：每个目录下最近 5 条会话，按最近活跃排序
- **运行中标识**：正在生成回复的会话前显示绿色圆点

![会话树](/screenshots/desktop-session-tree.png)

点击分组标题即可折叠/展开：

![会话树折叠](/screenshots/desktop-session-tree-collapsed.png)

点击会话的行为：

- 当前目录下的会话 → 直接在当前窗口恢复
- 其他目录下的会话 → 自动切换工作目录后恢复该会话

悬停会话条目可点击删除图标删除会话，删除前会弹出应用内确认对话框；worktree 会话会额外提示将一并删除 worktree 目录与临时分支：

![删除会话确认对话框](/screenshots/desktop-confirm-delete.png)

## localhost 原型预览与元素评论

让 agent 启动本地开发服务器（如 Vite 原型）后，点击消息中的 localhost 链接（`localhost`、`127.0.0.1`、`[::1]`，任意端口）会在窗口右侧打开预览面板，而不是跳转外部浏览器 —— 边对话边看原型：

![原型预览面板](/screenshots/desktop-preview-pane.png)

- 非 localhost 的 http(s) 链接仍用系统默认浏览器打开
- 面板工具栏提供：地址显示、元素拾取开关、刷新、「在浏览器打开」、关闭；面板宽度可拖拽调整
- 再点击其他 localhost 链接会在同一面板内导航；dev server 热更新会自动反映 agent 的改动

点击工具栏左侧的「元素拾取」开关进入拾取模式：鼠标悬停的元素显示高亮轮廓，页面自身的点击、跳转、表单提交会被拦截：

![元素拾取](/screenshots/desktop-preview-picker.png)

点击目标元素后，旁边弹出评论卡片，写下要改什么，回车或点击右下角的添加图标把这条评论连同元素上下文追加到下方的输入框；点击卡片外空白处可取消并重新选择：

![元素评论](/screenshots/desktop-preview-comment.png)

评论不会立刻发送给 agent，而是追加到消息列表下方的输入框，方便你连续拾取多个元素、逐条积累评论后统一编辑、一起发送。拾取模式保持开启，可以继续点选下一个元素；提交内容包含页面 URL、元素 CSS 选择器、元素摘要与你的评论文本，agent 据此精确理解「指的是哪里」并修改原型。再次点击拾取开关退出拾取；页面导航或刷新后拾取自动重置为关闭。

![评论追加到输入框](/screenshots/desktop-preview-comment-input.png)

## 核心交互

对话体验与 IDE 插件一致 —— 思考过程、工具调用、权限确认、斜杠命令、消息队列、图片粘贴等全部可用：

![核心交互](/screenshots/desktop-chat.png)

详细说明请移步：

- [基础对话与 AI 思考过程](/vsce#basic-chat)
- [斜杠命令与文件建议](/vsce#slash-commands)
- [权限模式管理](/vsce#permission-modes)
- [配置设置](/vsce#configuration-settings)

## 登录

桌面版支持 SSO 登录，复用与 IDE 插件相同的登录按钮与登录对话框；授权页面会在系统默认浏览器中打开，登录流程由内置 CLI 子进程完成。登录为可选项 —— 未登录时也可通过自定义配置（API Key / Base URL）直连模型服务。
