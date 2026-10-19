---
name: ops-upload
description: 往 CodeChat 运营平台发产物（test / drill / prod 三个环境）：桌面端三件套（dmg / mac.zip / exe，取 CI 的 Release 后 upload.mjs 分片直传 → 接口 sha512 + feed 核验）、文档站包（本地 docs:pack 出包 → upload.mjs --type docs → 企业端 /docs/ 验对象）、远控 Web 页（pack:remote 出包 → upload-remote-page.mjs 单次上传）。当用户要求「上传/发布桌面端」「发 beta」「发/传文档站」「发/构建/传远控页（远端页、手机页面、web 端）」「回滚页面」，或询问运营平台下载管理、产物上传与分发流程时使用。
allowed-tools:
  - Bash
---

# 运营平台上传（桌面端 / 文档站 / 远控页）

三条产物线，**同一个平台、同一套凭证、同一组环境**；差别只在「包从哪来」和「落到哪」。

| 产物线       | 包从哪来                                             | 传什么                       | 脚本                        | 落到                                    |
| ------------ | ---------------------------------------------------- | ---------------------------- | --------------------------- | --------------------------------------- |
| 桌面端三件套 | CI（publish.yml）的 GitHub Release，**不用本地构建** | `.dmg` / `-mac.zip` / `.exe` | `upload.mjs --type desktop` | 下载管理 `desktopDownloads[]`           |
| 文档站包     | **本地** `pnpm run docs:pack`                        | `docs-<v>.tar.gz`            | `upload.mjs --type docs`    | 下载管理 docs 行 + 企业端 `/docs/` 托管 |
| 远控 Web 页  | **本地** `pnpm -F wave-webview run pack:remote`      | `remote-page.zip`            | `upload-remote-page.mjs`    | file-center 对象 + 企业端 `/remote/`    |

**上传方式只有一条：脚本。** 不要用浏览器上传（原因见「坑」）。桌面端与文档包传完要按各自小节做核验（接口字段 / feed / 对象在不在）；远控页传完只看 `201` + `fileKeys`。

## 环境选择（先看这段）

| 环境     | ops（上传面）                                | 企业端（访问面）                            | 什么时候用                                                 |
| -------- | -------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------- |
| **prod** | `https://neteasecc.codewave.163.com`         | `https://codechat.codewave.163.com`         | **默认**。「上传/发布」「给 tester 测」「发 beta」都是这个 |
| test     | `https://neteasecc.codewave-test.163yun.com` | `https://codechat.codewave-test.163yun.com` | **仅当用户当次明确点名「测试环境」**                       |
| drill    | `https://neteasecc.lcap.hadri.163yun.com`    | `https://codechat.lcap.hadri.163yun.com`    | 演练环境（hadri），用户点名时用                            |

- **两条产物线用同一个 `--env`**：`upload.mjs` 与 `upload-remote-page.mjs` 都认 `--env prod|test|drill`，默认 prod。
- ⚠️ 打错环境**不会报错**：包会静默写进另一个环境。脚本会把解析出的平台地址打印在第一行，动手前先核一遍。（`--base <URL>` 仍保留，仅用于冒烟/临时环境，和 `--env` 二选一。）

## 凭证

- 账号与密码存于 `~/.wave/neteasecc.json` 的 `email`/`password` 字段（明文敏感，勿外传、勿复制进聊天/技能文件）；三个环境同账号。
- token 由脚本内部取（`POST {BASE}/api/auth/login` → `token`），后续请求带 `Authorization: Bearer <token>`；**脚本从不打印账号、密码或 token**。
- ⚠️ **任何命令都不要回显账号密码**：不要在命令行写密码字面量、不要 `echo`/`cat` 凭证。脚本只打印凭证文件路径。
- ops pod 有多副本，上传前必须拿到 `codechat-ops-route` 亲和 cookie（脚本自己取）。

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

发测试版把 `--channel` 换成 `beta`（stable / beta 是两条独立的线，同一版本要两条都发就**跑两遍**，互不覆盖）。发测试环境加 `--env test`、演练加 `--env drill`（默认 `--env prod`）。

