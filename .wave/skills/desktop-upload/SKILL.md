---
name: desktop-upload
description: 上传桌面端安装包到运营平台下载管理，走分片直传脚本 upload.mjs（默认生产环境 https://neteasecc.codewave.163.com；测试环境 https://neteasecc.codewave-test.163yun.com 仅在用户当次明确点名时使用）。当用户要求"上传桌面端"、"上传安装包到运营平台"、"发布桌面端"、或询问下载管理/桌面端分发流程时使用。
allowed-tools:
  - Bash
---

# 桌面端上传运营平台流程

把桌面端三件套（macOS 安装包 / macOS 更新包 / Windows 安装包）与文档站压缩包上传到「CodeChat 运营平台」下载管理，企业端通过 file-center 公网域名下载。**不需要本地构建**：CI（publish.yml）已把产物传到 GitHub Release，直接下载产物上传即可。

**上传方式只有一条：分片直传脚本 `.wave/skills/desktop-upload/upload.mjs`。** 不要用浏览器上传（原因见「坑」）。

## 环境选择（先看这段）

| 环境         | 域名                                         | 什么时候用                                                                                                                                                                             |
| ------------ | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **生产环境** | `https://neteasecc.codewave.163.com`         | **默认**。用户说「上传/发布桌面端」「给 tester 测」「发 beta」= 这个（prod 已有 beta 通道，tester 直接在 prod 域走 beta）；等同于 `~/.wave/neteasecc.json` 里的 baseUrl                |
| 测试环境     | `https://neteasecc.codewave-test.163yun.com` | **仅在用户当次明确点名「测试环境」时使用**（历史遗留：prod 早期没有 beta 通道，才惯用 test）；low-code 集群（本机 `kubectl get ingress -n low-code` 可见 host `codechat-ops-ingress`） |

⚠️ 两个域名打错**不会报错**：安装包会静默写到另一个环境。脚本会把解析出的平台地址**打印在第一行**，动手前先核一遍。

## 凭证

- 账号与密码存于 `~/.wave/neteasecc.json` 的 `email`/`password` 字段（明文敏感，勿外传、勿复制进聊天/技能文件）；test / prod 同账号。
- token 由脚本内部取（`POST {BASE}/api/auth/login` → `token`），后续请求带 `Authorization: Bearer <token>`；**脚本从不打印账号、密码或 token**。
- ⚠️ **任何命令都不要回显账号密码**：不要在命令行写密码字面量、不要 `echo`/`cat` 凭证。脚本只打印凭证文件路径。

## 发布前检查（每次都做）

1. **`git pull` 主仓库到最新**，并确认对应 `wave-desktop@<version>` tag 的 Publish Package workflow 已跑完、Release 资产已生成。
2. **核对版本号**：`python3 -c "import json;print(json.load(open('packages/desktop/package.json'))['version'])"` —— 上传时会用你传的 `--version` 落库并决定 fileKey，传错就是把包装到别的版本号下。
3. **从 GitHub Release 下载产物**（在非 git 目录跑要显式 `-R`）：
   ```bash
   gh release download -R netease-lcap/wave-agent wave-desktop@<version> --dir /tmp/wave-desktop-<version>
   ls /tmp/wave-desktop-<version>
   ```
   资产名随 electron-builder 的命名规则变，**以 `ls` 实际输出为准**（2026-09-20 实测为 `CodeWave.IDE-<v>-arm64.dmg` / `CodeWave.IDE-<v>-arm64-mac.zip` / `CodeWave.IDE.Setup.<v>.exe`）。

## 上传（分片直传脚本）

零第三方依赖，Node 20+ 内置 `fetch` / `FormData` / `Blob`，从仓库根直接跑。

```bash
V=1.2.6
DIR=/tmp/wave-desktop-$V

# macOS 安装包
node .wave/skills/desktop-upload/upload.mjs \
  --file "$DIR/CodeWave.IDE-$V-arm64.dmg" --version "$V" --platform mac-dmg --channel stable

# macOS 更新包
node .wave/skills/desktop-upload/upload.mjs \
  --file "$DIR/CodeWave.IDE-$V-arm64-mac.zip" --version "$V" --platform mac-zip --channel stable

# Windows 安装包
node .wave/skills/desktop-upload/upload.mjs \
  --file "$DIR/CodeWave.IDE.Setup.$V.exe" --version "$V" --platform win-exe --channel stable
```

发测试版把 `--channel` 换成 `beta`（stable / beta 是两条独立的线，同一版本要两条都发就**跑两遍**，互不覆盖）。发测试环境额外加 `--base https://neteasecc.codewave-test.163yun.com`。

