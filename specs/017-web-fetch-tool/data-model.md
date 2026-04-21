# Data Model: WebFetch Tool

**Branch**: `017-web-fetch-tool` | **Status**: Completed | **Date**: 2026-03-31 | **Updated**: 2026-04-21 | **Spec**: [spec.md](./spec.md)

## Summary

The `WebFetch` tool uses an LRU cache to store the Markdown content and metadata of fetched URLs. This cache is implemented using `lru-cache` with a TTL of 15 minutes and a 50MB max size limit.

## Entities

### WebFetchCache

- **url**: The URL of the fetched content (string, key).
- **content**: The Markdown content of the page (string). Truncated to 100,000 chars if exceeding.
- **bytes**: The size of the content in bytes (number).
- **code**: The HTTP status code (number).
- **codeText**: The HTTP status text (string, e.g., "OK").
- **contentType**: The MIME type of the response (string).

### Cache Configuration

- **TTL**: 15 minutes (automatic expiration via `lru-cache`).
- **Max Size**: 50MB (automatic eviction of least-recently-used entries).
- **Size Calculation**: Based on `bytes` field of each cache entry.

## Relationships

- **WebFetchCache** is a collection of cached entries indexed by URL, each containing metadata about the original fetch.

## Data Flow

1. **Validate URL**: Check URL length, credentials, hostname parts.
2. **Fetch**: The tool checks the LRU cache for the requested URL.
3. **Network Request**: If the URL is not in the cache, the tool makes a network request (with 60s timeout) to fetch the HTML content, following same-host redirects automatically (max 10 hops).
4. **Conversion**: The HTML content is converted to Markdown using the `turndown` library.
5. **Truncation**: If Markdown exceeds 100,000 characters, it is truncated.
6. **Cache Update**: The entry `{ bytes, code, codeText, content, contentType }` is stored in the LRU cache.
7. **AI Processing**: The Markdown content is processed with the user-provided prompt using a fast AI model.
8. **Response**: The tool returns the AI model's response with enriched metadata (status code, content size).

## Constitution Check

1. **Package-First Architecture**: The data model is implemented in `agent-sdk`.
2. **TypeScript Excellence**: The cache is strictly typed with `CacheEntry` interface.
3. **Test Alignment**: The cache logic is tested as part of the tool's unit tests.
4. **Build Dependencies**: `agent-sdk` must be built before use.
5. **Documentation Minimalism**: Only necessary documentation files are created.
6. **Quality Gates**: `type-check` and `lint` are required.
7. **Source Code Structure**: The cache is implemented within the `webFetchTool.ts` file.
8. **Data Model Minimalism**: An LRU cache with structured entries is used.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| lru-cache | Automatic size-based eviction + TTL | Map + setInterval lacks size-based eviction |
| Rich cache entries | Enables enriched output (status, size) without re-fetching | Storing only content loses diagnostic info |
