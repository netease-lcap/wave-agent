---
name: ops-upload
description: 往 CodeChat 制品发布接口发产物（两种部署都打企业端域名，路径恒为 `/api/publish/*`，静态令牌鉴权；test / drill / prod 三个环境，四条产物线共用一个脚本 upload.mjs）：桌面端三件套（dmg / mac.zip / exe，取 CI 的 Release 后 `--type desktop` 分片直传 → sha512 + feed 核验）、文档站包（本地 docs:pack 出包 → `--type docs` 单次上传 → 企业端 /docs/ 验对象）、远控 Web 页（pack:remote 出包 → `--type remote` 单次上传）、wave 官方插件市场快照（`--type plugin-market` 内容寻址 + latest 指针），外加台账读写（`--list` / `--delete` 回退版本）。当用户要求「上传/发布桌面端」「发 beta」「发/传文档站」「发/构建/传远控页（远端页、手机页面、web 端）」「发插件市场」「回滚版本」，或询问制品发布接口、发布令牌、发布台账时使用。
allowed-tools:
  - Bash
---

# 制品发布（桌面端 / 文档站 / 远控页 / 插件市场）

四条产物线，**同一个接口、同一把令牌、同一组环境、同一个脚本**（`.wave/skills/ops-upload/upload.mjs`，用 `--type` 选）；差别只在「包从哪来」和「落到哪」。

| 产物线        | 包从哪来                                             | 传什么                        | 脚本                              | 落到                                                                       |
| ------------- | ---------------------------------------------------- | ----------------------------- | --------------------------------- | -------------------------------------------------------------------------- |
| 桌面端三件套  | CI（publish.yml）的 GitHub Release，**不用本地构建** | `.dmg` / `-mac.zip` / `.exe`  | `upload.mjs --type desktop`       | 台账 `GET /api/publish/desktop` + 下载页/feed                              |
| 文档站包      | **本地** `pnpm run docs:pack`                        | `docs-<v>.tar.gz`             | `upload.mjs --type docs`          | file-center `codechat/docs/` → 企业端 `/docs/`（不入台账）                 |
| 远控 Web 页   | **本地** `pnpm -F wave-webview run pack:remote`      | `remote-page.zip`             | `upload.mjs --type remote`        | file-center 对象 + 企业端 `/remote/`                                       |
| wave 插件市场 | **本地** 打上游仓库整树快照                          | `wave-plugins-official-*.zip` | `upload.mjs --type plugin-market` | file-center `codechat/wave-plugins-official/<sha>.zip` + `latest.txt` 指针 |

**上传方式只有一条：脚本。** 不要用浏览器（运营端「下载管理 / 制品管理」页面已整条下线，没有上传入口了；分片直传也只能走脚本，原因见「坑」）。桌面端与文档包传完要按各自小节做核验：桌面端查台账字段 + feed，文档包**只能**验企业端对象（它不写台账）；远控页与插件市场传完看 `201` + 企业端对象/指针。

## 环境与鉴权（先看这段）

| 环境     | 地址（发布接口 = 访问面，同一个域名）       | 什么时候用                                                 |
| -------- | ------------------------------------------- | ---------------------------------------------------------- |
| **prod** | `https://codechat.codewave.163.com`         | **默认**。「上传/发布」「给 tester 测」「发 beta」都是这个 |
| test     | `https://codechat.codewave-test.163yun.com` | **仅当用户当次明确点名「测试环境」**                       |
| drill    | `https://codechat.lcap.hadri.163yun.com`    | 演练环境（hadri），用户点名时用                            |

- **两种部署都打企业端域名**：CodeChat 的 `/api/publish/*` 写入口跟着读入口走（2026-11-04 起），SaaS 与私有化都挂在企业端，运维只需要记一本地址。运营端 `neteasecc.*` **不再挂**这组接口（同路径 404）——只有还没升级到该版本镜像的环境，才需要 `--base` 指向运营端过渡。
- **路径逐字一致，只换 host**：同一份命令在两种部署下都能用。**私有化没有 `--env` 预设**（那是客户自己的域名），必须 `--base https://<客户企业端>` + 该环境的令牌。
- ⚠️ 打错环境**不会报错**：对象会静默写进另一个环境。脚本会把解析出的地址打印在第一行，动手前先核一遍。（`--base <URL>` 仍保留，和 `--env` 二选一。）
- **托管类产物要求 `--confirm-prod`**：`--type remote` / `--type plugin-market` 传 prod、以及**删生产台账行**时必须显式加这个开关（一传就对用户生效、打错环境不报错）；桌面端/文档包的历史命令不带它，保持原样。

### 令牌（`PUBLISH_TOKEN`）

只有一把与账号体系无关的**静态令牌**：`Authorization: Bearer $PUBLISH_TOKEN`，服务端 env 配置、至少 16 位。**没有登录，没有 `/api/auth/login`**，也不接受 ops / 企业端的任何登录态 JWT（带了也 401）。

取值优先级（脚本自己解析，**值从不打印**）：

1. `--token <令牌>`
2. 环境变量 `PUBLISH_TOKEN`
3. `~/.wave/publish-token.json` —— 按环境分键，推荐这种（别留在 shell history 里）：

