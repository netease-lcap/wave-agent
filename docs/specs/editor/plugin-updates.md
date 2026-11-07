---
name: "插件更新策略"
description: "VS Code 扩展与 JetBrains 插件的更新交由官方市场机制，各宿主的状态对话框都不提供手动检查更新入口"
order: 50
---

# 功能规格说明：插件更新策略

**规格文件**：`docs/specs/editor/plugin-updates.md`
**创建日期**：2026-08-10

> 本规格定义 VS Code 扩展（`packages/vscode`）与 JetBrains 插件（`packages/jetbrains`）的版本更新策略：插件不内置更新检查（不查询 GitHub Releases、不查询企业 manifest、不自动下载安装），更新完全由官方市场机制负责（VS Code 扩展自动更新 / JetBrains Marketplace 插件更新）。桌面应用（`packages/desktop`）是独立 Electron 应用，走 electron-updater 自有机制，不在本规格范围。CLI 的 `wave update` 命令见 [Update 命令](../commands/update-command.md)。

## 用户场景与测试 _（必填）_

### 用户故事：插件更新由官方市场机制管理（优先级：P1）

作为使用 VS Code 扩展或 JetBrains 插件的用户，我希望插件版本的检查与更新完全由官方市场机制负责，插件自身不内置更新检查逻辑，以便更新体验与官方渠道一致，且插件不依赖平台内部 API。

**为什么是这个优先级**：JetBrains Marketplace 审核禁止插件使用平台内部 API（`PluginInstaller` 等无公开替代品），自建更新检查同时带来双端行为漂移；移除后插件完全复用官方更新通道。

**独立测试**：安装从市场发布的插件版本，确认插件运行期间不产生任何自建更新检查的网络请求；发布新版本到市场后，IDE/VS Code 通过其原生机制提示更新。

**验收场景**：

1. **假设** VSCE 扩展从 VS Code Marketplace 安装，**当**新版本发布到市场时，**则** VS Code 按扩展自动更新设置完成更新，插件自身不发起任何更新检查。
2. **假设** JetBrains 插件从 JetBrains Marketplace 安装，**当**新版本发布到市场时，**则** IDE 按其插件更新设置提示并完成更新，插件自身不发起任何更新检查。
3. **假设** VSCE 扩展或 JetBrains 插件启动，**当**插件运行时，**则**插件不向 GitHub Releases API 或企业下载 manifest 端点发起更新检查请求。

---

### 用户故事：状态对话框不提供手动检查更新入口（全部宿主）（优先级：P1）

作为 VS Code 扩展、JetBrains 插件或桌面应用的用户，我希望状态对话框只展示版本信息、不提供「检查更新」按钮：插件更新统一由官方市场管理，桌面应用的更新由后台自动检查驱动（发现即静默下载，下载完成后账户卡片出现「更新」按钮）。

**为什么是这个优先级**：状态对话框是只读的信息面板，两者的版本信息都由宿主随 `statusResponse` 下发，不需要也不应该在这块面板上挂动作；桌面端若保留手动检查，就会与「启动自动检查 + 运行期轮询」并存出第二套提示口径（一次 toast 的结果反馈），而真正的升级入口已经是账户卡片那个按钮（[desktop-account.md](../desktop/desktop-account.md)「账户卡片 · 更新按钮状态机 S0–S3」）。

**独立测试**：在 VS Code、IntelliJ 与桌面应用中分别打开状态对话框，确认版本行只有版本号、没有「检查更新」按钮（桌面端同样不渲染）；桌面端确认不发 `checkForUpdates` 命令、更新仍随自动检查走完 S0–S3。

**验收场景**：

1. **假设** 用户在任一宿主（VS Code / JetBrains / 桌面应用）打开状态对话框，**当**对话框渲染版本行时，**则**只显示版本号，不显示任何更新检查按钮或其它触发更新的入口。
2. **假设** 桌面应用用户想让应用检查新版本，**当**他不做任何操作，**则**启动自动检查与运行期轮询（[desktop-distribution.md](../desktop/desktop-distribution.md)「桌面端自动更新」场景 1/11）会自行发现并静默下载，下载完成后账户卡片的「更新」按钮出现——升级不依赖任何手动检查。

---

### 边界情况

- **非市场渠道安装（内网手动下载 zip 安装）怎么办？** 插件不内置更新检查；新版本通过官方渠道发布后，由用户自行获取新版本安装包手动更新（IDE 只对从市场安装的插件执行自动更新）。
- **JetBrains 插件从市场安装后仍被 verifier 报告内部 API 使用怎么办？** 本规格移除 `UpdateChecker`（唯一使用 `PluginInstaller` / `IdeaPluginDescriptorImpl` 的代码）后，重新构建并上传，verifier 不应再报告内部 API 使用。
