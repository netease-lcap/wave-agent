#!/bin/sh
# 物料镜像的容器入口：等目标 CodeChat 就绪，再把四类物料推上去。
#
# 只读两个环境变量，其余参数原样透传给 upload-all.sh：
#   CODECHAT_BASE   必填。目标 CodeChat 企业端地址（ingress 域名或集群内 Service 域名，
#                   用哪个由部署侧决定，每个交付环境都不一样）。末尾斜杠会被去掉。
#   PUBLISH_TOKEN   必填。部署时经 envFrom: secretRef 注入，SRE 零输入。
#
# 退出码（部署判定的成败就看它）：0 全部成功（含已存在跳过）；1 有失败项；2 环境/配置错。
set -eu

BASE="${CODECHAT_BASE:-}"
TOKEN="${PUBLISH_TOKEN:-}"

if [ -z "$BASE" ]; then
  echo "✗ 缺 CODECHAT_BASE（填该客户实际的企业端地址，不是示例值）" >&2
  exit 2
fi
if [ -z "$TOKEN" ]; then
  echo "✗ 缺 PUBLISH_TOKEN（K8s 里 envFrom: secretRef: codechat-secret）" >&2
  exit 2
fi
BASE="${BASE%/}"

# 等目标就绪。部署时容器可能比企业端 Pod 先起来（部署编排就是这种时序），
# 直接上传会连不上；轮询 /health 直到通，次数用 WAIT_RETRIES 可覆盖（默认 60 × 5s = 5 分钟）。
i=0
until curl -fsS -o /dev/null --max-time 5 "$BASE/health" 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -ge "${WAIT_RETRIES:-60}" ]; then
    echo "✗ 等 $BASE/health 超时（${WAIT_RETRIES:-60} 次 × 5s）" >&2
    exit 2
  fi
  echo "  …等待 $BASE/health（第 $i 次）"
  sleep 5
done

echo "目标就绪 $BASE"
# upload-all.sh 自己从 PUBLISH_TOKEN 读令牌（不回显、不落盘），身份与本地跑完全一致。
exec /artifacts/upload-all.sh --base "$BASE" "$@"