```json
{
  "prod": "…",
  "test": "…",
  "drill": "…",
  "https://客户企业端": "…",
  "default": "…"
}
```

查表顺序：`--env` 名 → `--base` 的整条地址或 host（私有化用）→ `default`；文件里写 `{ "token": "…" }` 则当成全局令牌。

**三种失败态含义完全不同，别混**：

| 状态                                                           | 含义                                                              | 怎么办                                           |
| -------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------ |
| `401 {"error":"Invalid publish token"}`                        | 令牌错/缺失/拿登录 JWT 来试                                       | 换令牌，别去查"是不是没登录"                     |
| `503 {"error":"未配置 PUBLISH_TOKEN 环境变量（至少 16 位）…"}` | **该部署没开这个能力**                                            | 找运维补后端 env 并重启，不是你的令牌问题        |
| `404`                                                          | 这个 host 上没有这组接口：host 打错，或该环境后端还没部署这版代码 | 核地址；**别再猜「单个端点没上线」**（见「坑」） |

- ⚠️ **任何命令都不要回显令牌**：不要在命令行写字面量（临时用 `PUBLISH_TOKEN=… node …` 可以，但别进脚本/文档），不要让脚本打印令牌值——它只打印**来源**与长度。
- 令牌轮换 = 改后端 env 重启，旧令牌立即失效；脚本侧什么都不用清。

## 一、桌面端三件套

**不用本地构建**：CI 已把产物传到 GitHub Release，下载后直接上传。

### 发布前检查（每次都做）

1. **`git pull` 主仓库到最新**，并确认对应 `wave-desktop@<version>` tag 的 Publish Package workflow 已跑完、Release 资产已生成。
2. **核对版本号**：`python3 -c "import json;print(json.load(open('packages/desktop/package.json'))['version'])"` —— 上传时会用你传的 `--version` 落库并决定 fileKey，传错就是把包装到别的版本号下。
3. **从 GitHub Release 下载产物**（在非 git 目录跑要显式 `-R`）：
   ```bash
   gh release download -R netease-lcap/wave-agent wave-desktop@<version> --dir /tmp/wave-desktop-<version>
   ls /tmp/wave-desktop-<version>
   ```
   资产名随 electron-builder 的命名规则变，**以 `ls` 实际输出为准**（2026-09-20 实测为 `CodeWave.IDE-<v>-arm64.dmg` / `CodeWave.IDE-<v>-arm64-mac.zip` / `CodeWave.IDE.Setup.<v>.exe`）。

### 上传（分片直传）

零第三方依赖，Node 20+ 内置 `fetch` / `FormData` / `Blob`，从仓库根直接跑。

```bash
V=1.2.6
DIR=/tmp/wave-desktop-$V

S=.wave/skills/ops-upload/upload.mjs

# macOS 安装包
node $S --file "$DIR/CodeWave.IDE-$V-arm64.dmg"     --version "$V" --platform mac-dmg --channel stable
# macOS 更新包
node $S --file "$DIR/CodeWave.IDE-$V-arm64-mac.zip" --version "$V" --platform mac-zip --channel stable
# Windows 安装包
node $S --file "$DIR/CodeWave.IDE.Setup.$V.exe"     --version "$V" --platform win-exe --channel stable
```

**一次可发两条通道**：`--channels stable,beta`（逗号分隔，或重复写 `--channel`）⇒ 服务端落两行台账、安装包只传一次、file-center 只存一份。跑两遍（先 stable 后 beta）仍然安全，覆盖语义不变。发测试环境加 `--env test`、演练加 `--env drill`（默认 `--env prod`）。

| 参数                   | 说明                                                                                     |
| ---------------------- | ---------------------------------------------------------------------------------------- |
| `--file`               | 要上传的本地文件（必填）                                                                 |
| `--version`            | `X.Y.Z`，桌面端必填                                                                      |
| `--platform`           | `mac-dmg` / `mac-zip` / `win-exe`，桌面端必填（决定服务端落库的 canonical 文件名）       |
| `--channels`           | `stable` / `beta` / `stable,beta`，默认 `stable`（`--channel` 是它的单值写法，保留兼容） |
| `--release-notes-file` | 该版本的变更记录（markdown），随 init 提交、与通道无关（见下「变更记录」）               |
| `--type`               | `desktop`（默认）/ `docs` / `remote` / `plugin-market`                                   |
| `--env`                | `prod`（默认）/ `test` / `drill`                                                         |
| `--base`               | 直接指定地址，与 `--env` 二选一（私有化/兜底）                                           |
| `--token`              | 发布令牌；不传则依次看 `PUBLISH_TOKEN` 与 `~/.wave/publish-token.json`                   |
| `--dry-run`            | 只做 init + 第一片，**绝不调 complete**（不写库、不留可见记录），用于冒烟                |

### 变更记录（`--release-notes-file`，桌面端 S4 展示用）

**来源与发版同源**：CI 在打 `wave-desktop@<version>` tag 时已用同一个脚本生成 GitHub Release 的
body（`packages/desktop/scripts/release-notes.mjs`，见 `.github/workflows/publish.yml`
「Generate release notes」）。上传时**别手写**，直接从 Release 的 body 落成文件，保证 Release 与客户端
S4 看到的是同一份文本：

