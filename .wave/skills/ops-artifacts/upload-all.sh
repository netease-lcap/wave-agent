#!/bin/sh
# CodeChat 离线物料包一键上传（四类产物：桌面端安装包 / 文档站 / 远控页 / 插件市场快照）。
#
# 背景：私有化交付时 SRE 手上只有「一个 tar.gz + 一个企业端域名 + 一把发布令牌」，机器上
# 不一定有 node/python/jq。所以这个脚本是 **POSIX sh**，只依赖 curl + coreutils（dd/wc/sed）。
# 打接口的口径与 `.wave/skills/ops-upload/upload.mjs` 完全一致 —— 两个客户端、一个服务端契约
# （CodeChat `packages/shared/src/publish/router.ts`）。
#
# 这个文件是本仓的**唯一来源**：出包时（见 .wave/skills/ops-artifacts/SKILL.md）把它原样拷进包根
# 并给可执行位。交付路径上不依赖 node，所以它没有 node 版替代品。
#
# 用法：
#   ./upload-all.sh --base https://codechat.example.com          # 令牌缺省时静默交互输入
#   PUBLISH_TOKEN=xxx ./upload-all.sh --base https://... --verify
#   ./upload-all.sh --base https://... --only desktop,docs --dry-run
#   ./upload-all.sh --base https://... --list
#   ./upload-all.sh --base https://... --delete <台账 id>
#
# 退出码：0 = 全部成功（含「已存在，跳过」）；1 = 有失败项（详见汇总）。
#
# Windows / Git Bash 用户如果撞到 schannel 的吊销检查报错，加：CURL_OPTS=--ssl-no-revoke

set -u
LC_ALL=C

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
ARTIFACT_DIR="$SCRIPT_DIR/artifacts"
MANIFEST="$SCRIPT_DIR/MANIFEST.tsv"
NOTES_FILE="$SCRIPT_DIR/release-notes.md"

BASE=""
TOKEN="${PUBLISH_TOKEN:-}"
OVERWRITE=0
DRY_RUN=0
VERIFY=0
LIST=0
DELETE_ID=""
ONLY="desktop,docs,remote,plugin-market"
CURL_OPTS="${CURL_OPTS:-}"
HTTP_TIMEOUT="${HTTP_TIMEOUT:-1800}"

TMP=""
OK_COUNT=0
SKIP_COUNT=0
FAIL_COUNT=0
FAILED_ITEMS=""
# 变更记录（release-notes.md）转义成 JSON 字符串体后的内容；空串 = 本版本没有记录。
RELEASE_NOTES_BODY=""
RELEASE_NOTES_COUNT=0
RELEASE_NOTES_BYTES=0

usage() {
  cat <<'EOF'
用法: ./upload-all.sh --base <企业端地址> [选项]

必填:
  --base <url>          目标部署的企业端地址（私有化就是客户访问的那个域名）
                        例: --base https://codechat.example.com

令牌（三选一，按优先级）:
  --token <token>       命令行传入（会留在 shell history 里，不推荐）
  PUBLISH_TOKEN=<token> 环境变量（推荐）
  （都不给且是终端时，脚本会静默提示输入）

上传范围:
  --only <列表>         只跑其中几条线，逗号分隔：desktop,docs,remote,plugin-market
                        默认四条全跑（失败的线可以单独重跑，成功的线会自动跳过）
  --overwrite           已存在也重新覆盖（默认「缺就补、有就跳过」）

验证与回退:
  --dry-run             只做预检：探通接口、校验包与清单、报告「会跳过哪些」，不写任何东西
  --verify              上传完再核一遍读路径（feed / manifest / /docs/ / /remote/ / latest）
  --list                读桌面端发布台账后退出
  --delete <id>         删一条桌面端台账记录（= 回退一个版本）后退出

变更记录（桌面端）:
  包根 release-notes.md 若存在且非空，会在 desktop init 时随请求提交（按版本存，
  与通道无关，客户端「重启以完成更新」里展示）。空文件/缺失 = 本版本没有记录，
  不提交该字段，其余行为不变。

环境变量:
  CURL_OPTS             追加给 curl 的参数（Git Bash 撞证书吊销检查时用 --ssl-no-revoke）
  HTTP_TIMEOUT          单次请求超时秒数，默认 1800

退出码: 0 全部成功（含跳过）；1 有失败项
EOF
}

