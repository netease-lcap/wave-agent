# Implementation Plan: WebFetch Tool

**Branch**: `017-web-fetch-tool` | **Status**: Completed | **Date**: 2026-03-31 | **Updated**: 2026-04-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/017-web-fetch-tool/spec.md`

## Summary

Implement a `WebFetch` tool that allows users to fetch web content, convert it to Markdown, and process it with a fast AI model. This involves adding `turndown` as a dependency, creating a new `WebFetchToolPlugin` in `agent-sdk`, and registering it in the `ToolManager`. The tool will handle HTTP to HTTPS upgrades, redirects to different hosts, and caching of Markdown content for 15 minutes. It will also suggest using the `gh` CLI for GitHub URLs. To optimize performance and stability, a specialized `processWebContent` function is implemented in `aiService` to handle the AI processing without the overhead of the full `callAgent` infrastructure.

**Improvement Phase (2026-04-21)**: Added URL validation (max length, credentials, localhost blocking), security limits (10MB content, 60s timeout, 10 redirect max), automatic same-host/www-variation redirect following, LRU cache upgrade (50MB limit, no manual cleanup), honest User-Agent header, Accept header, content truncation at 100K chars, and enriched output with HTTP status/size info.

## Technical Context

**Language/Version**: TypeScript (Node.js)
**Primary Dependencies**: `turndown` (for HTML to Markdown conversion), `lru-cache` (for LRU caching), Node.js built-in `fetch`
**Storage**: `lru-cache` instance for caching Markdown content with 15min TTL and 50MB size limit
**Testing**: Vitest (Unit tests for the tool logic)
**Target Platform**: Linux/macOS/Windows (Node.js environment)
**Project Type**: Monorepo (agent-sdk + code)
**Performance Goals**: Fast content extraction and processing (< 2s for typical pages)
**Constraints**: Must handle redirects and host changes as specified. Must enforce security limits (URL length, content size, timeout).

## Constitution Check

1. **Package-First Architecture**: Logic implemented in `agent-sdk` as a tool plugin. Pass.
2. **TypeScript Excellence**: Strict typing for tool parameters and results. Pass.
3. **Test Alignment**: Mandatory unit tests for `WebFetchToolPlugin`. Pass.
4. **Build Dependencies**: `agent-sdk` must be built before use. Pass.
5. **Documentation Minimalism**: Only necessary spec/plan/research/data-model/quickstart files. Pass.
6. **Quality Gates**: `type-check` and `lint` required. Pass.
7. **Source Code Structure**: `webFetchTool.ts` in `packages/agent-sdk/src/tools/`. Pass.
8. **Data Model Minimalism**: Simple `WebFetchCache` entity with richer metadata. Pass.

## Project Structure

### Documentation (this feature)

```
specs/017-web-fetch-tool/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```
packages/
├── agent-sdk/
│   ├── src/
│   │   ├── constants/
│   │   │   └── tools.ts
│   │   ├── managers/
│   │   │   └── toolManager.ts
│   │   ├── tools/
│   │   │   ├── types.ts
│   │   │   └── webFetchTool.ts
│   └── tests/
│       └── tools/
│           └── webFetchTool.test.ts
```

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| lru-cache dependency | 50MB size limit + automatic eviction | Map + setInterval lacks size-based eviction and is error-prone |
| AbortController for timeout | Prevents indefinite hangs on slow servers | Native fetch timeout requires AbortController |
| Recursive redirect following | Reduces unnecessary tool calls for same-host redirects | Returning every redirect forces manual re-fetches |
| Content truncation at 100K chars | Prevents "Prompt is too long" errors | No truncation would cause AI API failures on large pages |
