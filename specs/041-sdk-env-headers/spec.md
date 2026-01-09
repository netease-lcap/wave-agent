# Feature Specification: SDK Env Headers Support

**Feature Branch**: `041-sdk-env-headers`  
**Created**: 2026-01-09  
**Status**: Draft  
**Input**: User description: "sdk should support setting headers from env"

## Clarifications

### Session 2026-01-09
- Q: Should the mandatory apiKey validation be removed since users might use custom headers for auth? → A: Remove mandatory apiKey validation entirely.
- Q: What should the SDK do if no authentication is provided (neither apiKey nor custom headers)? → A: Proceed and let the server handle missing auth (401/403).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure SDK Headers via Environment Variables (Priority: P1)

As a developer, I want to configure HTTP headers for the SDK using environment variables so that I can manage sensitive information (like API keys) or environment-specific metadata without changing the application code.

**Why this priority**: This is the core requirement. It enables better security practices and easier configuration across different environments (dev, staging, prod).

**Independent Test**: Can be tested by setting the environment variable `WAVE_CUSTOM_HEADERS` with newline-separated headers (e.g., `X-Custom-Id: 123\nUser-Agent: MyAgent`), initializing the SDK, and verifying that the outgoing requests include these headers.

**Acceptance Scenarios**:

1. **Given** `WAVE_CUSTOM_HEADERS` is set to `X-Test-Header: value123`, **When** the SDK makes any request, **Then** the request MUST include the header `X-Test-Header: value123`.
2. **Given** `WAVE_CUSTOM_HEADERS` contains multiple lines like `Header1: Val1\nHeader2: Val2`, **When** the SDK makes a request, **Then** all corresponding headers MUST be included.

---

### User Story 2 - Multi-line Header Support (Priority: P2)

As a developer, I want to provide multiple headers in a single environment variable using newlines as separators, so that I can easily manage a set of headers in environments that might limit the number of environment variables.

**Why this priority**: This matches the requested implementation pattern and provides a clean way to group related configurations.

**Independent Test**: Set `WAVE_CUSTOM_HEADERS` to `A: 1\nB: 2` and verify both headers are sent.

**Acceptance Scenarios**:

1. **Given** `WAVE_CUSTOM_HEADERS` uses `\n` or `\r\n` as separators, **When** the SDK processes it, **Then** it MUST correctly parse each line as a separate header.

---

### Edge Cases

- **What happens when a line in the environment variable is malformed?** (e.g., missing a colon). It should be ignored or logged as a warning. Default: Ignore malformed lines.
- **How does the system handle conflicts between env headers and explicitly set headers?** Explicitly set headers in code should take precedence.
- **What if the environment variable is empty?** No additional headers should be added.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: SDK MUST read the environment variable `WAVE_CUSTOM_HEADERS`.
- **FR-002**: SDK MUST split the value of `WAVE_CUSTOM_HEADERS` by newlines (`\n` or `\r\n`).
- **FR-003**: SDK MUST parse each non-empty line as an HTTP header in `Key: Value` format.
- **FR-004**: SDK MUST include these headers in all outgoing HTTP requests made by the agent.
- **FR-005**: Explicitly configured headers in the SDK constructor or request options MUST take precedence over environment-provided headers.
- **FR-006**: SDK MUST ignore malformed lines that do not follow the `Key: Value` format.
- **FR-007**: SDK MUST NOT enforce the presence of an `apiKey` during initialization, allowing for alternative authentication methods via custom headers.
- **FR-008**: SDK MUST NOT perform client-side validation for the presence of authentication headers; it MUST proceed with the request and allow the server to handle missing or invalid credentials.

### Key Entities *(include if feature involves data)*

- **Environment Variable**: A system-level key-value pair used for configuration.
- **HTTP Header**: A metadata field sent with HTTP requests.

## Tasks

- [x] Support `WAVE_CUSTOM_HEADERS` environment variable.
- [x] Parse multi-line headers in `Key: Value` format.
- [x] Merge environment headers with constructor headers (constructor takes precedence).
- [x] Support headers from `settings.json` (via `env` property).
- [x] Remove mandatory apiKey validation and allow alternative auth.
- [x] Replace OpenAI SDK with custom fetch-based implementation to skip internal apiKey validation.
- [x] Comprehensive unit and integration tests.

## Success Criteria

- **SC-001**: Headers defined in `WAVE_CUSTOM_HEADERS` are correctly included in outgoing requests.
- **SC-002**: Multiple headers separated by newlines in `WAVE_CUSTOM_HEADERS` are all correctly processed.
- **SC-003**: Malformed lines in the environment variable do not cause the SDK to crash and are gracefully ignored.
- **SC-004**: Explicitly set headers in code always override environment-provided headers.

## Assumptions

- The environment variable name is `WAVE_CUSTOM_HEADERS`.
- Headers in the variable are separated by `\n` or `\r\n`.
- Each line follows the standard `Key: Value` format.
