---
name: ide-plugin-publish
description: 发布 IDE 插件（VS Code 扩展 + JetBrains 插件）到各自 marketplace。当用户要求"发布 ide/vs code/jetbrains 插件"、"发布到 marketplace"、或询问插件发布流程时使用。
allowed-tools:
  - Bash
---

# IDE 插件发布流程

发布 IDE 插件**不需要本地构建**。仓库 `release.js` 打 tag 后，CI（publish.yml）已把产物上传到 GitHub Release，直接下载产物上传到 marketplace 即可。发布前先确认对应版本 tag 的 Publish Package workflow 跑完、Release 资产已生成。

（例外：**pre-release 通道**不能用 CI 产物，必须本地重新打包 —— 见下方「Pre-release」。）

## 凭证

- **VS Code**：走 `az login` 的 Entra 身份（lewis617@163.com，已是 publisher `wave-codechat` 的 Owner），无需 token。PAT（`VSCE_PAT`）方式也可用但 2026-12-01 退役，优先 azure-credential。
- **JetBrains**：永久 token，存于 `~/.wave/jetbrains-token`（纯文本，`cat` 读取；明文敏感，勿外传/勿复制进聊天，引用该路径读取）。
  - 当前有效 token 的 marketplace 用户 ID 是 **20066**；旧 token（用户 ID 19823）已失效（8-24 确认，`403 token is invalid`）。
  - ⚠️ **不要用 gradle `publishPlugin` 发布**：gradle 插件的认证方式对此 perm token 不兼容（报 `Authentication Failed: token is invalid`），即使 token 有效。**用 Bearer 直传 API**（见下）。

## 发布前检查（每次都做）

1. **`git pull` 主仓库到最新**：`release.js` 的版本 bump 是经 PR 合入 main 的，本地不 pull 就会以**旧版本号**打包（实战踩过：本地停在 bump 之前的 commit，结果以 1.1.10 发了一个本该是 1.1.11 的 pre-release）。
2. **核对版本号**：`python3 -c "import json;print(json.load(open('packages/vscode/package.json'))['version'])"`（JB 看 `packages/jetbrains/gradle.properties`）。
3. **看市场现状**：`cd packages/vscode && pnpm exec vsce show wave-codechat.wave-vscode` —— 只列 **stable** 版本；注意我们市场正式版可能落后于 GitHub Release 很多（2026-09-10 时 stable 还停在 1.1.5，而桌面/tag 已到 1.1.11）。

## VS Code 扩展发布

```bash
# 1. 下载产物
gh release download -R netease-lcap/wave-agent wave-vscode@<version> --pattern "*.vsix"

# 2. 验证身份（可选但推荐）
cd packages/vscode && pnpm exec vsce verify-pat wave-codechat --azure-credential

# 3. 发布（--packagePath 传绝对路径，产物在仓库根目录）
VSIX="$PWD/wave-vscode-<version>.vsix"
cd packages/vscode && pnpm exec vsce publish --azure-credential --packagePath "$VSIX"
```

注意：`vsce` 在 `packages/vscode` 包作用域下（`pnpm -F wave-vscode exec` 或 cd 进去）。`--azure-credential` 依赖 az CLI 已登录（`az account show` 确认）。

### Pre-release

**CI 产物发不了 pre-release**：vsce 要求 manifest 带 `Microsoft.VisualStudio.Code.PreRelease`，只有 `vsce package --pre-release` 会写它；拿 Release 的 .vsix 发布必然报 `Cannot use '--pre-release' flag with a package that was not packaged as pre-release.`

```bash
git pull && pnpm install --frozen-lockfile   # 前置：依赖必须装全，否则打包脚本构建上游时会缺产物
pnpm run vsce:package:pre          # 正式版用 pnpm run vsce:package

VSIX="$PWD/packages/vscode/releases/wave-vscode-<新版本号>.vsix"
cd packages/vscode && pnpm exec vsce publish --pre-release --azure-credential --packagePath "$VSIX"
```

- 版本号必须是**新的**（marketplace 拒重复版本）。
- **别绕过这两个脚本手搓 `vsce package`**：打包本身只拷贝预构建产物，脚本负责先按 CI 的顺序构建上游。旧版就因此夹带过旧 CLI（扩展后端是新的、CLI 是旧的），用户端表现为「修复发了却还是老样子」。
- 放行前自检：解出 vsix，确认 manifest 有 `Pre-release`，且本次修复的特征串在 CLI bundle 里
  （`grep -c <特征串> <解出的>/extension/dist/wave-cli/dist/bundle/wave.mjs`）。

