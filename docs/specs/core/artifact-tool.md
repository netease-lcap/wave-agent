---
name: "Artifact 工具"
description: "发布本地 HTML/Markdown 为默认私有的可分享网页（并向模型告知分享状态），枚举/读取 artifact 与摘要，管理 artifact 资源库（上传/列举/读取/删除/复制）"
order: 35
---

# 功能规格说明：Artifact 工具

**创建日期**：2026-08-12

> 对齐 Claude Code 的内建 Artifact 工具：把本地 `.html`/`.md` 文件发布为默认私有的可分享网页（claude.ai 风格），并通过 WebFetch 拦截读取已发布的 artifact 页面。
> 服务端契约已落地（codechat 自托管同源实现）：`POST /api/frame/deploy/direct`（发布）、`GET /api/frame/{slug}?via=model_read`（元数据）、`GET /api/frame/{slug}/content?v={version}`（正文，同源 + Bearer 鉴权，无独立域名/assetToken 流程）。
> 已拍板的简化决定：零新增配置（API 端点复用 Server URL origin：`options.serverUrl > WAVE_SERVER_URL > 默认值`，不新增 baseUrl 配置项）；客户端只实现 inline 直传一条路径（无 signed URL / DIRECT_UPLOAD）；无 AUTO_OPEN / FRAME_TIMING / OWNERSHIP_FRAME 遥测；**启用开关 `enableArtifact`（未设置时跟随代码默认值常量：2026-09-30 起 = 已登录则启用、未登录则禁用——发布/读取/资源每个请求都要带 SSO token，没有账号时注册出来只会次次失败；显式 `true` 仍强制启用（首次调用提示先 `/login`），显式 `false` 与远端下发 `false` 一律关闭）**。`disableArtifact` opt-out 开关等 GA 后再对齐 CC，本期不实现。
> 触发方式定案（双通道并存，2026-08-13）：**模型经自然语言自动调用 `Artifact` 工具**（description 覆盖"发布/分享/做成网页/给链接"语义，中文提示词同样触发）+ **内置技能 `/artifact` 人工斜杠触发**（builtin SKILL.md，`disable-model-invocation: true` 仅人工、模型不可经 Skill 工具调用该技能）。用户在输入框输入 `/` 即可在技能列表看到该命令并一键触发，无需知道怎么写提示词。**技能本身不含任何发布逻辑**——其内容仅指示模型调用 `Artifact` 工具（参数经 `$ARGUMENTS`/`$1` 透传），发布/校验/权限确认/会话映射全部由工具完成，技能不绕过也不复制这些逻辑。
> 范围：wave-agent 客户端侧工具 + WebFetch 拦截。分享管理（`POST /api/frame/{slug}/share`、pinned_version）由服务端/网页外壳承担，客户端仅发布私有页面并探测分享状态；探测到的分享状态以文案形式告知模型（见下「分享状态文案」）。
> 对齐 CC 的 Artifact 工具形态（2026-09-11 增补）：工具入口统一为带 `action` 参数的单一工具——`action: "publish"`（省略时的默认值，即现有发布行为）与 `action: "read"`（新增读取动作）。**`read` 的返回形态对齐 CC**：读取当前用户**拥有**的 artifact 返回原文 HTML（含内联 CSS/JS）；读取**他人分享**的 artifact 返回隔离摘要（可选 `prompt` 指明关注点），不把他人页面全文放进上下文。
> 动作面分两批对齐：首批（2026-09-11）只补 `read`（当时 codechat 无枚举/资源库接口）；第二批（2026-09-29，见下）补 `list` 与 `assets` 五动作。仍未对齐：`watch`/`unwatch`/`status`（服务端实现已回滚、需求未重开）、Artifact 评论（独立能力，服务端 + 灰度 flag 双门控）、`list_types`/`describe_type`（CC 默认关闭的 Artifact Types 子系统）、`read_db`/`write_db`/`call_endpoint`/`run_script`（页面数据岛与契约子系统）。
> 读取实现单一化（2026-09-11）：artifact 正文的取用（元数据探测 + Bearer 鉴权 + 正文拉取 + 大内容落盘）收敛为**唯一实现**，`Artifact` 工具的 `read` 动作与 WebFetch 的 artifact URL 拦截共用，不再各写一套。
> 发布标题与短名对齐 CC（2026-09-18 修正，取代 2026-09-11 的「`label` 当标题兜底」口径）：**标题**与**短名**是两件独立的事，各由一个参数承载。
>
> - **`title`（可选，仅 `.html` 生效，≤1000 字符）**：artifact 的标题（浏览器标签 / 画廊显示名）；超过 1000 字符客户端先报错不发请求（服务端 `TITLE_MAX` 同值校验）。服务端解析阶梯 = 页面**前 8KB 内**的 `<title>` > `title` 参数 > 默认名——标签**永不**被参数覆盖（客户端不自行判优先级，也不做冲突提示）；客户端按 CC 的末级兜底补**文件名 basename**，因此 `.html` 发布**总会发一个非空 `title`**，标题链才闭合。
> - **`label`（可选，≤60 字符）**：**本次发布的短名**（如 "Draft to legal"），只用于版本列表/版本选择器，**不参与标题解析**——工具不再拿它当标题兜底。
> - **Markdown 保持文件名身份**：客户端渲染时把**文件名**注入 `<title>`（不是 `label`），`title` 参数对 `.md` 不生效，`.md` 页面因此以文件名作标题。
>   枚举与资源库补齐（2026-09-29，issue #2199 的阻塞条件「codechat 未上生产」已解除）：本轮按 CC 契约补 **`list`** 与 **`assets` 五动作**（`upload_asset` / `list_assets` / `read_asset` / `delete_asset` / `copy_from`）。端点已线上逐条核对：`GET /api/frame/frames?limit=200`（枚举）、`POST /api/frame/blob/{slug}/agent-upload`（裸字节 + `Content-Type`）、`/agent-list`（`{after?, limit}`）、`/{assetId}/agent-delete`（幂等）、`/agent-copy`（`{from, ids}`）、`GET /_f/{ver}/_blob/{assetId}?__frame_t={token}`（资源读取）。
>   对齐基准 `@anthropic-ai/claude-code@2.1.284`。**服务端只管形状、客户端担语义**：codechat 只校验 MIME 的正则形状（裸 MIME、无参数——带参数或缺失一律 415 `unsupported_type`）+ 长度，**不做扩展名白名单**（实测 `application/x-msdownload` 也照收）；扩展名→MIME 白名单、本地文件语义（常规文件 / 拒绝网络路径 / 解析符号链接后的可读区与常规文件校验 / 上传前后文件身份复核）、配额提示全部在客户端。
>   `asset_id` = **32 位小写 hex**（响应里的 `opaque_id`），**不是** `_blob/{id}` 路径——服务端 `agent-delete` 路由只接受裸 id（带 `_blob/` 前缀 404，实测）。`/agent-list` 页大小服务端固定 50（收 `limit` 但忽略），游标是不透明串（`after` 传非法值 → 400 `invalid_request`）。`read_asset` 走 **`assetToken`**（`GET /api/frame/{slug}?via=model_read` 已返回，TTL 1 小时、基于 `JWT_SECRET` 派生密钥的 HMAC，**不是会话 JWT、不能当 Bearer 用**），外壳把页面里的 `_blob/{id}` 改写成带 token 的绝对路径。
>   与 CC 的一处刻意差异：CC 解析 `/agent-list` 响应时把 `content_type` / `created_at` 截到 **40 字符**（超出则整行 safeParse 失败、静默丢行）；codechat 上传侧放宽到 100（DB 列宽），于是 `.docx` 这类长 MIME 在 CC 里会掉行。**wave 不设 40 字符上限**（以服务端口径为准），避免静默丢行。
>   分享状态文案对齐（2026-09-29，issue #2278 差距清单中唯一「数据面已具备、只差提示词」的一条）：`read` / WebFetch 与 `publish` 的工具结果中，把探测到的 **分享范围**（`perm.mode` = `owner`/`users`/`org`）与 **当前会话对该 artifact 的角色**（`role` = `owner`/`reader`）**以文案形式告知模型**，并照 CC 2.1.278 的口径以固定句收尾：**「你不能改分享，改分享在网页的 Share 菜单里」**；未分享（`owner`）时同时说明**别人打不开**，读者视角（`reader`）说明**本会话不能发布到它**。对齐基准 `@anthropic-ai/claude-code@2.1.284`（#2278 的调研基于 2.1.278）。**只读口径不变**：不新增任何写分享的 action/参数（CC 也没有，服务端 `POST /api/frame/{slug}/share` 仅拥有者可用，模型侧无入口看起来是有意设计）。**不做** CC 的「受众变宽提醒」（`{owner:0, users:1, agent_scoped:1, org:2, public:3}` 等级表）：wave 没有任何改分享的入口 ⇒ 受众不会因本工具的动作变宽，该提醒无触发场景；CC 的 `public`（Anyone with the link）与 `agent_scoped`（属于 agent 而非人）两种 mode 在 codechat 也无对应物，文案只覆盖 `owner`/`users`/`org` + 缺省（`perm` 缺失时**不渲染分享行**，不臆断为私有）。