log()  { printf '%s\n' "$*"; }
info() { printf '  %s\n' "$*"; }
warn() { printf '  ⚠️  %s\n' "$*"; }

die() {
  printf '✗ %s\n' "$1" >&2
  exit 1
}

# ─── 参数解析 ────────────────────────────────────────────────────────────────
while [ $# -gt 0 ]; do
  case "$1" in
    --base)      BASE="${2:-}"; shift 2 ;;
    --token)     TOKEN="${2:-}"; shift 2 ;;
    --only)      ONLY="${2:-}"; shift 2 ;;
    --delete)    DELETE_ID="${2:-}"; shift 2 ;;
    --overwrite) OVERWRITE=1; shift ;;
    --dry-run)   DRY_RUN=1; shift ;;
    --verify)    VERIFY=1; shift ;;
    --list)      LIST=1; shift ;;
    -h|--help)   usage; exit 0 ;;
    *)           die "未知参数: $1（-h 看用法）" ;;
  esac
done

[ -n "$BASE" ] || die "缺 --base（目标部署的企业端地址）"
BASE="${BASE%/}"

# 令牌：命令行 > 环境变量 > 交互输入（不回显、不落盘）
if [ -z "$TOKEN" ]; then
  if [ -t 0 ]; then
    printf '发布令牌（输入不回显）: '
    stty -echo 2>/dev/null || true
    IFS= read -r TOKEN || true
    stty echo 2>/dev/null || true
    printf '\n'
  fi
fi
[ -n "$TOKEN" ] || die "缺发布令牌（--token / PUBLISH_TOKEN / 交互输入任选其一）"

case "$BASE" in
  http://*|https://*) ;;
  *) die "--base 必须以 http:// 或 https:// 开头（收到: $BASE）" ;;
esac

TMP=$(mktemp -d 2>/dev/null || mktemp -d -t codechat-upload) || die "建不了临时目录"
trap 'rm -rf "$TMP"' EXIT INT TERM
# Git Bash：`mktemp` 给的是 `/tmp/...`，而 curl 可能是**原生 Windows 程序**（不认 MSYS 路径），
# 分片文件就会读不到。`cygpath -m` 换成 `C:/...` 形式 —— bash、MSYS curl、原生 curl 三种都认。
if command -v cygpath >/dev/null 2>&1; then
  TMP=$(cygpath -m "$TMP" 2>/dev/null || printf '%s' "$TMP")
fi

wants() {
  case ",$ONLY," in
    *",$1,"*) return 0 ;;
    *) return 1 ;;
  esac
}

# ─── HTTP 基元 ───────────────────────────────────────────────────────────────
# 统一把响应体写进 $TMP/body、把状态码放进 $CODE；失败（连不上）时 $CODE=000。
# 注意：不开 `--fail`，因为 4xx/5xx 的响应体里有我们想打印的业务文案。
BODY_FILE=""
http() {
  method="$1"; path="$2"; shift 2
  BODY_FILE="$TMP/body"
  # shellcheck disable=SC2086
  CODE=$(curl -sS $CURL_OPTS --max-time "$HTTP_TIMEOUT" \
      -X "$method" -o "$BODY_FILE" -w '%{http_code}' \
      -H "Authorization: Bearer $TOKEN" "$@" "$BASE$path" 2>"$TMP/curl.err") || CODE=000
  [ -n "$CODE" ] || CODE=000
}

body() { cat "$BODY_FILE" 2>/dev/null; }

