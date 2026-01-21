# Feature Specification: Real-Time Content Streaming

**Feature Branch**: `012-stream-content-updates`  
**Created**: 2025-11-19  
**Status**: Draft  
**Input**: User description: "support stream for both agent-sdk and code package. the agent-sdk should add a onAssistantContentUpdated in MessageManagerCallbacks. and current onToolBlockUpdated should support stream tool parameters updating. the code should use onAssistantContentUpdated to update assistant message content, user will see the stream content update in CLI messsage list. the code should use onToolBlockUpdated to update assistant message tool call parameters, user will see compactParams update in collapse state and see parameters update in expand state."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Real-time Assistant Message Streaming (Priority: P1)

Users experience immediate, incremental updates to assistant responses as they are being generated, similar to ChatGPT's typing effect.

**Why this priority**: This is the core user-facing experience improvement that provides immediate visual feedback and makes the system feel more responsive and engaging.

**Independent Test**: Can be fully tested by sending any message to the assistant and observing that the response text appears incrementally character by character, rather than appearing all at once after completion.

**Acceptance Scenarios**:

1. **Given** a user sends a message, **When** the assistant begins generating a response, **Then** text content appears character by character in the CLI message list
2. **Given** the assistant is streaming a response, **When** new content chunks arrive, **Then** the message content updates incrementally without refreshing the entire interface
3. **Given** a streaming response is interrupted, **When** the user aborts the message, **Then** the partial content remains visible and properly formatted

---

### User Story 2 - Real-time Tool Parameter Streaming (Priority: P2)

Users see tool call parameters being built incrementally as the AI constructs function calls, providing transparency into the AI's reasoning process.

**Why this priority**: Enhances user trust and understanding by showing the AI's decision-making process in real-time, especially valuable for complex tool calls with many parameters.

**Independent Test**: Can be tested by requesting an action that triggers tool calls and observing that parameters appear incrementally in collapsed view, while expanded view shows snapshot of parameters from when expanded mode was entered.

**Acceptance Scenarios**:

1. **Given** the assistant is generating a tool call, **When** parameter data streams in, **Then** the compactParams display updates in real-time in collapsed view
2. **Given** the user has expanded view enabled, **When** tool parameters are being generated, **Then** display shows static snapshot of parameters from when expanded mode was entered
3. **Given** multiple tool calls are being generated, **When** in collapsed view, **Then** each tool's compactParams update independently in real-time

---

### User Story 3 - Seamless View Mode Transitions (Priority: P3)

Users can switch between collapsed and expanded view modes, where collapsed mode shows real-time streaming and expanded mode shows completely static content without any updates during content generation.

**Why this priority**: Ensures streaming works optimally in collapsed mode while providing a completely stable, distraction-free reading experience in expanded mode that never changes during content generation.

**Independent Test**: Can be tested by triggering streaming content and toggling between collapsed/expanded modes during the streaming process.

**Acceptance Scenarios**:

1. **Given** content is streaming in collapsed mode, **When** user switches to expanded mode, **Then** streaming stops and content displays as a static snapshot from the moment of switching
2. **Given** user is in expanded mode, **When** new content begins generating, **Then** display remains as static snapshot from when expanded mode was entered
3. **Given** user is in expanded mode, **When** switching to collapsed mode during generation, **Then** streaming resumes from current completion point

---

### User Story 4 - Tool Block Stage Updates (Priority: P2)

An SDK integrator wants to track the lifecycle of a tool execution through deterministic stages (start, streaming, running, end) to provide accurate UI feedback.

**Why this priority**: Clear differentiation between "starting", "streaming output", "still running", and "finished" states lets integrators show accurate status messages and final results.

**Independent Test**: Subscribe to `onToolBlockUpdated`, trigger a tool execution, and verify that events arrive with the expected `stage` values in the correct order.

**Acceptance Scenarios**:

1. **Given** a tool execution begins, **When** `onToolBlockUpdated` fires, **Then** the first event received includes `stage="start"` and the tool's display name.
2. **Given** a tool that emits streaming output, **When** `onToolBlockUpdated` fires with `stage="streaming"`, **Then** each event includes the latest `parametersChunk`.
3. **Given** a long-running tool, **When** progress updates occur without new chunks, **Then** `onToolBlockUpdated` emits `stage="running"`.
4. **Given** a tool reaches completion, **When** `onToolBlockUpdated` emits the final update, **Then** the event uses `stage="end"` and carries the final output or error summary.
5. **Given** any `onToolBlockUpdated` event, **Then** the payload does not contain the deprecated `isRunning` flag.

---

### Edge Cases

