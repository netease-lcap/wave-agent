# Contract: WebFetch Tool

**Branch**: `017-web-fetch-tool` | **Status**: Completed | **Date**: 2026-03-31 | **Updated**: 2026-04-21 | **Spec**: [spec.md](./spec.md)

## Summary

The `WebFetch` tool is a plugin for the `wave-agent` that allows the AI agent to fetch and analyze web content. It is a read-only tool that converts HTML to Markdown and processes it with a fast AI model.

## Tool Definition

### Name

`WebFetch`

### Parameters

- **url**: The URL to fetch content from (string, required, format: uri). Max 2000 characters. Must not contain username/password. Hostname must have at least 2 parts.
- **prompt**: The prompt to run on the fetched content (string, required).

### Result

- **success**: Boolean indicating if the tool execution was successful.
- **content**: The AI model's response about the content.
- **error**: Optional error message if the tool execution failed.
- **shortResult**: Optional short result for summary display (e.g., `Received 2.3KB (200 OK) from https://example.com`).

## Behavior

1. **Validate URL**: URL length, credentials, hostname parts are validated. Invalid URLs return an error.
2. **HTTP Upgrade**: `http://` URLs are upgraded to `https://`.
3. **GitHub Check**: URLs containing `github.com` are rejected with a suggestion to use `gh` CLI.
4. **Cache Lookup**: The tool checks the LRU cache (15min TTL, 50MB max) for the requested URL.
5. **Network Request**: If not cached, fetches with a 60-second timeout. Content exceeding 10MB is rejected.
6. **Redirect Handling**: Same-host and `www.`-variation redirects are followed automatically (max 10 hops). Cross-host redirects return a `REDIRECT_TO:` message.
7. **Conversion**: The HTML content is converted to Markdown using the `turndown` library.
8. **Truncation**: Markdown exceeding 100,000 characters is truncated with a notice.
9. **Cache Update**: The entry `{ bytes, code, codeText, content, contentType }` is stored in the LRU cache.
10. **AI Processing**: The Markdown content is processed with the user-provided prompt using a specialized, lightweight `processWebContent` function and a fast AI model.
11. **Response**: The tool returns the AI model's response with enriched metadata.

## Error Handling

- **Invalid URL**: Returns `success: false` with a descriptive error (too long, has credentials, single-part hostname).
- **GitHub URL**: Returns `success: false` with a suggestion to use the `gh` CLI.
- **Content Too Large**: Returns `success: false` if response exceeds 10MB.
- **Too Many Redirects**: Returns `success: false` after 10 redirect hops.
- **Network Errors**: Returns `success: false` with an appropriate error message.
- **Non-200 Status Codes**: Returns `success: false` with the HTTP status.
- **Cross-Host Redirects**: Returns `success: true` with a `REDIRECT_TO: <url>` message.
- **Missing Parameters**: Returns `success: false` if `url` or `prompt` is missing.

## Security Limits

| Limit | Value |
|-------|-------|
| Max URL length | 2000 characters |
| Max content length | 10MB |
| Fetch timeout | 60 seconds |
| Max redirects | 10 hops |
| Max Markdown length | 100,000 characters (truncated) |
| Cache TTL | 15 minutes |
| Cache max size | 50MB |

## Headers

- **User-Agent**: `Wave-User (+https://github.com/netease-lcap/wave-agent)`
- **Accept**: `text/markdown, text/html, */*`
