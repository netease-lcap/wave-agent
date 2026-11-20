---
name: "桌面端渲染进程崩溃与卡死恢复"
description: "CodeWave IDE 桌面端渲染进程崩溃/卡死的自愈入口、现场取证（minidump、JS 调用栈采样、崩溃前进程树内存快照 `[process-memory]`）与一键导出诊断包"
order: 95
---

# 功能规格说明：桌面端渲染进程崩溃与卡死恢复

> 真实事故驱动：用户（macOS ARM64）连续运行约 53 小时后界面**整片黑屏**、任务仍在后台正常运行，系统留下 `EXC_BREAKPOINT (SIGTRAP)`、Thread 0 为 `CrRendererMain`、栈顶在 `cppgc::internal::WriteBarrier::DijkstraMarkingBarrierRangeSlow` 的崩溃报告——渲染进程在 V8 堆/GC 的 native 代码里崩了。她只能强杀重开，崩溃现场（转储、JS 栈、内存读数、日志）全部丢失，事后无法定位。本规格只解决「崩了之后用户怎么办 + 我们能拿到什么证据」，不解决该 native 崩溃本身。
>
> 黑屏的视觉成因：窗口本身还活着，`backgroundColor: "#1e1e1e"` 铺满整片深色——渲染进程一旦消失，用户看到的就是一片深色空窗。所以恢复入口**不能**放在渲染进程里，只能是主进程的原生对话框。

## 用户场景与测试

### 用户故事：渲染进程崩溃后用户有明确的下一步（优先级：P1）

作为用户，当界面因渲染进程崩溃而黑屏时，我希望应用告诉我发生了什么，并给我「重启 / 导出日志 / 退出」的选择，以便我不必强杀应用、也不会丢掉可以定位问题的现场。

**为什么是这个优先级**：这是真实事故里用户唯一缺的东西——她知道任务还在跑，却只能强杀重开；而强杀之后再没有任何证据。

**独立测试**：在真实 Electron 中用 `webContents.forcefullyCrashRenderer()` 杀掉渲染进程（或 `kill -9` 渲染进程），验证弹出原生对话框、`desktop.log` 中有一条含 `reason`/`exitCode` 的崩溃记录、选「重启应用」后应用重启且未走 `before-quit` 的 dispose 流程；崩溃后不出现任何自动重载。

**验收场景**：

1. **假设**渲染进程异常退出，**当**主进程收到 `render-process-gone`，**则**必须写一条含 `reason`、`exitCode`、当前 URL 以及崩溃前最后一次进程树内存快照（`[process-memory]` 行）的 ERROR 日志，并弹出一个原生对话框：标题「界面已崩溃」，按钮「重启应用 / 导出日志 / 退出」，`defaultId` 指向「重启应用」、`noLink: true`。
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
8. **假设**卡死期间已按 `trigger=stall` 取过一次进程树快照，**当**随后发生 `render-process-gone`，**则**崩溃日志必须同时带上最后一次快照，便于判断「是否内存压力导致」。

---

### 用户故事：进程树内存快照 `[process-memory]`（优先级：P2）

作为维护者，我希望应用在后台按周期记录**我们自己的整棵 Electron 进程树**的内存占用（与 Claude Code 桌面端同形的 `[process-memory]` 行）**并同时记录渲染进程承载的消息量**，以便事后判断黑屏是「会话历史把渲染进程撑爆」还是「我们被系统内存压力饿死」——而不是只有一堆对不上因果的 MB 数字。

**为什么是这个优先级**：单一快照无法证实也无法排除内存压力；而崩溃那一刻渲染进程已经消失，事后调用 `app.getAppMetrics()` 取不到它，所以读数必须在此前就持续记录。MB 数字单独看没有因果——必须和「这个 pane 有多少条消息、多少个 block」一起看，才能判断涨的是不是会话长度驱动的那一份。

**只在越桶时落盘**：快照按 `60000ms` 加 `Math.random()` 给出的 ±`5000ms` 抖动周期采集（抖动避免多实例同时打点），采样本身不写日志——常态出口只有崩溃日志的 `lastMemory=`。仅当「我们自己的进程树 RSS 之和占物理内存的比例」越过 `100% / 110% / 125% / 150%` 这几个桶时，才往 `desktop.log` 写一条 WARN，且同一个桶 `30` 分钟内只写一次（期间水位回落也不补写）。

> **已知边界（设计取舍，不是缺陷）**：落盘判据只看「我们占了多少物理内存」，**不看系统还剩多少、也不看别的进程占了多少**。所以「渲染进程自身只占几百 MB、机器被别的进程吃干导致我们被饿死」（这正是 2026-11-20 那次 Windows 事故的形态）**不会产生任何周期日志行**——那一刻的读数依然只出现在崩溃日志的 `lastMemory=` 里。要回答「被谁饿死」需要系统级提交量（commit limit / charge）或枚举其他进程，本规格明确不做（见「非目标」）。

