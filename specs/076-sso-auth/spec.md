# Feature Specification: SSO Authentication

**Feature Branch**: `076-sso-auth`
**Created**: 2026-05-12
**Input**: "Add /login slash command for SSO authentication via Wave AI, supporting browser-based SSO flow, token storage, and automatic API proxy routing."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - SSO Login via Browser (Priority: P1)

As a developer working on a local machine, I want to type `/login` in Wave to authenticate via my company SSO so I don't have to manually configure API keys.

**Why this priority**: This is the primary authentication flow — most users will have a browser available on their local machine.

**Independent Test**: Set `WAVE_AI_URL`, run Wave, type `/login`, browser opens, complete SSO login, verify token saved and API requests succeed.

**Acceptance Scenarios**:

1. **Given** `WAVE_AI_URL` is set and no existing SSO token, **When** the user types `/login`, **Then** Wave opens a browser to the SSO login page and displays the auth URL in the terminal.
2. **Given** the user completes SSO login in their browser, **When** the browser redirects to the localhost callback URL with `?code={code}`, **Then** Wave exchanges the code for a JWT via `POST /api/auth/exchange`, saves the token to `~/.wave/auth.json`, and displays "Login successful".
3. **Given** the user is authenticated via SSO, **When** the user sends a message, **Then** all LLM API requests are sent to `WAVE_AI_URL/api/v1` with the SSO token as Bearer auth.
4. **Given** the user is already authenticated via SSO, **When** the user types `/login`, **Then** Wave shows current auth status (truncated token, AI URL) and offers to logout on Enter.
5. **Given** the user is authenticated and presses Enter while in the login UI, **When** they confirm logout, **Then** the SSO token is removed from `~/.wave/auth.json` and Wave displays "Logged out successfully".

---

### User Story 2 - Manual Token Input for Remote Servers (Priority: P1)

As a developer working on a remote server via SSH, I want to manually paste the SSO token after completing login in my local browser so I can authenticate without localhost callback forwarding.

**Why this priority**: A significant number of developers use remote servers (SSH, containers, devboxes) where localhost callback cannot reach the CLI. Without this, `/login` is broken for them.

**Independent Test**: SSH to a remote server, set `WAVE_AI_URL`, run Wave, type `/login`, open URL in local browser, complete SSO, copy token from browser URL bar, paste into terminal.

**Acceptance Scenarios**:

1. **Given** Wave is running on a remote server, **When** the user types `/login`, **Then** Wave displays the SSO auth URL and prompts "Paste the authorization code from your browser URL bar:".
2. **Given** the user pastes a valid authorization code and presses Enter, **Then** Wave exchanges the code for a JWT via `POST /api/auth/exchange`, saves the token to `~/.wave/auth.json`, and displays "Login successful".
3. **Given** the user pastes an empty line, **Then** Wave clears the input and keeps waiting for token input.
4. **Given** the user presses Escape during token input, **Then** the login flow is cancelled and Wave returns to the idle state.

---

### User Story 3 - Automatic SSO API Routing (Priority: P1)

As a developer who has authenticated via SSO, I want all LLM API requests to automatically use the Wave AI proxy so I don't need to configure `WAVE_API_KEY` or `WAVE_BASE_URL`.

**Why this priority**: This is the core value proposition — SSO authentication should transparently route API traffic through Wave AI without additional configuration.

**Independent Test**: Login via SSO, send a message, verify API request goes to `WAVE_AI_URL/api/v1/chat/completions` with Bearer SSO token.

**Acceptance Scenarios**:

1. **Given** `~/.wave/auth.json` contains a valid `SSO_TOKEN`, **When** the Agent resolves gateway configuration, **Then** it returns `{ apiKey: SSO_TOKEN, baseURL: "${WAVE_AI_URL}/api/v1" }` regardless of `WAVE_API_KEY` or `WAVE_BASE_URL` settings.
2. **Given** no `SSO_TOKEN` exists, **When** the Agent resolves gateway configuration, **Then** it falls back to the existing behavior (reading `WAVE_API_KEY`/`WAVE_BASE_URL`).
3. **Given** `SSO_TOKEN` exists but `WAVE_AI_URL` is unset, **When** gateway config is resolved, **Then** a configuration error is thrown with a clear message.

---

### Edge Cases

- **What happens if the SSO callback server port is already in use?** The server uses `localhost:0` (system-assigned random port), avoiding port collision.
- **What happens if no SSO providers are configured on Wave AI?** The login fails with a clear error message ("No SSO providers available").
- **What happens if `WAVE_AI_URL` is not set during login?** The login fails with a clear error instructing the user to set the environment variable.
- **What happens if the browser cannot be opened (headless server)?** The auth server stays alive, and the user can manually open the URL and paste the authorization code.
- **What happens if the user saves additional fields in `auth.json` in the future?** The `saveAuth` method merges with existing config, preserving non-SSO_TOKEN fields.
- **What happens if the token expires (JWT default 8h)?** The API call returns 401; the user must re-run `/login`. Token refresh is out of scope (requires Wave AI changes).
- **What happens if the SSO login times out (5 min)?** The auth server closes and an error is displayed. The user can retry `/login`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide `/login` and `/logout` slash commands in the CLI.
- **FR-002**: System MUST start a local HTTP server on `127.0.0.1` with a random port to receive SSO callbacks.
- **FR-002a**: System MUST extract the `code` query parameter from the callback URL and exchange it for a JWT via `POST /api/auth/exchange`.
- **FR-003**: System MUST fetch available SSO providers from `WAVE_AI_URL/api/auth/sso-providers` and use the first provider.
- **FR-004**: System MUST open the SSO login URL in the default browser when available.
- **FR-005**: System MUST accept manual authorization code input via the CLI when browser callback is unavailable (remote servers), and exchange it for a JWT.
- **FR-006**: System MUST save the SSO token to `~/.wave/auth.json` with file permissions `0o600`.
- **FR-007**: System MUST preserve non-SSO_TOKEN fields in `auth.json` when saving (merge, not overwrite).
- **FR-008**: System MUST prioritize SSO mode over direct LLM mode when resolving gateway configuration.
- **FR-009**: System MUST route LLM API requests to `${WAVE_AI_URL}/api/v1` when in SSO mode.
- **FR-010**: System MUST NOT expose the SSO token in logs, error messages, or UI (only show truncated prefix/suffix).
- **FR-011**: System MUST close the localhost callback server after receiving a token or timing out.
- **FR-012**: System MUST timeout the login flow after 5 minutes with a clear error message.
- **FR-013**: System MUST allow the user to cancel the login flow at any time by pressing Escape.
- **FR-014**: System MUST use `execFile` (not `exec`) for browser opening to prevent command injection.
- **FR-015**: SSO mode and direct LLM mode MUST coexist — removing the SSO token restores direct LLM behavior.

### Key Entities

- **AuthService**: Singleton service managing SSO authentication lifecycle (login, logout, token storage).
- **AuthConfig**: Configuration object stored in `~/.wave/auth.json` containing `SSO_TOKEN`.
- **LoginCommand**: Ink UI component for the `/login` slash command, handling both browser and manual input flows.
- **GatewayConfig (SSO mode)**: Resolved configuration where `apiKey` is the SSO token and `baseURL` is `${WAVE_AI_URL}/api/v1`.
