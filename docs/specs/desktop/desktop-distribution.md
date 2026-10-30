---
name: "桌面端分发与更新"
description: "CodeWave IDE 桌面端的分发与升级：内置 CLI 的随包发布与远端同步（按字节判等）、macOS/Windows 打包、自动更新状态与外置 feed、Beta 版通道"
order: 12
---

# 功能规格说明：桌面端分发与更新

> 本规格描述「应用与它的内置 CLI 如何被造出来、送到用户手上、以及在远端保持同一份」。窗口与交互外壳见 [desktop-shell.md](./desktop-shell.md)；更新按钮的界面状态机（S0–S6）见 [desktop-account.md](./desktop-account.md)「账户卡片 · 更新按钮状态机」。

## 用户场景与测试

### 用户故事：内置 CLI 一致保障（本地与远程均按内容字节判定是否同步）（优先级：P2）

作为用户，我希望本地会话始终使用随应用发布的内置 CLI，且连接远程主机时自动检测并**经 ssh 推送本机内置的同一份 CLI** 到远端，使远端运行的代码与本机内置的 `dist/bundle/wave.mjs` 字节一致，以便我始终使用受支持的后端——同步判据是**内容（sha256 字节）而非版本号**：不依赖远端 npm 上 `wave-code` 包的发布进度（GUI 可单独发版而不 bump CLI 的 npm 包号，npm 最新版可能落后于 GUI 内置 CLI，旧机制下会因 `npm install wave-code@<GUI版本>` 404 而失效），且只比较版本号会漏掉「版本号未变但代码已更新」的副本（本地 dev 重装、GUI 单独发版都可能带着新字节而版本号未 bump）。

**为什么是这个优先级**：本地 CLI 随应用安装包发布，升级应用即升级 CLI，无需运行期升级；远程主机上的 CLI 由远端 daemon 长期托管且无内置运行时，仍需在连接时保障其与 GUI 内置 CLI 保持同一份代码——内置 CLI 是单文件纯 JS bundle（`dist/bundle/wave.mjs`，esbuild 打成，跨平台），可经本机已建立的 ssh 通道直接推送，远端只需系统 Node.js >= 22 即可运行（无需 npm 装包、远端无出网也能完成 CLI 推送）；若远端副本与内置不一致（哪怕版本号相同）而 daemon 仍运行旧代码，修复与新增功能将永远不生效（例如远程会话运行状态修复），必须同步并重启 daemon。

**独立测试**：在一台未安装 Node.js 的机器上安装应用，验证本地会话直接用内置 CLI 工作；连接全新远程主机或装有与内置不一致 CLI（含「版本号相同但字节不同」的副本）的主机，验证应用经 ssh 推送内置 CLI、远端 daemon 以推送的 CLI 重启；GUI 升级但内置 CLI 字节未变时再连接，验证不推送、daemon 不重启；GUI 单独发版（wave-code 版本号未 bump）但内置字节已变时连接，验证仍推送并重启 daemon。

**验收场景**：