```bash
gh release view -R netease-lcap/wave-agent "wave-desktop@$V" --json body -q .body > /tmp/wave-desktop-$V/notes.md
node $S --file "$DIR/CodeWave.IDE-$V-arm64-mac.zip" --version "$V" --platform mac-zip \
  --channel stable --release-notes-file "$DIR/notes.md"
```

- **与通道无关、按版本存一份**：`--channels stable,beta` 一次上传只提交这一份，读的是同一份文本。
- **三件套各次 init 都带同一个文件**：成本为零，且不依赖「服务端只写非空」这种细节（issue 里的口径是按版本覆盖写，缺省时才不写）。
- **不带 = 该版本没有记录**：S4 与现状逐字一致，其余流程（检查/下载/重启）不受影响。**别用空文件冒充「有记录」**，脚本会拒收空文件与 >16KB 的文件（feed 里所有版本的记录共用 16KB 预算，超了请收紧生成脚本口径）。
- ⚠️ **等 vusion/codechat#50 上线后再在正式发布里带这个参数**：init 接口当前还不认识 `releaseNotes`，服务端对未知字段是「忽略」还是「400 拒绝」尚未确认（已在 issue 里问过）。上线前该参数只在 test 环境演练。
- **上线后要顺手验 feed**：`curl <server>/api/downloads/desktop/win/latest.yml | node -e "const y=require('js-yaml')…"` —— 解析成功且 `releaseNotes` 是**非空数组**、每项 `version`/`note` 都是字符串，才算真通。多行 markdown 一旦被字符串拼进 yml，**所有**客户端的更新检查都会挂（`ERR_UPDATER_INVALID_UPDATE_INFO`）。

### 验证要点（四路硬证，上传后逐一跑）

脚本在 `complete` 之后**已经自动核对**了 `version` / `platform` / `channels` / `sizeBytes` / `sha512`（不一致直接非零退出），下面第 1 步是回读台账再确认一遍「记录确实在库里」。

**1. 台账字段核对**：`--list` 读 `GET /api/publish/desktop`，看 `version` / `platform` / `channel` / `fileName` / `downloadUrl` / `fileSize` / `sha512`。**`sha512` 是 digest 的 base64（不是 hex）**，可与本地文件直接比：

```bash
node .wave/skills/ops-upload/upload.mjs --list --env test        # 生产去掉 --env test
```

```bash
# 本地文件的 sha512（base64），与台账里的那个逐字比
python3 -c "import base64,hashlib;print(base64.b64encode(hashlib.sha512(open('/tmp/wave-desktop-1.2.6/CodeWave.IDE-1.2.6-arm64.dmg','rb').read()).digest()).decode())"
```

一致 = 库里的记录指向的字节与本地文件逐字节相同。

**2. 下载地址可下且大小一致**：拿台账给的 `downloadUrl`（**别自己拼域名**）做 HEAD，期望 `200` 且 `content-length` 等于本地字节数：

```bash
curl -sI "<上一步打印的 downloadUrl>" | grep -iE '^HTTP/|content-length'
stat -c %s /tmp/wave-desktop-1.2.6/CodeWave.IDE-1.2.6-arm64.dmg
```

**3. 桌面端修复特征串**（确认发出去的是这个构建）：macOS 更新包是 zip 包着 `.app`，`.app/Contents/Resources/app.asar` 就是宿主 bundle：

```bash
unzip -o -q /tmp/wave-desktop-1.2.6/CodeWave.IDE-1.2.6-arm64-mac.zip "CodeWave IDE.app/Contents/Resources/app.asar" -d /tmp/asar-chk
grep -c "<本次修复的特征串>" /tmp/asar-chk/"CodeWave IDE.app/Contents/Resources/app.asar"   # 期望 ≥1
```

⚠️ **中文特征串直接 grep 会 0 命中**：打包器（esbuild）把非 ASCII 转义成 `\uXXXX` 存进产物。2026-09-22 实测 1.2.9 的 asar：`grep -c "企业本期额度已用尽"` = **0**，`grep -c '\u4F01\u4E1A\u672C\u671F\u989D\u5EA6\u5DF2\u7528\u5C3D'` = **1**。所以**优先挑 ASCII 锚**（testid / 变量名 / 函数名，如 `account-plan-conclusion`，同一次实测 2 命中）；只有当修复点只有中文字面量可搜时才按转义串搜：

```bash
# 中文 → \uXXXX（注意 python 那侧要用 raw string，否则 \u%04X 不是合法转义）
printf '%s' '企业本期额度已用尽' | python3 -c "import sys;print(''.join(r'\u%04X'%ord(c) for c in sys.stdin.read()))"
# \u4F01\u4E1A\u672C\u671F\u989D\u5EA6\u5DF2\u7528\u5C3D
```

