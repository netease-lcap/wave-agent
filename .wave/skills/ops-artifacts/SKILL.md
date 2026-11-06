---
name: ops-artifacts
description: 打「私有化离线物料包」——把四类静态物料（桌面端安装包 / 文档站 / 远控页 / 插件市场快照）连同 upload-all.sh 组装成 bundle，再打成多架构 Docker 镜像推到内网 harbor（仅私有化，SaaS 不部署；镜像怎么在集群里跑归 qingzhou chart，不归本技能）。交付物只有镜像，不再出 tar.gz 包。没有出包脚本：按本技能给出的 bash 步骤在出包机上逐步执行（前置 fixtures build、docs 截图、docs:pack、pack:remote、插件市场 zip 全由这些步骤自己搞定）；镜像构建这段固定步骤在 build-image.sh。当用户要求「打私有化物料包」「离线包」「交付包」「artifacts 包」「私有化镜像」「物料镜像」，或询问离线交付/物料包结构/upload-all.sh/多架构镜像时使用。上传单个产物线用 ops-upload 技能。
allowed-tools:
  - Bash
---

# 私有化离线物料包（四类静态物料 → 多架构镜像）

客户集群**不出网**，CodeChat 镜像里也不含这四类物料。所以物料在出包机这边凑成一个 bundle，
再打成容器镜像推内网 harbor —— 客户环境里由 chart 起一次性 Job，容器自己把四类物料推上去。
bundle 结构与上传契约由 **CodeChat 服务端**定义（它那边 `docs/specs/ops-publish-api.md`），
这里只负责按契约生产 —— 结构、字段名、枚举值都不要"优化"。

**交付物只有镜像**：不再打 tar.gz 交付包，组装出来的 `$WORK/bundle/$BUNDLE` 目录直接喂给 `build-image.sh`。

**出包没有脚本**：由你按下面的步骤直接跑 bash 完成（每一步的判断是智能的：取哪个 tag、缺哪些平台、
截图齐不齐）。仓里的脚本只有三个，各自解决「固定且易错」的那一段：

- `upload-all.sh` —— 批量上传器，**原样拷进 bundle**（容器里只有 curl + coreutils，没有 node/python/jq）。
- `build-image.sh` —— 多架构镜像构建 + 推 harbor（第 7 节），只在出包机跑。
- `entrypoint.sh` —— 镜像内的容器入口，随镜像分发，不单独交给人。

## 一句话流程

```
gh release download（桌面端三件套）
docs:pack（文档站）→ pack:remote（远控页）→ 上游仓整树打 zip（插件市场）
→ 组装成 bundle（MANIFEST.tsv + sha256sums.txt + README.md + upload-all.sh + release-notes.md）
→ build-image.sh → 多架构镜像推 harbor（第 7 节）
```

## 0. 先定变量（在 wave-agent 仓库根）

```bash
cd "$(git rev-parse --show-toplevel)"            # 必须在仓库根：后面全是相对路径
TAG=wave-desktop@1.6.1                            # 桌面端版本 = tag 的 @ 之后
VER=${TAG#*@}
CHANNELS=stable                                   # 或 stable,beta（服务端一次落两行）
WORK=/tmp/wave-artifacts-$VER                     # 固定路径：重跑时复用已下的 350MB
DL=$WORK/dl
BUNDLE=codechat-artifacts-$(date +%Y%m%d)-desktop$VER
mkdir -p "$DL" "$WORK/bundle/$BUNDLE/artifacts"/{desktop,docs,remote,plugin-market}

# macOS 没有 sha256sum：所有取 sha256 的地方都用这个函数，别直接写 sha256sum
sha_of() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
```

## 1. 桌面端安装包（~350MB，重跑别重复下）

```bash
# 已有文件就跳过这步（--desktop-dir 的等价做法），否则从 GitHub Release 下
gh release download "$TAG" -R netease-lcap/wave-agent \
  --pattern '*.exe' --pattern '*.dmg' --pattern '*.zip' --dir "$DL" --clobber
ls -l "$DL"
```

平台标识取自服务端枚举，CodeChat 下载页按这三个值映射入口：`win-exe`（`.exe`）/
`mac-dmg`（`.dmg`）/ `mac-zip`（扩展名 `.zip` 且文件名含 `mac`）。

