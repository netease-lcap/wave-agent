# Requirements Checklist: WebFetch Tool

**Branch**: `017-web-fetch-tool` | **Status**: Completed | **Date**: 2026-03-31 | **Spec**: [spec.md](../spec.md)

## Functional Requirements

- [X] **FR-001**: System MUST provide a `WebFetch` tool.
- [X] **FR-002**: System MUST accept `url` and `prompt` as parameters.
- [X] **FR-003**: System MUST upgrade `http://` URLs to `https://`.
- [X] **FR-004**: System MUST fetch the content of the URL using a standard HTTP client.
- [X] **FR-005**: System MUST convert the fetched HTML content to Markdown.
- [X] **FR-006**: System MUST process the Markdown content with the provided prompt using a "fast" AI model.
- [X] **FR-007**: System MUST implement a 15-minute self-cleaning cache for fetched Markdown content.
- [X] **FR-008**: System MUST detect redirects to different hosts and return a `REDIRECT_TO: <url>` message.
- [X] **FR-009**: System MUST reject GitHub URLs and suggest using the `gh` CLI.
- [X] **FR-010**: System MUST handle network errors and non-200 status codes gracefully.

## Non-Functional Requirements

- [X] **NFR-001**: The tool MUST be read-only and not modify any files.
- [X] **NFR-002**: The tool MUST be fast and efficient.
- [X] **NFR-003**: The tool MUST handle large content by summarizing if necessary (handled by AI model).
- [X] **NFR-004**: The tool MUST be easy to use and provide clear error messages.
