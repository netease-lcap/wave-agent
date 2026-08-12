---
name: "Artifact 工具"
description: "发布本地 HTML/Markdown 为默认私有的可分享网页，WebFetch 读取 artifact URL"
order: 35
---

# 功能规格说明：Artifact 工具

**创建日期**：2026-08-12

> 对齐 Claude Code 的内建 Artifact 工具：把本地 `.html`/`.md` 文件发布为默认私有的可分享网页（claude.ai 风格），并通过 WebFetch 拦截读取已发布的 artifact 页面。
> 服务端契约已落地（codechat 自托管同源实现）：`POST /api/frame/deploy/direct`（发布）、`GET /api/frame/{slug}?via=model_read`（元数据）、`GET /api/frame/{slug}/content?v={version}`（正文，同源 + Bearer 鉴权，无独立域名/assetToken 流程）。
> 已拍板的简化决定：零新增配置（API 端点复用 Server URL origin：`options.serverUrl > WAVE_SERVER_URL > 默认值`，不新增 baseUrl 配置项）；客户端只实现 inline 直传一条路径（无 signed URL / DIRECT_UPLOAD）；无 AUTO_OPEN / FRAME_TIMING / OWNERSHIP_FRAME 遥测；**启用开关 `enableArtifact`（未设置时跟随代码默认值常量，当前默认禁用**——后端未上线先不发功能，内测/灰度通过 `enableArtifact: true` 显式打开；后端上线后翻转默认值常量为启用）。`disableArtifact` opt-out 开关等 GA 后再对齐 CC，本期不实现。
> 范围：wave-agent 客户端侧工具 + WebFetch 拦截。分享管理（`POST /api/frame/{slug}/share`、pinned_version）由服务端/网页外壳承担，客户端仅发布私有页面并探测分享状态。

## 用户场景与测试 *（必填）*

### 用户故事：发布 HTML/Markdown 为 artifact 网页（优先级：P1）

作为用户，我希望把本地已写好的 `.html`/`.md` 文件发布为一个默认私有的可分享网页并拿到 URL，以便把工作成果分享给团队成员。

**为什么是这个优先级**：这是 Artifact 功能的核心价值。

**独立测试**：可以调用 `Artifact` 工具（参数 `file_path` + `favicon`）并 mock 服务端 201 响应，验证工具返回 `{ url, path, title, version }`。

**验收场景**：

1. **假设** model 调用 `Artifact` 工具且参数为 `file_path: "a.html"`、`favicon: "📄"`，文件已存在于磁盘，**当** 发布请求返回 201 时，**则** 工具返回 `{ url, path, title, version }`，其中 `url` 形如 `{host}/code/artifact/{slug}`。
2. **假设** `file_path` 指向磁盘上不存在的文件，**当** 工具执行时，**则** 返回 `success: false` 与明确的错误消息（提示先 Write/Edit 落盘，不接受内联 content）。
3. **假设** `file_path` 扩展名不是 `.html` 或 `.md`，**当** 工具执行时，**则** 返回 `success: false` 与扩展名受限的错误。
4. **假设** `file_path` 是 `.md` 文件，**当** 工具执行时，**则** 客户端先将其渲染为完整 HTML 再上传（服务端只接收完整 HTML）。
5. **假设** `favicon` 包含非 emoji 字符（如文字、URL、HTML markup），**当** 工具执行时，**则** 返回 `success: false` 与错误提示。
6. **假设** 发布内容超过 16MB（服务端返回 413），**当** 工具执行时，**则** 返回 `success: false` 与大小超限的错误。
7. **假设** 客户端未登录（无有效 token），**当** 工具执行时，**则** 返回鉴权错误并提示先登录。

### 用户故事：WebFetch 读取 artifact 页面（优先级：P1）

作为用户，我希望 WebFetch 能识别 artifact URL 并走专用通道读取发布内容，以便 AI 可以基于 artifact 内容回答、排查或继续迭代。

**为什么是这个优先级**：发布与读取构成完整闭环，也是冲突防护（stale_version_guard）的基础。