| 参数            | 说明                                                                               |
| --------------- | ---------------------------------------------------------------------------------- |
| `--file`        | 要上传的本地文件（必填）                                                           |
| `--version`     | `X.Y.Z`，桌面端必填                                                                |
| `--platform`    | `mac-dmg` / `mac-zip` / `win-exe`，桌面端必填（决定服务端落库的 canonical 文件名） |
| `--channel`     | `stable` / `beta`，默认 `stable`                                                   |
| `--type`        | `desktop`（默认）/ `docs`                                                          |
| `--env`         | `prod`（默认）/ `test` / `drill`                                                   |
| `--base`        | 直接指定平台地址，与 `--env` 二选一（兜底/冒烟用）                                 |
| `--credentials` | 凭证文件路径，默认 `~/.wave/neteasecc.json`                                        |
| `--dry-run`     | 只做 init + 第一片，**绝不调 complete**（不写库、不留可见记录），用于冒烟          |

### 验证要点（四路硬证，上传后逐一跑）

**1. 接口字段核对（含内容摘要）**：`GET /api/ops/downloads` 的 `desktopDownloads[]` 出 `version` / `channel` / `fileName` / `downloadUrl` / `fileSize` / `sha512`。**`sha512` 是 digest 的 base64（不是 hex）**，可与本地文件直接比：

```bash
python3 - <<'PY'
import base64, hashlib, json, os, urllib.request
creds = json.load(open(os.path.expanduser('~/.wave/neteasecc.json')))
base = 'https://neteasecc.codewave.163.com'   # 仅当用户当次点名测试域时换成 test 域名
req = urllib.request.Request(base + '/api/auth/login',
    data=json.dumps({'email': creds['email'], 'password': creds['password']}).encode(),
    headers={'Content-Type': 'application/json'})
token = json.load(urllib.request.urlopen(req))['token']
req = urllib.request.Request(base + '/api/ops/downloads', headers={'Authorization': 'Bearer ' + token})
for d in json.load(urllib.request.urlopen(req))['desktopDownloads']:
    if d['version'] == '1.2.6' and d['channel'] == 'stable':
        print(d['platform'], d['fileName'], d['downloadUrl'])
        print('  api sha512 :', d['sha512'])
        local = open('/tmp/wave-desktop-1.2.6/CodeWave.IDE-1.2.6-arm64.dmg', 'rb').read()
        print('  local      :', base64.b64encode(hashlib.sha512(local).digest()).decode())
PY
```

接口需鉴权，不带 token 回 401 `未登录`。`sha512` 与本地 `hashlib.sha512(...).digest()` 的 base64 一致 = 上传的字节与本地文件逐字节相同。

**2. 下载地址可下且大小一致**：拿接口给的 `downloadUrl`（**别自己拼域名**）做 HEAD，期望 `200` 且 `content-length` 等于本地字节数：

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

**4. feed 端到端核对（必做）**：上面第 1 步读的是**运营平台库里的记录**；客户端（electron-updater）实际读的不是它，而是**企业端后端按 electron-builder 格式动态生成的 feed yml**。feed 的基地址就**是客户端配置里的 `serverUrl` 本身**——桌面端把它缓存下来**只为拼 feed URL**（见 `packages/desktop/src/main/updateAutoUpdater.ts` 的 `feedUrlFor`），所以要拿值为准就去读该环境客户端的 `serverUrl`：设置页「服务端地址」/ `~/.wave/settings.json` 的 `env.WAVE_SERVER_URL` / 桌面端 `userData/wave-desktop.json` 里的 `serverUrl` 缓存。**⚠️ 别拿 `--base`（ops 域名）去请求 feed 路径，会 404**（见「坑」）。

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

**拿错域名的两个反例**（2026-09-22 实测原文，省下一个人 10 分钟）：

```bash
# ① 用 ops 域名（--base 那个）请求 feed 路径
curl -s "https://neteasecc.codewave.163.com/api/downloads/desktop-beta/mac/latest-mac.yml"
# {"error":"Not found"}   ← 404

# ② 反过来用企业端域名请求 ops 接口
curl -s -o /dev/null -w '%{http_code}\n' "https://codechat.codewave.163.com/api/ops/downloads"
# 404
```