## 用户场景与测试 _（必填）_

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
8. **假设** model 调用 `Artifact` 工具时省略 `action`（或显式传 `action: "publish"`），**当** 工具执行时，**则** 按发布处理，上述校验/确认/冲突防护全部生效（缺省动作即发布，与既有行为一致）。
9. **假设** model 调用 `Artifact` 工具发布一个**没有 `<title>`** 的 `.html` 文件且未提供 `title`，**当** 工具执行时，**则** 请求体带 `title` = **文件名（不含扩展名）**（CC 标题链的末级兜底），服务端按「页面 `<title>` > `title` 参数 > 默认名」解析后标题不会落到 `Untitled artifact`。
10. **假设** model 调用 `Artifact` 工具发布 `.html` 且显式传了 `title`，**当** 工具执行时，**则** 该值随请求发送；若页面自带 `<title>`，仍由**服务端**判定标签优先（客户端不自行判优先级、不做冲突提示）。
11. **假设** model 调用 `Artifact` 工具发布 `.md` 文件，**当** 工具执行时，**则** 按 CC 保持**文件名身份**：客户端渲染时把文件名注入 `<title>`，且**不发送 `title` 参数**（`title` 仅对 `.html` 生效）；显式给出的 `label` 只作为本次发布的短名随请求发送。
12. **假设** model 显式提供 `label`，**当** 工具执行时，**则** `label` 作为「本次发布的短名」原样发送（超过 60 字符返回 `success: false` 与错误提示），且**不参与**标题解析——无论 `.html` 还是 `.md`，标题都不再取决于 `label`。

### 用户故事：内置技能 /artifact 人工触发（优先级：P1）

作为用户，我希望在不知道如何用自然语言描述发布需求时，通过在输入框输入 `/` 看到并选择 `artifact` 命令来触发发布，以便一键使用而不依赖提示词技巧。

**为什么是这个优先级**：技能是"不会写提示词"用户的入口，与模型自动调用工具构成双通道，均为发布核心路径。**技能只是给用户的快捷入口**：其内容仅指示模型调用 `Artifact` 工具，不含任何发布逻辑——发布、校验、权限确认、会话映射全部由工具完成。

**独立测试**：`enableArtifact` 开启时断言 `getSlashCommands()` 包含 `artifact` 技能命令（描述带 `Skill: ` 前缀、归入 popup 技能分组）；模型经 Skill 工具调用 artifact 技能被拒绝（`disable-model-invocation`）。

**验收场景**：