- **同平台多份**（arm64 + x64 两个 dmg）只放第一份进包，另一份跳过并告诉用户跳过了谁。
- **缺平台只告警不失败**（客户端对应入口没包，由人决定补不补）。三个平台都没有 = 做错了，停下。
- 资产名以 `ls` 实际输出为准；资产名不含空格（含空格就手工处理，别让 glob 断词）。

每个平台一条 MANIFEST 行（六列，`\t` 分隔）：

```bash
B=$WORK/bundle/$BUNDLE
row_desktop() { # $1=平台 $2=文件
  local rel="desktop/$(basename "$2")"
  cp "$2" "$B/artifacts/$rel"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' desktop "$rel" "$VER" "$1" "$CHANNELS" "$(sha_of "$B/artifacts/$rel")" >> "$B/MANIFEST.tsv"
}
WIN=$(ls "$DL"/*.exe 2>/dev/null | head -1)
DMG=$(ls "$DL"/*.dmg 2>/dev/null | head -1)
MACZIP=$(ls "$DL"/*[Mm][Aa][Cc]*.zip 2>/dev/null | head -1)
[ -n "$WIN" ]    && row_desktop win-exe "$WIN"
[ -n "$DMG" ]    && row_desktop mac-dmg "$DMG"
[ -n "$MACZIP" ] && row_desktop mac-zip "$MACZIP"
```

## 2. 文档站包（两个前置：fixtures dist + gitignored 截图）

```bash
# 2a. 前置 dist：demo 的 type-check 直接 import 这两个包的 dist，dist 过期时报的是一堆看着
#     莫名其妙的 TS 错（2026-11-06 实测：fixtures 缺 releaseNotes → TS2339、sdk 缺
#     DEFAULT_WAVE_CONTEXT_WINDOW → TS2305，都不是真代码问题）。判据不是「dist 在不在」
#     而是「src 有没有比 dist 新」。
need_build() { [ ! -d "$1/dist" ] || [ -n "$(find "$1/src" -newer "$1/dist" -name '*.ts*' -print -quit)" ]; }
need_build packages/webview-fixtures && pnpm -F wave-webview-fixtures build
need_build packages/agent-sdk      && pnpm -F wave-agent-sdk build

# 2b. 截图（docs/public/screenshots/ 是 gitignored 的构建产物）：按 docs 实际引用的文件名逐张查，
#     比「目录非空」准 —— 缺一张就会让 vitepress 在「未解析 import」上炸。
#     只认「Markdown 图片」与「<img src>」两种引用（口径同 scripts/check-docs-screenshots.mjs）：
#     specs 正文里当示例提到的 /screenshots/x.webp 是纯文本，全文 grep 会把它当成缺图。
scan_missing() {
  find docs -path docs/.vitepress/dist -prune -o -type f \( -name '*.md' -o -name '*.vue' \) -print0 \
    | xargs -0 grep -hoE '!\[[^]]*\]\([^)[:space:]]+|<img[^>]+src="[^"]+"' \
    | grep -o 'screenshots/[A-Za-z0-9._/-]*\.webp' \
    | sed 's|.*screenshots/||' | sort -u \
    | while read -r n; do [ -f "docs/public/screenshots/$n" ] || echo "$n"; done
}
missing=$(scan_missing)
if [ -n "$missing" ]; then
  pnpm run docs:screenshots || echo "⚠️ demo 套件有失败（并发下常见，2026-11-05 实测）——按截图重新核对"
  missing=$(scan_missing)
  if [ -n "$missing" ]; then echo "✗ 仍缺截图：$missing"; exit 1; fi
fi

# 2c. 出包；--reuse-screenshots = 截图已就绪，别再跑一遍 demo
pnpm run docs:pack -- --reuse-screenshots

# 2d. 校验：服务端要求包根层就是 index.html
DOCS=$(ls -t docs-*.tar.gz | head -1)
tar -tzf "$DOCS" | grep -qx './index.html' || echo "✗ $DOCS 根层没有 index.html，别继续"
```

- `docs:screenshots` 首次在 Linux/WSL 上跑需要 Chromium：`pnpm exec playwright install chromium`，
  必要时 `sudo env "PATH=$PATH" npx playwright install-deps`（sudo 会丢 PATH）。