1. **假设**应用已安装，**当**应用启动，**则**本地会话直接使用随应用发布的内置 CLI（`resources/wave-cli/`，其 `package.json` 中的 wave-code 版本与 GUI 版本相互独立，可不同号），不执行任何 npm 安装/升级。
2. **假设**应用升级到新版本，**当**新版本应用启动，**则**本地会话使用新版内置 CLI——运行时 `~/.wave/cli/desktop/` 中 `dist/bundle/wave.mjs` 与内置 `resources/wave-cli/` 的同名文件字节（sha256）不一致时重新复制（仅替换 CLI 文件：`dist/`、入口、`package.json`），字节一致（同版本重装、或 GUI 单独发版未改 CLI）则不复制；旧 CLI 无残留运行，已缓存的运行时依赖（rg/sharp，`node_modules/`）保留、不重复下载。
3. **假设**用户连接远程主机，且远端固定目录 `~/.wave/cli/desktop/` 中 `dist/bundle/wave.mjs` 与本机内置同名文件的字节（sha256）一致，**当**连接建立，**则**直接复用该 CLI 与（可能）正在运行的 daemon，不推送、不重启；**当**远端 CLI 缺失、损坏（内容探针无法读取或算出一致的哈希）或字节与内置不一致（即使 `package.json` 的版本号相同），**则**应用必须把本机内置 CLI（`bin/wave-code.js` + `dist/bundle/wave.mjs` + `package.json`）经 ssh 写入远端临时目录后原子替换到 `~/.wave/cli/desktop/`，再连接/创建该主机的 daemon。
4. **假设**远端 CLI 升级（推送）成功且该主机旧 daemon 仍在运行（旧 daemon 运行的是升级前的代码），**当**升级完成，**则**应用必须重启该主机的 daemon（终止旧 daemon 并启动新 daemon）；重启后历史会话仍可从远端转录恢复，断线前正在进行的任务终止（与 daemon 退出的既有语义一致，不得出现幽灵「运行中」状态）。
5. **假设**远端 CLI 推送失败（ssh 中断、磁盘错误等），**当**应用检测到失败，**则**必须向用户显示可操作的错误信息与重试提示（下次连接自动重试，不得无限重试）；替换采用「临时目录写入 + 原子 `mv`」且失败不动旧目录，故运行中的旧 daemon 不受影响、可继续使用。
6. **假设**远端主机完全未安装 wave CLI（首次连接），**当**应用连接该主机，**则**必须推送与 GUI 内置 CLI 字节一致的 bundle（推送源与内容=内置 `resources/wave-cli/`，而非远端 npm registry 的 `wave-code` 包）到 `~/.wave/cli/desktop/`；**当**远端无 Node.js（或主版本低于 22），**则**必须显示安装/升级远端 Node.js 的引导信息，不得进入不可用状态。
7. **假设**应用升级到新版本但内置 CLI 的 wave-code 版本未变（GUI 单独发版，不 bump CLI），**当**用户连接远程主机，**则**以字节为准：内置 `wave.mjs` 与远端副本字节一致时不推送、不重启 daemon（无增量传输）；字节已变（构建了新的 CLI 代码但未 bump 版本号）时必须推送并重启 daemon——版本号相同不再视为「已满足」。
8. **假设**远端 CLI 已就位但其 grep 依赖 rg（`@vscode/ripgrep` JS 包装 + 平台二进制）缺失（如首次推送后），**当**远端以该 CLI 启动 daemon，**则**由远端 CLI 自己在**启动期**从 npmmirror 下载 rg 到共享 `~/.wave/cli/node_modules/@vscode/`（只需远端 Node ≥ 22 与出网，**不再要求远端安装 npm**）；下载失败不阻断 daemon 启动（grep 暂不可用、下次启动重试），CLI 推送本身不受影响（走 ssh、不经 registry）。
9. **假设**远端共享 runtime 目录全新（rg 与 sharp 都需下载，sharp 排在依赖表前面），**当**远端 daemon 启动期自装这两个依赖，**则**两者都装上、marker 记录两者，rg 在该 daemon 进程内立即可用（远端会话的 Grep 正常工作）——不得出现「rg 文件已落盘却报 ripgrep is not available、且该 daemon 生命周期内不自愈」的状态。

---

### 用户故事：跨平台分发（优先级：P2）

作为团队，我希望 desktop 应用能打包为 macOS（arm64）和 Windows 安装包，以便覆盖主要用户平台。

**为什么是这个优先级**：分发能力决定功能是否能到达用户。

**独立测试**：在 CI 或本地分别打出 macOS arm64 与 Windows 包，安装后验证启动与会话功能。

**验收场景**：

1. **假设**配置了 electron-builder，**当**执行打包命令，**则**必须生成 macOS arm64 与 Windows 安装产物。
2. **假设**应用依赖 native node 模块，**当**在 macOS 上打包 Windows 产物失败，**则**必须先通过 CI matrix 调研解决，再实现打包流程。

---

### 用户故事：桌面端自动更新（优先级：P1）

作为用户，我希望桌面应用检测到新版本后按我的节奏完成下载与重启安装，以便我无需手动访问下载页面即可获得修复与新功能，也不会在操作中途被强制重启打断。

