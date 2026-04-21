# Requirements Checklist: WebFetch Tool

**Branch**: `017-web-fetch-tool` | **Status**: Completed | **Date**: 2026-03-31 | **Updated**: 2026-04-21 | **Spec**: [spec.md](../spec.md)

## Functional Requirements

- [X] **FR-001**: System MUST provide a `WebFetch` tool.
- [X] **FR-002**: System MUST accept `url` and `prompt` as parameters.
- [X] **FR-003**: System MUST upgrade `http://` URLs to `https://`.
- [X] **FR-004**: System MUST fetch the content of the URL using a standard HTTP client.
- [X] **FR-005**: System MUST convert the fetched HTML content to Markdown.
- [X] **FR-006**: System MUST process the Markdown content with the provided prompt using a "fast" AI model.
- [X] **FR-007**: System MUST implement a 15-minute LRU cache for fetched Markdown content with a 50MB size limit.
- [X] **FR-008**: System MUST detect redirects to different hosts and return a `REDIRECT_TO: <url>` message. Same-host and `www.`-variation redirects MUST be followed automatically (max 10 hops).
- [X] **FR-009**: System MUST reject GitHub URLs and suggest using the `gh` CLI.
- [X] **FR-010**: System MUST handle network errors and non-200 status codes gracefully.
- [X] **FR-011**: System MUST validate URLs: max 2000 chars, no username/password, hostname must have >=2 parts.
- [X] **FR-012**: System MUST enforce a 10MB content length limit and 60-second fetch timeout.
- [X] **FR-013**: System MUST truncate Markdown content exceeding 100,000 characters before AI processing.
- [X] **FR-014**: System MUST include an honest User-Agent header and Accept header.

## Non-Functional Requirements

- [X] **NFR-001**: The tool MUST be read-only and not modify any files.
- [X] **NFR-002**: The tool MUST be fast and efficient.
- [X] **NFR-003**: The tool MUST handle large content by truncating and summarizing if necessary.
- [X] **NFR-004**: The tool MUST provide clear error messages and diagnostic output (HTTP status code, content size).
- [X] **NFR-005**: The cache MUST use an LRU eviction strategy with automatic expiration (no manual cleanup interval).
