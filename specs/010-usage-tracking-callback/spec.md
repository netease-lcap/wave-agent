# Feature Specification: SDK Usage Tracking and Callback System

**Feature Branch**: `010-usage-tracking-callback`  
**Created**: 2025-11-11  
**Status**: Draft  
**Input**: User description: "sdk support new callback named onUsagesChange, also, agent sdk support new method to get usages. the usages come from packages/agent-sdk/src/services/aiService.ts , including call agent and compress. onUsagesChange is triggered evertytime the usages change. lastly, save usage in session as well."

## Clarifications

### Session 2025-11-11

- Q: Storage mechanism for usage data → A: Store usage data as metadata within each assistant message in the session
- Q: Callback data scope → A: Callbacks receive Usage[] array containing all session usage data
- Q: Failed operation handling → A: No usage tracking for failed operations (no AI service consumption occurred)
- Q: Callback error handling strategy → A: Log callback errors and continue normal SDK operation without interruption
- Q: Usage data format structure → A: use the openai Usage type, usages: Usage[]
- Q: Implementation approach → A: Reuse current callbacks system, add usage field in Message type, save in session file

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Real-time Usage Monitoring (Priority: P1)

SDK users need to monitor AI service usage (tokens, costs, API calls) in real-time as their application makes agent calls and message compression requests. This enables them to track costs, implement usage limits, and provide user feedback during operations.

**Why this priority**: Core functionality that provides immediate value - enables cost monitoring and user experience improvements in production applications.

**Independent Test**: Can be fully tested by registering a callback function and making a single agent call, verifying the callback receives accurate usage data and delivers immediate cost tracking value.

**Acceptance Scenarios**:

1. **Given** a developer registers an onUsagesChange callback, **When** their application makes an agent call via callAgent(), **Then** the callback is triggered with Usage[] array containing all session usage data
2. **Given** a developer registers an onUsagesChange callback, **When** their application compresses messages via compressMessages(), **Then** the callback is triggered with updated Usage[] array containing all operations
3. **Given** multiple agent calls are made in sequence, **When** each call completes, **Then** the callback receives Usage[] array with all operation usage data from the session

---

### User Story 2 - Usage Data Retrieval (Priority: P2)

SDK users need to programmatically retrieve current usage statistics at any time without waiting for callback triggers. This enables dashboard displays, periodic reporting, and integration with external monitoring systems.

**Why this priority**: Essential for applications that need on-demand usage data for reporting, but secondary to real-time notifications which provide immediate operational value.

**Independent Test**: Can be fully tested by making several agent calls, then calling the `public get usages()` method and verifying it returns accurate cumulative statistics.

**Acceptance Scenarios**:

1. **Given** several agent operations have completed, **When** developer calls `public get usages()` method, **Then** returns Usage[] array with current usage statistics and operation metadata
2. **Given** no operations have been performed, **When** developer calls `public get usages()`, **Then** returns empty Usage[] array
3. **Given** mixed agent calls and message compression operations, **When** `public get usages()` is called, **Then** returns Usage[] array with separate Usage objects for each operation type

---

### User Story 3 - Message-Level Usage Recording (Priority: P3)

SDK users need usage data embedded within assistant messages in the session so that each AI operation's cost and token consumption is traceable to specific interactions. This enables detailed conversation analytics, per-interaction billing, and historical usage review within the context of the conversation flow.

**Why this priority**: Important for detailed analytics and audit trails, but can be implemented after core real-time tracking functionality is working.

**Independent Test**: Can be fully tested by performing agent operations, then examining session messages to verify that usage metadata is properly attached to each assistant response.

**Acceptance Scenarios**:

1. **Given** an agent call operation completes, **When** examining the resulting assistant message in the session, **Then** the message contains usage metadata including tokens consumed for that specific operation
2. **Given** a message compression operation occurs, **When** the operation completes, **Then** usage data for the compression is recorded with the appropriate message context
3. **Given** multiple operations occur in a session, **When** reviewing session history, **Then** each assistant message has its own usage metadata allowing per-interaction cost tracking

---

### User Story 4 - CLI Exit Token Summary (Priority: P2)