1. **假设** `enableArtifact` 已开启，**当** 用户在输入框输入 `/` 时，**则** popup 技能列表显示 `artifact` 命令（描述形如"发布本地 HTML/Markdown 为可分享网页"），用户选择即可触发。
2. **假设** 用户输入 `/artifact`（无参数），**当** 命令执行时，**则** 技能内容注入主 agent（内容仅指示调用 `Artifact` 工具），agent 从会话上下文推断要发布的文件（不明确时先询问用户），随后调用 `Artifact` 工具发布并返回 URL。
3. **假设** 用户输入 `/artifact <file_path>`（带参数），**当** 命令执行时，**则** 文件路径作为参数（`$ARGUMENTS`/`$1` 语义）透传给技能内容，agent 直接以该路径为 `file_path` 调用 `Artifact` 工具，不再询问。
4. **假设** 模型试图通过 `Skill` 工具调用 artifact 技能，**当** 调用时，**则** 返回 "not available for model invocation"（`disable-model-invocation: true`）；模型的发布入口只有 `Artifact` 工具，两通道不重叠。
5. **假设** 用户经 `/artifact` 触发发布，**当** `Artifact` 工具执行时，**则** 与自然语言路径走完全相同的工具调用：文件存在性/扩展名/大小校验、权限确认（首次）与同会话自动允许（重复发布）、409 冲突与 stale_version_guard 全部生效——技能不含任何绕过或复制这些逻辑的实现。
6. **假设** `enableArtifact` 未开启（未登录默认如此，或显式 `false`），**当** 会话初始化时，**则** artifact 技能不注册，popup 不显示 `/artifact`（与工具注册同 gate）。
7. **假设** 运行中的会话中 `enableArtifact` 由禁用热重载为启用，**当** 配置重载时，**则** `/artifact` 技能命令即时注册、popup 可见；反向关闭时即时注销（与工具注册同 gate）。

### 用户故事：WebFetch 读取 artifact 页面（优先级：P1）

作为用户，我希望 WebFetch 能识别 artifact URL 并走专用通道读取发布内容，以便 AI 可以基于 artifact 内容回答、排查或继续迭代。

**为什么是这个优先级**：发布与读取构成完整闭环，也是冲突防护（stale_version_guard）的基础。

**验收场景**：

1. **假设** WebFetch 的 `url` 形如 `{host}/code/artifact/{slug}`（匹配 artifact URL 格式），**当** 工具执行时，**则** 走专用读取通道：先 `GET /api/frame/{slug}?via=model_read` 取元数据，再拉取正文，返回页面内容；该取用逻辑与 `Artifact` 工具 `read` 动作共用**同一份实现**（元数据探测、Bearer 鉴权、正文拉取、大内容落盘不重复实现）。
2. **假设** artifact 读取成功，**当** WebFetch 返回结果时，**则** 输出 schema 附带可选 `artifactRead: { slug, ver }` 元数据（`ver` 为当前版本号），且会话内记录的版本号同步更新。
3. **假设** artifact HTML 内容较大（超过 ~2KB），**当** WebFetch 执行时，**则** 完整内容落盘到临时文件，返回文件路径 + head 截断预览，避免工具结果过大。
4. **假设** artifact 不存在或已删除（服务端 404），**当** WebFetch 执行时，**则** 返回 `success: false` 与对应的错误消息。
5. **假设** 读取接口返回的 `contentUrl` 需要鉴权，**当** WebFetch 拉取正文时，**则** 携带当前登录 token（Bearer）请求。
6. **假设** WebFetch 读取的是**他人分享**的 artifact，**当** 返回结果时，**则** 仍是围绕 `prompt` 的小模型答案（小模型看到内容、主模型只看到答案），他人页面全文不进入主对话上下文。

### 用户故事：读取已发布 artifact 的原文（优先级：P1）

作为用户，我希望让 AI 直接读取某个已发布 artifact 的原文 HTML（而不是被转成 markdown 的二手文本，也不是被小模型概括过的摘要），以便在真实的 HTML/CSS/JS 上继续修改页面、排查样式或渲染问题。

**为什么是这个优先级**：读取与发布构成完整闭环；当前唯一的读取通道是 WebFetch，它会把 HTML 转成 markdown 后交给小模型，标签结构、class 与元素的对应关系全部丢失，无法支撑"改页面/查样式"这类需求。

**独立测试**：mock `GET /api/frame/{slug}?via=model_read` 返回自有 artifact 元数据与 `content` 端点返回的 HTML，调用 `Artifact` 工具（`action: "read"` + `url`）并断言返回原文 HTML；另一个用例 mock 他人分享的 artifact 并断言走摘要路径。

**验收场景**：

1. **假设** model 调用 `Artifact` 工具且 `action: "read"`、`url` 形如 `{host}/code/artifact/{slug}` 且当前用户是该 artifact 的拥有者，**当** 读取成功时，**则** 返回该版本的**原始 HTML**（含内联 CSS/JS），并给出 artifact 的版本信息。
2. **假设** 读取到的原文超过落盘阈值（约 2KB），**当** 工具返回时，**则** 完整原文写入本地文件，工具结果给出文件路径与开头预览（提示用 Read 查看全文），避免工具结果膨胀。
3. **假设** `url` 指向的是**他人分享给当前用户**的 artifact，**当** 读取时，**则** 内容以隔离摘要形式返回（调用方给了 `prompt` 时摘要围绕该关注点组织），他人页面的全文不进入对话上下文。
4. **假设** `url` 不是 artifact URL（slug 无法解析），**当** 工具执行时，**则** 返回 `success: false` 与"不是可读取的 artifact URL"错误。
5. **假设** artifact 不存在或已删除（服务端 404），**当** 工具执行时，**则** 返回 `success: false` 与"artifact 不存在"错误。
6. **假设** 当前用户无权读取该 artifact（服务端 403），**当** 工具执行时，**则** 返回 `success: false` 与"无权限"错误（与"不存在"区分开）。
7. **假设** 客户端未登录（无有效 token），**当** 工具执行时，**则** 返回鉴权错误并提示先登录。
8. **假设** 工具结果包含 artifact 版本号，**当** 读取成功后同会话再发布同一 artifact 时，**则** 会话内记录的版本号已更新为读取到的最新版本，stale_version_guard 不误报冲突。
9. **假设** 首次读取**他人分享**的 artifact，**当** 调用工具时，**则** 触发权限确认（该页面内容将进入对话上下文）；用户同意后，同一 artifact 在本会话内的后续读取不再重复确认。
10. **假设** 读取当前用户**自己拥有**的 artifact，**当** 调用工具时，**则** 免确认（只读动作，内容本来就在用户的控制范围内）。
11. **假设** `enableArtifact` 未开启，**当** model 调用 `Artifact` 工具时，**则** 工具不注册、不可调用（与发布同一 gate），WebFetch 的 artifact URL 拦截同样失效。

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