- demo 套件并发下有偶发失败（2026-11-05 实测 2/118 失败：`agents-dialog` / `mcp-server-tab`，
  单跑立刻通过、184 张图其实都出来了）。**判据是截图齐不齐**，不是 demo 的退出码：失败后重查
  `scan_missing`，空了就继续，别卡在这一步、也别去改 demo。
- 文档包版本取自仓库根 `package.json`，与桌面端 tag **不同步是正常的**（实测 docs 1.6.0 / desktop 1.6.1），
  别拿它当交付版本号。

## 3. 远控页 Web 包

```bash
pnpm -F wave-webview run pack:remote     # → packages/webview/remote/dist/remote-page.zip，根层 index.html
```

## 4. 插件市场快照（上游仓整树打 zip）

```bash
PM=/mnt/c/Users/<你>/github/wave-plugins-official   # WSL 上通常在这；macOS 一般是 ~/github/wave-plugins-official
[ -f "$PM/.wave-plugin/marketplace.json" ] || echo "✗ 根层没有 .wave-plugin/marketplace.json，停下确认仓库"

# 用 python3 打（WSL 上 zip/unzip 常常没装 —— 2026-11-05 实测 `zip: command not found`）
PLUGZIP=$WORK/wave-plugins-official.zip
PM=$PM PLUGZIP=$PLUGZIP python3 - <<'EOF'
import os, zipfile
src, out = os.environ["PM"], os.environ["PLUGZIP"]
skip = {".git", "node_modules", ".DS_Store"}
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(src):
        dirs[:] = sorted(d for d in dirs if d not in skip)
        for f in sorted(files):
            if f == ".DS_Store":
                continue
            p = os.path.join(root, f)
            z.write(p, os.path.relpath(p, src))
EOF

# 校验根层（zipfile 不写扩展属性，等价于 zip -X）
python3 - "$PLUGZIP" <<'EOF'
import sys, zipfile
names = zipfile.ZipFile(sys.argv[1]).namelist()
if ".wave-plugin/marketplace.json" not in names:
    sys.exit("✗ 插件市场 zip 根层没有 .wave-plugin/marketplace.json")
print(f"plugin-market: {len(names)} 项，根层有 marketplace.json")
EOF
```

没有 python3 时（少见）退回 `zip`：`(cd "$PM" && zip -rX "$PLUGZIP" . -x '.git/*' -x '*/node_modules/*' -x '*.DS_Store')`。

## 5. 组装

```bash
B=$WORK/bundle/$BUNDLE

# 其余三类 + 各自的 MANIFEST 行（version/platform/channels 三列留空）
cp "$DOCS" "$B/artifacts/docs/"
printf 'docs\tdocs/%s\t\t\t\t%s\n' "$(basename "$DOCS")" "$(sha_of "$B/artifacts/docs/$(basename "$DOCS")")" >> "$B/MANIFEST.tsv"

cp packages/webview/remote/dist/remote-page.zip "$B/artifacts/remote/"
printf 'remote-page\tremote/remote-page.zip\t\t\t\t%s\n' "$(sha_of "$B/artifacts/remote/remote-page.zip")" >> "$B/MANIFEST.tsv"

# 插件市场文件名内容寻址（sha 前 12 位），latest 指针认它
PMZIP="wave-plugins-official-$(sha_of "$PLUGZIP" | cut -c 1-12).zip"
cp "$PLUGZIP" "$B/artifacts/plugin-market/$PMZIP"
printf 'plugin-market\tplugin-market/%s\t\t\t\t%s\n' "$PMZIP" "$(sha_of "$B/artifacts/plugin-market/$PMZIP")" >> "$B/MANIFEST.tsv"

# 上传器随镜像分发，必须有可执行位
cp .wave/skills/ops-artifacts/upload-all.sh "$B/" && chmod 755 "$B/upload-all.sh"

# 变更记录：本版本相对**上一个 wave-desktop@* tag** 的增量，客户端「重启以完成更新」里展示。
# 没有它，私有化客户点了重启也看不到「本次更新内容」（不影响更新本身）。
# 「上一个版本」的取法与 `publish.yml` 逐字一致（按版本号排序的上一条 tag，**不是**
# git describe —— tag 不都在同一条祖先链上，describe 会跳过版本）：
# 出包前先 `git fetch --tags`。首个版本取不到上一版时脚本不产出文件，这里补一个空文件占位 ——
# Dockerfile 的 COPY 需要它，upload-all.sh 见到空文件就不提交 releaseNotes。
PREV=$(git tag --sort=-v:refname --list 'wave-desktop@*' | grep -v "^${TAG}$" | head -1) || true
node packages/desktop/scripts/release-notes.mjs --since "${PREV:-}" --to "$TAG" --out "$B/release-notes.md" || true
[ -f "$B/release-notes.md" ] || : > "$B/release-notes.md"

# 整包校验（相对包根路径，在 bundle 目录里 sha256sum -c 能过）
(cd "$B" && find artifacts -type f | sort | while read -r f; do printf '%s  %s\n' "$(sha_of "$f")" "$f"; done > sha256sums.txt)
```

