# 功能规格说明：SSO 认证

**特性分支**：`053-sso-auth`
**创建日期**：2026-05-12

## 用户场景与测试 *（必填）*

### 用户故事 1 - 通过浏览器进行 SSO 登录（优先级：P1）

作为在本地机器上工作的开发者，我希望在 Wave 中输入 `/login` 通过公司 SSO 进行认证，这样就不必手动配置 API 密钥。

**为什么是这个优先级**：这是主要的认证流程——大多数用户在本地机器上可以使用浏览器。

**独立测试**：设置 `WAVE_SERVER_URL`，运行 Wave，输入 `/login`，浏览器打开，完成 SSO 登录，验证 token 已保存且 API 请求成功。

**验收场景**：

1. **假设** `WAVE_SERVER_URL` 已设置且没有现有的 SSO token，**当**用户输入 `/login` 时，**则** Wave 打开浏览器到 SSO 登录页面并在终端中显示认证 URL。
2. **假设**用户在浏览器中完成 SSO 登录，**当**浏览器重定向到带有 `?code={code}` 的 localhost 回调 URL 时，**则** Wave 通过 `POST /api/auth/token` 使用 `{ grant_type: "authorization_code", code }` 交换 code 获取 JWT，将 token 和 refresh token 保存到 `~/.wave/auth.json`，并显示"Login successful"。
3. **假设**用户已通过 SSO 认证，**当**用户发送消息时，**则**所有 LLM API 请求发送到 `WAVE_SERVER_URL/api/v1`，使用 SSO token 作为 Bearer 认证。
4. **假设**用户已通过 SSO 认证，**当**用户输入 `/login` 时，**则** Wave 显示当前认证状态（截断的 token、AI URL）并提供按 Enter 退出的选项。
5. **假设**用户已认证并在登录 UI 中按 Enter，**当**他们确认退出时，**则** SSO token 从 `~/.wave/auth.json` 中移除，Wave 显示"Logged out successfully"。

---

### 用户故事 2 - 远程服务器的手动 Token 输入（优先级：P1）

作为通过 SSH 在远程服务器上工作的开发者，我希望在本地浏览器完成登录后手动粘贴 SSO token，以便在没有 localhost 回调转发的情况下进行认证。

**为什么是这个优先级**：大量开发者使用远程服务器（SSH、容器、devbox），localhost 回调无法到达 CLI。没有这个功能，`/login` 对他们来说无法使用。

**独立测试**：SSH 到远程服务器，设置 `WAVE_SERVER_URL`，运行 Wave，输入 `/login`，在本地浏览器中打开 URL，完成 SSO，从浏览器 URL 栏复制 token，粘贴到终端。

**验收场景**：

1. **假设** Wave 在远程服务器上运行，**当**用户输入 `/login` 时，**则** Wave 显示 SSO 认证 URL 并提示"Paste the authorization code from your browser URL bar:"。
2. **假设**用户粘贴有效的授权码并按 Enter，**则** Wave 通过 `POST /api/auth/token` 使用 `{ grant_type: "authorization_code", code }` 交换 code 获取 JWT，将 token 和 refresh token 保存到 `~/.wave/auth.json`，并显示"Login successful"。
3. **假设**用户粘贴空行，**则** Wave 清除输入并继续等待 token 输入。
4. **假设**用户在 token 输入期间按 Escape，**则**登录流程被取消，Wave 返回空闲状态。

---

### 用户故事 3 - 自动 SSO API 路由（优先级：P1）

作为已通过 SSO 认证的开发者，我希望所有 LLM API 请求自动使用 Wave AI 代理，这样就不必配置 `WAVE_API_KEY` 或 `WAVE_BASE_URL`。

**为什么是这个优先级**：这是核心价值主张——SSO 认证应透明地通过 Wave AI 路由 API 流量而无需额外配置。

**独立测试**：通过 SSO 登录，发送消息，验证 API 请求发送到 `WAVE_SERVER_URL/api/v1/chat/completions`，使用 Bearer SSO token。

**验收场景**：

1. **假设** `~/.wave/auth.json` 包含有效的 `SSO_TOKEN`，**当** Agent 解析网关配置时，**则**它返回 `{ apiKey: SSO_TOKEN, baseURL: "${WAVE_SERVER_URL}/api/v1" }`，无论 `WAVE_API_KEY` 或 `WAVE_BASE_URL` 设置。
2. **假设**不存在 `SSO_TOKEN`，**当** Agent 解析网关配置时，**则**它回退到现有行为（读取 `WAVE_API_KEY`/`WAVE_BASE_URL`）。
3. **假设** `SSO_TOKEN` 存在但 `WAVE_SERVER_URL` 未设置，**当**解析网关配置时，**则**抛出配置错误并附带清晰消息。

---

### 边界情况

- **如果 SSO 回调服务器端口已被占用会怎样？** 服务器使用 `localhost:0`（系统分配的随机端口），避免端口冲突。
- **如果 Wave AI 上没有配置 SSO 提供程序会怎样？** 登录失败并显示清晰的错误消息（"No SSO providers available"）。
- **如果登录时 `WAVE_SERVER_URL` 未设置会怎样？** 登录失败并显示清晰的错误，指示用户设置环境变量。
- **如果浏览器无法打开（无头服务器）会怎样？** 认证服务器保持活动，用户可以手动打开 URL 并粘贴授权码。
- **如果用户将来在 `auth.json` 中保存额外字段会怎样？** `saveAuth` 方法与现有配置合并，保留非 SSO_TOKEN 字段。
- **如果 token 过期（JWT 默认 8 小时）会怎样？** 系统在过期前 5 分钟使用存储的 refresh token 主动刷新 token。如果 refresh token 被撤销（400/401），认证被清除，用户必须重新运行 `/login`。在刷新期间的瞬时网络错误中，保留现有 token，重试在下次请求时进行。
- **如果 SSO 登录超时（5 分钟）会怎样？** 认证服务器关闭并显示错误。用户可以重试 `/login`。