### 用户故事：向模型告知 artifact 的分享状态（优先级：P2）

作为用户，我希望 AI 在发布或读取 artifact 后自己就知道这个页面的分享范围（私有 / 分享给指定的人 / 组织内可见）以及「改分享要去网页的 Share 菜单、未分享时别人打不开」，以便我不必自己解释为什么同事打开我发过去的链接是 403。

**为什么是这个优先级**：默认私有是 CC 的默认行为，而模型看不到分享状态就会把「发布成功」当成「已经分享给团队了」。CC 2.1.278 对每种 mode 都生成一段说明并以固定句收尾（`You cannot change sharing; that is done from the page's Share menu.`），这是「分享只读探针」能力**唯一的出口**——探针读到了却不告诉模型，等于白读。

**独立测试**：mock `GET /api/frame/{slug}?via=model_read` 分别返回 `perm.mode` = `owner` / `users` / `org` 与 `role: "reader"`，断言 `read` 与 `publish` 的工具结果含对应的分享文案与固定句；mock 元数据缺 `perm` 时断言分享行整体缺席（且结果其余部分正常）。

**验收场景**：

1. **假设** model 首次发布一个**新** artifact（未带 `url`）且服务端返回 201，**当** 工具返回时，**则** 结果除 URL / 版本外还含分享行，说明该页面**私有（只有你能打开，别人打不开）**，并以固定句「你不能改分享；改分享在网页的 Share 菜单里」收尾；新 artifact 服务端必然 `share_mode=owner`，无需额外探测即可断言。
2. **假设** 带 `url` 重发布一个**已分享**的 artifact（探测到 `perm.mode` = `users` 或 `org`），**当** 发布成功时，**则** 分享行按探测到的 mode 渲染（`users` = 分享给了指定的人；`org` = 组织内可见），同样以固定句收尾。
3. **假设** model 用 `action: "read"` 读取一个**自己拥有**的 artifact 且元数据 `perm.mode` = `owner`，**当** 工具返回时，**则** 返回原文 HTML 的同时含「私有、别人打不开」的分享行与固定句。
4. **假设** model 用 `action: "read"` 读取**他人分享**的 artifact（`artifactOwnershipFromMeta` 判定为 `reader`），**当** 返回摘要时，**则** 文案说明这是**别人分享给你的**页面、且**本会话不能发布到它**（要改只能另发一个新 artifact），并以固定句收尾。
5. **假设** 元数据里没有 `perm`（或 `mode` 不在 `owner|users|org` 内），**当** 工具返回时，**则** **不渲染分享行**（不臆断为私有、不报错），结果其余部分照常。
6. **假设** WebFetch 命中 artifact URL 走专用读取通道，**当** 结果返回时，**则** 分享文案与 `read` 动作**逐字一致**（同一份实现，不各写一套）。
7. **假设** 分享行已渲染在工具结果里，**当** 检查权限确认面时，**则** 确认文案与 `warning` **不含**该分享行——模型可见文案与用户确认文案是两条通道，后者沿用既有 shared-live 警告，两者不重复也不冲突。
8. **假设** model 试图用 `Artifact` 工具改分享范围，**当** 检查工具 schema 时，**则** 不存在任何分享/权限相关参数（`share_scope` / `shareScope` / `access_scope` / `link_access` 零命中），文案本身已明确「不能改分享，去 Share 菜单」。
9. **假设** `enableArtifact` 未开启，**当** 会话初始化时，**则** 工具整体不注册，分享文案同样不可达（与 publish/read 同一 gate）。

### 用户故事：发布确认与同会话自动允许（优先级：P2）

作为用户，我希望发布动作默认经过确认、但同会话内的重复发布不再打扰，以便既不误发又保持流畅。

**为什么是这个优先级**：发布是外发动作需确认；同会话重发是常见迭代循环，频繁确认会打断工作流。

**验收场景**：

1. **假设** model 首次发布某文件，**当** 调用 `Artifact` 工具时，**则** 触发权限确认（文案形如 "publish \"&lt;file&gt;\" to a private page"），用户拒绝则取消发布。
2. **假设** 同会话内 model 再次发布本会话已发布过的文件（`url` 省略，靠会话内 file_path → artifact URL 映射），**当** 调用 `Artifact` 工具时，**则** 自动允许，不再弹确认。
3. **假设** 会话内映射不存在（本会话未发布过该文件）且用户未配置自动允许，**当** 调用 `Artifact` 工具时，**则** 仍弹确认。

### 用户故事：启用开关与默认启用（优先级：P2）

作为用户，我希望登录之后就能直接用 Artifact（自然语言或 `/artifact`），而不必先去设置里打开开关，以便开箱即用；同时希望开关仍可显式关闭，作为回退入口。