**4. feed 端到端核对（必做）**：上面第 1 步读的是**运营平台库里的记录**；客户端（electron-updater）实际读的不是它，而是**企业端后端按 electron-builder 格式动态生成的 feed yml**。feed 的基地址就**是客户端配置里的 `serverUrl` 本身**——桌面端把它缓存下来**只为拼 feed URL**（见 `packages/desktop/src/main/updateAutoUpdater.ts` 的 `feedUrlFor`），所以要拿值为准就去读该环境客户端的 `serverUrl`：设置页「服务端地址」/ `~/.wave/settings.json` 的 `env.WAVE_SERVER_URL` / 桌面端 `userData/wave-desktop.json` 里的 `serverUrl` 缓存。feed 与发布接口现在是**同一个域名**（2026-11-04 起），不再有「两个域名」那层坑。

- 端点（`serverUrl` 下，**无鉴权**）：beta = `…/api/downloads/desktop-beta/{mac|win}/…`，stable 去掉 `-beta` = `…/api/downloads/desktop/{mac|win}/…`。**mac 用 `latest-mac.yml`（对应 zip 更新包）、win 用 `latest.yml`（对应 exe 安装包）**；dmg 不参与自动更新 feed。
- 期望：`200` + `version:` 等于本次上传的版本 + `files[0].sha512`（base64）与本地文件 `hashlib.sha512(...).digest()` 的 base64 **一致** + `size` 等于本地字节数 + `path`/`url` 指向该环境的 file-center。
- 为什么要查：**这是客户端真正读取的东西**——第 1 步只证明「库里有记录 / 对象存进去了」，feed 才证明「客户端会看到这个版本」。顺手还能证明**没污染另一条通道**：往 beta 传完之后 stable feed 的 `version` 应当**不变**（stable / beta 是两条独立的线）。

```bash
python3 - <<'PY'
import base64, hashlib, urllib.request
server = 'https://codechat.codewave.163.com'   # = 该环境客户端的 serverUrl，取值为准
chan, plat, yml = 'desktop-beta', 'mac', 'latest-mac.yml'   # stable 用 'desktop'；win 用 'latest.yml'
local = '/tmp/wave-desktop-1.2.9/CodeWave.IDE-1.2.9-arm64-mac.zip'
txt = urllib.request.urlopen(f'{server}/api/downloads/{chan}/{plat}/{yml}').read().decode()
lines = txt.splitlines()
ver = next(l for l in lines if l.startswith('version:')).split(':', 1)[1].strip()
sha = next(l for l in lines if l.strip().startswith('sha512:')).split(':', 1)[1].strip()
size = next(l for l in lines if l.strip().startswith('size:')).split(':', 1)[1].strip()
data = open(local, 'rb').read()
print('feed version =', ver)
print('sha512 match =', sha == base64.b64encode(hashlib.sha512(data).digest()).decode())
print('size  match =', size == str(len(data)))
PY
```

**域名只有一个了，别再按「两个域名」排查**（2026-11-04 起发布接口与访问面同域，都在企业端）：

```bash
# 发布接口与 feed 用同一个 host，都对
curl -s "https://codechat.codewave-test.163yun.com/api/downloads/desktop-beta/mac/latest-mac.yml"

# 仍会 404 的只有两种情况
#   ① host 打错（不是该环境的**企业端**域名）：{"error":"Not found"}
#   ② 该环境跑的还是 2026-11-04 之前的镜像（那时发布接口只挂运营端）
#      → 临时用 --base https://neteasecc.<环境> 指向运营端，等发版后再切回
```

运营端 `neteasecc.*` 已不再挂这组接口（2026-11-04 起全仓只有企业端一个写面），旧地址只当「环境还没升级镜像」时的过渡兜底；产物读路径全在企业端，传完在同一个域名上验证，不用在两本地址之间来回切。

## 二、文档站包

**要本地构建**：发版 CI 不再构建文档（`publish.yml` 只发 npm 包 + 建 Release），GitHub Pages 的站点另由 `pages.yml` 在 push main 时构建，与这里无关。

### 出包

```bash
pnpm run docs:pack                           # 生成截图 → vitepress build --base /docs/ → 打 tar.gz
pnpm run docs:pack -- --reuse-screenshots    # 截图刚跑过、只想重新打包时用
```

产物是仓库根 `docs-<version>.tar.gz`（版本号读根 `package.json`，已 gitignore），压缩包根就是 `index.html`。`--base /docs/` 是**平台侧的托管前缀**，别换成 config.js 里的 `/wave-agent/`（那是 GitHub Pages 的 base）；截图来自 Playwright demo，本机没装 Chromium 就先 `pnpm -F wave-webview exec playwright install chromium`（版本要跟仓库的 playwright 对齐，装错了会报 `Executable doesn't exist at …chromium_headless_shell-<build>/…`）。

⚠️ **Windows 两个坑**（2026-11-04 实机踩到，各浪费一轮上传）：

- `docs:pack` 里 `execFileSync("pnpm", …)` 在 Windows 上找不到 `pnpm.cmd`（脚本已在 `scripts/pack-docs.mjs` 里用 `shell: win32` 兜住；改之前手动跑就得逐条替换成 `pnpm …`）。
- **手动**执行 `DOCS_BASE=/docs/ pnpm exec vitepress build docs` 时，Git Bash 会把 `/docs/` 当路径转换成 `C:/Program Files/Git/docs/`，产物的资源 URL 全变成 `C:/Program Files/Git/docs/assets/…`（上传后整站白屏，且 201 一切正常）。手动跑必须 `MSYS_NO_PATHCONV=1 DOCS_BASE=/docs/ …`，打完**先在本机 `grep 'assets/' dist/index.html` 看一眼前缀是不是 `/docs/`**。