**为什么是这个优先级**：应用更新是修复与功能到达用户的唯一通道；现状仅「提示 + 给下载 URL」，用户不主动访问下载页就拿不到修复。macOS 签名 + 公证已就绪（ed2d9bf7 + 6f00c44a），自动更新链路可以端到端闭环。企业版用户登录后 serverUrl 已知，更新源（codechat 的 file-center 更新元数据）运行时注入，构建期不写死。**交互承载已裁决（2026-09-03）**：删除 toast 自动下载/重启提醒链路，由账户卡片「更新按钮状态机 S0–S6」（见 [desktop-account.md](./desktop-account.md)「账户卡片 · 更新按钮状态机 S0–S6」故事）全权接管——检测发现新版本只把状态推为 idle（卡片出现「更新」按钮），下载须经用户在 S2 确认框确认，下载完成自动弹 S4 重启确认。本故事仅约束**更新源 / 分发 / 降级边界**，按钮文案、对话框步骤与状态流转语义不在此重复。

**独立测试**：登录后触发检查，验证「发现更新（S1）→ S2 确认下载（S3 下载中禁用）→ 就绪自动弹重启确认（S4）→ 立即重启（S6 复位 + quitAndInstall）」全流程（按钮语义按 [desktop-account.md](./desktop-account.md)「账户卡片 · 更新按钮状态机 S0–S6」故事断言）；无 serverUrl 时验证不触发任何更新检查（启动自动检查静默、手动检查提示登录）；下载失败时验证按钮恢复「更新」可重试（不弹手动下载页 toast）；更新端点故障时验证手动检查给「检查更新失败」提示、自动检查（启动与轮询）静默；应用持续运行跨过一个轮询间隔时验证按间隔再次自动触发检查（自动、静默），且不自动下载。

**验收场景**：