**为什么是这个优先级**：frame 后端已上线，功能可以默认可用；但 Artifact 的每个请求（发布 / 读取 / 资源）都要带 SSO token，**没有账号时注册出来只会次次失败**——所以"默认开启"的前提是**已登录**。账号判据 = `authService.getSSOToken()` 存在（不看过期：token 过期会在下一次请求时经 `createAuthAwareFetch` 惰性刷新，这与 CLI 欢迎页判断"是否提示 /login"用的是同一个判据）。口径对齐 CC：CC 是 `enabled = 没有"关"的来源 && (defaultOn || 显式 true)`，其账号层判定（`no_auth` / provider / token scope）正对应这里的"有没有可用凭据"（`@anthropic-ai/claude-code-linux-x64@2.1.285` 的 `resolveArtifactEnableSetting` / `getArtifactDefaultOn`，`defaultOn: true`；账号层判定在 `artifactToolWithholdingGate`，取值为 `no_auth` / provider / token scope）。开关支持热更新：运行中的会话修改 settings.json、**或会话内登录 / 登出**，都会即时重评估工具与技能注册（无需重启会话）。

**独立测试**：断言 `ARTIFACT_DEFAULT_ENABLED === true`；`isArtifactEnabled()` 四种组合（未配 + 已登录 ⇒ 开；未配 + 未登录 ⇒ 关；显式 `true` + 未登录 ⇒ 开；显式 `false` / 远端 `false` ⇒ 关）；登录 / 登出后 `reloadFeatureGatedTools()` 与 `reloadFeatureGatedSkills()` 被触发。

**验收场景**：

1. **假设** 未配置 `enableArtifact` 且当前已登录（有 SSO token），**当** 会话初始化时，**则** `Artifact` 工具注册、可调用，`/artifact` 技能命令同步注册、popup 可见。
2. **假设** 未配置 `enableArtifact` 且当前未登录（无 SSO token），**当** 会话初始化时，**则** `Artifact` 工具不注册、不可调用，`/artifact` 技能命令同样不注册、popup 不显示（注册出来也只有失败一条路）。
3. **假设** settings.json 配置 `enableArtifact: true` 但当前未登录（显式要求优先），**当** 会话初始化时，**则** 工具与技能命令照常注册，首次调用返回鉴权错误并提示先 `/login`。
4. **假设** settings.json 配置 `enableArtifact: false`，**当** 会话初始化时，**则** 工具与技能命令不注册（无论是否登录）。
5. **假设** 未配置 `enableArtifact` 且会话启动时未登录，**当** 用户在本会话内 `/login` 成功后，**则** `Artifact` 工具与 `/artifact` 技能命令即时注册、可调用（无需重启会话）；**假设** 随后登出，**则** 两者即时注销、popup 隐藏。
6. **假设** Artifact 被禁用（未登录默认关闭，或显式 / 远端关闭），**当** WebFetch 收到 artifact URL 时，**则** 不进入专用读取通道（按普通 URL 处理或报错），不执行 `via=model_read` 调用。
7. **假设** 运行中的会话未启用 Artifact（未登录），**当** 用户在 settings.json 中改为 `enableArtifact: true` 触发配置热重载时，**则** `Artifact` 工具即时注册、可调用，`/artifact` 技能命令同步注册、popup 可见，无需重启会话；**假设** 改为 `false`，**则** 即时注销，同时 WebFetch 的 artifact URL 拦截（逐调用检查 `isArtifactEnabled`）同步失效。
8. **假设** 服务端 `GET /api/wave/settings` 下发了 `enableArtifact: true`（remote settings），**当** 会话初始化或轮询（60min + 304 checksum）检测到变更时，**则** remote 值优先于本地 settings.json 与代码默认值（未登录也照开），`Artifact` 工具按 remote 值注册，`/artifact` 技能命令按同 gate 注册，WebFetch 拦截同样生效（管理员远程灰度/回滚入口）。
9. **假设** 服务端下发的 remote `enableArtifact` 与本地 settings.json 冲突，**当** 合并配置时，**则** remote 胜出（last-write-wins，与 `model`、`permissions.defaultMode` 等 managed 字段语义一致），工具与技能命令均按 remote 值注册/注销；未下发时回退本地/默认值。

### 用户故事：列举当前账号的 artifact（`list`，优先级：P1）

作为用户，我希望让 AI 列出我拥有或别人分享给我的 artifact，以便在不记得 URL 时也能定位到要读取或继续迭代的页面。

**为什么是这个优先级**：不记得 slug 就无法 `read`；`list` 又是资源动作（`assets`）的前置入口——要操作资源得先知道 artifact 的 URL。

**独立测试**：mock `GET /api/frame/frames?limit=200` 返回 mine/shared 混合行，调用 `Artifact`（`action: "list"`）断言按 `scope` 过滤、`limit` 截断与 `(mine)`/`(shared)` 分组标签；另两个用例断言空结果与未登录。

**验收场景**：

1. **假设** model 调用 `Artifact` 工具且 `action: "list"`（`scope` 省略），**当** 工具执行时，**则** 请求 `GET /api/frame/frames?limit=200`（页大小固定 200，**不传** `scope`、**无**游标参数），只保留 `rel: "mine"` 的行（默认 `scope` = `mine`）。
2. **假设** `scope: "shared"`，**当** 工具执行时，**则** 只保留 `rel: "shared"` 的行；**假设** `scope: "all"`，**则** 两类都保留并各自标注归属。
3. **假设** `limit` 省略，**当** 工具执行时，**则** 最多返回 25 行（默认值）；**假设** 传 `limit: 10`，**则** 最多 10 行；**假设** 传超过 50 的 `limit`，**则** 返回 `success: false` 与上限错误（不静默截断）。
4. **假设** 过滤后可选行仍多于 `limit`，**当** 工具返回时，**则** 结果标注「已截断」，提示提高 `limit` 或收窄 `scope`。
5. **假设** 结果非空，**当** 工具返回时，**则** 按 `(mine)` / `(shared)` 分组渲染，每行含标题（缺失时为 `Untitled artifact`）、URL `{host}/code/artifact/{slug}`、`updatedAt`；`mine` 行额外带 favicon。
6. **假设** 某行的 `softDeleted: true` 或 `rel` 不在 `mine|shared` 内，**当** 工具处理响应时，**则** 跳过该行（不整体报错）；**假设** 所有行都不可解析，**则** 返回 `success: false` 与「响应行不可读」类错误。
7. **假设** 过滤后为空，**当** 工具返回时，**则** 返回 `success: true` 与明确的空结果文案（如 `no artifacts`），不报错。
8. **假设** 未登录（无有效 token），**当** 工具执行时，**则** 返回鉴权错误并提示先登录。
9. **假设** 服务端返回非 2xx 或请求失败，**当** 工具执行时，**则** 返回 `success: false` 与状态码错误；首次网络失败或 5xx 时客户端先重试一次（抖动退避），仍失败才报错。
10. **假设** `enableArtifact` 未开启，**当** 会话初始化时，**则** 工具整体不注册，`list` 同样不可用（与 publish/read 同一 gate）。