两边都是 `404 {"error":"Not found"}` 这个形状，**错误码/错误串都不指向真正的原因（域名打错了）**，别指望 HTTP 状态帮你定位。（别把这里的 404 跟真正的 `401` 混起来：`401` 只在 **ops 域名**下请求 `/api/ops/downloads` 且不带 token 时出现，见第 1 步。）

## 二、文档站包

**要本地构建**：发版 CI 不再构建文档（`publish.yml` 只发 npm 包 + 建 Release），GitHub Pages 的站点另由 `pages.yml` 在 push main 时构建，与这里无关。

### 出包

```bash
pnpm run docs:pack                           # 生成截图 → vitepress build --base /docs/ → 打 tar.gz
pnpm run docs:pack -- --reuse-screenshots    # 截图刚跑过、只想重新打包时用
```

产物是仓库根 `docs-<version>.tar.gz`（版本号读根 `package.json`，已 gitignore），压缩包根就是 `index.html`。`--base /docs/` 是**平台侧的托管前缀**，别换成 config.js 里的 `/wave-agent/`（那是 GitHub Pages 的 base）；截图来自 Playwright demo，本机没装 Chromium 就先 `pnpm -F wave-webview exec playwright install --with-deps chromium`。

### 上传

```bash
node .wave/skills/ops-upload/upload.mjs --file docs-<version>.tar.gz --type docs --env prod
```

`--type docs` **不传** `--version`/`--platform`/`--channel`，文件名须为 `.tar.gz` 或 `.zip`。同名重传是覆盖，安全。

### 核验

1. **下载管理里那一行**：`GET /api/ops/downloads` 的 `downloads[]`（注意不是 `desktopDownloads[]`）。⚠️ docs 行的 `version` **恒为 `latest`**，不是文件名里的版本号 —— 别拿它跟 `docs-<v>` 比。
2. **企业端对象真的在**（托管类资源，接口 201 只证明传上去了）：三个环境的 `/docs/` 都应 200（2026-10-19 实测 test / drill / prod 全 200），再从 `/docs/` 的 index.html 里取带 hash 的资源名逐个 `curl` 核 200 + `cmp` 本地 `docs/.vitepress/dist` 下的同名文件。**别只探 `/docs/` 首页就收工**。

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
# 预检：环境解析 / zip 形状 / 登录 / 亲和 cookie / 上传前线上版本，不写任何东西
node .wave/skills/ops-upload/upload-remote-page.mjs --env test --check