**独立测试**：假时钟驱动内存采样器，验证启动即采一次、之后每次间隔为 `60000ms` 加 ±`5000ms` 抖动；验证快照收录 `app.getAppMetrics()` 的**全部**条目（`type` 用 Electron 原文）、KB 换算 MB、`top=` 只留 RSS 最大的 5 个；验证正常水位不产生任何日志行但 `lastLine()` 仍更新、越桶才写一条且同桶 `30` 分钟内不重复、`stall` 触发即时快照且 `10000ms` 内只一次、采样失败也写一行；用假消息列表验证条数与 block 总数的换算；在真实 host 上验证只统计「界面上有 pane 在显示」的会话。

**验收场景**：

1. **假设**主窗口已创建，**当**开始记录内存，**则**必须立即采一次，之后每次间隔为 `60000ms` 加 `Math.random()` 给出的 ±`5000ms` 抖动；定时器必须 `unref()`，不得拖住进程退出。
2. **假设** `getAppMetrics()` 返回多条记录，**当**形成快照，**则**必须收录**全部**条目（不筛选渲染进程）：`tree_rss_sum=<n>MB(electron-only)` 为全部进程 RSS 之和、`electron(<n>)=<n>MB` 为进程数、`top=[…]` 为按 RSS 降序的前 `5` 个、每项形如 `<type>:<pid>:<rss>MB`；`(electron-only)` 后缀标明「只含 Electron 进程，子进程未枚举」；`<type>` 一律用 Electron `ProcessMetric.type` 原文（`Browser` / `Tab` / `GPU` / `Utility`），不得自造分类名。单位 MB（Electron 原始单位为 KB，保留一位小数）。
3. **假设**系统内存可读，**当**形成快照，**则**必须写 `sys_free=<avail>MB/<total>MB`：Linux 上 `avail` 取 `/proc/meminfo` 的 `MemAvailable`（那里的 `os.freemem()` 等于 `MemFree`，会低估可用内存），并额外写 `sys_free_raw=<MemFree>MB`；其他平台取 `os.freemem()` 且**省略** `sys_free_raw`——不得把同一个数字打上两个名字冒充两种口径。读不到 `/proc/meminfo` 时同样省略 `sys_free_raw`，不得编数。
4. **假设**我们没有枚举 `wave --stdio` 等子进程的能力，**当**形成快照，**则**必须写 `children=unavailable(not-enumerated)`，**不得**为了凑字段去调用 `ps` / `tasklist` 之类的外部命令。
5. **假设**窗口发出 `unresponsive`，**当**采样器被触发，**则**立即取一次快照并把 `trigger=stall` 写进行内（周期采集则是 `trigger=interval`）；两次 stall 快照之间至少间隔 `10000ms`——同一轮卡死会连续发事件，重复读数没有意义。
6. **假设**界面上有 pane 绑定了会话，**当**形成快照，**则**该行尾部必须带该窗口所有 pane 的消息总数与 block 总数（`messages=<n> blocks=<n>`），并另起一行按 pane 给出明细：`pane=`、`session=`、`messages=`、`blocks=` 与该会话最新上下文用量 `tokens=`（压缩只折叠 API 上下文，`tokens` 平稳而条数/block 数持续上涨即「展示侧无界」的判据）。
7. **假设**尚无 pane 绑定会话，**当**采样，**则**只记快照、不记计数（不得写 `messages=0` 冒充「没有消息」）。
8. **假设** `getAppMetrics()` 里没有 `Tab` 条目（窗口尚未加载出渲染进程），**当**采样，**则**不产生读数（`lastMemory` 保持为空）——不得为一个从未渲染过的窗口编曲线。
9. **假设**窗口关闭，**当**渲染进程随之消失，**则**必须清除定时器，不得继续对一个不存在的进程采样。
10. **假设** `getAppMetrics()` 或系统内存读取抛错，**当**采样，**则**必须写一条 `[process-memory] snapshot failed: <err>` 的 WARN，下一轮继续（不得让一次失败停掉整条读数链，也不得静默）。
11. **假设**消息量统计抛错，**当**采样，**则**仍保留内存快照并记一条 WARN——内存读数不得因为计数失败而丢失。
12. **假设**某个会话的 agent 已不被任何 pane 显示（后台会话），**当**统计消息量，**则**不得计入：它的消息从未推给渲染进程，计进去会让读数与渲染进程堆脱钩。
13. **假设**崩溃发生，**当**写崩溃日志，**则** `lastMemory` 必须沿用同一份快照结果（含计数），使崩溃那一刻的内存与消息量同时可见。
14. **假设**水位未越过任何桶，**当**采样，**则**不得写日志行（读数只更新内存里的 `lastLine()` 供崩溃路径读取）；**假设**越过了某个桶，**当**采样，**则**写一条 WARN，且该桶 `30` 分钟内不再写。
15. **假设**系统可用内存已极低、但我们的 `tree_rss_sum` 没越过任何桶，**当**采样，**则**仍然不得写日志行——这是判据的已知边界（见上文「已知边界」），不得为了覆盖该情形自行增加系统压力判据或提交量采集。

