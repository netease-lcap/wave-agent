---
title: 接入本地模型
description: 把本地部署的模型接进 Wave：网关地址、模型名与能力声明
---

# 接入本地模型

默认模型请求走 CodeWave 服务端网关。把网关地址、密钥与模型名换成自建的 OpenAI 兼容端点（vLLM、Ollama、私有网关等，需提供 `/v1/chat/completions`），就接入了本地模型。配置写在用户级 `~/.wave/settings.json`：

```json
{
  "env": {
    "WAVE_BASE_URL": "https://gw.customer.com/v1",
    "WAVE_API_KEY": "sk-xxxxxxxxxxxxxxxx",
    "WAVE_MODEL": "qwen3.8-max",
    "WAVE_FAST_MODEL": "qwen3.5-flash",
    "WAVE_VISION_MODEL": "qwen3.8-max",
    "WAVE_MAX_INPUT_TOKENS": "200000"
  },
  "models": {
    "qwen3.8-max": {
      "capabilities": { "vision": true, "promptCaching": true }
    },
    "qwen3.5-flash": { "capabilities": { "vision": false } }
  }
}
```

> ⚠️ **直接接入本地模型会丢失大量服务端能力**：artifact 发布与评论、遥测与「研发效能」看板、远程控制（手机 / Web 端接管）、企业管控台、托管配置下发等都依赖 CodeWave 服务端与登录态，换成自建端点后这些能力没有数据或直接不可用；并且登录状态下请求固定走服务端网关（`{服务端}/api/v1`），自建端点不生效，用本地模型需先退出登录。确实需要接入本地模型时，**建议私有化采购部署服务端**——模型可以自建，服务端能力保留。

字段说明：

- `WAVE_BASE_URL` 填到 `/v1` 这一层；本地服务不校验密钥时也要给 `WAVE_API_KEY` 一个非空值，否则客户端直接报 `Missing credentials`。
- `WAVE_MODEL` / `WAVE_FAST_MODEL` / `WAVE_VISION_MODEL`：主模型、轻量任务（子代理摘要、网页取内容等）用的快模型、内置 vision 子代理用的读图模型（后者仅在主模型声明 `vision: false` 时才注册）。
- `WAVE_MAX_INPUT_TOKENS` 按模型上下文窗口设；需要逐模型不同就写 `models[<模型名>].maxInputTokens`，压缩阈值与用量显示都按它算。
- `models[<模型名>].capabilities`：`vision`（能否读图，默认 `true`）、`promptCaching`（是否注入 Anthropic 风格的 `cache_control` 缓存标记，默认 `false`，端点不支持就别开）；生成参数（`temperature`、`max_tokens` 等）写在同级的 `options` 里。

改完下一轮对话即生效，无需重启。
