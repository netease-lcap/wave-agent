---
name: ops-artifacts
description: 打「私有化离线物料包」——把四类静态物料（桌面端安装包 / 文档站 / 远控页 / 插件市场快照）连同 upload-all.sh 打成单个 tar.gz 交 SRE。没有打包脚本：按本技能给出的 bash 步骤在出包机上逐步执行（前置 fixtures build、docs 截图、docs:pack、pack:remote、插件市场 zip 全由这些步骤自己搞定）。当用户要求「打私有化物料包」「离线包」「交付包」「artifacts 包」「给 SRE 的 tar.gz」，或询问离线交付/物料包结构/upload-all.sh 时使用。上传单个产物线用 ops-upload 技能。
allowed-tools:
  - Bash
---

# 私有化离线物料包（四类静态物料 → 一个 tar.gz）

客户集群**不出网**，CodeChat 镜像里也不含这四类物料。所以物料在出包机这边凑齐、打成一个包，
SRE 在客户环境里 `tar -xzf` 后跑一条 `./upload-all.sh --base <企业端域名>` 就传完。
包结构与上传契约由 **CodeChat 服务端**定义（它那边 `docs/specs/ops-publish-api.md`），
这里只负责按契约生产 —— 结构、字段名、枚举值都不要"优化"。

**没有打包脚本**：出包由你按下面的步骤直接跑 bash 完成。仓里唯一的脚本是
`.wave/skills/ops-artifacts/upload-all.sh`，它要**原样拷进包**（SRE 机器上不一定有 node/python/jq，
交付路径上不能只有 node 版实现）。

## 一句话流程

```
gh release download（桌面端三件套）
docs:pack（文档站）→ pack:remote（远控页）→ 上游仓整树打 zip（插件市场）
→ 组装 + MANIFEST.tsv + sha256sums.txt + README.md + upload-all.sh → tar -czf → dist/artifacts/
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
OUT=$PWD/dist/artifacts                            # 已 gitignored
mkdir -p "$DL" "$OUT" "$WORK/bundle/$BUNDLE/artifacts"/{desktop,docs,remote,plugin-market}

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
# 2a. fixtures 没 build 时，demo 的 type-check 直接报 Cannot find module 'wave-webview-fixtures'
[ -f packages/webview-fixtures/dist/index.js ] || pnpm -F wave-webview-fixtures build

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

# 上传器随包分发，必须有可执行位
cp .wave/skills/ops-artifacts/upload-all.sh "$B/" && chmod 755 "$B/upload-all.sh"

# 整包校验（相对包根路径，解包后在包目录里 sha256sum -c 能过）
(cd "$B" && find artifacts -type f | sort | while read -r f; do printf '%s  %s\n' "$(sha_of "$f")" "$f"; done > sha256sums.txt)
```

包内 `README.md`（读它的人已经解过压、站在包目录里，所以只讲「在这儿跑哪条命令」，不要写 `tar -xzf`）：

```bash
cat > "$B/README.md" <<EOF
# CodeChat 离线物料包（桌面端 $VER）

四类产物都在当前目录下的 \`artifacts/\`：桌面端安装包 / 文档站 / 远控页 / 插件市场快照。

- 桌面端 $VER
- 文档站 $(basename "$DOCS" | sed 's/^docs-//; s/\.tar\.gz$//')（版本取自 wave-agent 仓 package.json，与桌面端不同步属正常）

## 上传

在当前目录执行：

\`\`\`bash
./upload-all.sh --base https://<客户企业端域名>
\`\`\`

执行后会提示输入发布令牌（找交付要，不回显、不落盘）。四条产线一次传完，末尾打印汇总；
重复执行安全（已传的自动跳过），有失败项按提示重跑那一条即可。

只想跑其中几条：\`--only desktop,docs\`；先探一遍不写入：\`--dry-run\`；传完核读路径：\`--verify\`。
回退一个桌面端版本：\`--list\` 找到 id 后 \`--delete <id>\`。
EOF
```

打包（`--no-xattrs` 不是可选项，见坑 5；`mv` 跨设备会自动退回拷贝+删源，不会 EXDEV）：

```bash
(cd "$WORK/bundle" && tar -czf "$BUNDLE.tar.gz" --no-xattrs "$BUNDLE")
mv "$WORK/bundle/$BUNDLE.tar.gz" "$OUT/"
```

## 6. 自检（出包机上必跑，别跳）

```bash
cd "$B"
sha256sum -c sha256sums.txt 2>/dev/null || shasum -a 256 -c sha256sums.txt   # macOS 用后者
awk -F'\t' 'NF!=6{print "✗ 列数不是 6: "$0}' MANIFEST.tsv                     # 必须无输出
tar -tzf "$OUT/$BUNDLE.tar.gz" | head -3                                      # 首层是 $BUNDLE/…
ls -l "$OUT/$BUNDLE.tar.gz"                                                   # ~350MB（有桌面端时）
```

