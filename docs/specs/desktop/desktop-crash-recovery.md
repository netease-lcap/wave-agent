---
name: "桌面端渲染进程崩溃与卡死恢复"
description: "CodeWave IDE 桌面端渲染进程崩溃/卡死的自愈入口、现场取证（minidump、JS 调用栈采样、renderer 内存曲线）与一键导出诊断包"
order: 95
---

# 功能规格说明：桌面端渲染进程崩溃与卡死恢复

> 真实事故驱动：用户（macOS ARM64）连续运行约 53 小时后界面**整片黑屏**、任务仍在后台正常运行，系统留下 `EXC_BREAKPOINT (SIGTRAP)`、Thread 0 为 `CrRendererMain`、栈顶在 `cppgc::internal::WriteBarrier::DijkstraMarkingBarrierRangeSlow` 的崩溃报告——渲染进程在 V8 堆/GC 的 native 代码里崩了。她只能强杀重开，崩溃现场（转储、JS 栈、内存曲线、日志）全部丢失，事后无法定位。本规格只解决「崩了之后用户怎么办 + 我们能拿到什么证据」，不解决该 native 崩溃本身。
>
> 黑屏的视觉成因：窗口本身还活着，`backgroundColor: "#1e1e1e"` 铺满整片深色——渲染进程一旦消失，用户看到的就是一片深色空窗。所以恢复入口**不能**放在渲染进程里，只能是主进程的原生对话框。

## 用户场景与测试

### 用户故事：渲染进程崩溃后用户有明确的下一步（优先级：P1）

作为用户，当界面因渲染进程崩溃而黑屏时，我希望应用告诉我发生了什么，并给我「重启 / 导出日志 / 退出」的选择，以便我不必强杀应用、也不会丢掉可以定位问题的现场。

**为什么是这个优先级**：这是真实事故里用户唯一缺的东西——她知道任务还在跑，却只能强杀重开；而强杀之后再没有任何证据。

**独立测试**：在真实 Electron 中用 `webContents.forcefullyCrashRenderer()` 杀掉渲染进程（或 `kill -9` 渲染进程），验证弹出原生对话框、`desktop.log` 中有一条含 `reason`/`exitCode` 的崩溃记录、选「重启应用」后应用重启且未走 `before-quit` 的 dispose 流程；崩溃后不出现任何自动重载。

**验收场景**：

1. **假设**渲染进程异常退出，**当**主进程收到 `render-process-gone`，**则**必须写一条含 `reason`、`exitCode`、当前 URL 以及崩溃前最后一次 renderer 内存读数的 ERROR 日志，并弹出一个原生对话框：标题「界面已崩溃」，按钮「重启应用 / 导出日志 / 退出」，`defaultId` 指向「重启应用」、`noLink: true`。
2. **假设**渲染进程崩溃，**当**主进程处理该崩溃，**则**不得调用 `win.reload()` / `webContents.reload()` 自动重载——自动重载会抹掉崩溃现场（JS 堆、控制台、出错时的 DOM），也会重置用户正在看的会话状态；恢复动作只能由用户在对话框里选择。
3. **假设**同一次崩溃连续触发多个信号（`unresponsive`、`render-process-gone`、`did-fail-load`），**当**第一个对话框已弹出，**则**后续信号只记日志，不得再弹第二个对话框（同一时刻最多一个恢复对话框）。
4. **假设**用户选择「重启应用」，**当**动作执行，**则**必须使用 `app.relaunch()` + `app.exit(0)`：不得使用 `app.quit()`（会进入 `before-quit` 并等待 `host.dispose()`，最长 5 秒，甚至在渲染进程已死时卡住）；CLI 子进程按既有约定在 stdin EOF 后自退出。
5. **假设**用户选择「退出」，**当**动作执行，**则**应用立即退出（同样跳过 `before-quit` 的等待），并在日志中记下「用户在渲染失败后选择退出」。
6. **假设**渲染进程已崩溃，**当**用户尚未做出选择，**则**窗口保持现状（深色空窗），不得关闭窗口或结束正在运行的任务：关闭窗口会触发 `host.dispose()`，直接杀掉后台任务。
7. **假设**崩溃对话框已弹出，**当**用户关闭窗口（`win.isDestroyed()` 为真），**则**不得再对该窗口弹窗（避免对已销毁窗口调用原生 dialog）。

---

### 用户故事：界面加载失败可诊断（优先级：P2）

