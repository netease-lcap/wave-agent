#!/usr/bin/env bash
# 把已打好的物料 bundle 构建成多架构镜像并推到内网 harbor。
#
# 为什么是脚本而不是让 AI 每次拼命令：这一段是**完全固定且易错**的（binfmt 注册顺序、
# buildx driver、--provenance / --oci-mediatypes 这两个一漏就出事的参数、builder 清理），
# 跟 upload-all.sh 同理。真正的智能判断（要不要出镜像、推哪个 registry / tag）留在 SKILL.md。
#
# 用法：
#   ./build-image.sh /tmp/wave-artifacts-1.6.1/bundle/codechat-artifacts-20261106-desktop1.6.1
#   ./build-image.sh <bundle> --tag 1.6.1-202611061530-multi --registry harbor.cloud.netease.com/qzlowcode
#   ./build-image.sh <bundle> --platforms linux/amd64,linux/arm64   # 默认就是双架构
#   ./build-image.sh <bundle> --no-push                             # 只本地出 oci tar，验证构建链路
#
# 退出码：0 构建并推送成功；1 参数/环境问题；2 构建或推送失败。
set -euo pipefail

REGISTRY="harbor.cloud.netease.com/qzlowcode"
IMAGE_NAME="codechat-artifacts"
TAG=""
PLATFORMS="linux/amd64,linux/arm64"
BINFMT_IMAGE="harbor.cloud.netease.com/qzlowcode/binfmt:multi-20250523"
BUNDLE=""
PUSH=1

die() { printf '✗ %s\n' "$1" >&2; exit "${2:-1}"; }
say() { printf '%s\n' "$*"; }

usage() {
  cat <<'EOF'
用法: ./build-image.sh <bundle 目录> [选项]

必填:
  <bundle>               SKILL.md 步骤 5 的 $WORK/bundle/$BUNDLE（含 MANIFEST.tsv / artifacts/ / upload-all.sh）

选项:
  --tag <tag>            完整镜像 tag，默认 `<物料版本>-<YYYYMMDDHHmm>-multi`（如 1.6.1-202611061530-multi）
  --registry <h/p>       默认 harbor.cloud.netease.com/qzlowcode
  --image <name>         默认 codechat-artifacts
  --platforms <list>     默认 linux/amd64,linux/arm64（私有化客户有 ARM 节点，别只出单架构）
  --binfmt <image>       QEMU 注册镜像，默认 harbor 上的同款（与 qingzhou CI 一致）
  --no-push              只构建成本地 oci tar（写到 bundle 同级），验证链路用，不碰 registry

凭证:
  push 时用 ~/.docker/config.json，先 docker login <registry host>
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --tag)       TAG="${2:-}"; shift 2 ;;
    --registry)  REGISTRY="${2:-}"; shift 2 ;;
    --image)     IMAGE_NAME="${2:-}"; shift 2 ;;
    --platforms) PLATFORMS="${2:-}"; shift 2 ;;
    --binfmt)    BINFMT_IMAGE="${2:-}"; shift 2 ;;
    --no-push)   PUSH=0; shift ;;
    -h|--help)   usage; exit 0 ;;
    -*)          die "未知参数: $1（-h 看用法）" ;;
    *)           [ -z "$BUNDLE" ] || die "只接受一个 bundle 目录（多余参数: $1）"; BUNDLE="$1"; shift ;;
  esac
done

# ─── 前置校验：bundle 与 docker 能力 ────────────────────────────────────────
[ -n "$BUNDLE" ] || die "缺 bundle 目录（SKILL.md 步骤 5 的 \$WORK/bundle/\$BUNDLE）"
[ -d "$BUNDLE" ] || die "bundle 目录不存在: $BUNDLE"
for f in MANIFEST.tsv sha256sums.txt upload-all.sh release-notes.md; do
  [ -f "$BUNDLE/$f" ] || die "bundle 里缺 $f —— 传错目录了？（要的是 SKILL.md 步骤 5 组装出的 bundle 目录；release-notes.md 允许为空文件但必须存在）"
done
[ -d "$BUNDLE/artifacts" ] || die "bundle 里缺 artifacts/ 目录"

SKILL_DIR=$(cd "$(dirname "$0")" && pwd)
[ -f "$SKILL_DIR/Dockerfile" ] && [ -f "$SKILL_DIR/entrypoint.sh" ] || die "技能目录缺 Dockerfile / entrypoint.sh"

# 版本号：默认 `<物料版本>-<YYYYMMDDHHmm>-multi`，与 codechat-enterprise / codechat-ops 的
# tag 形态一致（`v1.6.5-202611050847-multi`）。
#
# ⚠️ 时间戳不是装饰，也不能省：物料版本（桌面端 tag）**不等于**物料内容版本 —— 同一份 1.6.1 里
#    docs 包的版本号来自仓库 package.json（与桌面端不同步）、远控页与插件市场快照每次重打都是新的。
#    用纯版本号做 tag 就会出现「tag 没变、内容变了」：harbor 上被覆盖（失去可追溯），客户节点上
#    `imagePullPolicy: IfNotPresent` 不会重拉（静默用旧物料）。所以**每次构建一个新 tag，永不覆盖**。
if [ -z "$TAG" ]; then
  VER=$(printf '%s' "$(basename "$BUNDLE")" | sed -n 's/.*desktop\([0-9][0-9.]*\)$/\1/p')
  [ -n "$VER" ] || die "从目录名推断不出版本号，用 --tag 指定"
  TAG="${VER}-$(date +%Y%m%d%H%M)-multi"
fi
IMAGE="${REGISTRY}/${IMAGE_NAME}:${TAG}"