### 上传

```bash
node .wave/skills/ops-upload/upload.mjs --file docs-<version>.tar.gz --type docs --env prod
```

- `--type docs` **不传** `--version`/`--platform`/`--channel`，文件名须为 `.tar.gz` 或 `.zip`（服务端单文件上限 100MiB）。
- **单次 multipart，不分片**：`POST /api/publish/docs`（字段 `archive`）。服务端一次收包 → 解包（解包**前**校验条目路径，含 `..` 或绝对路径直接 400）→ 逐文件传 file-center（`codechat/docs/<包内相对路径>`，其余文件并发 10、根 `index.html` **最后写**）→ 中途失败回滚本次已传对象。因此**不需要 `codechat-ops-route` 亲和 cookie**（没有跨请求的会话状态）。
- **不写台账**：文档站永远只有「最新版」一个状态，传完没有可回读的记录、也**没有删除与回滚接口**（要清空线上文档只能去 file-center 删 `codechat/docs/` 下的对象）。整包重传即整站覆盖，幂等安全。
- `--dry-run` 只做令牌校验 + 本地包大小预检（单次请求没有「只传一半」的中间态）。

### 核验

1. **接口返回**：成功是 `201` + `{ prefix, entryFileKey, fileCount, fileKeys }`。`prefix` 应为 `codechat/docs`，`fileCount` 等于本地包内文件数（`tar -tzf docs-<version>.tar.gz | wc -l`）。
2. **企业端对象真的在**（托管类资源，201 只证明服务端收下并转存了）：三个环境的 `/docs/` 都应 200，再从 `/docs/` 的 index.html 里取带 hash 的资源名逐个 `curl` 核 200。**别只探 `/docs/` 首页就收工**——资源前缀写错（见上面 Windows 那个坑）时首页照样 200，但页面是白屏。
3. ⚠️ **别再去台账里找 docs 行**：文档记录从未进台账（`GET /api/publish/desktop` 里没有 docs 行），看到「没有 docs 行」不是上传失败。

## 三、远控 Web 页

页面**不发版**：几个静态文件传成 file-center 对象，企业端 `/remote/` 立刻可见，后端不转发、不用重建镜像 ⇒ 换一版页面 = 传一次对象。

**上线是三件互相独立的事**，别混：① 合 main ≠ 线上页面已更新（只由上传决定，多轮实测滞留过旧产物）；② 页面已更新 ≠ machine 已更新（服务端方法白名单在**服务那个会话的进程**里，旧机器上只显示「…指令没有回执」，新能力不可用、旧能力照常）；③ 产物是构建快照 ⇒ 上传后 main 再前进它就落后。

### 出包

三个前置（每次都做）：**提交之后再打包**（lint-staged 的 prettier 会重排 CSS/JS、hash 会变，2026-10-14 实测踩到）→ **`git log --oneline HEAD..origin/main` 为空**（否则先 rebase，且用已 ff 到目标提交的主检出，别拿 worktree 里 rebase 前的旧 `dist/`）→ **先 `pnpm -F wave-agent-sdk build`**（SDK `dist/` 陈旧时 `pack:remote` 会红在 esbuild 的 `No matching export … WORKFLOW_SIZE_WARNING_AGENTS`，看着像 remote 源码坏了）。

```bash
pnpm -F wave-agent-sdk build
pnpm -F wave-webview run pack:remote           # = node remote/build.mjs --zip
```

产物在 `packages/webview/remote/dist/`（gitignored）：`index.html` + `chat.<hash>.js` / `chat.<hash>.css` / `shim.<hash>.js` / `sw.<hash>.js` / `mermaid.<hash>.js` / `manifest.<hash>.json` / `apple-touch-icon.<hash>.png` / `icon-512.<hash>.png`，外加交付容器 `remote-page.zip`（根层含 `index.html`）。**数量不进契约**：收端只要形状（根层 `index.html` + 扩展名白名单 + 路径正则 + 上限），加删文件不需要对面改代码。

### 上传

```bash
S=.wave/skills/ops-upload/upload.mjs

# 预检：环境解析 / zip 形状 / 本次构建 version+sha / 令牌 / 上传前线上版本，不写任何东西
node $S --type remote --env test --dry-run

# 正式上传（--file 可省，默认取 packages/webview/remote/dist/remote-page.zip）
node $S --type remote --env test
node $S --type remote --env prod --confirm-prod
```

- **`--env prod` 必须加 `--confirm-prod`**：打错环境不报错、对象静默写进别处，多一道闸（只有远控页与插件市场有这道闸）。
- **成功判据**：`201` + `fileKeys` 数量 = **产物文件数**（整包重传是幂等覆盖，重跑同一条命令安全）。脚本会把数量与包内文件数比对，不一致会告警。
- **不再有版本标签**：上传接口只收 zip，不写 `version.txt` —— 那个指针既不参与任何判定、也不跟内容绑定。想知道传的是哪份构建，看入口页自己带的 `wave-remote-config`（构建期注入的 `version` + 构建 sha，`--dry-run` 会同时打印**本次构建**与**线上当前版本**，报告里直接抄）。
- **没有删除接口** ⇒ 回滚只能另打一份覆盖同名文件，或让 SRE 删 file-center 对象；**旧 hash 名永不清理**，别拿「旧名 404」当判据。
- 换版留痕：`kubectl -n low-code logs deploy/codechat-ops | grep remote-page`。