作为用户，当界面加载失败（白屏）时，我希望应用同样告诉我错误码并给出恢复入口，而不是静静地停在空白页。

**为什么是这个优先级**：加载失败比崩溃更常见（安装损坏、文件缺失），且同样表现为「窗口在、界面没了」；它与崩溃共用同一套日志与对话框，边际成本很低。

**独立测试**：让主框架加载一个不存在的文件（`did-fail-load` errorCode -6），验证弹出「界面加载失败」对话框；构造子框架加载失败与 `-3`（ABORTED）验证只记日志不弹窗。

**验收场景**：

1. **假设**主框架加载失败，**当**主进程收到 `did-fail-load` 或 `did-fail-provisional-load`，**则**必须记一条含 `errorCode`、`errorDescription`、`validatedURL`、`isMainFrame` 的 ERROR 日志，并弹出「界面加载失败」对话框（按钮同崩溃：重启应用 / 导出日志 / 退出）。
2. **假设**失败的是子框架（`isMainFrame` 为假，例如预览面板里的本地 dev server 断连），**当**主进程收到该事件，**则**只记日志，不弹对话框。
3. **假设** `errorCode` 为 `-3`（`ERR_ABORTED`，正常的导航中断），**当**主进程收到该事件，**则**视为正常行为，不弹对话框。

---

### 用户故事：卡死时自动采集 JS 调用栈（优先级：P1）

作为维护者，当界面卡死（unresponsive）时，我希望应用在卡死期间自动采样渲染进程的 JS 调用栈，以便事后知道它卡在哪段代码，而不是只知道「它卡了」。

**为什么是这个优先级**：卡死没有 crash dump，采样是唯一能拿到「卡在哪」的手段；而事故里的 native 崩溃前也常伴随长时间卡顿。

**独立测试**：用假时钟驱动采样器，验证 1 秒一次、15 秒自停、相同栈计数正确、flush 内容含 `Total Samples`；在真实 Electron 中冻结渲染进程主线程后调用 `collectJavaScriptCallStack()`，验证能拿到栈、`forcefullyCrashRenderer()` 能触发 `render-process-gone`（`pnpm -F wave-desktop run smoke:crash`）。

**验收场景**：

1. **假设**窗口发出 `unresponsive`，**当**主进程收到该事件，**则**立即开始采样：每 `1000ms` 调用一次 `webContents.mainFrame.collectJavaScriptCallStack()`，最长 `15000ms` 后自行停止；采样期间不得阻塞主进程事件循环（定时器链，不是循环）。
2. **假设**采样进行中，**当**收到 `responsive`、渲染进程退出或窗口关闭，**则**停止采样并把已采集的样本 flush 成一条多行 WARN 日志：标题行含窗口名与 URL，每个不同的栈一行、行首为出现次数（`<12> <栈顶帧>`，其后为原栈的其他帧），末行 `Total Samples: <总数>`。
3. **假设**单次采集失败或永远不返回（渲染进程已死、文档未声明调用栈策略、帧内没有 JS 在运行），**当**超过 `2000ms`，**则**本次采样作废并继续下一次，flush 时以 `no stack samples collected: <原因>` + `Total Samples: 0` 记录——「卡了 15 秒但读不到栈」本身也是证据，且原因必须写出来。
4. **假设**栈超过 `40` 行，**当**写入日志，**则**保留前 40 行并追加一行 `… N more frames truncated`，不得把长栈截断到失去定位价值，也不得写出一行几万字符的日志。
5. **假设**窗口处于「无响应」并弹出对话框，**当**用户选择「继续等待」，**则**不得重启或退出，必须解除弹窗闩锁、重新开始一个新的 15 秒采样窗口，并使「再次卡死」能再次弹窗。
6. **假设** DevTools 已打开或窗口已销毁，**当**收到 `unresponsive`，**则**不启动采样（浏览器自身已在暂停该渲染进程）。
7. **假设** webview 通过 `file://` 加载，**当**主进程为冻结帧采集栈，**则**必须为该 scheme 的响应注入 `Document-Policy: include-js-call-stacks-in-crash-reports`——缺这条策略时 Electron 直接拒绝（"Website owner has not opted in for JS call stacks in crash reports."），采样恒为空。
8. **假设**卡死期间 renderer 内存已采样过，**当**随后发生 `render-process-gone`，**则**崩溃日志必须同时带上最后一次内存读数，便于判断「是否内存压力导致」。

