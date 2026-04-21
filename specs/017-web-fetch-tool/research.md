# Research: WebFetch Tool

**Branch**: `017-web-fetch-tool` | **Status**: Completed | **Date**: 2026-03-31 | **Updated**: 2026-04-21 | **Spec**: [spec.md](./spec.md)

## Summary

The `WebFetch` tool provides a simple way for the AI agent to access and analyze web content. It uses the Node.js built-in `fetch` API for network requests and the `turndown` library for HTML to Markdown conversion. The tool is read-only and does not modify any files. It includes an LRU cache with a 15-minute TTL and 50MB size limit. URL validation, security limits, automatic same-host redirect following, content truncation, honest User-Agent, and enriched output are all implemented.

## Technical Context

- **Fetch API**: Node.js 18+ includes a built-in `fetch` API that is compatible with the browser's `fetch`.
- **Turndown**: A popular library for converting HTML to Markdown. It is lightweight and easy to use.
- **LRU Cache**: `lru-cache` provides automatic size-based eviction and TTL expiration, replacing the previous Map + setInterval approach.
- **AI Processing**: The tool uses a specialized `processWebContent` function in `aiService` (similar to `compressMessages`) to process the extracted Markdown content with a user-provided prompt. This bypasses the full Agent infrastructure for better performance and stability.
- **Redirect Handling**: The tool uses `redirect: 'manual'` to detect redirects. Same-host and `www.`-variation redirects are followed recursively (max 10 hops). Cross-host redirects return a `REDIRECT_TO:` message.
- **Security Limits**: 60-second fetch timeout via AbortController, 10MB content length limit, 2000-char URL limit, 100K-char Markdown truncation.
- **URL Validation**: Rejects URLs with credentials, localhost, or single-part hostnames.
- **User-Agent**: Honest identification as `Wave-User (+https://github.com/netease-lcap/wave-agent)`.

## Constitution Check

1. **Package-First Architecture**: The tool is implemented as a plugin in `agent-sdk`.
2. **TypeScript Excellence**: The tool uses strict typing for parameters and results.
3. **Test Alignment**: Unit tests are provided for the tool's core logic.
4. **Build Dependencies**: `agent-sdk` must be built before use.
5. **Documentation Minimalism**: Only necessary documentation files are created.
6. **Quality Gates**: `type-check` and `lint` are required.
7. **Source Code Structure**: The tool is placed in the `tools` directory of `agent-sdk`.
8. **Data Model Minimalism**: An LRU cache with structured entries is used.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| lru-cache dependency | Automatic size-based eviction | Map + setInterval lacks size-based eviction |
| AbortController for timeout | Prevents indefinite hangs | No timeout could hang the tool forever |
