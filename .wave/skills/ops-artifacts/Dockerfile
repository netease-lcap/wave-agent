# 私有化物料镜像：把「四类物料 + 上传器」运进客户集群，Job 跑起来自己完成上传。
#
# 构建上下文不是仓库根，而是 build-image.sh 临时组出来的目录：bundle 的全部内容
# （MANIFEST.tsv / sha256sums.txt / README.md / upload-all.sh / release-notes.md / artifacts/）
# + 本文件 + entrypoint.sh。
#
# ⚠️ 物料本身架构无关（安装包、zip、tar.gz），两个平台的 COPY 层 digest 相同、
#    registry 里 blob 复用，多架构真正翻倍的只有下面这层 alpine + curl。
FROM alpine:3.20

# curl：entrypoint 的 /health 探测 + upload-all.sh 的全部请求都靠它。
# ca-certificates：目标可能是 https（集群内 http 则用不上，留着无害）。
RUN apk add --no-cache curl ca-certificates

WORKDIR /artifacts

# 逐类拷，别用 `COPY . .`：万一 bundle 里混进垃圾文件，逐类拷能在这里爆出来。
# release-notes.md 允许是空文件（= 本版本没有记录），但必须存在 —— 出包流程会写。
COPY MANIFEST.tsv sha256sums.txt README.md upload-all.sh entrypoint.sh release-notes.md ./
COPY artifacts/ ./artifacts/

RUN chmod 0755 upload-all.sh entrypoint.sh

# 令牌绝不进镜像层：只从运行时 env（K8s Secret）读。
ENTRYPOINT ["/artifacts/entrypoint.sh"]