bundle 里的 `README.md`（随镜像分发，得 `docker run --rm <镜像> cat README.md` 才看得到；
讲清怎么喂环境变量、退出码是什么，别再写「解压后跑」那套）：

```bash
cat > "$B/README.md" <<EOF
# CodeChat 离线物料镜像（桌面端 $VER）

四类产物在容器内 \`/artifacts/artifacts/\`：桌面端安装包 / 文档站 / 远控页 / 插件市场快照。

- 桌面端 $VER
- 文档站 $(basename "$DOCS" | sed 's/^docs-//; s/\.tar\.gz$//')（版本取自 wave-agent 仓 package.json，与桌面端不同步属正常）

## 用法

容器只吃两个环境变量，其余参数原样透传给 upload-all.sh：

\`\`\`bash
docker run --rm -e CODECHAT_BASE=https://<企业端域名> -e PUBLISH_TOKEN=<令牌> <镜像> --dry-run
\`\`\`

- 部署时由 chart 的 Job 注入这两个变量并跑 \`--verify\`；手动预检用 \`--dry-run\`（零写入）。
- 四条产线一次传完，重复执行安全（已传的自动跳过）；单条重跑：\`--only desktop,docs\`。
- 包内 \`release-notes.md\` 非空时，桌面端上传会一并提交本版本变更记录（客户端「重启以完成更新」里展示）。
- 退出码：0 全部成功、1 有失败项、2 环境/配置错。
EOF
```

到这里 `$B` 就是完整的 bundle —— **它直接就是镜像的构建输入**（`build-image.sh` 吃这个目录），
不再打 tar 包。物料是原样进镜像层的，所以 macOS 扩展属性那条坑只剩 docs 包还沾（见坑 5）。

## 6. 自检（出包机上必跑，别跳）

```bash
cd "$B"
sha256sum -c sha256sums.txt 2>/dev/null || shasum -a 256 -c sha256sums.txt   # macOS 用后者
awk -F'\t' 'NF!=6{print "✗ 列数不是 6: "$0}' MANIFEST.tsv                     # 必须无输出
find artifacts -type f | wc -l                                                # 六条物料
wc -c < release-notes.md                                                      # 变更记录字节数（0 = 本版本无记录）
du -sh "$B"                                                                   # ~350MB（有桌面端时）
```

然后给用户这几行：

```
bundle  $WORK/bundle/$BUNDLE（镜像的构建输入，不再打 tar）
镜像    harbor.cloud.netease.com/qzlowcode/codechat-artifacts:<ver>-<YYYYMMDDHHmm>-multi
自查    docker buildx imagetools inspect <镜像>
直传    node .wave/skills/ops-upload/upload.mjs --type <desktop|docs|remote|plugin-market> …（本机可达时）
```

## 7. Docker 镜像（多架构，**仅私有化**）

bundle 打成多架构镜像推到内网 harbor：物料 + `upload-all.sh` + `release-notes.md` + `entrypoint.sh`
进镜像，部署后容器自己把四类物料推进 CodeChat，SRE 不用碰文件、不用输令牌。

**本技能到「镜像推到 harbor」为止**：镜像怎么在客户集群里跑（chart 里的一次性 Job、用什么域名、
多副本亲和）是 qingzhou-lowcode 那边的事，别在这里展开，也别在技能里抄现成环境的值。

**SaaS 环境永远不部署这个镜像**：SaaS 的物料由我们直接传（走 `ops-upload`）。这条硬约束由 chart 侧
的渲染条件保证，镜像本身不做区分。

