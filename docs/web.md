# Web 端（远程控制）使用文档

Web 端不需要安装任何客户端：电脑上跑着 agent，手机或电脑的浏览器打开一个地址就能接管——看进度、批审批、接着对话。页面与桌面端、IDE 插件共用同一套会话与产物，切过去不会打断正在跑的任务。

## 快速入门

1. **电脑侧开启远程控制**：在桌面端、VS Code / JetBrains 插件或 CLI 会话里执行 `/remote-control`（或从设置页进入「远程控制」），页面上给出**页面地址**与**二维码**。
2. **手机打开页面**：扫码或用浏览器打开地址，用企业账号登录（登录态过期会在页面内就地续期，不用重新扫码）。
3. **添加到主屏幕（推荐）**：像 App 一样全屏使用，也是开启锁屏通知的前提。

<figure class="doc-figure"><img src="/screenshots/desktop-remote-control.webp" alt="电脑侧设置页的远程控制项" /><figcaption>电脑侧：设置页 → 远程控制，页面地址与二维码都在这里</figcaption></figure>

## 手机上的界面

顶栏只有四个入口，都对应手机上真正用得上的动作：**新建对话**（在电脑上另起一条会话）、**会话**（电脑上的会话列表）、**切换电脑**、**更多**（通知开关、企业管控台、帮助文档）。

<div class="phone-gallery">

<figure><img src="/screenshots/web-chat.webp" alt="手机上的对话页" /><figcaption>对话页：顶栏 + 实时流式输出</figcaption></figure>

<figure><img src="/screenshots/web-session-list.webp" alt="会话列表" /><figcaption>会话列表：状态点、可搜可删</figcaption></figure>

</div>

### 会话列表

顶栏「会话」打开电脑上的会话列表：每行是标题、项目目录与最近活跃时间，可以按关键词搜索；行尾的「⋯」放重命名与删除。

每条会话前面的状态点只有一个，按优先级取最高的那一种：

- 🟡 **等待确认**：这条会话卡在审批上，等你处理
- ⏳ **运行中**：正在生成
- 🔵 **有后台任务在跑**：前台回合结束，后台任务还在转

删除建在 worktree 里的会话时，会先读一次改动、把「有未提交改动」说清楚；正在回答的会话还要额外勾一句确认，避免误删正在跑的东西。

<div class="phone-gallery">

<figure><img src="/screenshots/web-session-actions.webp" alt="会话行级动作" /><figcaption>行级动作：重命名 / 删除会话</figcaption></figure>

<figure><img src="/screenshots/web-new-session.webp" alt="新建会话" /><figcaption>新建会话：选目录、基于分支、可开 worktree</figcaption></figure>

</div>

### 审批在手机上一样能批

命令、文件改动（带 diff）、计划，都在手机上以确认卡片的形式弹出。计划审批有一处专门的差异：**计划正文直接渲染在确认对话框里**——手机上没有编辑器列、也没有面板，计划正文是批准与否的唯一依据，所以不把它藏到别处去。

<div class="phone-gallery">

<figure><img src="/screenshots/web-approval.webp" alt="命令审批" /><figcaption>命令审批</figcaption></figure>

<figure><img src="/screenshots/web-plan-approval.webp" alt="计划审批（正文内联）" /><figcaption>计划审批：正文内联在对话框</figcaption></figure>

</div>

### 更多菜单

「更多」菜单里可以开启**锁屏通知**——会话跑完了、或者卡在审批上等你处理，手机会推一条通知。通知需要先把页面添加到主屏幕并允许权限。

<div class="phone-gallery phone-gallery--single">

<figure><img src="/screenshots/web-more-menu.webp" alt="更多菜单" /><figcaption>更多菜单：通知开关</figcaption></figure>

</div>

## 多台电脑

同一账号下可以有多台电脑登记为远程主机。顶栏「切换电脑」列出全部机器与在线状态，选一台就切过去；每台机器的页面地址相同，扫码 / 打开地址时选的是机器。

<div class="phone-gallery phone-gallery--single">

<figure><img src="/screenshots/web-machine-picker.webp" alt="选择要连接的电脑" /><figcaption>「切换电脑」：同一账号下的机器与在线状态</figcaption></figure>

</div>

## 断线与恢复

连接断了不需要重新扫码：页面顶部给出状态横幅（「电脑侧不在线，等待上线…」），并按指数退避自动重连；手机从后台回到前台、或从浏览器缓存里恢复时，也会立刻重连一次。真连不上时横幅上有「重新连接」与「换机器」两个动作。

前台回合跑到一半断线不会丢内容：重连后页面重新拉齐这条会话的快照（正在跑的那一轮继续推）。往上翻到更早的消息时按需分页加载。

## 能力边界

页面可操作的是这台机器上的**会话**，而非那台电脑的**界面**。以下能力目前在 Web 端暂未开放，多数已在后续计划中：

- **设置页**：Web 端暂未开放，配置修改请在桌面端 / VS Code / JetBrains 插件里完成。
- **插件市场、技能、子代理、钩子、MCP 服务**：电脑侧已具备上述能力，页面侧的管理视图待补充。
- **diff / 文件 / 预览面板**：需以整页或抽屉视图承载，尚在排期中。
- **上传文件**：电脑端自磁盘读取后上传，手机端需改为「浏览器读取文件 → 传输至电脑」的链路。
- **当前形态不适配**：打开本地文件（无编辑器可跳转）、终端（不开放远端 shell）、页面内登录退出（退出将注销该电脑）。

一项能力需同时满足「电脑侧提供方法」与「页面侧提供入口」才会呈现，缺一则不渲染入口。少数动作会额外确认一次，因其影响落在该电脑上：切换模型、rewind、`/clear`。