### 核验

一条 `curl` 就够：`index.html` 里 `wave-remote-config` 的 `version` / `sha`（带 `-dirty` 表示打包时工作区有改动），外加它引用的 hash 名对不对得上本地 `dist/`：

```bash
curl -s "https://codechat.codewave-test.163yun.com/remote/" | grep -o "wave-remote-config[^>]*"
# 期望 version/sha = 本次构建，入口引用的 chat.<hash>.js / shim.<hash>.js 与 dist/ 同名
```

### 收尾报告要素

构建 sha + 目标环境 + 上传状态码 / `fileKeys` 数量 + 上传前线上是哪份构建（回滚账）+ 与上一版相比内容有没有变（hash 名相同即一字不差）。前两项 `--type remote --dry-run` 会直接打印（`本次构建 version/sha` 与 `线上构建 version`），报告里照抄即可。

### 坑（页面专属）

- **`dist/` 里常躺着旧构建**：打包前**现打一遍**，别拿现成 dist 传（脚本会提示包超过一小时没重打过）。
- **合并后补传常是「内容一字不差」**：分支期传一版 → squash 合 main 重打包，zip 可能与合并前同 sha256、文件 hash 全同 ⇒ 照旧重打包重传，但报告里点明「内容没变」。
- **别用任何外挂标签证明内容**：从前的 `version.txt` 只是上传时给的字符串，实测出现过「包里的两半来自不同构建、标签却指向更晚的提交」；现在它已下线，判据只剩入口引用的 hash 名与本地 `dist/` 是否一致。
- `/remote/<子路径>` = **404**（通用条先命中并 rewrite 到不存在的对象），不兜到入口页；页面只用 `?query` 做深链，无影响。
- 缓存分档：入口 `no-cache`、带 hash 的资源 `immutable`；**manifest.json 与两个 PNG 实测是 `no-cache`**（更像按扩展名清单分档），功能无损。手机吃不到新版时先看入口：入口 `no-cache` ⇒ 刷新即重新校验并指向新 hash 名。
- 真机验收某条新能力前，**先确认本机服务进程跑的是含这条改动的构建**（本机 CLI npm link 到主 checkout ⇒ 那里 pull + build 后重启 daemon），否则只会看到「指令没有回执」。

## 四、wave 官方插件市场

平台托管的**插件市场镜像快照**：客户端从企业端 `/wave-plugins-official/latest` 取 sha，再去拉 `…/<sha>.zip`。上传 = 把上游市场仓库整树打成一个 zip 传一次对象，**不写台账、不发版、不重建镜像**。

⚠️ **这是「wave 插件市场」，不是插件端**：VS Code / JetBrains 插件安装包走 `ide-plugin-publish` 技能，平台不再分发（见「坑」最后一条）。

### 出包（上游仓库 `netease-lcap/wave-plugins-official`）

```bash
cd ~/github/wave-plugins-official      # 仓库位置因机器而异
git pull --ff-only
zip -rq /tmp/wave-plugins-official-$(git rev-parse --short HEAD).zip . \
  -x '.git/*' -x '*.DS_Store'
unzip -Z1 /tmp/wave-plugins-official-*.zip | grep -x '.wave-plugin/marketplace.json'
```

- **包根必须是市场根**：zip 根层要有 `.wave-plugin/marketplace.json`（服务端准入校验，缺了直接 400）。所以是 `cd` 进仓库后打 `.`，别把目录名打进去。
- 仓库里**没有**打包脚本，这一步手打；`-x '.git/*'` 必须带（否则包体翻几倍）。**没有 `zip` 命令的机器**（如 Windows 上的 Git Bash）可以用 `git archive --format=zip --prefix="" -o /tmp/…zip HEAD` 代替，得到的正是 HEAD 的整树快照，同样不含 `.git`。
- 快照是**内容寻址**的：字节一致 ⇒ sha 一致 ⇒ 服务端落点一致、重传幂等。

### 上传

```bash
S=.wave/skills/ops-upload/upload.mjs
PKG=/tmp/wave-plugins-official-<sha>.zip

# 预检：manifest / 本地 sha / 线上 latest（不写任何东西）
node $S --type plugin-market --file $PKG --env test --dry-run

# 正式上传
node $S --type plugin-market --file $PKG --env test
node $S --type plugin-market --file $PKG --env prod --confirm-prod
```

- **`--env prod` 必须 `--confirm-prod`**：一传就对全体用户生效，且打错环境不报错。
- **预检直接给结论**：`本次 sha`（= 落地 key）+ `线上指针`（回滚账）；两者相同会明确写「内容没变」。
- 单次 multipart（字段 `zip`），快照体积 ~0.5–3MB，远小于网关上限。

### 核验