- What happens when network connectivity is poor and stream chunks arrive out of order or with delays?
- How does the system handle partial UTF-8 characters that might be split across stream chunks?
- What occurs if the user switches from collapsed to expanded mode while content is streaming?
- How does the interface behave if streaming is interrupted due to API rate limits or errors?
- What happens when very long content streams exceed terminal display limits?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Agent-SDK MUST add an `onAssistantContentUpdated` callback to the `MessageManagerCallbacks` interface that receives both chunk (incremental content) and accumulated (full message content built up so far) as two separate arguments for third-party integrations, extensions, and examples
- **FR-002**: Agent-SDK MUST enhance the existing `onToolBlockUpdated` callback to support streaming parameter updates and lifecycle tracking by adding:
    - A new `stage` field with allowed values: `start`, `streaming`, `running`, `end`.
    - A new `parametersChunk` field (used during `streaming` stage) alongside existing accumulated parameter data.
- **FR-002a**: Agent-SDK MUST modify `onAssistantMessageAdded` callback to receive no arguments, as content and tool updates are handled by dedicated streaming callbacks
- **FR-002b**: Agent-SDK MUST remove the deprecated `isRunning` field from all `onToolBlockUpdated` payloads.
- **FR-002c**: On the `start` stage, the payload MUST include the tool's identifier and human-readable name.
- **FR-002d**: The `end` stage MUST occur exactly once per tool execution and include the final result data or error summary.
- **FR-003**: CLI package MUST use only `onMessagesChange` for all content updates, with Agent SDK managing internal state updates during streaming and triggering `onMessagesChange` appropriately. Third-party integrations and examples (such as `packages/code/src/print-cli.ts`) MAY use streaming callbacks for direct logging or external integration purposes.
- **FR-003a**: Agent SDK MUST trigger `onMessagesChange` callback after each streaming content update (every chunk processed) and after each streaming parameter update (every parameter chunk processed) to ensure UI synchronization
- **FR-004**: CLI package MUST display incremental content and tool parameter updates through `onMessagesChange` triggered by Agent SDK during streaming without causing visual flicker or layout shifts in collapsed view mode
- **FR-005**: System MUST handle streaming tool parameters through the enhanced `onToolBlockUpdated` callback with Agent SDK managing internal state updates
- **FR-006**: CLI MUST update `compactParams` display in real-time when in collapsed view mode during parameter streaming
- **FR-007**: CLI MUST display content and parameters as static snapshot captured at the moment of switching to expanded view mode, with no further updates applied during streaming
- **FR-008**: System MUST continue receiving streaming callbacks internally but only apply visual updates when in collapsed view mode
- **FR-009**: In collapsed view mode, `compactParams` MUST update in real-time as each parameter chunk is processed, showing the most current available parameters. In expanded view mode, `compactParams` MUST remain static showing the parameter state captured at the moment of switching to expanded mode

### State Management Architecture

- **Agent SDK Responsibility**: Manages all message state internally, updates messages, and triggers `onMessagesChange`
- **Streaming Callbacks Purpose**: Provide real-time streaming data for third-party integrations, extensions, and examples (such as `packages/code/src/print-cli.ts` and `packages/agent-sdk/examples`)
- **UI State Flow**: All message updates flow through existing `onMessagesChange` for consistency
- **Clean Separation**: Streaming callbacks are additive for external integrations, not primary state management

## Clarifications

### Session 2025-11-19

- Q: Expanded mode streaming behavior → A: Never stream in expanded mode - all content appears only after completion
- Q: Expanded mode content updates when generation completes → A: No updates even when content is complete
- Q: Content visibility in expanded mode → A: Show snapshot of content at time of switching to expanded mode
- Q: onAssistantContentUpdated callback data format → A: Two arguments: (chunk: string, accumulated: string)
- Q: onToolBlockUpdated callback parameter format → A: Existing signature with new `parametersChunk` field for incremental updates alongside accumulated parameters
- Q: onAssistantMessageAdded callback arguments → A: Should receive no arguments, content/tools handled by dedicated streaming callbacks
- Q: State management during streaming → A: Agent SDK manages message state internally and triggers `onMessagesChange`; streaming callbacks provide data for third-party integrations, extensions, and examples

## Assumptions *(mandatory)*

- The underlying AI service supports streaming responses (incremental content delivery)
- Network connectivity is generally stable for most users
- Terminal/CLI interface can handle real-time text updates at OpenAI's streaming rate (target: 2-3 content updates per second)
- Users typically use standard terminal emulators that support real-time text rendering
- Content streams arrive in chronological order under normal network conditions
- The existing message management system can be enhanced to support incremental updates through `onMessagesChange`
- Tool parameter streams contain valid JSON or structured data that can be parsed incrementally using a new `extractStreamingParams` utility function (to be implemented) which will validate JSON completeness and extract valid parameter objects from partial streams
- Agent SDK can manage internal message state and trigger existing callbacks for UI updates