### 7a. 构建并推送（走脚本，别手拼命令）

```bash
./.wave/skills/ops-artifacts/build-image.sh "$WORK/bundle/$BUNDLE"
# → harbor.cloud.netease.com/qzlowcode/codechat-artifacts:<物料版本>-<YYYYMMDDHHmm>-multi
#   例：1.6.1-202611061529-multi（amd64 + arm64）
```

**tag 里的时间戳不能省**，也别手工改回纯版本号：物料版本（桌面端 tag）≠ 物料内容版本 —— 同一份 1.6.1 里
docs 包的版本号来自仓库 `package.json`（与桌面端不同步）、远控页和插件市场快照每次重打都是新的。用纯版本号
就会出现「tag 没变、内容变了」：harbor 上被覆盖（丢掉可追溯），客户节点上 `imagePullPolicy: IfNotPresent`
不会重拉（**静默用旧物料**）。**物料重打就出新 tag**，一个 tag 只对应一次构建。

可选参数：`--tag <tag>`（完整 tag，默认按上面规则自动拼）、`--registry <host/project>`、
`--platforms`（默认 `linux/amd64,linux/arm64`，**必须是双架构**）、`--no-push`
（只构建成本地 `<bundle>.oci.tar` 并打印 manifest list 里的 arch，不碰 registry ——
第一次接新构建机、或怀疑多架构链路时先这样验一遍，别拿真 tag 试）。

推送前先 `docker login harbor.cloud.netease.com`，脚本会查 `~/.docker/config.json` 提前拦下没登录的情况。

脚本内部就五步（每步的原因都写在脚本注释里，改之前先读）：注册 QEMU binfmt（`binfmt_misc` 是内核态，
**WSL 重启 / 换构建机就丢**，所以每次装，用内网 harbor 同款镜像）→ 建一次性 docker-container builder
（本机默认 `docker` driver 不支持多平台）→ 把 bundle + `Dockerfile` + `entrypoint.sh` 拼成临时 context
（**不往 bundle 里加文件**，它要打 tar 交出去，包结构是服务端契约）→ `buildx build` 双架构直接推 registry
（多架构不能 `--load`）→ 删 builder 与 context（`trap` 兜住失败路径）。

体积：物料是架构无关的静态文件，两个平台的 `COPY` 层 digest 相同、harbor 里 blob 复用，
**真正翻倍的只有 alpine + curl 那一层（~15MB）** —— 多架构几乎不增加存储和推拉时间。

### 7b. 镜像的对外契约（重点看 7a，这里只列构建完要自查的）

- 容器只吃两个环境变量：`CODECHAT_BASE`（企业端地址）与 `PUBLISH_TOKEN`（发布令牌），其余参数原样
  透传给 `upload-all.sh`。令牌只从 env / Secret 注入，**绝不进镜像层**，也不回显、不落盘。
- `entrypoint.sh` 先轮询 `<base>/health` 再上传（容器可能比企业端起得早），然后
  `exec upload-all.sh --base "$CODECHAT_BASE" "$@"` —— **退出码就是结果**：`0` 全部成功、`1` 有失败项、
  `2` 环境/配置错（缺 `CODECHAT_BASE` / `PUBLISH_TOKEN`）。
- 镜像里就是 §5 组装出来的那份 bundle **原样**（`MANIFEST.tsv` / `sha256sums.txt` / `release-notes.md` /
  `artifacts/` 四类 / `upload-all.sh`），落在 `/artifacts/`，不额外加工。

构建完先在本地验一遍（只读、零写入）：

```bash
./.wave/skills/ops-artifacts/build-image.sh "$WORK/bundle/$BUNDLE" --no-push
docker load -i "$WORK/bundle/$BUNDLE.oci.tar"
docker run --rm -e CODECHAT_BASE=<可达的企业端地址> -e PUBLISH_TOKEN=<令牌> <镜像> --dry-run
```

`--dry-run` 打印「将上传 / 跳过」四条线的预检结果 —— 等于在真部署前验一遍镜像里的物料和网络通路。

### 7c. 构建的坑