**验收场景**：

1. **假设** WebFetch 的 `url` 形如 `{host}/code/artifact/{slug}`（匹配 artifact URL 格式），**当** 工具执行时，**则** 走专用读取通道：先 `GET /api/frame/{slug}?via=model_read` 取元数据，再拉取正文，返回页面内容。
2. **假设** artifact 读取成功，**当** WebFetch 返回结果时，**则** 输出 schema 附带可选 `artifactRead: { slug, ver }` 元数据（`ver` 为当前版本号）。
3. **假设** artifact HTML 内容较大（超过 ~2KB），**当** WebFetch 执行时，**则** 完整内容落盘到临时文件，返回文件路径 + head 截断预览，避免工具结果过大。
4. **假设** artifact 不存在或已删除（服务端 404），**当** WebFetch 执行时，**则** 返回 `success: false` 与对应的错误消息。
5. **假设** 读取接口返回的 `contentUrl` 需要鉴权，**当** WebFetch 拉取正文时，**则** 携带当前登录 token（Bearer）请求。

### 用户故事：重新部署与并发冲突防护（优先级：P2）

作为系统，我希望同一 artifact 的并发发布受版本保护，以便多会话协作时不发生静默覆盖。

**为什么是这个优先级**：多会话同时发布同一 slug 是真实协作场景，409 + stale_version_guard 是 CC 对齐的关键行为。

**验收场景**：

1. **假设** model 调用 `Artifact` 工具且带 `url` 参数（已有 artifact 的 URL），**当** 发布时，**则** 使用该 slug 重新部署，返回包含新 `version` 的结果。
2. **假设** 重部署时服务端返回 409（`{ conflict: true, live: "<最新版本号>" }`，他人已发布新版），**当** 工具执行时，**则** 返回 `success: false`，错误信息包含 `live` 版本号并提示先 WebFetch 最新内容、和解后重新发布。
3. **假设** 冲突时 model 带 `force: true` 重发，**当** 工具执行时，**则** 跳过冲突检查直接覆盖发布。
4. **假设** 同会话内 model 未先 WebFetch 最新版本就重发同一 artifact（stale_version_guard：本地记录的版本落后于服务端），**当** 工具执行时，**则** 返回 `success: false` 阻止发布，除非带 `force: true`。
5. **假设** 服务端 409 响应携带 `live` 版本号，**当** 冲突错误返回后，**则** 客户端用 `live` 作为下一次发布的 `baseVersion` 重试（供服务端做并发检测）。

### 用户故事：默认私有与分享状态探测（优先级：P2）

作为用户，我希望发布出的页面默认只有我能看到，并且读取时能感知页面的分享状态，以便安全地决定是否传播 URL。

**为什么是这个优先级**：默认私有是 CC 的默认行为，分享状态探测决定发布确认文案与重发布行为。

**验收场景**：

1. **假设** model 首次发布新 artifact 且未指定分享方式，**当** 发布完成时，**则** 页面默认为私有（服务端 `share_mode=owner`）。
2. **假设** WebFetch 读取 artifact 元数据，**当** 返回结果时，**则** 元数据包含 `perm: { mode, role }`（mode: owner/users/org；role: owner/reader），用于探测当前分享状态。
3. **假设** 已分享为 shared-live（`shared` 字段为空，读者实时看到更新）的 artifact 被重发布，**当** 工具执行时，**则** 发布确认中提示影响读者可见版本，需用户确认（对齐 CC 行为）。

### 用户故事：发布确认与同会话自动允许（优先级：P2）

作为用户，我希望发布动作默认经过确认、但同会话内的重复发布不再打扰，以便既不误发又保持流畅。

**为什么是这个优先级**：发布是外发动作需确认；同会话重发是常见迭代循环，频繁确认会打断工作流。

**验收场景**：