# 正式上传
node .wave/skills/ops-upload/upload-remote-page.mjs --env test
node .wave/skills/ops-upload/upload-remote-page.mjs --env prod --confirm-prod
```

- **`--env prod` 必须加 `--confirm-prod`**：打错环境不报错、对象静默写进别处，多一道闸。
- **成功判据**：`201` + `fileKeys` 数量 = **产物文件数**（整包重传是幂等覆盖，重跑同一条命令安全）。
- **不再有版本标签**（2026-10-19 下线）：上传接口只收 zip，不再写 `version.txt` —— 那个指针既不参与任何判定、也不跟内容绑定。想知道线上是哪份构建，看入口页自己带的 `wave-remote-config`（构建期注入，脚本上传前会打印）。
- **没有删除接口**（只有 `POST /upload`）⇒ 回滚只能另打一份覆盖同名文件，或让 SRE 删 file-center 对象；**旧 hash 名永不清理**，别拿「旧名 404」当判据。
- 换版留痕：`kubectl -n low-code logs deploy/codechat-ops | grep remote-page`。
- **传完的判据就是 `201` + `fileKeys`**（本技能不再提供逐字节核验脚本）。想知道线上此刻是哪一版，一条 `curl …/remote/` 就够：`index.html` 里 `wave-remote-config` 的 `version`，外加它引用的 hash 名对不对得上本地 `dist/`。

### 收尾报告要素

构建 sha + 目标环境 + 上传状态码 / `fileKeys` 数量 + 上传前线上是哪份构建（回滚账）+ 与上一版相比内容有没有变（hash 名相同即一字不差）。

### 坑（页面专属）

- **`dist/` 里常躺着旧构建**：打包前**现打一遍**，别拿现成 dist 传（脚本会提示包超过一小时没重打过）。
- **合并后补传常是「内容一字不差」**：分支期传一版 → squash 合 main 重打包，zip 可能与合并前同 sha256、文件 hash 全同 ⇒ 照旧重打包重传，但报告里点明「内容没变」。
- **别用任何外挂标签证明内容**：以前那个 `version.txt` 只是上传时给的字符串，实测出现过「包里的两半来自不同构建、标签却指向更晚的提交」；现在它已下线，判据只剩入口引用的 hash 名与本地 `dist/` 是否一致。
- `/remote/<子路径>` = **404**（通用条先命中并 rewrite 到不存在的对象），不兜到入口页；页面只用 `?query` 做深链，无影响。
- 缓存分档：入口 `no-cache`、带 hash 的资源 `immutable`；**manifest.json 与两个 PNG 实测是 `no-cache`**（更像按扩展名清单分档），功能无损。手机吃不到新版时先看入口：入口 `no-cache` ⇒ 刷新即重新校验并指向新 hash 名。
- 真机验收某条新能力前，**先确认本机服务进程跑的是含这条改动的构建**（本机 CLI npm link 到主 checkout ⇒ 那里 pull + build 后重启 daemon），否则只会看到「指令没有回执」。

## 脚本内部：分片直传（桌面端 + 文档包共用）

### 脚本内部做了什么

1. **拿亲和 cookie**：先对平台打一次请求，收下 ingress 下发的 `codechat-ops-route`（对**任意**请求都会回，未鉴权也回），之后所有请求都带上它。**这是分片直传的硬前提**：生产 codechat-ops 是多副本，分片会话（`chunkSessions` Map + 本 pod 的 `os.tmpdir()`）只在收到 init 的那个 pod 上存在，不带 cookie 会被 LB 打到别的 pod → 随机 404 `上传会话不存在或已过期`。
2. **登录取 token**（不上屏）。
3. **`init` → 逐片 `chunk` → `complete`**：`POST /api/ops/downloads/chunked/init`（`{type, platform, channels, version, fileName, fileSize}`）→ 逐片 `POST …/chunked/<uploadId>/<i>`（multipart 字段名 `chunk`，服务端固定 20MB 一片、单文件最多 1000 片）→ `POST …/chunked/<uploadId>/complete`。
4. **重试策略与前端一致**：每片最多 5 次尝试、400ms 起指数退避（上限 4s、带抖动）；无响应 / 5xx / 429 可重试，业务 4xx 直接失败。**分片会话丢失（404 `上传会话不存在或已过期`）时整轮重启**（重新 init + 重传全部新分片），最多 3 轮。
5. **收尾**：`complete` 返回的 JSON 原样打印，含落库后的 `desktopDownloads[]`（`version` / `channel` / `fileName` / `downloadUrl` / `fileSize` / `sha512`）。

### 阅读输出与失败排查

逐片打印 `片号/总数  HTTP 状态  字节数  耗时`，失败时明确报出**哪一片、HTTP 状态、亲和 cookie 是否已携带**：

```
✗ 上传失败：第 3/7 片：HTTP 504：…
  失败位置：第 3/7 片（uploadId=…）
  HTTP 状态：504
  亲和 cookie：已携带（长度 78）
```

- **退出码**：`0` = 成功（含 `--dry-run`）；`1` = 失败。脚本不会静默成功。
- 若报「未取到 `codechat-ops-route` 亲和 cookie」= 请求压根到不了 ingress（域名/网络问题），此时任何上传都会随机 404，先解决连通性。
- 失败后**直接重跑同一条命令**即可：分片会话丢失会由脚本整轮重启兜住；同名同通道重传是**覆盖**，安全。

### 冒烟：`--dry-run`

验证脚本本身与连通性（含凭证、亲和 cookie、init 契约）而不写库：

```bash
node .wave/skills/ops-upload/upload.mjs \
  --file /tmp/dummy.dmg --version 0.0.0-dryrun --platform mac-dmg --env test --dry-run