---

### 用户故事：renderer 内存曲线（优先级：P2）

作为维护者，我希望应用持续记录渲染进程的内存占用**并同时记录它承载的消息量**，以便判断黑屏是否是「会话历史把 renderer 堆撑爆」——而不是只有一堆 MB 数字对不上因果。

**为什么是这个优先级**：单一快照无法证实也无法排除内存压力；只有曲线能回答「崩溃前内存是否一路攀升」。而 MB 数字单独看没有因果——必须和「这个 pane 有多少条消息、多少个 block」一起看，才能看出「堆涨的时候条数是不是也在涨」。

**独立测试**：假时钟驱动内存采样器，验证启动即采一次、之后每 `60000ms` 一次，只取 `type === "Tab"` 的进程，KB 换算为 MB（保留一位小数），窗口销毁后定时器被清除；用假消息列表验证条数与 block 总数的换算；在真实 host 上验证只统计「界面上有 pane 在显示」的会话。

**验收场景**：

1. **假设**主窗口已创建，**当**开始记录内存，**则**必须立即读一次 `app.getAppMetrics()`，之后每 `60000ms` 读一次。
2. **假设** `getAppMetrics()` 返回多条记录，**当**写日志，**则**只取 `type === "Tab"`（渲染进程）的条目，一行一个进程，含 `pid`、`workingSet`、`peak`，单位 MB（Electron 原始单位为 KB）。
3. **假设**界面上有 pane 绑定了会话，**当**写这条内存日志，**则**每个渲染进程行必须同时带该窗口所有 pane 的消息总数与 block 总数（`messages=<n> blocks=<n>`），并另起一行按 pane 给出明细：`pane=`、`session=`、`messages=`、`blocks=` 与该会话最新上下文用量 `tokens=`（压缩只折叠 API 上下文，`tokens` 平稳而条数/block 数持续上涨即「展示流无界」的判据）。
4. **假设**尚无 pane 绑定会话，**当**采样，**则**只写内存行、不写计数（不得写 `messages=0` 冒充「没有消息」）。
5. **假设**尚无渲染进程条目（窗口尚未加载），**当**采样，**则**不写空日志。
6. **假设**窗口关闭，**当**渲染进程随之消失，**则**必须清除定时器，不得继续对一个不存在的进程采样。
7. **假设** `getAppMetrics()` 抛错，**当**采样，**则**记一条 WARN，下一轮继续（不得让一次失败停掉整条曲线）。
8. **假设**消息量统计抛错，**当**采样，**则**仍写出内存行并记一条 WARN——内存读数不得因为计数失败而丢失。
9. **假设**某个会话的 agent 已不被任何 pane 显示（后台会话），**当**统计消息量，**则**不得计入：它的消息从未推给渲染进程，计进去会让曲线与 renderer 堆脱钩。
10. **假设**崩溃发生，**当**写崩溃日志，**则** `lastMemory` 必须沿用同一份采样结果（含计数），使崩溃那一刻的内存与消息量同时可见。

> **本条只做可观测。** 用户访谈（很少截图 ⇒ 排除 base64 图片；单个对话用了约 6 周、一直在压缩）＋ 代码核查指向：压缩只折叠发给模型的上下文（`this.messages`），UI 展示流 `displayMessages` 永保留全量历史，而桌面端 `setInitialState` 把整份列表原样推给渲染进程、没有切片 ⇒ 嫌疑人是「消息条数 + tool 输出全文」。**是否裁剪展示流 / 给 webview 加窗口是行为变更，需要产品拍板，属独立议题**，不在本规格范围内（见「非目标」）。该议题已另立并落地（`ui/message-rendering-system.md`「续页从转录读、两端不再常驻全量」）：展示流只留常驻窗口、更早的页从转录读，因此上面的读法在新版本里口径要跟着换（见本条最后一行）。

---

### 用户故事：本地 minidump 与「上次是崩过还是被强杀」（优先级：P1）

作为维护者，我希望应用在本地留存崩溃转储，并在下次启动时告诉我上一次是否发生了 native 崩溃，以便区分「真崩」与「用户强杀」——本次事故里用户强杀重开恰好抹掉了这个区别。

**为什么是这个优先级**：没有转储就没有 native 栈；而「上次崩过」这条判断是事后分析的第一块拼图。