# 从扁平 JSON 里抠一个字符串 / 数字字段（响应形状固定且没有同名嵌套，sed 足够；
# 服务端要是把它改成嵌套结构，这里会明显报「解析不出 uploadId」而不是静默出错）
json_str() { sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$BODY_FILE" 2>/dev/null | head -1; }
json_num() { sed -n 's/.*"'"$1"'"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$BODY_FILE" 2>/dev/null | head -1; }

http_head() { # 只取状态码，不要响应体（用于读路径探测）
  path="$1"
  # shellcheck disable=SC2086
  CODE=$(curl -sS $CURL_OPTS --max-time 60 -o /dev/null -w '%{http_code}' "$BASE$path" 2>/dev/null) || CODE=000
}

fail_item() {
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILED_ITEMS="$FAILED_ITEMS
  - $1: $2"
  printf '  ✗ %s\n' "$2"
}

# ─── 本地工具探测 ────────────────────────────────────────────────────────────
file_size() { wc -c < "$1" | tr -d ' '; }

# 本地 sha512（base64，与接口返回口径一致）。三种工具按可用性降级，都没有就返回空串
# ⇒ 跳过本地校验，只信服务端 complete 返回的值。口径优先级：openssl（最普及，含 macOS）
# > sha512sum + xxd > sha512sum + base64（hex→二进制这一步 xxd 最稳）。
sha512_b64() {
  if command -v openssl >/dev/null 2>&1; then
    openssl dgst -sha512 -binary "$1" 2>/dev/null | base64 | tr -d '\r\n'
    return
  fi
  if command -v sha512sum >/dev/null 2>&1 && command -v xxd >/dev/null 2>&1; then
    sha512sum "$1" | cut -d' ' -f1 | xxd -r -p | base64 | tr -d '\r\n'
    return
  fi
  printf ''
}

sha256_hex() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1; return; fi
  if command -v openssl >/dev/null 2>&1; then openssl dgst -sha256 "$1" | sed 's/.*= //'; return; fi
  printf ''
}

# ─── 变更记录（release-notes.md）─────────────────────────────────────────────
# 出包时生成、随镜像分发（见 .wave/skills/ops-artifacts/SKILL.md 步骤 5）。桌面端 init 时
# 一并提交，服务端按**版本**维度存进台账，feed（latest*.yml）里带出去，客户端「重启以完成
# 更新」里展示（vusion/codechat#50）。
#
# 文件 → 能直接塞进 JSON 字符串体的**单行**文本（不含外层引号）：`\` 与 `"` 转义、去掉
# CR、tab 换成空格、行间换行变字面 `\n`。只依赖 tr/sed —— 容器里没有 node/python/jq。
# 注意两个 sed 的顺序：先转义内容，再给除最后一行外的每行末尾加 `\n` 两个字符，最后 tr
# 把真换行删掉合成一行。
json_escape_file() {
  tr -d '\r' < "$1" | tr '\t' ' ' \
    | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' \
    | sed -e '$!s/$/\\n/' | tr -d '\n'
}

load_release_notes() {
  [ -f "$NOTES_FILE" ] || return 0
  [ -s "$NOTES_FILE" ] || return 0
  RELEASE_NOTES_BODY=$(json_escape_file "$NOTES_FILE")
  [ -n "$RELEASE_NOTES_BODY" ] || return 0
  RELEASE_NOTES_BYTES=$(file_size "$NOTES_FILE")
  RELEASE_NOTES_COUNT=$(grep -c '' "$NOTES_FILE" 2>/dev/null || printf '0')
}

# ─── 预检：令牌 / 接口可用性 ─────────────────────────────────────────────────
preflight() {
  printf '目标部署   %s\n' "$BASE"
  printf '发布令牌   已提供（长度 %s，值不显示）\n' "${#TOKEN}"

  if [ -n "$RELEASE_NOTES_BODY" ]; then
    printf '变更记录   %s 条（%s 字节，随 desktop init 提交）\n' "$RELEASE_NOTES_COUNT" "$RELEASE_NOTES_BYTES"
  else
    printf '变更记录   无（release-notes.md 缺失或为空 ⇒ 客户端不显示「本次更新内容」）\n'
  fi

  if [ "$LIST" = 1 ] || [ -n "$DELETE_ID" ]; then return 0; fi

  http GET /api/publish/desktop
  case "$CODE" in
    200) info "接口可用（/api/publish/desktop 200）" ;;
    401) die "令牌不对（401 Invalid publish token）" ;;
    503) die "该部署没配 PUBLISH_TOKEN（503），先去补环境变量再上传" ;;
    404) die "打错地址了（404）：--base 必须是企业端域名，且该部署镜像需为 v1.6.2 及以上" ;;
    000) die "连不上 $BASE（网络/证书问题）。Windows/Git Bash 上常见原因是 schannel 吊销检查，加 CURL_OPTS=--ssl-no-revoke 重试$(curl_err)" ;;
    *)   die "预检失败：HTTP $CODE $(body)" ;;
  esac
}