```

它只做 init + 第一片就停：不调 `complete` ⇒ 不落库、不产生用户可见记录；留下的只是服务端内存里的临时会话（TTL 2h 后随分片目录一起自动清理）。收尾可用下面「验证要点」第 1 步的读接口核对列表里**没有**这个版本号。

## 坑

- **不要用浏览器上传桌面端包**：2026-09-20 生产实测 3/3 被浏览器侧的**连接层中断**打死（`ERR_NETWORK_CHANGED` / `ERR_ABORTED`，断点每次不同）；服务端侧到达的分片全 200、全落同一 pod、失败那片**从未出现在服务端日志里**，即断在浏览器 ↔ ingress 之间，根因未定位。所以本技能的上传路径只有分片直传脚本。
- **环境别搞混**：三个环境见开头那张表，统一用 `--env prod|test|drill`（默认 prod）。**只有用户当次明确点名才用 test / drill**。打错域名**不报错**，会静默写到另一个环境（脚本第一行会打印平台地址，先看一眼）。
- **别把 ops 域名当 feed 域名**：**上传 / 回读走 ops 域名（`--env` 解析出的那个），客户端只读的 feed 走企业端域名**（feed 基地址 = 客户端 `serverUrl`，见「验证要点」第 4 步），两者是两个域名。打错**都不会告诉你"你用错域名了"**：2026-09-22 实测拿 ops 域名请求 feed 路径回 `404 {"error":"Not found"}`，反过来拿企业端域名请求 `/api/ops/downloads` 也回同样的 `404 {"error":"Not found"}`——是**网关不认识这条路**，跟 ops 域名下不带 token 的 `401` 不是一回事。企业端域名易变、且是外部拥有（变了我们不会收到通知），**别写死**——按「验证要点」第 4 步的方式取 `serverUrl`；2026-09-22 实测值为 prod `codechat.codewave.163.com` / test `codechat.codewave-test.163yun.com`，仅供参考。
- **无 cookie 直传 = 随机 404**：生产多副本 + 分片会话只在 init 那个 pod 的内存与临时目录里，必须带 `codechat-ops-route` 亲和 cookie。脚本自己取一次就够（ingress 对任意请求都下发），但**手搓 curl 直传时必须自己带上**。
- **同名同通道重传是覆盖**：`(type, version, platform, channel)` 相同即覆盖旧记录（`fileKey` 相同、file-center 幂等覆盖），重传安全；但**版本号必须与 `--version` 一致**。stable / beta 互不覆盖。
- **文件名与 `platform` 段以接口返回为准**：现行 canonical 名是 `codewave-ide.dmg` / `codewave-ide-mac.zip` / `codewave-ide-setup.exe`（服务端按 `platform` 定名，**不是**你上传时的原始文件名），`platform` 段为 `mac-dmg` / `mac-zip` / `win-exe`；历史行还留着上一代命名 `codechat-desktop.*`。核对时直接比字段，别靠拼字符串匹配。
- **`downloadUrl` 的域名别写死**：域名与 URL 前缀是宿主/CDN 的部署细节（外部拥有，变了我们不会收到通知），**一律读接口字段**。2026-09-18 实测生产与测试两个环境当时的域名、甚至路径前缀就已经不同。
- **平台不管理 IDE 插件**：说明文案"IDE 插件已迁移至官方插件市场，不再在此分发"，VS Code/JetBrains 发布走 `ide-plugin-publish` 技能。
- **文档包由本技能的「二、文档站包」负责出包 + 上传**：CI 不再构建文档，`docs-<version>.tar.gz` 一律本地 `pnpm run docs:pack` 产出。
- **远控页属托管类资源**：上传 201 只证明对象写进去了，页面上线要看「对象在不在」——本技能只给一条 `curl` 的办法（入口 `wave-remote-config` 的版本 + 入口引用的 hash 名），不再有逐字节核验脚本；「页面已更新」≠「机器侧已更新」——白名单在服务那个会话的进程里，旧机器只显示「…指令没有回执」。
