---
name: "Artifact 工具"
description: "发布本地 HTML/Markdown 为默认私有的可分享网页，读取 artifact 原文/摘要"
order: 35
---

# 功能规格说明：Artifact 工具

**创建日期**：2026-08-12

> 对齐 Claude Code 的内建 Artifact 工具：把本地 `.html`/`.md` 文件发布为默认私有的可分享网页（claude.ai 风格），并通过 WebFetch 拦截读取已发布的 artifact 页面。
> 服务端契约已落地（codechat 自托管同源实现）：`POST /api/frame/deploy/direct`（发布）、`GET /api/frame/{slug}?via=model_read`（元数据）、`GET /api/frame/{slug}/content?v={version}`（正文，同源 + Bearer 鉴权，无独立域名/assetToken 流程）。
> 已拍板的简化决定：零新增配置（API 端点复用 Server URL origin：`options.serverUrl > WAVE_SERVER_URL > 默认值`，不新增 baseUrl 配置项）；客户端只实现 inline 直传一条路径（无 signed URL / DIRECT_UPLOAD）；无 AUTO_OPEN / FRAME_TIMING / OWNERSHIP_FRAME 遥测；**启用开关 `enableArtifact`（未设置时跟随代码默认值常量，当前默认禁用**——后端未上线先不发功能，内测/灰度通过 `enableArtifact: true` 显式打开；后端上线后翻转默认值常量为启用）。`disableArtifact` opt-out 开关等 GA 后再对齐 CC，本期不实现。
> 触发方式定案（双通道并存，2026-08-13）：**模型经自然语言自动调用 `Artifact` 工具**（description 覆盖"发布/分享/做成网页/给链接"语义，中文提示词同样触发）+ **内置技能 `/artifact` 人工斜杠触发**（builtin SKILL.md，`disable-model-invocation: true` 仅人工、模型不可经 Skill 工具调用该技能）。用户在输入框输入 `/` 即可在技能列表看到该命令并一键触发，无需知道怎么写提示词。**技能本身不含任何发布逻辑**——其内容仅指示模型调用 `Artifact` 工具（参数经 `$ARGUMENTS`/`$1` 透传），发布/校验/权限确认/会话映射全部由工具完成，技能不绕过也不复制这些逻辑。
> 范围：wave-agent 客户端侧工具 + WebFetch 拦截。分享管理（`POST /api/frame/{slug}/share`、pinned_version）由服务端/网页外壳承担，客户端仅发布私有页面并探测分享状态。
> 对齐 CC 的 Artifact 工具形态（2026-09-11 增补）：工具入口统一为带 `action` 参数的单一工具——`action: "publish"`（省略时的默认值，即现有发布行为）与 `action: "read"`（新增读取动作）。**`read` 的返回形态对齐 CC**：读取当前用户**拥有**的 artifact 返回原文 HTML（含内联 CSS/JS）；读取**他人分享**的 artifact 返回隔离摘要（可选 `prompt` 指明关注点），不把他人页面全文放进上下文。
> 本期只补 `read`：CC 的 `list`/`watch`/`status`/`upload_asset`/`list_assets`/`read_asset`/`delete_asset`/`list_types` 等动作依赖平台提供枚举、订阅、资源库、模板等能力，codechat 平台暂无对应接口，本期不做；将来平台补齐后再逐个对齐。
> 读取实现单一化（2026-09-11）：artifact 正文的取用（元数据探测 + Bearer 鉴权 + 正文拉取 + 大内容落盘）收敛为**唯一实现**，`Artifact` 工具的 `read` 动作与 WebFetch 的 artifact URL 拦截共用，不再各写一套。

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
6. **假设** `enableArtifact` 未开启（默认禁用），**当** 会话初始化时，**则** artifact 技能不注册，popup 不显示 `/artifact`（与工具注册同 gate）。
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

### 用户故事：发布确认与同会话自动允许（优先级：P2）

作为用户，我希望发布动作默认经过确认、但同会话内的重复发布不再打扰，以便既不误发又保持流畅。

**为什么是这个优先级**：发布是外发动作需确认；同会话重发是常见迭代循环，频繁确认会打断工作流。

**验收场景**：

1. **假设** model 首次发布某文件，**当** 调用 `Artifact` 工具时，**则** 触发权限确认（文案形如 "publish \"&lt;file&gt;\" to a private page"），用户拒绝则取消发布。
2. **假设** 同会话内 model 再次发布本会话已发布过的文件（`url` 省略，靠会话内 file_path → artifact URL 映射），**当** 调用 `Artifact` 工具时，**则** 自动允许，不再弹确认。
3. **假设** 会话内映射不存在（本会话未发布过该文件）且用户未配置自动允许，**当** 调用 `Artifact` 工具时，**则** 仍弹确认。

### 用户故事：启用开关与默认禁用（优先级：P2）

作为管理员或内测用户，我希望 Artifact 功能默认不可用、但可显式开启，以便在后端上线前不暴露无效工具，同时支持内测/灰度先行体验。