# ─── 桌面端：init → 分片 → complete ──────────────────────────────────────────
ledger_has() { # $1=version $2=platform $3=channel [$4=sha512]
  [ -s "$TMP/ledger.json" ] || return 1
  # 每条记录一段，逐段比对；不跨记录贪婪匹配。
  # 注意末尾那个 `echo`：响应体不以换行结尾，而 `while read` 会丢掉最后一行 =>
  # 不补换行的话「台账里只有一条记录」时永远判成「没有」。
  { sed 's/},{/}\
{/g' "$TMP/ledger.json"; echo; } | while IFS= read -r rec; do
    case "$rec" in
      *"\"version\":\"$1\""*) ;;
      *) continue ;;
    esac
    case "$rec" in
      *"\"platform\":\"$2\""*) ;;
      *) continue ;;
    esac
    case "$rec" in
      *"\"channel\":\"$3\""*) ;;
      *) continue ;;
    esac
    if [ $# -ge 4 ] && [ -n "$4" ]; then
      case "$rec" in
        *"\"sha512\":\"$4\""*) ;;
        *) continue ;;
      esac
    fi
    printf 'hit'
    break
  done | grep -q hit
}

upload_desktop() { # $1=version $2=platform $3=channels(csv) $4=file
  version="$1"; platform="$2"; channels="$3"; file="$4"
  name=$(basename "$file")
  size=$(file_size "$file")
  local_sha=$(sha512_b64 "$file")

  if [ -s "$TMP/ledger.json" ]; then
    first_channel=$(printf '%s' "$channels" | cut -d, -f1)
    if ledger_has "$version" "$platform" "$first_channel" "$local_sha"; then
      SKIP_COUNT=$((SKIP_COUNT + 1))
      info "跳过 desktop/$platform $version（台账里已是同一份，--overwrite 可强制覆盖）"
      return 0
    fi
  fi

  if [ "$DRY_RUN" = 1 ]; then
    info "将上传 desktop/$platform $version（$name，$((size / 1048576))MB，通道 $channels）"
    return 0
  fi

  # init：通道传成 JSON 数组，与服务端 parseChannels 的两种入参都兼容。
  # 变更记录也在这里提交（三个平台行共用同一份文本，服务端按 version 存一份）——老服务端
  # 逐字段读请求体、未知字段一律忽略，所以带上不会报错，只是存不下来。
  channels_json=$(printf '%s' "$channels" | sed 's/[^,]*/"&"/g')
  notes_field=""
  if [ -n "$RELEASE_NOTES_BODY" ]; then
    notes_field=$(printf ',"releaseNotes":"%s"' "$RELEASE_NOTES_BODY")
  fi
  init_body=$(printf '{"platform":"%s","version":"%s","fileName":"%s","fileSize":%s,"channels":[%s]%s}' \
    "$platform" "$version" "$name" "$size" "$channels_json" "$notes_field")
  http POST /api/publish/desktop/init -H 'Content-Type: application/json' -d "$init_body"
  if [ "$CODE" != 201 ] && [ "$CODE" != 200 ]; then
    fail_item "desktop/$platform $version" "init 失败 HTTP $CODE $(body)"; return 1
  fi
  upload_id=$(json_str uploadId)
  chunk_size=$(json_num chunkSize)
  total_chunks=$(json_num totalChunks)
  case "$upload_id" in
    '') fail_item "desktop/$platform $version" "init 响应解析不出 uploadId: $(body)"; return 1 ;;
  esac
  case "$chunk_size" in
    ''|0) fail_item "desktop/$platform $version" "init 响应解析不出 chunkSize: $(body)"; return 1 ;;
  esac
  case "$total_chunks" in
    ''|0) fail_item "desktop/$platform $version" "init 响应解析不出 totalChunks: $(body)"; return 1 ;;
  esac
  info "会话 $upload_id（$total_chunks 片，每片 $((chunk_size)) 字节）"

  i=0
  while [ "$i" -lt "$total_chunks" ]; do
    # 用 dd 切出第 i 片：bs 取服务端下发的 chunkSize，count=1 保证只读一片；
    # 最后一片自然短于 bs，dd 会读到文件尾就停。
    if ! dd if="$file" bs="$chunk_size" skip="$i" count=1 of="$TMP/chunk" 2>/dev/null; then
      fail_item "desktop/$platform $version" "切第 $((i + 1)) 片失败（dd）"; return 1
    fi
    http POST "/api/publish/desktop/$upload_id/chunk/$i" -F "chunk=@$TMP/chunk;filename=chunk-$i"
    if [ "$CODE" != 200 ]; then
      fail_item "desktop/$platform $version" "第 $((i + 1))/$total_chunks 片失败 HTTP $CODE $(body)$(curl_err)"; return 1
    fi
    printf '\r  chunk %s/%s 已传' "$((i + 1))" "$total_chunks"
    i=$((i + 1))
  done
  printf '\r'

  http POST "/api/publish/desktop/$upload_id/complete"
  if [ "$CODE" != 201 ] && [ "$CODE" != 200 ]; then
    fail_item "desktop/$platform $version" "complete 失败 HTTP $CODE $(body)"; return 1
  fi
  server_sha=$(json_str sha512)
  if [ -n "$local_sha" ] && [ -n "$server_sha" ] && [ "$local_sha" != "$server_sha" ]; then
    fail_item "desktop/$platform $version" "sha512 不一致（本地 ${local_sha%%=*}… / 服务端 ${server_sha%%=*}…）"; return 1
  fi
  OK_COUNT=$((OK_COUNT + 1))
  info "✓ desktop/$platform $version 已发布（sha512 ${server_sha%%=*}…）"
}

