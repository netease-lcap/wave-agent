# Feature Specification: Message Compression

**Feature Branch**: `014-message-compression-spec`  
**Created**: 2026-01-22  
**Status**: Implemented  
**Input**: User description: "Manage conversation history and user input size"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Automatic History Compression (Priority: P1)

As an AI agent, when the conversation history becomes too long, I want to automatically summarize older messages so that I stay within the model's token limits while maintaining context.

**Why this priority**: Essential for long-running sessions to prevent "context window exceeded" errors and reduce costs.

**Independent Test**: Mock token usage to exceed the threshold and verify that `AIManager` triggers a compression cycle and replaces old messages with a summary block.

**Acceptance Scenarios**:

1. **Given** the total token count exceeds `getMaxInputTokens()`, **When** the next message is processed, **Then** the agent MUST identify messages to compress.
2. **Given** messages are identified for compression, **When** the summarization is complete, **Then** the original messages MUST be replaced by a `compress` block in the session.
3. **Given** a `compress` block exists, **When** sending messages to the API, **Then** it MUST be converted to a system message with the prefix `[Compressed Message Summary]`.

---

### User Story 2 - Long Input Placeholder (Priority: P2)

As a user, when I paste a large block of text into the input field, I want it to be replaced by a placeholder so that the UI remains clean and manageable.

**Why this priority**: Improves the user experience by preventing the input field from being overwhelmed by massive amounts of text.

**Independent Test**: Paste a string longer than 200 characters into the input field and verify it is replaced by a `[LongText#ID]` placeholder.

**Acceptance Scenarios**:

1. **Given** the user pastes text > 200 characters, **When** the paste event is processed, **Then** the text MUST be replaced by a `[LongText#ID]` placeholder.
2. **Given** a placeholder exists in the input, **When** the user submits the message, **Then** the placeholder MUST be expanded back to the original text before being sent to the agent.

---

### Edge Cases

- **Recursive Compression**: When compressing history that already contains a summary, the entire history (including the old summary) is replaced by a new continuation summary.
- **Image Handling**: Ensure that image blocks are accounted for during compression, even if their content isn't directly summarized.
- **Token Limit Edge**: If the summary itself is too long (unlikely but possible), the system should handle it gracefully.
- **Multiple Placeholders**: Users should be able to paste multiple long blocks, each getting its own unique ID.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST monitor token usage after each AI response.
- **FR-002**: System MUST replace the entire conversation history with a single continuation summary when token limits are reached.
- **FR-003**: System MUST use the AI to generate a summary of messages identified for compression.
- **FR-004**: System MUST replace compressed messages with a `compress` block in the session history.
- **FR-005**: System MUST convert `compress` blocks to system messages for API calls.
- **FR-006**: System MUST detect pasted text longer than 200 characters in the input field.
- **FR-007**: System MUST replace long pasted text with a `[LongText#ID]` placeholder.
- **FR-008**: System MUST expand placeholders back to original text upon submission.

### Key Entities *(include if feature involves data)*

- **CompressBlock**: A message block containing a summary.
    - `type`: "compress"
    - `content`: The summary text.
- **LongTextMap**: A mapping in `InputManager` for placeholders.
    - `key`: `[LongText#ID]`
    - `value`: Original text.

## Assumptions

- The AI model used for summarization is capable of producing concise and accurate summaries.
- The token counting utility is reasonably accurate.
- Users prefer a clean UI over seeing massive blocks of pasted text.
