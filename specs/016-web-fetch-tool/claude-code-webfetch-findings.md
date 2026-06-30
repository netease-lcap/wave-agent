# Claude Code WebFetch Tool — Research Findings

**Source**: `claude-code/src/tools/WebFetchTool/`  
**Date**: 2026-04-21

## File Structure

| File | Purpose |
|------|---------|
| `WebFetchTool.ts` | Main tool definition (schema, permissions, call logic) |
| `utils.ts` | Core logic: fetching, caching, HTML→MD, AI processing |
| `prompt.ts` | Tool description + secondary model prompt builder |
| `preapproved.ts` | Preapproved domain list (essential docs sites) |
| `UI.tsx` | React Ink UI rendering for tool messages/progress |

## Architecture Overview

### Input/Output Schema

```typescript
// Input
{ url: string (URL), prompt: string }

// Output
{ bytes: number, code: number, codeText: string, result: string, durationMs: number, url: string }
```

### Fetch Flow

1. **Validate URL** — max 2000 chars, no username/password, hostname must have ≥2 parts (blocks localhost)
2. **Check URL cache** (LRU, 15min TTL, 50MB max)
3. **Upgrade http → https**
4. **Preflight domain check** — calls `api.anthropic.com/api/web/domain_info?domain=...` to verify domain is safe (can be skipped via `skipWebFetchPreflight` setting for enterprise)
5. **Fetch with permitted redirects** — custom redirect handling (max 10 hops, follows only same-host/www-variations)
6. **Handle content**:
   - HTML → Turndown → Markdown
   - Binary (PDFs etc.) → save to disk + fall-through text decode for Haiku summary
   - Other text → use raw
7. **Apply prompt via Haiku** — small fast model processes markdown + prompt
8. **Cache and return**

## Key Design Decisions

### 1. Permission System

WebFetch integrates with Claude Code's permission framework:
- **Preapproved hosts** auto-allow (docs sites like react.dev, docs.python.org, etc.)
- Permission rules can be set per-host (`domain:example.com`)
- Default behavior: **ask** user for permission
- Supports `allow`/`deny`/`ask` rule types with suggestions to persist to local settings

### 2. Domain Blocklist (Preflight Check)

Before fetching, calls Anthropic's API to check if a domain is safe. This is a security layer against malicious/problematic domains. Response: `{ can_fetch: boolean }`.

- Separate cache (`DOMAIN_CHECK_CACHE`) for hostname-level checks, 5min TTL, max 128 entries
- Only caches `allowed` results — blocked/failed re-check next time
- Can be disabled via `settings.skipWebFetchPreflight` for enterprise environments

### 3. Redirect Handling

Custom redirect handling with `maxRedirects: 0` (disables axios auto-redirect):
- Catches 301/302/307/308 responses manually
- `isPermittedRedirect()` allows:
  - Same host, different path/query
  - Adding/removing `www.` prefix
- Non-permitted redirects return `REDIRECT DETECTED` message to user with instructions to re-fetch the redirect URL
- Max 10 redirect hops (prevents redirect loops)

### 4. Caching Strategy

Two-tier LRU cache:
- **URL_CACHE**: Full content, keyed by URL, 15min TTL, 50MB size limit
- **DOMAIN_CHECK_CACHE**: Domain allow status, keyed by hostname, 5min TTL, 128 entries

Cache stores: `{ bytes, code, codeText, content, contentType, persistedPath?, persistedSize? }`

### 5. AI Processing (Haiku/Secondary Model)

- Uses `queryHaiku()` — a small, fast model
- Content truncated to 100,000 chars max
- Different guidelines for preapproved vs non-preapproved domains:
  - **Preapproved**: Concise response, can include code examples
  - **Non-preapproved**: Strict 125-char quote limit, quotation marks required, legal/copyright safeguards
- Empty response → returns "No response from model"

### 6. Binary Content Handling

Binary files (PDFs, etc.) are:
- Saved to disk with MIME-derived extension via `persistBinaryContent()`
- Still decoded to UTF-8 string for Haiku to summarize (PDFs have enough ASCII structure)
- File path noted in result so user can inspect raw file

### 7. Security Measures

- **Max URL length**: 2000 chars
- **Max content length**: 10MB (`MAX_HTTP_CONTENT_LENGTH`)
- **Fetch timeout**: 60 seconds
- **Domain check timeout**: 10 seconds
- **Max redirects**: 10
- **Blocks URLs with username/password**
- **Blocks localhost/internal hostnames** (< 2 hostname parts)
- **Egress proxy detection**: Detects `X-Proxy-Error: blocked-by-allowlist` header
- **AbortSignal support**: Cancellable via abort controller

### 8. User Agent

```
Claude-User (claude-code/<version>; +https://support.anthropic.com/)
```
Uses `Claude-User` agent — Anthropic's documented agent identity for user-initiated fetches, matching what site operators expect in robots.txt.

### 9. Turndown Lazy Loading

Turndown service is lazily initialized (lazy singleton) to avoid loading ~1.4MB retained heap until first HTML fetch. Single instance reused across calls.

### 10. Memory Management

- Releases ArrayBuffer reference after converting to Buffer (GC can reclaim up to 10MB before Turndown builds DOM tree)
- Content truncated before AI processing to avoid "Prompt is too long" errors

## Differences from Our Implementation

| Feature | Claude Code | Our Current |
|---------|------------|-------------|
| HTTP client | axios | Node.js native fetch |
| Permission system | Full permission framework with rules | None |
| Domain blocklist | Anthropic API preflight check | None |
| Preapproved domains | ~80 essential doc sites | None (GitHub rejection only) |
| Redirect handling | Custom, follows same-host only | Manual redirect, rejects cross-host |
| Binary content | Saves to disk + Haiku summary | Not handled |
| Max content | 10MB | Not specified |
| Max URL | 2000 chars | Not specified |
| Fetch timeout | 60s | Not specified |
| User Agent | Custom `Claude-User` | Default |
| Output schema | Structured (bytes, code, codeText, result, durationMs, url) | Simple (success, content, error, shortResult) |
| Progress message | "Fetching…" | None |
| Abort support | AbortSignal | None |
| Cache size limit | 50MB | TTL only |

## Notable Implementation Details

### `getWithPermittedRedirects()` (utils.ts:262)
Recursive function with custom redirect handling. Catches 301/302/307/308, checks if redirect is permitted, follows recursively or returns redirect info. Also detects egress proxy blocks.

### `makeSecondaryModelPrompt()` (prompt.ts:23)
Builds prompt for secondary model with content + user prompt + guidelines. Differentiates between preapproved and non-preapproved domains for legal/compliance reasons.

### Tool UI (UI.tsx)
- Verbose mode shows full URL + prompt
- Non-verbose shows just URL
- Progress shows dimmed "Fetching…"
- Result shows file size + HTTP status code