## JetBrains 插件发布

```bash
# 1. 下载产物
gh release download -R netease-lcap/wave-agent wave-jetbrains@<version> --pattern "*.zip"

# 2. Bearer 直传 uploadPlugin API（认证用新 token，身份识别用 xmlId）
node -e "
const fs = require('fs');
const TOKEN = process.argv[1];
const zip = process.argv[2];
(async () => {
  const form = new FormData();
  form.append('file', new Blob([fs.readFileSync(zip)]), zip.split(/[\\\\/]/).pop());
  const r = await fetch('https://plugins.jetbrains.com/plugin/uploadPlugin?xmlId=com.wave.jetbrains', {
    method: 'POST',
    headers: { 'User-Agent': 'wave-agent', 'Authorization': 'Bearer ' + TOKEN },
    body: form
  });
  console.log('status', r.status, '|', (await r.text()).slice(0, 200));
})();
" "$(cat ~/.wave/jetbrains-token)" "<zip绝对路径>"
```

## 预发布 / 测试通道（给 tester）

两端通道都**公开可见**（不是定向内测），用户需自行 opt-in；审核不是瓶颈、用户侧一次性配置才是。

### VS Code：pre-release

必须**本地重打包**（CI 产物发不了，原因与命令见上方「Pre-release」）。

语义与坑：

- pre-release 与 release **共用同一 X.Y.Z 单调序列**，同号不能双发；发更高号的正式版会自动把 pre 用户收回来。
- **`vsce show` 与市场公开 items 页面只显示 stable**，pre 版本看不到属正常；**扩展查询 API（`extensionquery`，`flags: 401`）能看到 pre，但有传播滞后**（实测发布后 5~8 分钟仍可能只回上一版），别据此判定发布失败——发布成功仍以 vsce 的 `DONE Published …` 为准。
- 用户侧：扩展页 → 齿轮/右键 → **Switch to Pre-Release Version**。

### JetBrains：自定义 channel

```js
form.append("channel", "beta"); // 与 file 一起 multipart 提交；不带 channel = 默认 Stable
```

- **auto-approval**：插件在 Stable 通道近期有已批准更新时，自定义 channel 上传自动过审（实测 `201 {approve:true}`，分钟级）；不满足则转人工审核。「近期」这个窗口是 **JetBrains 侧规则**（2026-09-18 观察为 120 天），**可能变、别当契约** —— 一律以本次上传响应里的 `approve` 字段为准。
- **审核时长不写死、也不对外承诺**：时长不定，**以 JetBrains 发来的批准邮件为准**（回 `approve:false` 时就等邮件，别因为「已经过了 N 天」而重传或改口径）。旧文档里「官方口径约 2 个工作日」是与实测不符的固定天数，已废弃。
  - 当次实测：2026-09-18 往 **stable** 传 1.2.5（update id `1174611`，`cdate` `2026-09-18T14:05:39Z` = 16:05:39 GMT+2）→ **16:15 GMT+2 收到批准邮件**，约 10 分钟。**当次实测，不是承诺。**
- **stable 与自定义 channel 是两条独立的线，发一条覆盖不了另一条**（「发了 beta 但用户端没变化」的成因就在这）：
  - **不带 `channel` 字段 = stable 通道**。存量用户（默认仓库）只吃这条线 —— **只往 `beta` 传，他们的插件列表里会一直显示旧版**。要覆盖存量用户，**必须每轮往 stable 也发一次**。
  - **反向同理**：`channel` 优先于默认，订阅了 beta 的用户看不到之后只发在 Stable 的新版本 → 想长期喂 beta 用户也须**每版双发**，否则让他们试用完切回默认仓库。
- 用户侧：`Settings → Plugins → ⚙ → Manage Plugin Repositories` 加自定义仓库 URL；**更省事的是直接装 GitHub Release 里的 zip**（内容与 beta 包一样）。

## 发布后校验