# ─── 单次 multipart 的三条线 ─────────────────────────────────────────────────
upload_multipart() { # $1=kind $2=path $3=field $4=file
  kind="$1"; path="$2"; field="$3"; file="$4"
  name=$(basename "$file")

  if [ "$DRY_RUN" = 1 ]; then
    info "将上传 $kind（$name）"
    return 0
  fi

  http POST "$path" -F "$field=@$file"
  if [ "$CODE" != 201 ] && [ "$CODE" != 200 ]; then
    fail_item "$kind" "上传失败 HTTP $CODE $(body)"; return 1
  fi
  OK_COUNT=$((OK_COUNT + 1))
  info "✓ $kind 已上传（$name）"
}

upload_docs() { # $1=file
  if [ "$OVERWRITE" = 0 ]; then
    http_head /docs/index.html
    if [ "$CODE" = 200 ]; then
      SKIP_COUNT=$((SKIP_COUNT + 1))
      info "跳过 docs（/docs/ 已有内容，--overwrite 可强制覆盖）"
      return 0
    fi
  fi
  upload_multipart docs /api/publish/docs archive "$1"
}

upload_remote() { # $1=file
  if [ "$OVERWRITE" = 0 ]; then
    http_head /remote/index.html
    if [ "$CODE" = 200 ]; then
      SKIP_COUNT=$((SKIP_COUNT + 1))
      info "跳过 remote-page（/remote/ 已有内容，--overwrite 可强制覆盖）"
      return 0
    fi
  fi
  upload_multipart remote-page /api/publish/remote-page zip "$1"
}

upload_plugin_market() { # $1=file
  local_sha=$(sha256_hex "$1")
  if [ -n "$local_sha" ] && [ "$OVERWRITE" = 0 ]; then
    # latest 指针是纯文本 sha（内容寻址，重传同一份 zip 幂等），所以能直接比
    http GET /wave-plugins-official/latest
    if [ "$CODE" = 200 ]; then
      remote_sha=$(body | tr -d ' \r\n')
      if [ "$remote_sha" = "$local_sha" ]; then
        SKIP_COUNT=$((SKIP_COUNT + 1))
        info "跳过 plugin-market（latest 已是同一份快照 $(printf '%s' "$local_sha" | cut -c1-16)…）"
        return 0
      fi
    fi
  fi
  upload_multipart plugin-market /api/publish/plugin-market zip "$1"
}