1. **接口返回**：`201` + `{ sha, publicUrl, latestUrl }`。脚本会把「服务端 sha」与本地算的 sha256 对比，**不一致直接判失败**，并在传完后自动重读一次指针。
2. **指针生效**：`curl -s {企业端}/wave-plugins-official/latest` 应等于本次 sha（无扩展名路径被 ingress 精确 rewrite 到 `latest.txt`，`no-cache`）。滞后多半是 CDN 边缘，等 1–2 分钟再看，别立即判失败。
3. **zip 真能下**：`curl -sI {企业端}/wave-plugins-official/<sha>.zip` → `200`，且 `cache-control` 含 `immutable`（sha 命名的 zip 走长缓存入口）。

### 回滚

没有删除接口，**拿旧 zip 重传一次**即可把 `latest.txt` 指回去（旧 `<sha>.zip` 对象永不清理，所以回滚不用重新打包）。手头没有旧包时先从 `{企业端}/wave-plugins-official/<旧sha>.zip` 下回来。

## 五、台账与回退（桌面端）

运营端「下载管理」页面已下线，台账的读与删只剩脚本里这两条：

```bash
# 读台账（该环境所有桌面端发布记录，按平台 + 上传时间排序）
node .wave/skills/ops-upload/upload.mjs --list --env test

# 回退：删一条记录；生产要加 --confirm-prod（先跑 --dry-run 看要删哪条）
node .wave/skills/ops-upload/upload.mjs --delete <台账 id> --env test --dry-run
node .wave/skills/ops-upload/upload.mjs --delete <台账 id> --env test
```

- `DELETE /api/publish/desktop/:id` **只删这一条记录**；只有当该 `file_key` 不再被任何记录引用（另一通道同 key 的那行也算引用）时才连带删 file-center 对象。
- 删完下载页 / feed 立即回落到上一版本；脚本会重读一次台账确认这行真的没了。
- **台账里的 `uploaderEmail` 恒为 `ops-api`**：令牌是无身份凭证，服务端如实记「来自发布通道」。**要追人只能看发布记录 / 工单**，别拿这个字段当证据。

## 脚本内部：桌面端分片直传

**文档包、远控页、插件市场都不走这里**：三者都是**单次 multipart**（docs 字段 `archive` / remote 字段 `zip` / plugin-market 字段 `zip`），没有 init/chunk/complete、没有分片会话；三者都**不需要**亲和 cookie（单请求、服务端无跨请求状态）。`--dry-run` 对它们只意味着「令牌校验 + 本地预检、不发上传」。

### 桌面端脚本做了什么

1. **读一次台账**（`GET /api/publish/desktop`）：一条请求干三件事——验令牌（401/503/404 在启动阶段就说清楚，不等传完几百 MB 才发现）、收下 ingress 下发的 `codechat-ops-route` 亲和 cookie、拿到当前台账。
2. **`init` → 逐片 `chunk` → `complete`**：`POST /api/publish/desktop/init`（`{platform, version, fileName, fileSize, channels}`）→ 逐片 `POST /api/publish/desktop/:uploadId/chunk/:index`（multipart 字段名 `chunk`，**不是**旧的 `chunked/:uploadId/:i`；分片大小由服务端在 `chunkSize` 里下发，固定 20MiB，单文件最多 1000 片）→ `POST /api/publish/desktop/:uploadId/complete`（`201` + `{ids, version, platform, channels, downloadUrl, sizeBytes, sha512}`）。
3. **重试策略**：每片最多 5 次尝试、400ms 起指数退避（上限 4s、带抖动）；无响应 / 5xx / 429 可重试，业务 4xx 直接失败。**分片会话丢失（404 `上传会话不存在或已过期`）时整轮重启**（重新 init + 重传全部新分片），最多 3 轮。
4. **收尾自检**：`complete` 回包与本地逐项比对（`version` / `platform` / `channels` 集合 / `sizeBytes` / `sha512` base64），任一项不一致就**非零退出**，不静默成功。

### 阅读输出与失败排查

逐片打印 `片号/总数  HTTP 状态  字节数  耗时`，失败时明确报出**哪一片、HTTP 状态、以及该状态意味着什么**（401/503/404/502/413 各有一条固定提示，见「令牌」那节的三态表）。

```
✗ 上传失败：第 3/7 片：HTTP 504：…
  失败位置：第 3/7 片（uploadId=…）
  HTTP 状态：504
```

- **退出码**：`0` = 成功（含 `--dry-run`）；`1` = 失败。脚本不会静默成功。
- **亲和 cookie 缺失只告警不阻断**：它只在**多副本**部署下才影响分片（会话在 init 那个 pod 的内存 + 临时目录里）。两端部署清单目前都是 `replicas: 1`，私有化环境的 ingress 也未必原样下发这个 cookie；真丢了 cookie 会表现为随机 404，脚本会自动整轮重启兜住。
- 失败后**直接重跑同一条命令**即可：分片会话丢失会由脚本整轮重启兜住；同名同通道重传是**覆盖**，安全。

### 冒烟：`--dry-run`

验证脚本本身与连通性（含令牌、亲和 cookie、init 契约）而不写库：

```bash
node .wave/skills/ops-upload/upload.mjs \
  --file /tmp/dummy.dmg --version 0.0.0-dryrun --platform mac-dmg --env test --dry-run
```