1. **假设** model 首次发布某文件，**当** 调用 `Artifact` 工具时，**则** 触发权限确认（文案形如 "publish \"&lt;file&gt;\" to a private page"），用户拒绝则取消发布。
2. **假设** 同会话内 model 再次发布本会话已发布过的文件（`url` 省略，靠会话内 file_path → artifact URL 映射），**当** 调用 `Artifact` 工具时，**则** 自动允许，不再弹确认。
3. **假设** 会话内映射不存在（本会话未发布过该文件）且用户未配置自动允许，**当** 调用 `Artifact` 工具时，**则** 仍弹确认。

### 用户故事：启用开关与默认禁用（优先级：P2）

作为管理员或内测用户，我希望 Artifact 功能默认不可用、但可显式开启，以便在后端上线前不暴露无效工具，同时支持内测/灰度先行体验。

**为什么是这个优先级**：当前 frame 后端尚未上线，功能需默认禁用（不注册工具、不拦截读取）；内测/灰度通过 `enableArtifact: true` 显式打开（无需改代码）；后端上线后把代码默认值常量翻转为启用（未设置 = 启用，对齐 CC `enableArtifact` 的"未设置跟随功能可用性"语义）。

**验收场景**：

1. **假设** 未配置 `enableArtifact`（默认状态，后端上线前），**当** 会话初始化时，**则** `Artifact` 工具不注册、不可调用。
2. **假设** settings.json 配置 `enableArtifact: true`，**当** 会话初始化时，**则** `Artifact` 工具注册、可调用（内测/灰度入口）。
3. **假设** 后端已上线、代码默认值常量已翻转为启用，**当** 会话初始化时，**则** 未配置 `enableArtifact` 也默认启用。
4. **假设** Artifact 被禁用（默认或显式），**当** WebFetch 收到 artifact URL 时，**则** 不进入专用读取通道（按普通 URL 处理或报错），不执行 `via=model_read` 调用。

### 非功能需求

- **零新增配置**：API 端点相对 Server URL origin 硬编码（`options.serverUrl > WAVE_SERVER_URL > 默认值`，经 authService.getServerUrl() 获取），不新增 baseUrl/artifactUrl 配置项。
- **鉴权**：发布（deploy/direct）与读取（model_read、contentUrl）请求均携带当前登录 token（Bearer）；未登录返回明确错误。
- **大小上限**：发布内容上限 16MB（413 透传为友好错误）。
- **文件大小策略**：读取时 >~2KB 的 HTML 落盘到临时文件（返回路径 + head 预览），避免工具结果膨胀。
- **只读性**：WebFetch 侧读取行为保持只读，不修改 artifact 内容。
- **会话映射**：会话内维护 file_path → artifact URL 映射，用于同会话重发免 `url` 参数与 stale_version_guard。
- **测试**：SDK 层 mock 服务端（201/409/404/413）覆盖发布、重部署、冲突、读取、禁用开关场景。

### 边界情况

- **md → HTML 渲染失败怎么办？** 渲染失败时返回 `success: false` 与渲染错误信息，不发起上传。
- **未登录时发布/读取怎么办？** 返回鉴权错误并提示先登录（`/login`）。
- **artifact URL 的主机与 Server URL 不一致？** 自托管场景下发布返回的 URL 即当前 Server URL origin 下的 `/code/artifact/{slug}`；WebFetch 按 URL 路径格式 `{host}/code/artifact/{slug}` 识别，读取请求发往同一 origin。
- **并发发布同一 slug（跨会话）怎么办？** 服务端 409 + `live` 版本号；客户端透传错误并提示先 WebFetch 最新内容，或带 `force: true` 覆盖。
- **大文件读取的临时文件何时清理？** 沿用现有工具临时文件生命周期管理，不引入独立清理机制。
- **与 disallowedTools 的关系？** `enableArtifact` 是独立功能开关（未设置跟随默认值常量）；disallowedTools 对 Artifact 工具的显式禁用仍生效（两者取并集）。
- **Artifact 工具是受限工具吗？** 是——发布是外发网络动作，需加入 RESTRICTED_TOOLS 以触发默认模式的确认流程。