**多架构的三个参数不能省**：`--provenance=false`（否则 manifest list 多一条 attestation，老客户端
pull 会迷路）、`--oci-mediatypes=false`（用 Docker v2 schema2 的 manifest list，OCI index 兼容更差），
以及 binfmt 必须先注册（不注册时 arm64 的 `apk add` 直接 exec format error）。与 qingzhou 公共 CI
脚本 `build_image()`（`gitlab-ci-send-message.sh`）的参数逐字一致，可对照。`build-image.sh` 已全带上，
别手拼 `docker buildx build` 把它们漏掉。

## bundle 结构（服务端契约，逐字保留）

镜像里就是这份目录原样（容器内路径 `/artifacts/`）：

```
codechat-artifacts-<YYYYMMDD>-desktop<ver>/
  README.md            说明：这个镜像怎么喂环境变量、退出码是什么
  upload-all.sh        POSIX sh 批量上传器（只依赖 curl + coreutils）
  MANIFEST.tsv         tab 分隔六列：kind / 相对路径 / 版本 / 平台 / 通道 / sha256
  sha256sums.txt       整包校验（sha256sum -c 可过）
  release-notes.md     本版本变更记录（桌面端 init 一并提交；空文件 = 本版本无记录）
  artifacts/
    desktop/<安装包>            ← Release 的 .exe / .dmg / 含 mac 的 .zip
    docs/<docs-<ver>.tar.gz>    ← docs:pack，包根层即 index.html
    remote/remote-page.zip      ← pack:remote，包根层即 index.html
    plugin-market/<sha>.zip     ← 上游仓整树，根层有 .wave-plugin/marketplace.json
```

- `kind` 枚举：`desktop` / `docs` / `remote-page` / `plugin-market`（`upload-all.sh` 按它分派）。
- `MANIFEST.tsv` 的列顺序与行内字段都不许改：`upload-all.sh` 的 `read` 与它逐列对应。
- 桌面端版本号来自 tag；文档包版本号来自 `package.json`，两者不同步是正常的。
- `release-notes.md` 不在 `MANIFEST.tsv` 里（它不是物料，是随 init 提交的元数据），也不进
  `sha256sums.txt`；它由 `upload-all.sh` 在 desktop init 时读。三个平台行共用同一份文本 ——
  服务端按**版本**存一份，与通道、平台无关。
- 服务端对 docs / remote / plugin-market 的单次 multipart 上限是 **100MiB**（桌面端走分片不受限），
  这三个包别往里塞大文件。

## upload-all.sh 的行为（随镜像分发的那份）

```bash
./upload-all.sh --base https://<客户企业端域名>              # 令牌缺省时静默交互输入
./upload-all.sh --base https://... --dry-run                 # 只预检，零写入
./upload-all.sh --base https://... --only desktop,docs       # 单线重跑
./upload-all.sh --base https://... --overwrite               # 强制重传（默认缺就补、有就跳过）
./upload-all.sh --base https://... --verify                  # 传完探四条读路径
./upload-all.sh --base https://... --list                    # 桌面端台账
./upload-all.sh --base https://... --delete <id>             # 回退一条台账记录
```

- 默认幂等：桌面端按台账 `version+platform+channel+sha512` 比；docs / remote 探
  `/docs/index.html`、`/remote/index.html`；插件市场比 `latest` 指针的 sha256。
- 变更记录：包根 `release-notes.md` 非空时，在桌面端 init 请求里带 `releaseNotes`
  （预检会打印「变更记录 N 条」）。空文件/缺失就不带这个字段 —— 老服务端逐字段读请求体、
  未知字段一律忽略，所以带上也不会 400，只是存不下来。
  想给**已经传过的版本**补记录，得带 `--overwrite` 重传（否则台账判定「已存在」直接跳过，
  走不到 init）；服务端按版本 upsert，三个平台行重复提交同一份文本无害。
- 退出码 `0` = 全部成功（含跳过），`1` = 有失败项（末尾列失败项与单线重跑命令）。
- 错误态别猜：`401` 令牌错；`503` 该部署没配 `PUBLISH_TOKEN`（找运维补 env）；
  `404` 打错地址（`--base` 必须是企业端域名）。Git Bash 撞 schannel 吊销检查用
  `CURL_OPTS=--ssl-no-revoke`。
- 改了这个脚本就在 bundle 目录里 `./upload-all.sh --base https://<可达环境> --dry-run` 自查一遍
  （零写入，能识别出六条物料即正确）。

## 坑（都在这一步踩过，别退回去）