1. **假设**用户已登录企业版（存在 serverUrl），**当**应用触发更新检查，**则**必须通过 electron-updater 的 generic provider 查询更新元数据——feed 目录按当前 updateChannel 运行时注入：updateChannel=stable（默认）查 `serverUrl/api/downloads/desktop/{mac|win}/`，updateChannel=beta（「接收 Beta 版更新」开启，见下文故事）查 `serverUrl/api/downloads/desktop-beta/{mac|win}/`（均按当前平台区分 mac/win）；不得再查询 GitHub Releases。
2. **假设**用户未登录（无 serverUrl），**当**应用触发更新检查，**则** updateChannel 不生效，且不得执行任何更新检查：不得启动 electron-updater、不得查询 GitHub Releases（2026-09-09 拍板：未登录不查更新——曾有的 GitHub 回退手动提示链路与 checkForUpdate/updateChecker 代码一并删除），启动自动检查保持静默、手动检查提示「登录后可检查更新」；本地会话与其它功能不受影响。应用内 toast 基建保留（位置/形态与配色路由见 [desktop-settings.md](./desktop-settings.md)「设置页反馈语义」——应用级提示为顶部居中新形态），仅用于信息提示（登录引导、下载完成等），不再承载任何更新发现/下载/重启提醒。
3. **假设**已登录企业版且检查发现新版本，**当**收到 update-available 事件，**则**不得自动开始后台下载，必须把更新状态置为 idle 并随 `desktopAccountInfo` 推送——账户卡片个人信息行右侧出现「更新」按钮（S1）；是否下载由用户在 S2 确认框决定（2026-09-03 裁决：账户卡片不提供更新 toast，toast 自动下载链路已删除）。
4. **假设**用户在 S2 确认下载，**当** webview 下发 `desktopUpdateDownload` 命令，**则**宿主必须先把更新状态置为 downloading 并推送（卡片按钮转「正在下载更新…」并禁用，防重复下载，S3），再调用 electron-updater 开始后台下载；**当**下载完成收到 update-downloaded 事件，**则**必须把状态置为 ready 并推送（S4）——webview 据此自动弹出「重启应用」确认框（仅一次），选「稍后」后按钮转常驻「重启」（S5）。
5. **假设**更新服务故障（端点不可达 / 元数据解析失败 / 下载失败 / downloadUpdate 抛错），**当**下载失败且状态为 downloading，**则**必须把状态回退为 idle 并推送——卡片按钮恢复「更新」，用户可重新走 S2 重试（见 [desktop-account.md](./desktop-account.md)「账户卡片 · 更新按钮状态机 S0–S6」场景 8），不得静默失败也不得弹手动下载页 toast；**当**失败发生在已就绪（ready）之后的安装阶段，**则**不得把状态降级（重启时机由用户决定，避免把已就绪更新重置回可下载造成重复下载），仅记录日志；**当**失败发生在尚未发现更新的检查阶段，**则**自动检查（启动与轮询）静默、手动检查给出「检查更新失败，请稍后重试」提示。
6. **假设**用户触发手动检查（`checkForUpdates` 命令），**当**检查执行，**则**必须复用本故事场景 1-5 链路：已登录走 electron-updater（按当前 updateChannel 对应 feed 查询；无更新时 toast 提示按 updateChannel 区分，stable 见「接收 Beta 版更新」场景 5、beta 提示「当前已是最新版本」）；未登录按场景 2 不执行检查，toast 提示「登录后可检查更新」。
7. **假设**已登录企业版且 electron-updater 返回更新信息，**当**更新下载执行，**则**必须使用更新元数据中的真实文件入口下载安装包，不得指向 manifest.json / feed 目录自身。
8. **假设** macOS 上应用运行于不可写位置（如非 /Applications），**当** S6 重启安装无法原地完成，**则**安装失败经 electron-updater error 事件上报，宿主按场景 5 处理（ready 态错误不降级、记录日志），用户仍可稍后再次执行重启安装或经手动渠道获取安装包，不得自动弹窗打断当前工作。
9. **假设**构建安装包（mac/win），**当**electron-builder 打包完成，**则**产物 `resources/app-update.yml` 必须存在（afterPack 写入 `updaterCacheDirName`）——electron-updater 下载前会读取该文件（`configOnDisk`），缺失时下载阶段抛 ENOENT 并降级为下载页提示（修复：构建未声明 publish 配置时 electron-builder 不生成该文件）。
10. **假设**用户在 S4 确认框选「立即重启」或点击 S5「重启」按钮，**当** webview 下发 `desktopUpdateRestart` 命令，**则**宿主必须立即复位更新状态并推送（按钮消失，S6）后调用 quitAndInstall 退出并安装新版本（Windows 静默安装 + `--force-run` 装完自动重启，不再弹二次确认对话框）。重启安装前应用即将退出，无需任何 toast/加载态反馈——按钮消失即反馈（toast 加载链路已随 2026-09-03 裁决删除）。
11. **假设**应用已登录企业版且持续运行（不退出、不重启），**当**运行期跨过固定的检查间隔（首版 1 小时），**则**宿主必须再次自动触发更新检查（非手动，与启动自动检查同一路径：按当前 updateChannel 查对应 feed，见场景 1；未登录按场景 2 不执行检查，静默）；该轮询只负责「查」，仍必须遵守场景 3 的约束不得自动开始后台下载、不得自动安装——发现新版本只把更新状态置 idle 并随 `desktopAccountInfo` 推送（账户卡片出现「更新」按钮，S1），下载与重启由用户走 S2–S6；轮询检查失败按场景 5 静默处理（等同启动自动检查），不影响后续轮询；应用退出（dispose）后必须停止轮询，不得留下悬挂定时器。轮询发现新版本后的表现与手动检查完全一致。

---

### 用户故事：接收 Beta 版更新（设置项）（优先级：P1）

作为已登录企业版的桌面端用户，我希望在设置页「全局设置」的「桌面端设置」区块（2026-09-08 拍板：与「主题」一道从「基础设置」拆出独立成区）中开启「接收 Beta 版更新」，以便提前试用通过 codechat 下载管理测试通道分发的版本。

**为什么是这个优先级**：版本模型 S1（每构建 Z+1、三端同号，beta/正式仅靠分发通道区分）下，桌面 beta 与正式同源——codechat 下载管理加 channel（vusion/codechat #33），客户端差异仅为 feed 目录（`desktop-beta/` vs `desktop/`）。开关是桌面端接触测试版本的唯一入口，默认关闭（stable），正式用户不受影响；未登录用户无 serverUrl、本就无 codechat feed，开关置灰与 beta 无交集。

