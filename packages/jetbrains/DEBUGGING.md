# Wave JetBrains 插件调试指南

本文档说明如何在本仓库中调试 `packages/jetbrains` 插件。涵盖环境准备、构建运行、断点调试、日志查看、常见问题排查。

## 1. 环境准备

```bash
# JDK 17（temurin）必须，Kotlin jvmToolchain(17) 硬性要求
export JAVA_HOME=/Library/Java/JavaVirtualMachines/temurin-17.jdk/Contents/Home
export PATH="$JAVA_HOME/bin:$PATH"

# 确认版本
java -version   # 应显示 17.x
./gradlew --version   # Gradle 8.11.1（wrapper 已包含）
```

> 首次 `runIde` 会弹出 IntelliJ 终端用户协议（EUA）对话框，点 Accept 接受一次即可，后续不再出现。

## 2. 日常构建与运行

所有命令在 `packages/jetbrains` 目录下执行：

```bash
cd packages/jetbrains

# 仅编译 + 打包（产出 build/distributions/wave-jetbrains-0.1.0.zip）
./gradlew buildPlugin --no-daemon

# 启动一个带插件的测试 IDE 实例（GUI，会弹出独立 IDE 窗口）
./gradlew runIde --no-daemon

# 改了 webview 包后，需要先重新构建 webview dist，再 runIde
cd ../webview && pnpm run compile && cd ../jetbrains && ./gradlew runIde --no-daemon
```

`--no-daemon` 可避免后台常驻 Gradle 进程；开发时也可去掉以加速增量构建。

### Webview 资源同步链路

插件通过 `copyWebviewAssets` Gradle task 把 `packages/webview/dist/{chat.js,chat.css}` 拷贝到 `src/main/resources/webview/`，再打进 jar。**改了 webview 源码后必须重新 `pnpm -F wave-webview run compile`**，否则 runIde 加载的是旧 bundle。

## 3. 断点调试

### 方式 A：命令行远程调试（最简单）

在 `runIde` 时挂一个调试器端口：

```bash
./gradlew runIde --no-daemon \
  -Dorg.gradle.jvmargs="-agentlib:jdwp=transport=dt_socket,server=y,suspend=n,address=5005"
```

然后在 IntelliJ IDEA（你日常用的那个 IDE，不是 runIde 启动的测试 IDE）里：

1. Run → Edit Configurations → + Remote JVM Debug
2. Host: `localhost`, Port: `5005`
3. 点 Debug 连接，即可在 `packages/jetbrains/src/main/kotlin/` 的 Kotlin 代码上打断点

### 方式 B：用 IntelliJ IDEA 直接打开本项目调试（推荐）

1. 用 IntelliJ IDEA 打开 `packages/jetbrains` 目录（或整个 monorepo）
2. 等待 Gradle sync 完成
3. 右上角 Gradle 工具窗口 → `wave-jetbrains` → Tasks → intellij platform → 双击 `runIde`
   - 或在 `build.gradle.kts` 旁的绿色三角运行
4. 断点直接在编辑器里点行号左侧设置即可，自动生效

> 方式 B 不需要手动挂端口，IDE 会自动用调试模式启动测试实例。

## 4. 查看日志

测试 IDE 的所有日志（包括插件的 `LOG.xxx`）写入 sandbox 目录：

```
packages/jetbrains/build/idea-sandbox/IC-2024.2/log/idea.log
```

### 实时跟踪日志

```bash
tail -f packages/jetbrains/build/idea-sandbox/IC-2024.2/log/idea.log | grep -i wave
```

### 关键日志前缀

插件代码里用 `com.intellij.openapi.diagnostic.logger<T>()` 打日志，搜以下关键词：

| 关键词 | 来源 | 含义 |
|--------|------|------|
| `[wave-stdio]` | `StdioClient.kt` | wave 进程的 stderr 输出 |
| `wave stdio stdout stream closed` | `StdioClient.kt` | wave 进程退出 |
| `Failed to parse stdio line` | `StdioClient.kt` | JSON-RPC 解析失败 |
| `Failed to parse webview message` | `JcefBridge.kt` | webview→Kotlin 消息解析失败 |
| `executeJavaScript failed` | `JcefBridge.kt` | Kotlin→webview 注入失败 |
| `Failed to load wave webview` | `WavePanel.kt` | 资源提取或 HTML 加载失败 |
| `Wave session error` | `WaveSession.kt` | Agent 回调报错 |

### 在 IDE 内查看日志

测试 IDE 里：Help → Show Log in Finder，直接打开 `idea.log` 所在目录。

## 5. 配置（apiKey / model / headers）

插件配置存储在 sandbox 的 `wave.xml`：

```
packages/jetbrains/build/idea-sandbox/IC-2024.2/config/options/wave.xml
```

`WavePluginService` 是 `@State(name="WavePlugin", storages=[Storage("wave.xml")])` 的 `PersistentStateComponent`。修改后无需重启，`updateConfiguration` 命令会通过 `agent.updateConfig()` 热更新给 wave 进程。

## 6. 排查常见问题

### 插件不兼容 / 工具窗口不出现

日志里若出现 `plugin ... is not compatible`，检查 `build.gradle.kts` 的 `sinceBuild`。**必须是构建号（如 `242`），不是产品版本号（`2024.2`）**——后者作为整数比 `242` 大会被判定为不兼容。