command -v docker >/dev/null 2>&1 || die "没有 docker"
docker buildx version >/dev/null 2>&1 || die "没有 docker buildx（docker 版本太老或没装插件）"
docker info >/dev/null 2>&1 || die "连不上 docker daemon"

# 凭证：buildx 的 --output type=registry 直接用 docker 的凭证，没登录会在最后一步失败，
# 与其白跑一遍 350MB 的构建，不如现在就说清楚。
if [ "$PUSH" = 1 ] && ! grep -q "${REGISTRY%%/*}" "${HOME}/.docker/config.json" 2>/dev/null; then
  die "没登录 ${REGISTRY%%/*}（先 docker login ${REGISTRY%%/*}），凭证不在 ~/.docker/config.json" 1
fi

say "bundle    $BUNDLE"
say "镜像      $IMAGE"
say "平台      $PLATFORMS"
say "binfmt    $BINFMT_IMAGE"
say "推送      $([ "$PUSH" = 1 ] && echo registry || echo '否（--no-push，只出本地 oci tar）')"
say ""

# ─── 1. 注册 QEMU：每次都要跑 ───────────────────────────────────────────────
# binfmt_misc 是内核注册表，WSL 重启 / CI 换机器就没了，所以不判断「已装过」直接装是幂等的。
# 用内网 harbor 的 binfmt 镜像（与 qingzhou 的 GitLab CI 同一份），不依赖公网 docker hub。
say "▸ 注册 binfmt（$PLATFORMS 里的非本机架构靠它模拟执行）"
docker run --rm --privileged "$BINFMT_IMAGE" --install all >/dev/null

# ─── 2. 临时 docker-container builder ──────────────────────────────────────
# 本机默认的 docker driver 不支持多平台；builder 用完就删，避免堆一堆 buildkit 容器。
BUILDER="builder-${IMAGE_NAME}-$(date +%s)"
cleanup() {
  docker buildx rm "$BUILDER" >/dev/null 2>&1 || true
  [ -n "${CTX:-}" ] && rm -rf "$CTX"
}
trap cleanup EXIT INT TERM
say "▸ 创建 builder $BUILDER（docker-container driver）"
docker buildx create --name "$BUILDER" --driver docker-container --bootstrap --use >/dev/null

# ─── 3. 组构建上下文 ────────────────────────────────────────────────────────
# 不往 bundle 里加文件：它是要打 tar 包交出去的，包结构是 CodeChat 服务端契约。
CTX=$(mktemp -d)
cp -a "$BUNDLE"/. "$CTX"/
cp "$SKILL_DIR/Dockerfile" "$SKILL_DIR/entrypoint.sh" "$CTX"/
say "▸ 构建上下文 $(du -sh "$CTX" | cut -f1)（$CTX）"
say ""

# ─── 4. 构建（默认直接推 registry）───────────────────────────────────────────
# --provenance=false    不加就会在 manifest list 里多一条 attestation，老客户端 pull 会迷路
# --oci-mediatypes=false 用 Docker v2 schema2 的 manifest list（OCI index 兼容性更差）
# --output type=registry 多架构镜像不能 --load（本地存储只装得下一个平台）
# 与 qingzhou 公共 CI 脚本 build_image() 的参数逐字一致，行为可对照。
# --no-push 时改出 oci tar：同样一次构建出 manifest list，只是不落到 registry。
if [ "$PUSH" = 1 ]; then
  OUTPUT="type=registry,oci-mediatypes=false"
  say "▸ 构建并推送（300MB+ × ${PLATFORMS} 个平台，几分钟量级）"
else
  OCI_OUT="$BUNDLE.oci.tar"
  OUTPUT="type=oci,oci-mediatypes=false,dest=$OCI_OUT"
  say "▸ 只构建出本地 oci tar（不推送）：$OCI_OUT"
fi
if ! docker buildx build \
      --platform "$PLATFORMS" \
      -t "$IMAGE" \
      -f "$CTX/Dockerfile" \
      --provenance=false \
      --output "$OUTPUT" \
      --builder "$BUILDER" \
      "$CTX"; then
  die "构建或推送失败（构建上下文留在 $CTX 供排查）" 2
fi

# ─── 5. 收尾：确认产物里真的是 manifest list ────────────────────────────────
say ""
if [ "$PUSH" = 1 ]; then
  say "▸ 核对远端 manifest list"
  docker buildx imagetools inspect "$IMAGE" || say "⚠️ inspect 失败，但推送已成功，去 harbor 页面确认架构列表"
  say ""
  say "镜像  $IMAGE"
  say "平台  $PLATFORMS"
  say "部署  交给 qingzhou-lowcode 的 chart（一次性 Job）；容器契约见 SKILL.md 7b"
else
  # oci tar 的 index.json 只指向一层 manifest list，真正的平台列表在 blobs/ 里，
  # 把它解出来打给人看（不然「双架构成功」只剩一句口头保证）。
  say "▸ 核对本地 oci tar 里的 manifest list"
  LIST_DIGEST=$(tar -xOf "$OCI_OUT" index.json 2>/dev/null \
    | sed -n 's/.*"digest":"sha256:\([0-9a-f]\{64\}\)".*/\1/p' | head -1)
  if [ -n "$LIST_DIGEST" ]; then
    tar -xOf "$OCI_OUT" "blobs/sha256/$LIST_DIGEST" 2>/dev/null \
      | sed -n 's/.*"architecture": *"\([^"]*\)".*/  arch \1/p' || true
    say ""
  else
    say "⚠️ 没从 index.json 解析出 manifest list digest，自己看：tar -xOf $OCI_OUT index.json"
  fi
  say ""
  say "产物  $OCI_OUT（$(du -h "$OCI_OUT" | cut -f1)）"
  say "平台  $PLATFORMS"
fi