**独立测试**：登录后开启「接收 Beta 版更新」→ 手动检查命中 `desktop-beta` feed 的更高版本并进入账户卡片 S0–S6 全流程；关闭 → 切回 stable feed，正式未追平已装测试版号时手动检查提示等待、不降级；未登录时开关置灰不可切换、不触发任何更新检查。

**验收场景**：

1. **假设**桌面端用户打开设置页「全局设置」，**当**查看其下「桌面端设置」区块，**则**必须显示「接收 Beta 版更新」开关（默认关闭 = updateChannel=stable）；VSCE/JetBrains 设置页不得显示该区块与该行（仅桌面端渲染）。
2. **假设**用户未登录企业版（无 serverUrl），**当**查看「接收 Beta 版更新」开关，**则**开关必须置灰不可切换并说明原因（如「登录后可接收测试版更新」）；更新检查按「桌面端自动更新」场景 2 不触发（未登录不查更新），与 beta feed 无交集。
3. **假设**已登录且开关关闭（updateChannel=stable），**当**用户开启「接收 Beta 版更新」，**则**宿主必须把 updateChannel 置为 beta 并持久化（重启后保持），并立即按 `serverUrl/api/downloads/desktop-beta/{mac|win}/` 重查一次——发现更高版本则进入账户卡片更新按钮状态机 S0–S6（见 [desktop-account.md](./desktop-account.md)「账户卡片 · 更新按钮状态机 S0–S6」），无更高版本则保持现状（账户卡片不出现「更新」按钮）。
4. **假设**已登录且开关开启（updateChannel=beta），**当**应用触发更新检查（启动自动/手动），**则**一律查询 beta feed 而非 stable feed；**当**beta feed 不可达或元数据解析失败，**则**按自动更新故事场景 5 错误处理（启动自动检查静默、手动检查提示「检查更新失败，请稍后重试」），不得静默回退 stable feed、不得崩溃。
5. **假设**已登录且开关关闭（updateChannel=stable），**当**用户手动检查更新且已装版本高于 stable feed 最新版本（曾接收测试版、正式尚未追平），**则**不得降级、不得改查 beta feed，必须提示「正式版发布后将自动更新」而非「当前已是最新版本」；**当** stable feed 最新版本高于已装版本，**则**按自动更新故事场景 1-6 正常进入 S0–S6 升级；启动自动检查在无更新时保持静默。

## 边界情况

- **内置 CLI 缺失或损坏**：本地会话的内置 CLI 文件随安装包发布，若缺失或不可执行（安装损坏），应用必须显示重新安装应用的引导信息，不得尝试从网络安装。

- **内置 CLI 复制到用户目录**：安装目录只读，内置 CLI 在首次启动或内置与运行时副本的 `dist/bundle/wave.mjs` 字节（sha256）不一致时复制到 `~/.wave/cli/<end>/`（入口 `bin/wave-code.js`）；复制只替换 CLI 文件（`dist/`、入口、`package.json`），保留 `node_modules/`（运行时依赖缓存，rg 与 sharp）。

- **运行时依赖自装与缓存**（rg 与 sharp 同一套机制）：宿主自带的那份 CLI 不带 `node_modules`，依赖由 **CLI 在启动期**按「运行时依赖表」自装到共享 `~/.wave/cli/node_modules/`（rg 在 `@vscode/` 下），落点与旧实现相同 ⇒ 已有缓存直接命中、不重复下载；npm 安装的 `wave-code` 自带这些依赖、第一步即短路。就绪判定**先看文件系统存在性、再看加载**（不得 `require` 一个尚不存在的包——那次失败会把「不存在」按路径缓存进进程，同进程内包随后落盘也解析不到）。版本选择、sha512 校验、原子落地、保留可执行位等细节见 [stdio-transport.md](../ui/stdio-transport.md)「边界情况 · 运行时依赖自装与缓存」。

- **运行时依赖下载失败只降级、不阻断启动**：CLI 在启动期等依赖就位（避免「刚启动就贴图/搜索」撞上还没装好），但安装失败不抛错、不弹 toast——记一行警告后照常提供会话服务（Grep 报"ripgrep is not available"、超限图片按降级路径处理）；同一进程内不重试，下次启动再试。应用不再在启动 CLI 前代装或拦截（旧行为：rg 下载失败即 toast 提示初始化失败）。