### 用户故事：artifact 资源库（`assets` 五动作，优先级：P1）

作为用户，我希望让 AI 把本地文件作为资源上传到某个 artifact，并列出/读取/删除/复制这些资源，以便发布的页面能引用图片、字体、数据等外部文件，也让 AI 能查看与整理已有资源。

**为什么是这个优先级**：资源是 artifact 页面的组成部分（页面里通过 `_blob/{id}` 引用），没有资源能力就只能把内容内联成 base64，页面体积与可维护性都不可接受。

**独立测试**：mock `/agent-upload`（裸字节 body + `Content-Type`）、`/agent-list`、`/agent-copy`、`/agent-delete` 与 `/_f/{ver}/_blob/{id}` 读取通道，逐个断言请求形状、响应解析与错误映射；断言白名单外的扩展名在本地被拒（不发起请求）。

**验收场景**：

1. **假设** model 调用 `action: "upload_asset"` 且 `file_path` 指向一个白名单扩展名的常规文件，**当** 工具执行时，**则** 以**裸字节** + `Content-Type`（按扩展名映射，如 `.png`→`image/png`）`POST /api/frame/blob/{slug}/agent-upload`，返回 `{opaque_id, url, size_bytes, content_type, sha256}`，并告知模型资源可在页面内用 `_blob/{id}` 引用。
2. **假设** `file_path` 的扩展名不在白名单内（`png`/`jpg`/`jpeg`/`gif`/`webp`/`svg`/`mp4`/`webm`/`pdf`/`woff2`/`woff`/`ttf`/`otf`/`csv`/`md`/`markdown`/`json`/`txt`/`ts`/`css`/`js`/`mjs`/`cjs`），**当** 工具执行时，**则** 返回 `success: false` 并列出允许的类型，**不发起请求**（服务端不做白名单，只有客户端拦得住）。
3. **假设** `file_path` 不是常规文件（目录/设备/FIFO）、指向网络路径（UNC 共享、`/net` automount、设备式路径）、解析后落在会话可读区之外（符号链接按解析后的真实路径判定，真实路径本身可以是白名单内的常规文件），**当** 工具执行时，**则** 返回 `success: false` 与对应错误，不读取内容。
4. **假设** 文件为空，**当** 工具执行时，**则** 返回 `success: false` 与「无内容可上传」错误。
5. **假设** 文件超过单资源上限（SVG 2 MiB，其他类型 20 MiB），**当** 工具执行时，**则** 客户端先报错、不发起请求；**假设** 服务端仍返回 413，**则** 透传为友好的大小错误。
6. **假设** 上传前后复核发现文件身份变了（路径已移动、被替换，或读取期间 size/mtime 变化），**当** 工具执行时，**则** 中止并提示重试，不把已被换掉的内容上传出去。
7. **假设** 上传是写动作，**当** 首次对某 artifact 执行时，**则** 触发权限确认；用户同意后，同一 artifact 在本会话内的后续资源写动作不再重复确认（与 publish 的会话内自动允许同构）。
8. **假设** 服务端返回 415（content type 不是裸 MIME）或 409（配额/状态），**当** 工具执行时，**则** 映射为对应错误（415 明确提示 MIME 不得带参数）。
9. **假设** model 调用 `action: "list_assets"` 且 `url` 指向某 artifact，**当** 工具执行时，**则** `POST /api/frame/blob/{slug}/agent-list`（body `{limit, after?}`），页大小以服务端为准（固定 50），返回资源列表与配额用量（`files`/`bytes` 对 `max_files`/`max_bytes`）。
10. **假设** 响应带 `next` 游标，**当** 工具返回时，**则** 附上游标并提示可带 `after` 续页；**假设** `after` 不是合法游标（服务端 400 `invalid_request`），**则** 返回 `success: false` 并提示重新列举。
11. **假设** 用量已到上限（`files >= max_files` 或 `bytes >= max_bytes`），**当** 工具返回时，**则** 用量信息照常呈现，供模型判断是否需要先删再传。
12. **假设** model 调用 `action: "read_asset"` 且给了 `url` 与 `asset_id`，**当** 工具执行时，**则** 先探测 `GET /api/frame/{slug}?via=model_read` 取 `assetToken` 与 `version`，再 `GET /_f/{version}/_blob/{assetId}?__frame_t={token}` 取内容（**token 鉴权、不携带 Bearer**）；token 过期（401）时重新探测一次再取。
13. **假设** 资源是图片/字体等二进制，**当** 工具返回时，**则** 落盘到临时文件并给出路径与 `content_type`/大小，**不**把二进制塞进工具结果；**假设** 资源是文本类（`text/*`、`application/json` 等），**则** 可内联（过大时同样落盘）。
14. **假设** `asset_id` 不在该 artifact 内（服务端 404 / `asset_not_found`），**当** 工具执行时，**则** 返回 `success: false` 并提示用 `list_assets` 核对 id。
15. **假设** 读取的是他人分享 artifact 的资源，**当** 工具执行时，**则** 与 `read` 同口径：内容（第三方内容）进入上下文前需确认，且无法确认归属时按读者处理。
16. **假设** model 调用 `action: "delete_asset"` 且给了 `url` 与 `asset_id`，**当** 工具执行时，**则** `POST /api/frame/blob/{slug}/{assetId}/agent-delete`；服务端幂等——不存在或已删返回 200 `{deleted:false}`，工具如实呈现，不当作错误。
17. **假设** 删除是写动作，**当** 首次对某 artifact 执行时，**则** 触发权限确认（与 upload 相同的会话内自动允许规则）。
18. **假设** model 调用 `action: "copy_from"` 且给了目标 `url`、源 artifact（`from`）与 `asset_ids`（1–10 个不重复），**当** 工具执行时，**则** `POST /api/frame/blob/{targetSlug}/agent-copy`，body `{from, ids}`，返回的新资源顺序**严格等于** `asset_ids` 顺序；复制产生独立新副本，源资源不受影响。
19. **假设** `asset_ids` 为空、超过 10 个或含重复，**当** 工具执行时，**则** 返回 `success: false` 与约束错误，不发起请求。
20. **假设** 任一资源动作未登录，**当** 工具执行时，**则** 返回鉴权错误并提示先登录。
21. **假设** 服务端返回 403（含 `not a writer` 纯文本），**当** 工具执行时，**则** 映射为可操作错误：只有 artifact 的 owner/writer 能改资源，读者只能看。
22. **假设** `enableArtifact` 未开启，**当** 会话初始化时，**则** 工具整体不注册，资源动作同样不可用（与 publish/read 同一 gate）。

