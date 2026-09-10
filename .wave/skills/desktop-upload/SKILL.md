---
name: desktop-upload
description: 上传桌面端安装包到运营平台下载管理（测试环境 https://neteasecc.codewave-test.163yun.com / 生产 https://neteasecc.codewave.163.com）。当用户要求"上传桌面端"、"上传安装包到运营平台"、"发布桌面端"、或询问下载管理/桌面端分发流程时使用。
allowed-tools:
  - Bash
---

# 桌面端上传运营平台流程

把桌面端三件套（macOS 安装包 / macOS 更新包 / Windows 安装包）上传到「CodeChat 运营平台」下载管理，企业端通过 file-center 公网域名下载。**不需要本地构建**：CI（publish.yml）已把产物传到 GitHub Release，直接下载产物上传即可。发布前先确认对应 `wave-desktop@<version>` tag 的 Publish Package workflow 跑完、Release 资产已生成。

## 环境选择（先看这段）

| 环境         | 域名                                         | 什么时候用                                                                                                                                              |
| ------------ | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **测试环境** | `https://neteasecc.codewave-test.163yun.com` | 默认。用户说「发**测试环境** beta 通道 / 给 tester 测」= 这个；low-code 集群（本机 `kubectl get ingress -n low-code` 可见 host `codechat-ops-ingress`） |
| **生产环境** | `https://neteasecc.codewave.163.com`         | 仅正式对外分发时用；等同于 `~/.wave/neteasecc.json` 里的 baseUrl                                                                                        |

⚠️ **生产 ops 在大文件分片上传时会随机失败**：`chunked` 上传会话存在**服务端进程内存**里（`backend-ops/src/routes/downloads.ts` 的 `chunkSessions` Map + 本 pod 的 `os.tmpdir()`），生产 codechat-ops 多副本且无粘性路由 → init 落在 pod A、分片被 LB 打到 pod B 就返回 404 `上传会话不存在或已过期`（表现为同一文件有时第 1 片就挂、有时传过两片才挂）。测试环境是单副本，不受影响。所以：**测试环境走 API 直传（下节）最快；生产建议走 UI 页面上传，且仍可能失败**。

## 凭证

- 账号与密码存于 `~/.wave/neteasecc.json` 的 `email`/`password` 字段（明文敏感，勿外传、勿复制进聊天/技能文件）；test / prod 同账号。
- 取 token：`POST {BASE}/api/auth/login` body `{"email":...,"password":...}` → 响应 `token`；后续请求带 `Authorization: Bearer <token>`。
- UI 登录态持久化：独立 profile `~/.wave/platform-profile`（`--persistent`），登录一次后后续会话复用。

## 上传方式 A：API 直传（推荐，测试环境）

无需浏览器，直接打 chunked API（每片 multipart 字段名 `chunk`）：

```bash
BASE=https://neteasecc.codewave-test.163yun.com
TOKEN=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d "{\"email\":\"$(jq -r .email ~/.wave/neteasecc.json)\",\"password\":\"$(jq -r .password ~/.wave/neteasecc.json)\"}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['token'])")

# 下载资产（--repo 必带，gh 在非 git 目录推断不出）
gh release download -R netease-lcap/wave-agent wave-desktop@<version> --dir /tmp/wave-desktop-<version>

# 每个文件：init → 逐片 → complete
#   init:     POST $BASE/api/ops/downloads/chunked/init
#             {type:"desktop",platform:"mac-dmg"|"mac-zip"|"win-exe",channel:"stable"|"beta",
#              version:"X.Y.Z",fileName,fileSize}  →  {uploadId,chunkSize,totalChunks}
#   chunk i:  POST $BASE/api/ops/downloads/chunked/<uploadId>/<i>   (multipart "chunk")
#   complete: POST $BASE/api/ops/downloads/chunked/<uploadId>/complete
# 分片失败（404 会话过期）时整文件重新 init 再传
```

参考实现：`/tmp/upload-retry.mjs`（带整文件重试，参数 `BASE TOKEN FILE VERSION PLATFORM CHANNEL`）。

## 上传方式 B：UI（playwright-cli，headless）

用全局安装的 `playwright-cli`（@playwright/cli 0.1.18，`--browser chrome`）交互式驱动浏览器：