> **本条只做可观测。** 用户访谈（很少截图 ⇒ 排除 base64 图片；单个对话用了约 6 周、一直在压缩）＋ 代码核查指向：压缩只折叠发给模型的上下文（`this.messages`），展示侧过去永保留全量历史，而桌面端 `setInitialState` 把整份列表原样推给渲染进程、没有切片 ⇒ 嫌疑人是「消息条数 + tool 输出全文」。**是否裁剪展示侧 / 给 webview 加窗口是行为变更，需要产品拍板，属独立议题**，不在本规格范围内（见「非目标」）。该议题已另立并落地（`ui/message-rendering-system.md`「内存只装压缩后的上下文，更早的历史按页从转录取」）：列表口径收敛到最近一次压缩，首屏只推一页、更早的内容上翻时按页从转录读回，因此上面的读法在新版本里口径要跟着换（见文末「取证日志格式」的读法段）。

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
- **原生 GC 卡死无栈可采**：若渲染进程卡在 native 代码（如本次的 `cppgc` 写屏障）里，帧内 JS 可能完全不动，采样拿不到栈——此时证据只剩最后一次内存读数 + 崩溃转储，日志必须如实写明「未采到栈」。
- **同一崩溃的多个信号**：`unresponsive` → `render-process-gone` → `did-fail-load` 可能接连到达；闩锁保证只弹一个框，且崩溃前先 flush 采样。
- **窗口在对话框期间被销毁**：不再对该窗口弹窗、不再调用其 `webContents`。
- **渲染进程被系统回收（`memory-eviction`）/ 被强杀（`killed`）**：按崩溃同样处理（无 dump），日志里的 `reason` 区分它们。
- **内存压力来自我们自己之外**：`[process-memory]` 只在「我们自己的进程树占物理内存的比例」越桶时落盘，所以「别的进程把内存吃干、我们被饿死」这一形态没有周期日志行，那一刻的取值只在崩溃日志的 `lastMemory=` 里。这是已拍板的取舍（与 Claude Code 桌面端一致），不通过加系统压力判据来弥补。
- **启动后第一分钟内崩溃**：`start()` 的首次采样发生在窗口刚创建、渲染进程条目还不存在时，按场景 8 不产生读数，下一次要等一个周期（`60000ms` ± 抖动）。所以「启动即崩」的崩溃日志可能没有 `lastMemory=`；本规格不加启动后补采。

## 非目标（明确排除）

- **自动重载 / 自动重启**：明确不做。自动重载会抹掉崩溃现场（JS 堆、控制台、DOM）并重置用户会话；恢复动作只能由用户在对话框里选。（与部分同类产品「崩溃即自动 reload」的做法相反，此处为设计决定。）
- **渲染进程内 UI**：黑屏时渲染进程本身不可用，所有提示与恢复入口只在主进程用原生 `dialog`。
- **主动杀渲染进程「自愈」**：不在卡死时 `forcefullyCrashRenderer()` 强行重启渲染进程——那会连正在进行的渲染任务与会话状态一起丢掉。
- **上传崩溃报告 / 接入崩溃平台**：无后端、隐私未拍板；转储只留在本地，由用户通过「导出日志」带出。
- **zip 格式**：不引入 zip 依赖；`.tar.gz` 在 macOS Finder 与 Windows 10+ 右键解压均可直接打开。
- **该 native 崩溃（`cppgc` 写屏障）本身的修复**：本规格只提供自愈入口与取证能力，根因另案分析（需要收集到转储与内存读数之后再定位）。
- **裁剪会话展示侧 / 给 webview 加消息窗口**：内存读数指向「展示侧无界」这一嫌疑，但收缩列表口径、给 `setInitialState` 加分页或给 webview 加虚拟窗口都是**行为变更**（会影响用户看到的历史、压缩语义、恢复与搜索），需要产品拍板，属后续独立议题。本规格只落地计数，不动任何裁剪行为。
- **系统内存压力判据（提交量 / 其他进程占用）**：明确不做。`[process-memory]` 的落盘判据只用「我们自己占物理内存的比例」，不读系统级 commit limit / commit charge，不枚举其他应用的进程——参照物（Claude Code 桌面端）同样没有这两项，且 macOS 没有与 Windows `CommitLimit` 等价的免特权读数。后果见「边界情况」：我们自己没变大时不会留下周期日志行。
- **枚举 `wave --stdio` 等子进程**：不做。子进程不是 Electron 进程，没有 API 能列出来；`tree_rss_sum` 因此恒带 `(electron-only)`，`children` 恒为 `unavailable(not-enumerated)`——不为了填字段去跑 `ps` / `tasklist`。
- **修改 webview / CLI / agent-sdk 行为**：全部改动限于 `packages/desktop` 主进程。

