# Requirements Checklist: SSO Authentication

## Functional Requirements

- [x] **FR-001**: `/login` and `/logout` slash commands available in CLI
- [x] **FR-002**: Local HTTP server on `127.0.0.1` with random port for SSO callbacks
- [x] **FR-002a**: Extracts `code` from callback URL and exchanges via `POST /api/auth/exchange`
- [x] **FR-003**: Fetches SSO providers from `WAVE_ADMIN_URL/api/auth/sso-providers`
- [x] **FR-004**: Opens SSO login URL in default browser (`open`/`xdg-open`/`start`)
- [x] **FR-005**: Accepts manual authorization code input via Ink `useInput` for remote servers, exchanges for JWT
- [x] **FR-006**: Saves SSO token to `~/.wave/auth.json` with `0o600` permissions
- [x] **FR-007**: Merges existing config on save (preserves non-SSO_TOKEN fields)
- [x] **FR-008**: SSO mode prioritized over direct LLM mode in gateway config resolution
- [x] **FR-009**: Routes LLM API to `${WAVE_ADMIN_URL}/api/v1` in SSO mode
- [x] **FR-010**: Token not exposed in logs/errors/UI (only truncated display)
- [x] **FR-011**: Callback server closes after token received or timeout
- [x] **FR-012**: 5-minute timeout with clear error message
- [x] **FR-013**: Escape cancels login flow at any time
- [x] **FR-014**: `execFile` used for browser opening (prevents command injection)
- [x] **FR-015**: Removing SSO token restores direct LLM behavior