| 参数            | 说明                                                                                  |
| --------------- | ------------------------------------------------------------------------------------- |
| `--file`        | 要上传的本地文件（必填）                                                              |
| `--version`     | `X.Y.Z`，桌面端必填                                                                   |
| `--platform`    | `mac-dmg` / `mac-zip` / `win-exe`，桌面端必填（决定服务端落库的 canonical 文件名）    |
| `--channel`     | `stable` / `beta`，默认 `stable`                                                      |
| `--type`        | `desktop`（默认）/ `docs`                                                             |
| `--base`        | 平台地址，默认生产 `https://neteasecc.codewave.163.com`（测试域仅当用户当次点名时传） |
| `--credentials` | 凭证文件路径，默认 `~/.wave/neteasecc.json`                                           |
| `--dry-run`     | 只做 init + 第一片，**绝不调 complete**（不写库、不留可见记录），用于冒烟             |

文档包走 `--type docs`：**不传** `--version`/`--platform`/`--channel`，文件名须为 `.tar.gz` 或 `.zip`。

```bash
node .wave/skills/desktop-upload/upload.mjs --file /tmp/docs-<version>.tar.gz --type docs
```

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
node .wave/skills/desktop-upload/upload.mjs \
  --file /tmp/dummy.dmg --version 0.0.0-dryrun --platform mac-dmg --dry-run
```

它只做 init + 第一片就停：不调 `complete` ⇒ 不落库、不产生用户可见记录；留下的只是服务端内存里的临时会话（TTL 2h 后随分片目录一起自动清理）。收尾可用下面「验证要点」第 1 步的读接口核对列表里**没有**这个版本号。

## 验证要点（四路硬证，上传后逐一跑）

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

## 坑

- **不要用浏览器上传桌面端包**：2026-09-20 生产实测 3/3 被浏览器侧的**连接层中断**打死（`ERR_NETWORK_CHANGED` / `ERR_ABORTED`，断点每次不同）；服务端侧到达的分片全 200、全落同一 pod、失败那片**从未出现在服务端日志里**，即断在浏览器 ↔ ingress 之间，根因未定位。所以本技能的上传路径只有分片直传脚本。
- **环境别搞混**：默认生产 `neteasecc.codewave.163.com`；只有用户当次明确说「测试环境」才用 `neteasecc.codewave-test.163yun.com`。打错域名**不报错**，会静默写到另一个环境（脚本第一行会打印平台地址，先看一眼）。
- **别把 ops 域名当 feed 域名**：**上传 / 回读走 ops 域名（`--base`），客户端只读的 feed 走企业端域名**（feed 基地址 = 客户端 `serverUrl`，见「验证要点」第 4 步），两者是两个域名。打错**都不会告诉你"你用错域名了"**：2026-09-22 实测拿 ops 域名请求 feed 路径回 `404 {"error":"Not found"}`，反过来拿企业端域名请求 `/api/ops/downloads` 也回同样的 `404 {"error":"Not found"}`——是**网关不认识这条路**，跟 ops 域名下不带 token 的 `401` 不是一回事。企业端域名易变、且是外部拥有（变了我们不会收到通知），**别写死**——按「验证要点」第 4 步的方式取 `serverUrl`；2026-09-22 实测值为 prod `codechat.codewave.163.com` / test `codechat.codewave-test.163yun.com`，仅供参考。
- **无 cookie 直传 = 随机 404**：生产多副本 + 分片会话只在 init 那个 pod 的内存与临时目录里，必须带 `codechat-ops-route` 亲和 cookie。脚本自己取一次就够（ingress 对任意请求都下发），但**手搓 curl 直传时必须自己带上**。
- **同名同通道重传是覆盖**：`(type, version, platform, channel)` 相同即覆盖旧记录（`fileKey` 相同、file-center 幂等覆盖），重传安全；但**版本号必须与 `--version` 一致**。stable / beta 互不覆盖。
- **文件名与 `platform` 段以接口返回为准**：现行 canonical 名是 `codewave-ide.dmg` / `codewave-ide-mac.zip` / `codewave-ide-setup.exe`（服务端按 `platform` 定名，**不是**你上传时的原始文件名），`platform` 段为 `mac-dmg` / `mac-zip` / `win-exe`；历史行还留着上一代命名 `codechat-desktop.*`。核对时直接比字段，别靠拼字符串匹配。
- **`downloadUrl` 的域名别写死**：域名与 URL 前缀是宿主/CDN 的部署细节（外部拥有，变了我们不会收到通知），**一律读接口字段**。2026-09-18 实测生产与测试两个环境当时的域名、甚至路径前缀就已经不同。
- **平台不管理 IDE 插件**：说明文案"IDE 插件已迁移至官方插件市场，不再在此分发"，VS Code/JetBrains 发布走 `ide-plugin-publish` 技能。
- 文档站压缩包由 CI/docs 流程产出（`docs-*.tar.gz`），**本技能只负责把包传上去**，不覆盖打包环节。