# ─── 读路径核验 ──────────────────────────────────────────────────────────────
verify_all() {
  printf '\n核验读路径\n'
  http_head /docs/
  info "/docs/ → $CODE"
  http_head /remote/
  info "/remote/ → $CODE"
  http_head /wave-plugins-official/latest
  info "/wave-plugins-official/latest → $CODE"
  http GET /api/downloads/manifest.json
  if [ "$CODE" = 200 ]; then
    info "下载页 manifest → 200 $(sed -n 's/.*"version":"\([^"]*\)".*/当前版本 \1/p' "$BODY_FILE" | head -1)"
  else
    info "下载页 manifest → $CODE $(body)"
  fi
}

# ─── --list / --delete ───────────────────────────────────────────────────────
do_list() {
  http GET /api/publish/desktop
  [ "$CODE" = 200 ] || die "读台账失败 HTTP $CODE $(body)"
  # 先剥掉 {"desktopDownloads":[ ... ]} 的外壳，再按记录切分
  records=$(sed 's/^[^{]*{"desktopDownloads":\[//; s/\]}[[:space:]]*$//' "$BODY_FILE" | sed 's/},{/}\
{/g')
  printed=0
  while IFS= read -r rec; do
    case "$rec" in
      ''|'[]') continue ;;
    esac
    line=$(printf '%s\n' "$rec" | sed -n \
      's/.*"id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*"platform"[[:space:]]*:[[:space:]]*"\([^"]*\)".*"channel"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/  \2  \3  \4  (\1)/p')
    [ -n "$line" ] || continue
    printf '%s\n' "$line"
    printed=$((printed + 1))
  done <<EOF
$records
EOF
  if [ "$printed" = 0 ]; then
    printf '  （台账为空）\n'
  else
    printf '\n共 %s 条。回退一条：./upload-all.sh --base <地址> --delete <id>\n' "$printed"
  fi
}

do_delete() {
  http DELETE "/api/publish/desktop/$DELETE_ID"
  if [ "$CODE" = 200 ]; then
    printf '已删除台账记录 %s\n' "$DELETE_ID"
  else
    die "删除失败 HTTP $CODE $(body)"
  fi
}

curl_err() { [ -s "$TMP/curl.err" ] && printf '
    %s' "$(tr -d '\015' < "$TMP/curl.err" | tr '
' ' ')"; }

# ─── 主流程 ──────────────────────────────────────────────────────────────────
load_release_notes
preflight

if [ "$LIST" = 1 ]; then do_list; exit 0; fi
if [ -n "$DELETE_ID" ]; then do_delete; exit 0; fi

[ -f "$MANIFEST" ] || die "缺 MANIFEST.tsv（物料包不完整，重新解包）"

printf '\n物料包     %s\n' "$SCRIPT_DIR"
printf '模式       %s\n' "$([ "$DRY_RUN" = 1 ] && echo '预检（不写入）' || echo '正式上传')"
printf '覆盖策略   %s\n\n' "$([ "$OVERWRITE" = 1 ] && echo '强制覆盖' || echo '缺就补、有就跳过')"

if wants desktop; then
  http GET /api/publish/desktop
  if [ "$CODE" = 200 ]; then cp "$BODY_FILE" "$TMP/ledger.json"; fi
fi

TAB=$(printf '\t')
while IFS="$TAB" read -r kind rel version platform channels sha; do
  # Git Bash / Windows 上解包可能带 CR，逐字段清掉
  kind=$(printf '%s' "$kind" | tr -d '\r')
  rel=$(printf '%s' "$rel" | tr -d '\r')
  version=$(printf '%s' "$version" | tr -d '\r')
  platform=$(printf '%s' "$platform" | tr -d '\r')
  channels=$(printf '%s' "$channels" | tr -d '\r')
  sha=$(printf '%s' "$sha" | tr -d '\r')
  case "$kind" in
    ''|'#'*) continue ;;
  esac
  file="$ARTIFACT_DIR/$rel"
  if [ ! -f "$file" ]; then
    fail_item "$kind" "物料包缺文件 artifacts/$rel"; continue
  fi
  # 清单里的 sha256 与磁盘比对：防止包在传输/解包时损坏
  actual=$(sha256_hex "$file")
  if [ -n "$sha" ] && [ -n "$actual" ] && [ "$sha" != "$actual" ]; then
    fail_item "$kind" "artifacts/$rel sha256 与清单不符（包可能损坏）"; continue
  fi
  case "$kind" in
    desktop)       wants desktop       && upload_desktop "$version" "$platform" "$channels" "$file" ;;
    docs)          wants docs          && upload_docs "$file" ;;
    remote-page)   wants remote        && upload_remote "$file" ;;
    plugin-market) wants plugin-market && upload_plugin_market "$file" ;;
    *)             fail_item "$kind" "清单里有未知类型" ;;
  esac
done < "$MANIFEST"

if [ "$VERIFY" = 1 ] && [ "$DRY_RUN" = 0 ]; then
  verify_all
fi

printf '\n汇总：成功 %s，跳过 %s，失败 %s\n' "$OK_COUNT" "$SKIP_COUNT" "$FAIL_COUNT"
if [ "$FAIL_COUNT" -gt 0 ]; then
  printf '失败项：%s\n' "$FAILED_ITEMS"
  printf '\n可以只重跑失败的线（已成功的会自动跳过）：--only <desktop|docs|remote|plugin-market>\n'
  exit 1
fi
if [ "$DRY_RUN" = 1 ]; then
  printf '预检通过，没有写入任何东西。去掉 --dry-run 即正式上传。\n'
fi
exit 0