然后给用户这三行：

```
物料包  $OUT/$BUNDLE.tar.gz
交付    tar -xzf <包名> && cd <包名名> && ./upload-all.sh --base https://<客户企业端域名>
直传    node .wave/skills/ops-upload/upload.mjs --type <desktop|docs|remote|plugin-market> …（本机可达时）
```

## 包结构（服务端契约，逐字保留）

```
codechat-artifacts-<YYYYMMDD>-desktop<ver>/
  README.md            包内说明：站在这层目录里跑哪条命令
  upload-all.sh        POSIX sh 批量上传器（只依赖 curl + coreutils）
  MANIFEST.tsv         tab 分隔六列：kind / 相对路径 / 版本 / 平台 / 通道 / sha256
  sha256sums.txt       整包校验（sha256sum -c 可过）
  artifacts/
    desktop/<安装包>            ← Release 的 .exe / .dmg / 含 mac 的 .zip
    docs/<docs-<ver>.tar.gz>    ← docs:pack，包根层即 index.html
    remote/remote-page.zip      ← pack:remote，包根层即 index.html
    plugin-market/<sha>.zip     ← 上游仓整树，根层有 .wave-plugin/marketplace.json
```

- `kind` 枚举：`desktop` / `docs` / `remote-page` / `plugin-market`（`upload-all.sh` 按它分派）。
- `MANIFEST.tsv` 的列顺序与行内字段都不许改：`upload-all.sh` 的 `read` 与它逐列对应。
- 桌面端版本号来自 tag；文档包版本号来自 `package.json`，两者不同步是正常的。

## upload-all.sh 的行为（交付出去的那份）

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
- 退出码 `0` = 全部成功（含跳过），`1` = 有失败项（末尾列失败项与单线重跑命令）。
- 错误态别猜：`401` 令牌错；`503` 该部署没配 `PUBLISH_TOKEN`（找运维补 env）；
  `404` 打错地址（`--base` 必须是企业端域名）。Git Bash 撞 schannel 吊销检查用
  `CURL_OPTS=--ssl-no-revoke`。
- 改了这个脚本就在包目录里 `./upload-all.sh --base https://<可达环境> --dry-run` 自查一遍
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
5. **`--no-xattrs` 不是可选项**：macOS 的扩展属性会在服务端解成 `._*` 垃圾对象（一次 700+ 文件翻倍）。
   总包与 `pack-docs.mjs` 都带；`pack-docs.mjs` 自己还会自检 `SCHILY.xattr` 扩展头。
6. **别把 350MB 的包一遍遍读进内存算 hash**：用 `sha_of`（`sha256sum` / `shasum` 都是流式的），
   别自己写循环 `$(cat file | ...)` 那类写法。
7. **macOS 没有 `sha256sum`**：一律走 `sha_of`；`sha256sum -c` 回退 `shasum -a 256 -c`。
8. **WSL 上常常没有 `zip` / `unzip`**（2026-11-05 实测 `zip: command not found`）：插件市场用 python3 打，
   校验也用 python3 读 zip 名单，别依赖 `unzip -l`。
9. **`docs-*.tar.gz` 是中间产物**：装进包后删掉仓库根那份（`rm docs-*.tar.gz`），它虽 gitignored 但会一直堆着。

## 验收（出包机上跑一遍）

1. 产出单个 tar.gz，解包后 `artifacts/` 四类齐全，`MANIFEST.tsv` 六列、`sha256sums.txt` 能
   `sha256sum -c` 全过，`upload-all.sh` 有可执行位；
2. docs / remote 两个包根层是 `index.html`，plugin-market 根层有 `.wave-plugin/marketplace.json`；
3. 可达的私有化环境：`./upload-all.sh --base https://<企业端地址> --dry-run` 能识别到六条物料
   （三个桌面平台各一条 + 其余三条），正式跑后 `--verify` 四条读路径全 200；
4. 同一份包第二遍：全部跳过、退出码 0；
5. 出包过程**不出现**需要手工预构建的报错。

## 与本仓其它技能的关系

- **本技能**：出包（生产物料 + 打包），终点是「交给 SRE 的一个 tar.gz」。
- **`ops-upload`**：把单条产物线传到**本机可达**的环境（`upload.mjs --type …`，分片直传、台账、
  令牌查表都在那边）。日常发版走它；私有化交付走出包 + `upload-all.sh`。
- **`ide-plugin-publish`**：IDE 插件上 marketplace，与物料包无关。