- VS Code：输出 `DONE Published wave-codechat.wave-vscode vX.Y.Z`；页面 https://marketplace.visualstudio.com/items?itemName=wave-codechat.wave-vscode
  - 版本列表 / 市场页面刷新有滞后，**别据此判定失败**（历史出过「发了新版但用户端无变化」的事故）。跑下面三步硬证据链：
    1. **直下预发布包**（用 node fetch，不要 curl；能下 = 市场已收下该版本，比列表刷新快）：
       ```bash
       node -e "
       (async () => {
         const url = 'https://marketplace.visualstudio.com/_apis/public/gallery/publishers/wave-codechat/vsextensions/wave-vscode/<version>/vspackage';
         const r = await fetch(url);
         console.log('status', r.status, '|', r.headers.get('content-type')); // 期望 200 application/vsix
         require('fs').writeFileSync('/tmp/wave-vscode-<version>.vsix', Buffer.from(await r.arrayBuffer()));
       })();
       "
       ```
    2. **解包验真**：`extension.vsixmanifest` 里 `Version="<version>"` 且存在 `Microsoft.VisualStudio.Code.PreRelease` 的 `Value="true"`。
       ```bash
       unzip -o -q /tmp/wave-vscode-<version>.vsix -d /tmp/wave-vscode-<version>
       grep -E 'Version="<version>"|Microsoft\.VisualStudio\.Code\.PreRelease' /tmp/wave-vscode-<version>/extension.vsixmanifest
       ```
    3. **CLI 防呆自检**：解出的 `extension/dist/wave-cli/dist/bundle/wave.mjs` 的 sha256 **必须等于**本地新构建的 `packages/code/dist/bundle/wave.mjs`（发 pre 包前刚跑过 `pnpm run vsce:package:pre`）—— 专防「上游产物过期被夹带」。
       ```bash
       sha256sum /tmp/wave-vscode-<version>/extension/dist/wave-cli/dist/bundle/wave.mjs packages/code/dist/bundle/wave.mjs
       ```
- JetBrains：上传返回 **201 + 版本记录 JSON**，形如 `{id: 1173146, version: "1.2.4", approve: true, listed: true, channel: "beta"}`；插件 https://plugins.jetbrains.com/plugin/33466（Wave Code Chat）。
  - **auto-approval 已连续多轮命中**（beta 的 1.2.2 / 1.2.3 / 1.2.4，以及 2026-09-18 的 stable 1.2.5）⇒ 基本零人工等待；只有回 `approve: false` 时才需等人工审核，**时长以批准邮件为准、不做固定天数承诺**（见上文「自定义 channel」里的实测）。
  - 回读核对（`updates` feed，首条应就是刚发的版本）：

    ```bash
    # 默认通道（stable）——要带 token 才看得到待审条目
    curl -s "https://plugins.jetbrains.com/api/plugins/33466/updates" \
      -H "Authorization: Bearer $(cat ~/.wave/jetbrains-token)" \
      | python3 -c "import sys,json;a=json.load(sys.stdin);print(len(a));print([(e['id'],e['version'],e['approve'],e['listed'],e['channel']) for e in a[:3]])"

    # 自定义通道 beta
    curl -s "https://plugins.jetbrains.com/api/plugins/33466/updates?channel=beta" \
      -H "Authorization: Bearer $(cat ~/.wave/jetbrains-token)" \
      | python3 -c "import sys,json;a=json.load(sys.stdin);print(len(a));print([(e['id'],e['version'],e['approve'],e['listed'],e['channel']) for e in a[:3]])"
    ```

    - ⚠️ **无鉴权请求这个 feed 只回 `approve:true` 且 `listed:true` 的条目**：待审版本在那里根本看不到，**别据此判「没传上去」**。2026-09-18 实测：默认通道带 token 回 7 条、无鉴权回 6 条，差的正是那条 `approve:false` / `listed:false` 的 1.2.0 stable；`?channel=beta` 那次两个读法都是 6 条（该通道当时没有待审条目，看不出差别）。

## 坑

- **重复版本被拒**：marketplace 拒绝已存在的版本号，发布前确认该版本没发过；CI 与本地不要重复发。
- **本机 curl SSL 挂**：探测 marketplace API 用 node fetch，不要用 curl。
- **GitHub secret 状态**：CI 的 marketplace 发布步骤已移除（PR #1887），GitHub Actions secret `JETBRAINS_TOKEN` 仍是旧 token（无效）；若将来恢复 CI 自动发布，需更新 secret 并把调用方式改成 Bearer 直传（不能直接用 gradle publishPlugin）。
- 下载资产用 `gh release download -R netease-lcap/wave-agent <tag>`（在非 git 目录跑要显式 `-R`）。