## 需求 *（必填）*

### 功能需求

- **FR-001**：系统必须在 CLI 中提供 `/login` 和 `/logout` 斜杠命令。
- **FR-002**：系统必须在 `127.0.0.1` 上使用随机端口启动本地 HTTP 服务器以接收 SSO 回调。
- **FR-002a**：系统必须从回调 URL 中提取 `code` 查询参数，并通过 `POST /api/auth/token` 使用 `{ grant_type: "authorization_code", code }` 交换 JWT。
- **FR-003**：系统必须从 `WAVE_SERVER_URL/api/auth/sso-providers` 获取可用的 SSO 提供程序并使用第一个提供程序。
- **FR-004**：当浏览器可用时，系统必须在默认浏览器中打开 SSO 登录 URL。
- **FR-005**：当浏览器回调不可用时（远程服务器），系统必须接受通过 CLI 手动输入授权码，并交换 JWT。
- **FR-006**：系统必须将 SSO token 保存到 `~/.wave/auth.json`，文件权限为 `0o600`。
- **FR-007**：保存时系统必须保留 `auth.json` 中的非 SSO_TOKEN 字段（合并，而非覆盖）。
- **FR-008**：解析网关配置时，系统必须将 SSO 模式优先于直接 LLM 模式。
- **FR-009**：在 SSO 模式下，系统必须将 LLM API 请求路由到 `${WAVE_SERVER_URL}/api/v1`。
- **FR-010**：系统不得在日志、错误消息或 UI 中暴露 SSO token（仅显示截断的前缀/后缀）。
- **FR-011**：收到 token 或超时后，系统必须关闭 localhost 回调服务器。
- **FR-012**：系统必须在 5 分钟后超时登录流程并显示清晰的错误消息。
- **FR-013**：系统必须允许用户随时按 Escape 取消登录流程。
- **FR-014**：系统必须使用 `execFile`（而非 `exec`）打开浏览器以防止命令注入。
- **FR-015**：SSO 模式和直接 LLM 模式必须共存——移除 SSO token 恢复直接 LLM 行为。
- **FR-016**：当 SSO token 距过期不足 5 分钟时，系统必须使用存储的 refresh token 通过 `POST /api/auth/token` 使用 `{ grant_type: "refresh_token", refresh_token }` 主动刷新。
- **FR-017**：系统必须通过尝试 token 刷新并重试请求一次来响应式恢复 401/403 API 错误。
- **FR-018**：系统必须去重并发 token 刷新调用，使只发出一个网络请求。
- **FR-019**：系统必须检测磁盘上其他进程已刷新 token（通过文件 mtime），并使用新鲜 token 而不是进行冗余刷新请求。
- **FR-020**：当 refresh token 被撤销（400/401 响应）时，系统必须清除认证（注销），但在刷新期间的瞬时网络错误时保留认证。
- **FR-021**：系统必须将没有 `SSO_TOKEN_EXPIRES_AT` 的 token 视为永不过期（向后兼容）。
- **FR-022**：系统必须使用 `POST /api/auth/token` 和 `{ grant_type: "authorization_code", code }` 进行初始 code 交换（替代 `POST /api/auth/exchange`）。
- **FR-023**：系统必须将 `SSO_REFRESH_TOKEN` 和 `SSO_TOKEN_EXPIRES_AT` 与 `SSO_TOKEN` 一起保存在 `~/.wave/auth.json` 中，并在注销时删除它们。
- **FR-024**：系统必须在 SSO 模式下使用 `createAuthAwareFetch` 包装 fetch，以透明地处理所有 API 调用的 token 刷新。
- **FR-025**：系统必须在 token 刷新操作期间记录 info 级别的 `[Auth]` 消息（主动刷新、响应式 401 恢复、基于 mtime 的去重）用于审计和调试。
- **FR-026**：即使 `resolveGatewayConfig()` 在没有显式 `fetch` 参数的情况下被调用，当 SSO 模式活跃时系统必须始终创建 `authAwareFetch` 包装器。
- **FR-027**：`AuthService.login()` 必须接受可选的 `serverUrl` 参数，优先级为：`login({serverUrl})` → `authService._serverUrl` → `WAVE_SERVER_URL` 环境变量。

### 关键实体

- **AuthService**：管理 SSO 认证生命周期的单例服务（登录、注销、token 存储、token 刷新、认证感知 fetch）。在 `login()` 中接受可选的 `serverUrl` 参数并带有优先级链。
- **AuthConfig**：存储在 `~/.wave/auth.json` 中的配置对象，包含 `SSO_TOKEN`、`SSO_REFRESH_TOKEN`、`SSO_TOKEN_EXPIRES_AT` 和 `user`。
- **LoginCommand**：`/login` 斜杠命令的 Ink UI 组件，处理浏览器和手动输入流程。
- **GatewayConfig（SSO 模式）**：解析的配置，其中 `apiKey` 是 SSO token，`baseURL` 是 `${WAVE_SERVER_URL}/api/v1`，`fetch` 使用 `createAuthAwareFetch` 包装。
- **TokenResponse**：来自 `POST /api/auth/token` 的响应，包含 `token`、`refreshToken?`、`expiresIn?` 和 `user`。