- **本地不依赖系统 Node.js**：本地会话由 Electron 内置 Node 运行内置 CLI，客户系统未安装 Node.js/npm 或版本低于 22 均不影响本地会话；SSH 远程主机会话仍依赖远端 Node.js >= 22（远端以系统 Node 运行推送的 CLI）。

- **远端 CLI 布局镜像本地**：远端 CLI 固定位于 `~/.wave/cli/desktop/`（`bin/wave-code.js` + `dist/bundle/wave.mjs` + `package.json`），与本地 per-end 目录同名；远端运行时依赖（rg/sharp）位于共享 `~/.wave/cli/node_modules/`（升级替换 `desktop/` 目录时保留，不重复下载）。

- **远端同步判据取内置 CLI 内容而非版本号**：GUI 与内置 CLI 版本相互独立（publish.yml 明示 GUI 可单独发版不发布 CLI npm 包），同步判据是内置 `resources/wave-cli/dist/bundle/wave.mjs` 与远端副本的字节（sha256）比较，绝不是 `app.getVersion()`，也不以 `package.json` 的 wave-code 版本号为准（版本号未 bump 但字节已变也必须同步）——旧机制曾对 npm 上不存在的 GUI 版本号发起安装而 404。

- **远端运行时依赖由远端 CLI 自取**：远端 CLI 不带 `node_modules`，rg/sharp 由远端 CLI 在启动期自己从 npmmirror 下载到共享 `~/.wave/cli/node_modules/`——只需远端有 Node ≥ 22 与出网，**不再要求远端安装 npm**（旧机制在远端执行 `npm install --prefix ~/.wave/cli`）；server 无出网时 CLI 推送不受影响（走 ssh），daemon 照常启动、仅 grep 与超限图片降级，恢复网络后下次启动自动补齐。**远端 daemon 是长驻进程**（桌面端复用存活的 daemon，仅在内置 CLI 字节变化时重启），因此一次误判会粘住整个 daemon 生命周期：就绪判定必须诚实——判定为「已安装但无法加载」时，包要么真的不在磁盘上，要么真的加载不起来。

- **desktop-beta feed 依赖 codechat 通道**：beta feed（`/api/downloads/desktop-beta/{mac|win}/`）由 vusion/codechat #33 提供；codechat 侧通道上线前，开启「接收 Beta 版更新」后的检查按自动更新故事场景 5 错误处理（启动静默、手动提示检查失败），不得静默回退 stable feed 或崩溃。

- **updateChannel 不进共享配置**：「接收 Beta 版更新」开关持久化于桌面 configStore 顶层（userData/wave-desktop.json，theme 先例），不写入 settings.json、不同步到远程 CLI 或账号级配置；默认 stable。

- **未登录不触发更新检查**：无 serverUrl 时，启动自动检查与手动 `checkForUpdates` 均不得执行更新检查（不查 GitHub Releases、不启动 electron-updater），手动检查 toast 提示「登录后可检查更新」；曾用于未登录回退的 checkForUpdate/updateChecker 链路已删除（2026-09-09 拍板）。

- **运行期轮询只查不下载**：轮询与启动自动检查一样是「非手动」检查，发现新版本只置 idle（S1），绝不自动下载/安装（`autoDownload=false` 保持）；间隔为固定常量（首版 1 小时），与启动那次的「只跑一次」检查相互独立（轮询不得让它变成两次启动语义）；定时器生命周期随宿主 dispose 结束。

## 非目标（明确排除）

- **Linux 打包**：首版仅 macOS（arm64）与 Windows。

- **Windows 更新包签名校验**：Windows 安装包未签名，electron-updater 对未签名当前应用不校验更新签名（与现分发一致，SmartScreen 警告不在自动更新范围解决）。

- **Linux 自动更新**：首版仅 macOS（arm64）与 Windows。

- **CI 发布自动上传**：CI 保持 `--publish never` 零改动，安装包由 ops 手动上传 codechat file-center，与 vscode/jetbrains 分发方式一致。

- **更新安装的推迟调度**：重启安装立即执行（quitAndInstall），不做「推迟到下次退出应用」的调度。