**为什么是这个优先级**：当前 frame 后端尚未上线，功能需默认禁用（不注册工具、不拦截读取）；内测/灰度通过 `enableArtifact: true` 显式打开（无需改代码）；后端上线后把代码默认值常量翻转为启用（未设置 = 启用，对齐 CC `enableArtifact` 的"未设置跟随功能可用性"语义）。开关支持热更新：运行中的会话修改 settings.json 后，配置重载会即时重评估工具注册（无需重启会话）。

**验收场景**：

1. **假设** 未配置 `enableArtifact`（默认状态，后端上线前），**当** 会话初始化时，**则** `Artifact` 工具不注册、不可调用，`/artifact` 技能命令同样不注册、popup 不显示。
2. **假设** settings.json 配置 `enableArtifact: true`，**当** 会话初始化时，**则** `Artifact` 工具注册、可调用，`/artifact` 技能命令同步注册、popup 可见（内测/灰度入口）。
3. **假设** 后端已上线、代码默认值常量已翻转为启用，**当** 会话初始化时，**则** 未配置 `enableArtifact` 也默认启用（工具与技能命令均注册）。
4. **假设** Artifact 被禁用（默认或显式），**当** WebFetch 收到 artifact URL 时，**则** 不进入专用读取通道（按普通 URL 处理或报错），不执行 `via=model_read` 调用。
5. **假设** 运行中的会话未配置 `enableArtifact`（工具未注册），**当** 用户在 settings.json 中改为 `enableArtifact: true` 触发配置热重载时，**则** `Artifact` 工具即时注册、可调用，`/artifact` 技能命令同步注册、popup 可见，无需重启会话。
6. **假设** 运行中的会话已启用 `enableArtifact`，**当** 用户改为 `false` 触发配置热重载时，**则** `Artifact` 工具即时注销、不可调用，`/artifact` 技能命令同步注销、popup 隐藏，同时 WebFetch 的 artifact URL 拦截（逐调用检查 `isArtifactEnabled`）同步失效。
7. **假设** 服务端 `GET /api/wave/settings` 下发了 `enableArtifact: true`（remote settings），**当** 会话初始化或轮询（60min + 304 checksum）检测到变更时，**则** remote 值优先于本地 settings.json 与代码默认值，`Artifact` 工具按 remote 值注册，`/artifact` 技能命令按同 gate 注册，WebFetch 拦截同样生效（管理员远程灰度/回滚入口）。
8. **假设** 服务端下发的 remote `enableArtifact` 与本地 settings.json 冲突，**当** 合并配置时，**则** remote 胜出（last-write-wins，与 `model`、`permissions.defaultMode` 等 managed 字段语义一致），工具与技能命令均按 remote 值注册/注销；未下发时回退本地/默认值。

### 非功能需求

- **零新增配置**：API 端点相对 Server URL origin 硬编码（`options.serverUrl > WAVE_SERVER_URL > 默认值`，经 authService.getServerUrl() 获取），不新增 baseUrl/artifactUrl 配置项。
- **双通道不重叠**：`Artifact` 工具保留模型自动调用（自然语言触发）；内置技能 `/artifact`（builtin SKILL.md，`disable-model-invocation: true`）仅人工斜杠触发。技能仅指示模型调用 `Artifact` 工具，不含任何发布逻辑，与自然语言路径走完全相同的工具调用；技能注册与工具注册同 gate（`isArtifactEnabled`），禁用时两者都不暴露。
- **鉴权**：发布（deploy/direct）与读取（model_read、contentUrl）请求均携带当前登录 token（Bearer）；未登录返回明确错误。
- **大小上限**：发布内容上限 16MB（413 透传为友好错误）。
- **文件大小策略**：读取时 >~2KB 的 HTML 落盘到临时文件（返回路径 + head 预览），避免工具结果膨胀。
- **归属判定**：以服务端元数据判定当前用户对该 artifact 的角色（拥有者 / 读者）。拥有者返回原文 HTML；读者（他人分享）与**无法确认归属**的情况一律走摘要，不返回全文。
- **摘要实现**：读者视角的摘要复用 WebFetch 已有的小模型处理路径（同一份 prompt→答案机制），不新增模型调用通道。
- **读取实现单一化**：artifact 的元数据探测、Bearer 鉴权、正文拉取、大内容落盘只有一份实现，`Artifact` 工具的 `read` 动作与 WebFetch 的 artifact URL 拦截共同调用；不得出现两套并行逻辑。
- **工具描述**：`Artifact` 工具的 description 需同时覆盖发布与读取两类意图（"发布/分享/做成网页/给链接" 与 "读取/查看/看下这个链接里的内容"），并说明缺省动作是发布。
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
- **读到的内容比会话内记录的版本新怎么办？** 以读取到的版本号覆盖会话内记录（读取即"已看到最新版本"），随后同会话重发布不再因 stale_version_guard 被拦。
- **读他人 artifact 与 plan 模式？** 读他人 artifact 需用户确认（内容进入上下文、且是第三方内容）；plan 模式下没有可交互的确认面时不自动放行，保持规划状态并提示用户。
- **enableArtifact 关闭时读动作？** 与发布同 gate：工具整体不注册；WebFetch 的 artifact URL 拦截同步失效（退化为普通 URL 处理）。
- **Artifact 工具是受限工具吗？** 是——发布是外发网络动作，需加入 RESTRICTED_TOOLS 以触发默认模式的确认流程。