CLI users need to see a summary of total token usage by model when the CLI application exits. This enables them to understand the cost impact of their session, track budget consumption, and make informed decisions about future usage patterns.

**Why this priority**: Provides valuable cost visibility to CLI users without requiring callback implementation, but secondary to core tracking functionality.

**Independent Test**: Can be fully tested by running CLI operations with different models, then verifying that exit summary displays accurate token totals grouped by model name.

**Acceptance Scenarios**:

1. **Given** a CLI session with agent calls using different models, **When** the CLI exits normally, **Then** console.log displays total tokens consumed by each model
2. **Given** a CLI session with mixed agent calls and compression operations, **When** the CLI exits, **Then** the summary shows separate token totals for agent model and fast model usage
3. **Given** a CLI session with no AI operations, **When** the CLI exits, **Then** no token summary is displayed or shows zero usage
4. **Given** a CLI session that exits due to error, **When** the process terminates, **Then** token summary is still displayed before exit

---

### Edge Cases

- What happens when the onUsagesChange callback throws an error or fails? (Errors are logged and SDK continues normal operation without interruption)
- How does the system handle usage tracking when API calls fail or are aborted? (No usage tracking occurs for failed operations since no AI service consumption happened)
- What occurs when session message storage is full or write-protected?
- How does usage tracking behave with concurrent agent operations?
- What happens when usage data becomes extremely large over long-running sessions?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: SDK MUST reuse existing callback system to provide onUsagesChange callback registration mechanism
- **FR-002**: SDK MUST trigger the onUsagesChange callback immediately after each callAgent() operation completes with Usage[] array containing all session usage data
- **FR-003**: SDK MUST trigger the onUsagesChange callback immediately after each compressMessages() operation completes with Usage[] array containing all session usage data  
- **FR-004**: SDK MUST provide a `public get usages()` method that returns current cumulative usage statistics on demand
- **FR-005**: SDK MUST track token usage (prompt tokens, completion tokens, total tokens) for both agent calls and compression operations
- **FR-006**: SDK MUST track operation counts separately for agent calls and compression operations
- **FR-007**: SDK MUST add usage field to Message type and embed usage data within assistant messages saved in session file after each operation
- **FR-008**: SDK MUST calculate cumulative usage statistics by aggregating usage data from all assistant messages in the current session
- **FR-009**: SDK MUST handle callback errors gracefully by logging errors and continuing normal operations without interruption
- **FR-010**: SDK MUST provide usage data using OpenAI Usage type format as Usage[] array consistently across callbacks and `public get usages()` method
- **FR-011**: SDK MUST continue normal operation even when message metadata embedding fails
- **FR-012**: SDK MUST NOT track usage data for failed operations where no AI service consumption occurred
- **FR-013**: CLI MUST display total token usage by model name when exiting, showing prompt tokens, completion tokens and total tokens for each model used during the session
- **FR-014**: CLI MUST calculate token summary from session usage data and display it via console.log before process termination
- **FR-015**: CLI MUST handle exit token summary gracefully, continuing normal exit process even if summary generation fails

### Key Entities *(include if feature involves data)*

- **Usage Statistics**: Array of OpenAI Usage objects representing both per-operation usage data (embedded in messages) and cumulative session usage, including token counts (prompt_tokens, completion_tokens, total_tokens)
- **Usage Callback**: Function interface that receives usage statistics as Usage[] array whenever operations complete
- **Message Usage Metadata**: Per-operation OpenAI Usage data embedded within assistant messages in the session

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Developers can register usage callbacks and receive real-time usage updates within 100ms of operation completion
- **SC-002**: SDK supports concurrent operations while maintaining accurate cumulative usage statistics without data corruption
- **SC-003**: Usage data is accurately embedded in assistant messages with 100% consistency for tracking per-interaction costs
- **SC-004**: System maintains normal operation performance with less than 5% overhead when usage tracking is enabled
- **SC-005**: SDK handles callback errors gracefully with 99.9% uptime for core agent operations even when monitoring fails
- **SC-006**: CLI displays accurate token usage summary within 500ms of exit command across all supported exit scenarios (normal, error, interrupt)