1. **fixtures 必须先 build**：`wave-webview-fixtures/dist` 不存在时 demo 的 type-check 报
   `Cannot find module 'wave-webview-fixtures'`。
2. **截图是 gitignored 的**：首次出包必须跑 `docs:screenshots`（实测 184 张图、约 1.3 分钟）。
3. **`docs/public/screenshots` 空目录不等于齐**：按 docs 引用的文件名逐个 `test -f`（步骤 2b），
   否则等到 vitepress 构建才炸。**但别全文 grep `/screenshots/*.webp`**：`docs/specs/ui/file-path-links.md`
   正文里举例提到的 `/home/u/repo/docs/public/screenshots/x.webp` 会被当成缺图（2026-11-05 实测误报，
   害得白跑一遍 118 个 demo 又报错退出）—— 只认 Markdown 图片和 `<img src>` 两种引用语法。
4. **桌面端三件套约 350MB**，`gh release download` 十分钟量级 —— 固定 `$WORK`，失败重跑复用。
5. **`--no-xattrs` 只剩 docs 包还沾**：物料是原样进镜像层的，不再打总包 tar，所以 macOS 扩展属性
   → 服务端 `._*` 垃圾对象这条只在 `docs-*.tar.gz` 上还有 —— `pack-docs.mjs` 已经带了它并自检
   `SCHILY.xattr` 扩展头，别自己另打一份。
6. **别把 350MB 的包一遍遍读进内存算 hash**：用 `sha_of`（`sha256sum` / `shasum` 都是流式的），
   别自己写循环 `$(cat file | ...)` 那类写法。
7. **macOS 没有 `sha256sum`**：一律走 `sha_of`；`sha256sum -c` 回退 `shasum -a 256 -c`。
8. **WSL 上常常没有 `zip` / `unzip`**（2026-11-05 实测 `zip: command not found`）：插件市场用 python3 打，
   校验也用 python3 读 zip 名单，别依赖 `unzip -l`。
9. **`docs-*.tar.gz` 是中间产物**：装进包后删掉仓库根那份（`rm docs-*.tar.gz`），它虽 gitignored 但会一直堆着。
10. **binfmt 注册不持久**：`binfmt_misc` 是内核态，WSL 重启 / 换机器就没了，所以 `build-image.sh`
    每次都注册一遍（幂等）。手动拼 `buildx build` 前也要先 `--install all`，否则 arm64 的
    `apk add` 直接 `exec format error`。其余构建参数坑见 7c。

## 验收（出包机上跑一遍）

1. `$B` 下 `artifacts/` 四类齐全，`MANIFEST.tsv` 六列、`sha256sums.txt` 能 `sha256sum -c` 全过，
   `upload-all.sh` 有可执行位，`release-notes.md` 存在（内容非空，或为空表示本版本无记录）；
2. docs / remote 两个包根层是 `index.html`，plugin-market 根层有 `.wave-plugin/marketplace.json`；
3. 可达的私有化环境：`./upload-all.sh --base https://<企业端地址> --dry-run` 能识别到六条物料
   （三个桌面平台各一条 + 其余三条）且预检里打印「变更记录 N 条」，正式跑后 `--verify` 四条读路径全 200；
   传完 `--base …/latest.yml` 里该版本能看到 `releaseNotes`（客户环境 codechat 含变更记录支持时）；
4. 同一份包第二遍：全部跳过、退出码 0；
5. 出包过程**不出现**需要手工预构建的报错；
6. （走镜像时）`docker buildx imagetools inspect <镜像>` 能看到 `linux/amd64` 与 `linux/arm64`
   两个平台；`--no-push` 出的 oci tar 能 `docker load` 起来，`docker run … --dry-run` 识别到六条物料。

## 与本仓其它技能的关系

- **本技能**：出包（生产物料 + 组装 bundle + 打成多架构镜像）。终点就是**一个推到 harbor 的镜像**
  （不再出 tar.gz）；镜像怎么在客户集群里跑归 qingzhou-lowcode 的 chart，不在本技能。
- **`ops-upload`**：把单条产物线传到**本机可达**的环境（`upload.mjs --type …`，分片直传、台账、
  令牌查表都在那边）。日常发版走它；私有化交付走本技能的镜像。
- **`ide-plugin-publish`**：IDE 插件上 marketplace，与物料包无关。