它只做 init + 第一片就停：不调 `complete` ⇒ 不落库、不产生用户可见记录；留下的只是服务端内存里的临时会话（TTL 2h 后随分片目录一起自动清理）。收尾可用 `--list` 核对列表里**没有**这个版本号。

**普通上传/发布别用 `0.0.0-*` 之外的假版本号**：台账与 feed 按版本排序，往共享环境塞一个假的「更新版本」会真的被客户端当成可升级版本。要在共享环境做一次完整的上传演练，最安全的做法是**拿环境里已有的旧版本安装包原样回传**（字节一致 ⇒ 同 fileKey 覆盖，内容零变化），见 2026-11-04 实测。

## 坑

- **不要用浏览器上传桌面端包**：2026-09-20 生产实测 3/3 被浏览器侧的**连接层中断**打死（`ERR_NETWORK_CHANGED` / `ERR_ABORTED`，断点每次不同）；服务端侧到达的分片全 200、全落同一 pod、失败那片**从未出现在服务端日志里**，即断在浏览器 ↔ ingress 之间，根因未定位。所以本技能的上传路径只有分片直传脚本。（何况运营端上传页已经整条下线，现在也没得点。）
- **旧运营端上传接口已整条删除，看到 404 别再猜「环境没部署单点」**：`ops` 命名空间下那四条（downloads 分片/列表/删除、docs、plugin-market、remote-page 各一条 upload）与新路径 `/api/publish/*` 是两条不同的路，前者现在一律 404。404 只有两种原因：host 打错（两种部署都必须是**企业端域名**）或该环境后端还是 2026-11-04 之前的镜像（那时这组接口只挂运营端）。
- **环境别搞混**：三个环境见开头那张表，统一用 `--env prod|test|drill`（默认 prod）。**只有用户当次明确点名才用 test / drill**。打错域名**不报错**，会静默写到另一个环境（脚本第一行会打印地址，先看一眼）。
- **发布接口与 feed 现在同域**（2026-11-04 起，都在企业端）：历史上两者是两个域名（发布走 ops、feed 走企业端），那套「拿错域名两个方向都 404」的坑已经不存在。**但「`--env` 解析出的地址」与「客户端实际用的 `serverUrl`」仍可能不是同一个值**——feed 基地址只认客户端缓存下来的 `serverUrl`（见「验证要点」第 4 步），核 feed 时按第 4 步取，别把脚本打印的地址当 feed 域名硬凑；企业端域名是外部拥有的、可能变，**别写死**。
- **无 cookie 直传 = 随机 404（只对桌面端分片成立）**：多副本 + 分片会话只在 init 那个 pod 的内存与临时目录里，必须带 `codechat-ops-route` 亲和 cookie。脚本自己取一次就够（ingress 对任意请求都下发），但**手搓 curl 直传时必须自己带上**。文档包/插件市场/远控页是单次请求、服务端无会话状态 ⇒ 不需要这个 cookie，别把它当成「所有上传的通用前提」。
- **覆盖只按 `(version, platform, channel)` 三元组**：三元组相同即覆盖旧记录（`fileKey` 相同、file-center 幂等覆盖），重传安全；**版本号必须与 `--version` 一致**。stable / beta 互不覆盖 —— 也就是说往 `stable` 传一个「环境里本来只在 beta 出现过的版本」会**新增一行**（实测：1.1.7 原本只有 beta 行，传 stable 后变成两行），feed 仍按版本取最新、不会因此降级。
- **文件名与 `platform` 段以接口返回为准**：现行 canonical 名是 `codewave-ide.dmg` / `codewave-ide-mac.zip` / `codewave-ide-setup.exe`（服务端按 `platform` 定名，**不是**你上传时的原始文件名），`platform` 段为 `mac-dmg` / `mac-zip` / `win-exe`；历史行还留着上一代命名 `codechat-desktop.*`。核对时直接比字段，别靠拼字符串匹配。
- **`downloadUrl` 的域名别写死**：域名与 URL 前缀是宿主/CDN 的部署细节（外部拥有，变了我们不会收到通知），**一律读接口字段**。2026-09-18 实测生产与测试两个环境当时的域名、甚至路径前缀就已经不同。
- **「插件端」与「wave 插件市场」是两件事，别混**：平台**不再分发** 插件端安装包（vsix / jar），文案是「插件端已迁移至官方插件市场，不再在此分发」，发布走 `ide-plugin-publish` 技能；而平台**确实**托管 wave 官方插件市场的镜像快照（企业端 `/wave-plugins-official/`），上传见「四、wave 官方插件市场」。
- **文档包由本技能的「二、文档站包」负责出包 + 上传**：CI 不再构建文档，`docs-<version>.tar.gz` 一律本地 `pnpm run docs:pack` 产出。上传走 `POST /api/publish/docs` 单次 multipart，**不进分片链路、不入台账**，所以传完在台账里看不到任何文档记录——这不是失败。
- **远控页属托管类资源**：上传 201 只证明对象写进去了，页面上线要看「入口引用的 hash 名对不对得上本地 dist」；「页面已更新」≠「机器侧已更新」——白名单在服务那个会话的进程里，旧机器只显示「…指令没有回执」。