### 非功能需求

- **零新增配置**：API 端点相对 Server URL origin 硬编码（`options.serverUrl > WAVE_SERVER_URL > 默认值`，经 authService.getServerUrl() 获取），不新增 baseUrl/artifactUrl 配置项。
- **默认启用的账号判据**：`isArtifactEnabled()` 落到代码默认值时还要求**存在 SSO token**（`authService.getSSOToken()` 非空），即"已登录才默认开"。判据**只存在性、不看有效期**——会话启动时不刷新 token，过期 token 会在下一次请求时经 `createAuthAwareFetch` 惰性刷新（与 CLI 欢迎页判断是否提示 `/login` 同一口径），若改看有效期会让"只是 token 陈旧"的老用户被静默关掉。判据是同步文件读，因此 `isArtifactEnabled()` 保持同步（注册处 `ToolManager.initializeBuiltInTools()` 同步调用）；判据只作用于**代码默认**这一步，远端托管设置与显式 `enableArtifact` 都不受账号影响。
- **登录 / 登出的即时性**：注册发生在会话初始化时，而账号可能中途变化，因此 `authService.onAuthChange` 回调在原有"刷新/清理 remote settings"之外，还要重新评估 feature-gated 工具与技能（`reloadFeatureGatedTools()` + `reloadFeatureGatedSkills()`）——否则首次运行的用户在会话内 `/login` 后要重启才见得到 Artifact。`remoteSettingsService.refresh()` 不覆盖这一点：它只在托管设置 checksum 变化时才触发配置重载。
- **双通道不重叠**：`Artifact` 工具保留模型自动调用（自然语言触发）；内置技能 `/artifact`（builtin SKILL.md，`disable-model-invocation: true`）仅人工斜杠触发。技能仅指示模型调用 `Artifact` 工具，不含任何发布逻辑，与自然语言路径走完全相同的工具调用；技能注册与工具注册同 gate（`isArtifactEnabled`），禁用时两者都不暴露。
- **鉴权**：发布（deploy/direct）与读取（model_read、contentUrl）请求均携带当前登录 token（Bearer）；未登录返回明确错误。
- **大小上限**：发布内容上限 16MB（413 透传为友好错误）。
- **文件大小策略**：读取时 >~2KB 的 HTML 落盘到临时文件（返回路径 + head 预览），避免工具结果膨胀。
- **归属判定**：以服务端元数据判定当前用户对该 artifact 的角色（拥有者 / 读者）。拥有者返回原文 HTML；读者（他人分享）与**无法确认归属**的情况一律走摘要，不返回全文。
- **分享状态文案的单一实现**：`perm.mode` / `role` → 文案的映射只有一份，与 `artifactOwnershipFromMeta` 同层（artifact 内容层），`read` 动作、WebFetch 拦截与 `publish` 结果**共用**；不得出现两套并行文案。
- **分享只读口径**：不新增任何写分享的 action 或参数（对齐 CC —— 它同样只能读分享范围，改分享被指向网页 Share 菜单）；分享行恒以固定句「不能改分享」收尾。
- **分享行的可省略性**：`perm` 缺失或 mode 不可识别时省略分享行，不臆断为私有、不报错。
- **摘要实现**：读者视角的摘要复用 WebFetch 已有的小模型处理路径（同一份 prompt→答案机制），不新增模型调用通道。
- **读取实现单一化**：artifact 的元数据探测、Bearer 鉴权、正文拉取、大内容落盘只有一份实现，`Artifact` 工具的 `read` 动作与 WebFetch 的 artifact URL 拦截共同调用；不得出现两套并行逻辑。
- **工具描述**：`Artifact` 工具的 description 需同时覆盖发布与读取两类意图（"发布/分享/做成网页/给链接" 与 "读取/查看/看下这个链接里的内容"），并说明缺省动作是发布。
- **只读性**：WebFetch 侧读取行为保持只读，不修改 artifact 内容。
- **会话映射**：会话内维护 file_path → artifact URL 映射，用于同会话重发免 `url` 参数与 stale_version_guard。
- **测试**：SDK 层 mock 服务端（201/409/404/413）覆盖发布、重部署、冲突、读取、禁用开关场景。
- **枚举口径**：`list` 的 `scope`（`mine`(默认)/`shared`/`all`）与 `limit`（默认 25、最大 50）是**客户端行为**——服务端页大小固定 200、无 `scope`、无游标，过滤与截断由客户端算；`(mine)`/`(shared)` 分组标签由工具层渲染（服务端只给 `rel`）。
- **资源标识**：`asset_id` 一律用 32 位小写 hex 的 `opaque_id`；`_blob/{id}` 只是展示用 URL，工具在把 URL 当 id 用时先剥掉 `_blob/` 前缀。
- **资源请求超时与重试**：上传/复制等写请求超时 30s（大文件 90s）；超时或传输中断时提示「可能已成功，最多重试一次」（upload 重复只多占配额、delete 与 copy 可用 `list_assets` 复核）。
- **二进制处理**：`read_asset` 按 `content_type` 分流——文本类可内联，二进制落盘为文件（不经 UTF-8 文本通道）；落盘沿用现有的工具结果临时文件生命周期。
- **资源写入粒度**：`upload_asset`/`delete_asset`/`copy_from` 是外发/破坏性动作，走权限确认（首次对某 artifact 确认一次、本会话后续自动允许）；`list_assets`/`read_asset` 是只读动作，免确认。