### Wave 面板空白 / 不显示 React UI

1. 确认 webview dist 已构建：`ls packages/webview/dist/` 应有 `chat.js` + `chat.css`
2. 确认资源已拷贝：`ls packages/jetbrains/src/main/resources/webview/`
3. 看 `idea.log` 是否有 `Failed to load wave webview` 或 `executeJavaScript failed`
4. JCEF 在直接启动时 sandbox 被禁用（日志 `JCEF-sandbox was disabled`），这是正常的，不影响功能
5. **看 JS console**：搜 `idea.log` 中 `[webview-console]` 前缀——webview 的 `console.log/error` 已转发到这里。
6. **加载方式**：必须用 `loadURL("file://.../index.html")` 而非 `loadHTML(html)`。后者页面 origin 非 file://，会被同源策略拦截 `file://` 子资源，导致 JS 不执行、面板空白

### 发消息无响应 / `cefQuery is not a function`

**根因**：`JBCefJSQuery` 注入的全局函数名是 `cefQuery_<hash>_<index>`，**不是** `cefQuery`。shim 不能直接调 `window.cefQuery`，否则报 `Uncaught TypeError: window.cefQuery_xxx is not a function`，消息全丢。

**当前机制**（`JcefBridge.kt` + `vscode-shim.js`）：
- `JcefBridge` 注册 `CefLoadHandlerAdapter`，在 `onLoadEnd` 时用 `jsQuery.inject("request")` 注入固定桥接函数 `window.__wavePostMessage`——它内部调用真正的 `cefQuery_<hash>_<index>`。
- shim 的 `postMessage` 调 `__wavePostMessage`，并加 queue + 10ms poll（React mount 触发 `webviewReady` 可能早于 `onLoadEnd` 注入）。

**排查**：搜 `idea.log` 中 `[onLoadEnd] injected __wavePostMessage bridge`，若缺失说明 load handler 未触发。官方文档：https://plugins.jetbrains.com/docs/intellij/embedded-browser-jcef.html

### wave 进程没起来 / 发消息无响应

1. 确认本机已全局安装 wave：`which wave` 应有输出
2. 若没有，`BinaryResolver` 会尝试 `npm install -g wave-code` 自动安装——看日志里有无相关错误
3. 看 `idea.log` 中 `[wave-stdio]` 前缀的 stderr 输出，判断 wave 进程是否崩溃
4. wave 进程退出后 `StdioClient` 会 reject 所有 pending 请求，日志会有 `wave --stdio process exited`

### 改了 Kotlin 代码不生效

`runIde` 之前确保重新编译。最稳妥：

```bash
./gradlew clean buildPlugin --no-daemon && ./gradlew runIde --no-daemon
```

### 中文输入法崩溃（JBCefInputMethodAdapter NPE）

输入中文时报 `NullPointerException: Cannot read field "from" because "replacementRange" is null` at `JBCefInputMethodAdapter.inputMethodTextChanged`。这是 JetBrains JCEF 在 macOS 上处理输入法事件的平台 bug，与插件业务无关。

- **影响**：仅在触发输入法时崩溃，静态 UI 渲染不受影响。
- **绕过**：无公开 API 禁用该适配器。升级 `platformVersion`（如 2024.3+）可修复。
- **追踪**：暂用英文输入或粘贴方式规避。

### 改了 webview 代码不生效

```bash
cd packages/webview && pnpm run compile
cd ../jetbrains && ./gradlew runIde --no-daemon
```

`copyWebviewAssets` task 会自动把新 dist 拷过来。若仍不生效，删掉 `src/main/resources/webview/` 下的文件再重跑，强制重新拷贝。

## 7. 快速验证清单

改完代码后，按这个顺序验证：

- [ ] `./gradlew buildPlugin --no-daemon` 成功（编译通过）
- [ ] `./gradlew runIde --no-daemon` 启动测试 IDE，无 `not compatible` 警告
- [ ] 右侧出现 Wave 工具窗口，点开显示聊天界面（非空白）
- [ ] 在输入框打字发消息，`idea.log` 出现 `[wave-stdio]` 相关日志（说明 stdio 链路通）
- [ ] 关闭工具窗口，wave 子进程被清理（`ps aux | grep wave` 不应残留 `--stdio` 进程）

## 8. 关键源码位置

| 文件 | 职责 |
|------|------|
| `src/main/kotlin/.../WavePanel.kt` | JCEF 浏览器 + 全链路接通入口 |
| `src/main/kotlin/.../bridge/JcefBridge.kt` | JS↔Kotlin 双向消息桥 |
| `src/main/kotlin/.../bridge/WebviewContentBuilder.kt` | 资源提取 + HTML 生成 |
| `src/main/kotlin/.../session/WaveSession.kt` | stdio 连接 + 状态 + 节流 |
| `src/main/kotlin/.../session/MessageHandler.kt` | webview 命令分发 |
| `src/main/kotlin/.../session/PermissionFlow.kt` | 权限确认流程 |
| `src/main/kotlin/.../stdio/StdioClient.kt` | JSON-RPC 传输层 |
| `src/main/kotlin/.../stdio/StdioAgent.kt` | Agent 封装 + 通知映射 |
| `src/main/kotlin/.../stdio/BinaryResolver.kt` | wave 二进制查找/安装 |
| `src/main/resources/webview/vscode-shim.js` | acquireVsCodeApi + __waveReceive 垫片 |