**独立测试**：单元测试断言 `crashReporter.start` 的入参（不上传）、启动日志同时给出两个真实目录；构造 `getLastCrashReport()` 有/无返回值，断言分别记 WARN（含 id、日期、目录）与 INFO。

**验收场景**：

1. **假设**应用启动，**当**尚未到达 `app.whenReady()`，**则**必须调用 `crashReporter.start({ uploadToServer: false, compress: true })`：不配置 `submitURL`、不上传——本产品没有崩溃收集后端，静默上传属于未拍板的隐私决定。
2. **假设**应用启动，**当**初始化崩溃上报，**则**必须写一条 INFO 日志，同时给出 minidump 目录（`app.getPath("crashDumps")`）与文本日志目录（`~/.wave/logs/`，尊重 `WAVE_LOGS_DIR`）的真实路径，便于支持人员直接向用户要文件。
3. **假设**上一次运行留下了崩溃报告，**当**本次启动，**则**必须写一条 WARN 日志，含报告 id、日期与转储目录；终止原因（如 `SIGTRAP`）只在 `.dmp` 内，日志不得伪造该字段。
4. **假设**上一次运行没有崩溃报告，**当**本次启动，**则**写一条 INFO 日志说明「没有上次运行的崩溃转储」。
5. **假设**读取崩溃报告失败，**当**本次启动，**则**记一条 WARN 并继续启动，不得因此阻止应用使用。

---

### 用户故事：一键导出取证包（优先级：P1）

作为用户，当界面崩溃/卡死时，我希望一键把日志和崩溃转储打包到一个我能找到的位置，以便把它交给支持人员，而不必去翻隐藏目录。

**为什么是这个优先级**：事故复盘的瓶颈是「拿不到文件」——macOS 上 `~/.wave/logs` 与 Crashpad 目录都是隐藏路径，让用户手工找两处目录等于多一轮往返。

**独立测试**：单元测试覆盖文件名生成、保存对话框默认路径（桌面）、归档条目（logs / crash-dumps / manifest）、取消时不留痕迹、失败时仍清理临时目录。

**验收场景**：

1. **假设**用户在恢复对话框中选择「导出日志」，**当**动作执行，**则**必须用 `dialog.showSaveDialog` 让用户选择位置，默认 `~/Desktop/codewave-diagnostics-<YYYYMMDD-HHmmss>.tar.gz`（本地时间）。
2. **假设**用户确认保存位置，**当**打包，**则**归档必须包含：`logs/`（`~/.wave/logs/*.log`）、`crash-dumps/`（minidump 目录，若存在）、`manifest.txt`（生成时间、应用版本、平台、架构、Electron 版本、两个目录路径、纳入的日志文件名）。
3. **假设**仓库已有 `tar` 依赖，**当**选择归档格式，**则**使用 `.tar.gz`，**不得**为此引入 zip 等新的第三方依赖。
4. **假设**导出成功，**当**归档写盘完成，**则**用系统文件管理器定位该文件，并用原生提示框给出文件绝对路径。
5. **假设**导出过程报错，**当**失败，**则**记一条 ERROR 日志，并用原生提示框显示错误信息与日志目录（用户仍有手工打包的退路）。
6. **假设**用户取消保存对话框，**当**动作返回，**则**不写任何文件、不弹提示，并回到同一个恢复对话框。
7. **假设**导出结束（成功或失败），**当**清理阶段，**则**必须删除临时打包目录。
8. **假设**用户选择「导出日志」时界面仍在卡死，**当**导出完成后，**则**回到同一个恢复对话框（窗口仍然是坏的），不得把用户丢回一个不可用的界面。

---

### 边界情况

- **崩溃后用户直接关窗**：走既有 `before-quit` → `host.dispose()`（受 5 秒超时约束），正在运行的任务随之结束；本特性不改变该语义，只是让用户在弹窗里还有别的选择。
- **转储目录随环境变化**：`crashDumps` 跟随 userData（dev 实例是 `wave-desktop-dev`），日志目录随 `WAVE_LOGS_DIR`；两者都由启动日志如实写出，不写死路径。
- **从未崩溃过**：minidump 目录可能不存在或为空；导出时必须跳过而不是报错。
- **原生 GC 卡死无栈可采**：若渲染进程卡在 native 代码（如本次的 `cppgc` 写屏障）里，帧内 JS 可能完全不动，采样拿不到栈——此时证据只剩内存曲线 + 崩溃转储，日志必须如实写明「未采到栈」。
- **同一崩溃的多个信号**：`unresponsive` → `render-process-gone` → `did-fail-load` 可能接连到达；闩锁保证只弹一个框，且崩溃前先 flush 采样。
- **窗口在对话框期间被销毁**：不再对该窗口弹窗、不再调用其 `webContents`。
- **渲染进程被系统回收（`memory-eviction`）/ 被强杀（`killed`）**：按崩溃同样处理（无 dump），日志里的 `reason` 区分它们。