### 边界情况

- **md → HTML 渲染失败怎么办？** 渲染失败时返回 `success: false` 与渲染错误信息，不发起上传。
- **未登录时发布/读取怎么办？** 返回鉴权错误并提示先登录（`/login`）。
- **artifact URL 的主机与 Server URL 不一致？** 自托管场景下发布返回的 URL 即当前 Server URL origin 下的 `/code/artifact/{slug}`；WebFetch 按 URL 路径格式 `{host}/code/artifact/{slug}` 识别，读取请求发往同一 origin。
- **并发发布同一 slug（跨会话）怎么办？** 服务端 409 + `live` 版本号；客户端透传错误并提示先 WebFetch 最新内容，或带 `force: true` 覆盖。
- **大文件读取的临时文件何时清理？** 沿用现有工具临时文件生命周期管理，不引入独立清理机制。
- **与 disallowedTools 的关系？** `enableArtifact` 是独立功能开关（未设置时 = 已登录则开）；disallowedTools 对 Artifact 工具的显式禁用仍生效（两者取并集）。
- **token 存在但已过期 / 已失效？** 仍算"已登录"⇒ 默认开启（不看过期时间）；请求时按既有鉴权链处理：`createAuthAwareFetch` 先惰性刷新，401/403 再走一次恢复重试，都失败则工具返回鉴权错误并提示 `/login`。
- **未登录用户想强制打开？** 显式 `enableArtifact: true`（本地或远端下发）照开，工具照常注册；首次调用返回 `Artifact: not authenticated. Run /login to connect your account before …`——即"注册出来但用不了"是用户主动选择的结果，不是默认行为。
- **`auth.json` 存在但内容损坏 / 无 `SSO_TOKEN` 字段？** `loadAuth()` 解析失败返回 `{}`，判据为假 ⇒ 按未登录处理（默认不开），不报错。
- **读到的内容比会话内记录的版本新怎么办？** 以读取到的版本号覆盖会话内记录（读取即"已看到最新版本"），随后同会话重发布不再因 stale_version_guard 被拦。
- **读他人 artifact 与 plan 模式？** 读他人 artifact 需用户确认（内容进入上下文、且是第三方内容）；plan 模式下没有可交互的确认面时不自动放行，保持规划状态并提示用户。
- **enableArtifact 关闭时读动作？** 与发布同 gate：工具整体不注册；WebFetch 的 artifact URL 拦截同步失效（退化为普通 URL 处理）。
- **Artifact 工具是受限工具吗？** 是——发布是外发网络动作，需加入 RESTRICTED_TOOLS 以触发默认模式的确认流程。
- **上传的文件在上传过程中被改写怎么办？** 读取前后各取一次文件身份（inode + size/mtime），不一致即中止并提示重试，绝不把替换后的内容当作已确认的文件上传。
- **`read_asset` 的 `assetToken` 只有 1 小时且不是会话 JWT？** 每次读取都重新探测元数据换取新 token，不做跨调用缓存，也不把它当 Bearer 使用（它是基于 `JWT_SECRET` 派生密钥的 HMAC）。
- **页面里的 `_blob/{id}` 与工具产出的资源 URL 是什么关系？** 页面外壳负责把 `_blob/{id}` 改写成带 token 的绝对路径；工具只产出/消费 `opaque_id` 与相对 URL，不做改写。
- **资源配额用尽怎么办？** 工具不自动删除任何资源，只如实呈现 `usage`（`files`/`bytes` 对 `max_files`/`max_bytes`），由模型判断并提示用户。
- **`list_assets` 的 `content_type` 很长（如 `.docx`）怎么办？** 不设长度上限（服务端 DB 列宽 100），按原值呈现——CC 客户端会因 40 字符上限静默丢行，wave 不沿用该行为。
- **服务端没返回 `perm` 怎么办？** 不渲染分享行（模型看不到分享状态，也好过被告知错误的状态），其余结果照常返回；`owner` 的**首次发布**是例外——新 artifact 服务端必然私有，无需探测即可给出文案。
- **为什么不实现 CC 的「受众变宽提醒」？** CC 用 `{owner:0, users:1, agent_scoped:1, org:2, public:3}` 等级表判断受众是否变宽、要不要提醒模型；wave 没有任何改分享的入口 ⇒ 受众不会因本工具的动作变宽，该提醒无触发场景。
- **CC 的 `public` / `agent_scoped` 两种 mode 呢？** codechat 的 `perm.mode` 只有 `owner` / `users` / `org`；文案只覆盖这三档 + 缺省，不为服务端不存在的 mode 预留分支。
