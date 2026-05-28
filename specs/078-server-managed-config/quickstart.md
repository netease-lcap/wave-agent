# Quickstart: Server-Managed Config Download

## Overview

Wave can download managed settings from a Wave AI server when authenticated via SSO. Managed settings allow organization admins to enforce policies (tool restrictions, model selections, environment variables) without requiring each team member to manually configure their local settings.

## Prerequisites

- SSO authentication configured (see `specs/076-sso-auth/`)
- `WAVE_SERVER_URL` set to your Wave AI server

## How It Works

1. When Wave starts and the user is authenticated via SSO, it calls `GET /api/v1/managed-settings` on the Wave AI server.
2. The server returns managed settings (e.g., `disallowedTools`, `model`, `env`).
3. Wave merges these settings with local `settings.json`, where managed settings take priority.
4. On subsequent startups, Wave sends the cached checksum. If unchanged (304), cached settings are reused.

## Example: Disallowing Bash Tool

On the Wave AI server, an admin configures managed settings:

```json
{
  "disallowedTools": ["Bash"],
  "model": "gpt-4o"
}
```

When a team member starts Wave, the Bash tool is disabled and the model is set to `gpt-4o`, regardless of their local `settings.json` (because the `model` scalar field overrides local in the merge). If the admin instead uses `env.WAVE_MODEL`, the user can override it by setting `"model"` in their local `settings.json`.

## Fallback Behavior

- **Server unreachable**: Uses cached managed settings (from last successful download) or local-only settings.
- **Not authenticated**: No managed settings are downloaded; local settings only.
- **Invalid response**: Logs an error and falls back to local settings.