```bash
BASE=https://neteasecc.codewave-test.163yun.com   # 或生产域名

# 1. 打开平台（profile 已登录则直接到 downloads；未登录则走第 2 步）
playwright-cli open --browser chrome --persistent --profile ~/.wave/platform-profile "$BASE"
playwright-cli snapshot   # 看当前页面与 ref

# 2. 首次登录（snapshot 见 textbox 邮箱/密码 + 登录按钮）
playwright-cli fill <邮箱ref> "$(jq -r .email ~/.wave/neteasecc.json)"
playwright-cli fill <密码ref> "$(jq -r .password ~/.wave/neteasecc.json)"
playwright-cli click <登录ref>

# 3. 进下载管理 → 点上传
playwright-cli click <下载管理ref>   # 左侧导航 /downloads
playwright-cli click <上传ref>       # 页面右上角
```

上传弹窗字段（ref 每次 snapshot 会变，以实际为准）：

- **版本号**：textbox，填 `X.Y.Z`
- **接收通道**：`stable` / `beta`（桌面端专属；tester 用 beta）
- **文档站**：`.tar.gz/.zip`（一般不动，保持为空）
- **macOS 安装包**：`.dmg` ← GitHub 资产 `CodeWave.IDE-<v>-arm64.dmg`
- **macOS 更新包**：`.zip` ← GitHub 资产 `CodeWave.IDE-<v>-arm64-mac.zip`
- **Windows 安装包**：`.exe` ← GitHub 资产 `CodeWave.IDE.Setup.<v>.exe`

每个分类的挂载方式：先 `click` 该分类的按钮（触发 File chooser），再 `upload` 绝对路径：

```bash
playwright-cli click <macOS安装包ref>
playwright-cli upload "/tmp/wave-desktop-<v>/CodeWave.IDE-<v>-arm64.dmg"
playwright-cli click <macOS更新包ref>
playwright-cli upload "/tmp/wave-desktop-<v>/CodeWave.IDE-<v>-arm64-mac.zip"
playwright-cli click <Windows安装包ref>
playwright-cli upload "/tmp/wave-desktop-<v>/CodeWave.IDE.Setup.<v>.exe"

# 4. 提交并验证
playwright-cli click <上传ref>
playwright-cli snapshot   # 各分区表格出现 <version> 行即成功
```

## 验证要点

- 上传前可用 `playwright-cli eval` 检查文件挂载：
  `() => [...document.querySelectorAll('input[type=file]')].map((inp,i) => i + ': ' + (inp.files?.[0]?.name ?? 'EMPTY'))`
  （索引 0=文档站，1=macOS 安装包，2=macOS 更新包，3=Windows 安装包）
- API 直传成功判据：`complete` 返回 201 且 `desktopDownloads[0].version/channel/fileName` 正确；再 `GET /api/ops/downloads` 核对 `desktopDownloads` 里出现该版本行。
- 成功后文件名被平台规范化为 `codewave-ide.dmg` / `codewave-ide-mac.zip` / `codewave-ide-setup.exe`，下载地址形如 `https://minio-api.<env>.163yun.com/lowcode-static/codechat/desktop/<version>/<platform>/<file>`。

## 坑

- **环境别搞混**：用户说「测试环境」= `neteasecc.codewave-test.163yun.com`；用生产域名做分片上传大概率随机 404（见上文「环境选择」）。
- **同类型同版本同通道重复上传会覆盖旧版本**（弹窗提示），重传安全；但版本号必须与输入一致。stable / beta 同一 `(type,version,platform)` 可各存一条，互不覆盖。
- **ref 每次都会变**：不要写死 ref，以 `snapshot` 输出为准；快照文件存 `.playwright-cli/`（cwd 相对）。
- **`playwright-cli` 子命令自动 attach 会话**，多次调用间浏览器保持；结束可 `playwright-cli close`。
- **平台不管理 IDE 插件**：说明文案"IDE 插件已迁移至官方插件市场，不再在此分发"，VS Code/JetBrains 发布走 `ide-plugin-publish` 技能。
- 文档站压缩包由 CI/docs 流程产出（`docs-*.tar.gz`），本技能不覆盖。