## 非目标（明确排除）

- **自动重载 / 自动重启**：明确不做。自动重载会抹掉崩溃现场（JS 堆、控制台、DOM）并重置用户会话；恢复动作只能由用户在对话框里选。（与部分同类产品「崩溃即自动 reload」的做法相反，此处为设计决定。）
- **渲染进程内 UI**：黑屏时渲染进程本身不可用，所有提示与恢复入口只在主进程用原生 `dialog`。
- **主动杀渲染进程「自愈」**：不在卡死时 `forcefullyCrashRenderer()` 强行重启渲染进程——那会连正在进行的渲染任务与会话状态一起丢掉。
- **上传崩溃报告 / 接入崩溃平台**：无后端、隐私未拍板；转储只留在本地，由用户通过「导出日志」带出。
- **zip 格式**：不引入 zip 依赖；`.tar.gz` 在 macOS Finder 与 Windows 10+ 右键解压均可直接打开。
- **该 native 崩溃（`cppgc` 写屏障）本身的修复**：本规格只提供自愈入口与取证能力，根因另案分析（需要收集到转储与内存曲线之后再定位）。
- **裁剪会话展示流 / 给 webview 加消息窗口**：内存曲线指向「展示流无界」这一嫌疑，但裁剪 `displayMessages`、给 `setInitialState` 加分页或给 webview 加虚拟窗口都是**行为变更**（会影响用户看到的历史、压缩语义、恢复与搜索），需要产品拍板，属后续独立议题。本规格只落地计数，不动任何裁剪行为。
- **修改 webview / CLI / agent-sdk 行为**：全部改动限于 `packages/desktop` 主进程。

## 取证日志格式（用于事后阅读 `desktop.log`）

```text
[2026-10-22T07:41:02.113Z] [INFO] [desktop] crash evidence dirs dumps=/Users/x/Library/Application Support/CodeWave IDE/Crashpad logs=/Users/x/.wave/logs
[2026-10-22T07:41:02.114Z] [WARN] [desktop] previous run left a crash dump id=3a1b… date=2026-10-20T04:11:31.000Z dir=/Users/x/Library/Application Support/CodeWave IDE/Crashpad
[2026-10-22T07:42:00.001Z] [INFO] renderer memory pid=41337 workingSet=812.4MB peak=1204.9MB messages=1842 blocks=9310
session messages pane=pane-1 session=3f2a… messages=1842 blocks=9310 tokens=152000
[2026-10-22T09:14:07.532Z] [WARN] [desktop] renderer unresponsive url=file:///…/webview/index.html
[2026-10-22T09:14:22.538Z] [WARN] renderer unresponsive: JS stack samples (every 1000ms, up to 15000ms) window=main url=file:///…/webview/index.html
<9> at renderMessageList (chat.js:191:22)
    at commitHookEffectListMount (chat.js:42:11)
<5> at markMessageDirty (chat.js:301:7)
Total Samples: 14
[2026-10-22T09:14:24.010Z] [ERROR] [desktop] renderer process gone reason=crashed exitCode=133 url=file:///…/webview/index.html lastMemory=renderer memory pid=41337 workingSet=2981.2MB peak=3022.8MB messages=1842 blocks=9310; session messages pane=pane-1 session=3f2a… messages=1842 blocks=9310 tokens=152000
```

读法：`tokens`（API 上下文，压缩后会回落）与 `messages`/`blocks`（展示流）并排看——展示流被裁成常驻窗口之前它是只增不减的，前者平稳而后者持续上涨就是「压缩折叠了上下文、但渲染进程扛着全量展示流」的证据；两者一起涨则说明上下文本身也在膨胀。裁成窗口之后 `messages` 会停在一个上界附近，此时它再涨说明的是「用户又往上翻了页」，与内存压力解耦，要看的换成 `renderer memory` 那一项。