## 取证日志格式（用于事后阅读 `desktop.log`）

```text
[2026-10-22T07:41:02.113Z] [INFO] [desktop] crash evidence dirs dumps=/Users/x/Library/Application Support/CodeWave IDE/Crashpad logs=/Users/x/.wave/logs
[2026-10-22T07:41:02.114Z] [WARN] [desktop] previous run left a crash dump id=3a1b… date=2026-10-20T04:11:31.000Z dir=/Users/x/Library/Application Support/CodeWave IDE/Crashpad
[2026-10-22T09:14:07.532Z] [WARN] [desktop] renderer unresponsive url=file:///…/webview/index.html
[2026-10-22T09:14:22.538Z] [WARN] renderer unresponsive: JS stack samples (every 1000ms, up to 15000ms) window=main url=file:///…/webview/index.html
<9> at renderMessageList (chat.js:191:22)
    at commitHookEffectListMount (chat.js:42:11)
<5> at markMessageDirty (chat.js:301:7)
Total Samples: 14
[2026-10-22T09:14:24.010Z] [ERROR] [desktop] renderer process gone reason=crashed exitCode=133 url=file:///…/webview/index.html lastMemory=[process-memory] trigger=interval tree_rss_sum=2981.2MB(electron-only) electron(4)=2981.2MB children=unavailable(not-enumerated) top=[Tab:41337:2410.4MB Browser:41300:392.8MB GPU:41310:118.6MB Utility:41312:59.4MB] sys_free=3124MB/32768MB messages=1842 blocks=9310; session messages pane=pane-1 session=3f2a… messages=1842 blocks=9310 tokens=152000
[2026-10-23T11:02:41.220Z] [WARN] [process-memory] trigger=interval tree_rss_sum=33821.4MB(electron-only) electron(5)=33821.4MB children=unavailable(not-enumerated) top=[Tab:41337:33102.8MB Browser:41300:412.6MB GPU:41310:186.2MB Utility:41312:119.8MB] sys_free=1204MB/32768MB sys_free_raw=402MB messages=2104 blocks=11882
```

> 代码块里末两行是同一形态的两个出口：**崩溃那一刻**的读数进 `lastMemory=`（`[ERROR]` 那条），**越桶**时另写一条 `[WARN]`（最后那条，Linux 才有 `sys_free_raw=`；Windows / macOS 上该字段整段不出现）。常态下 `desktop.log` 不会出现周期内存行。

读法：先看 `lastMemory=` 或那条 WARN，再分三组读——①`tree_rss_sum` 与 `top=` 回答「我们占了多少、是哪个进程」（`Tab` 暴涨指向渲染进程，`Browser` / `Utility` 暴涨指向主进程或子服务，类别是 Electron 原文）；②`sys_free=<avail>/<total>` 回答「系统当时还剩多少」（Linux 上 `sys_free` 与 `sys_free_raw` 差得越大说明页缓存占用越多；其他平台只有 `available` 一个口径，不必找 raw）；③`messages`/`blocks`/`tokens` 回答「渲染进程扛着多少展示侧内容」——`tokens`（API 上下文，压缩后会回落）与 `messages`/`blocks`（展示侧）并排看。列表口径收缩到压缩边界之前后者只增不减，前者平稳而后两者持续上涨就是「压缩折叠了上下文、但渲染进程扛着全量展示侧」的证据；两者一起涨则说明上下文本身也在膨胀。口径收缩之后 `messages` 会停在「摘要 + 压缩保留轮次 + 其后新增」附近，此时它再涨说明的是「用户又往上翻了页」或「压缩之后又聊了很多」，与内存压力解耦，要看的换成 `tree_rss_sum` 与 `top=[Tab:…]` 本身。最后注意方向：`sys_free` 很低而 `tree_rss_sum` 很小 = 压力来自我们之外，本规格不为这种情形落盘（见「边界情况」）。
