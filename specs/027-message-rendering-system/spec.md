# Feature Specification: Message Rendering System

**Feature Branch**: `027-message-rendering-system`  
**Created**: 2026-03-24  
**Input**: User description: "The Wave Agent CLI needs a robust and performant way to render a list of messages and their constituent blocks in the terminal using Ink components. This includes support for static rendering of historical messages and dynamic rendering of active tool/command executions."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Message History Display (Priority: P1)

As a user, I want to see the history of my conversation with the agent so that I can refer back to previous interactions.

**Why this priority**: Essential for the core user experience of a chat-based agent.

**Independent Test**: Provide a list of messages to the `MessageList` component and verify they are rendered in chronological order.

**Acceptance Scenarios**:
1. **Given** a list of messages, **When** rendered, **Then** they appear in chronological order.
2. **Given** a long history of messages, **When** rendered, **Then** only the most recent messages are shown to maintain performance and readability.
3. **Given** historical messages, **When** rendered, **Then** they are rendered using Ink's `Static` component to avoid unnecessary re-renders.

---

### User Story 2 - Dynamic Block Rendering (Priority: P1)

As a user, I want to see real-time updates for active tool executions or running commands so that I know the agent is working.

**Why this priority**: Provides immediate feedback to the user during long-running operations.

**Independent Test**: Update a tool block's stage from `running` to `end` and verify the UI updates accordingly.

**Acceptance Scenarios**:
1. **Given** a tool block in the `running` stage, **When** rendered, **Then** it shows a dynamic display (e.g., a spinner or progress indicator).
2. **Given** a running `bang` command, **When** rendered, **Then** its output is updated in real-time.
3. **Given** any other block type (e.g., text, error), **When** rendered, **Then** it is treated as static content.

---

### User Story 3 - Diverse Block Type Support (Priority: P1)

As a user, I want different types of content (text, code, errors, images, tool calls) to be rendered appropriately so that I can easily distinguish between them.

**Why this priority**: Ensures clarity and readability of complex agent responses.

**Independent Test**: Render a message containing one of each block type and verify they all display correctly.

**Acceptance Scenarios**:
1. **Given** a text block, **When** rendered, **Then** it is displayed as markdown or plain text depending on the context.
2. **Given** an error block, **When** rendered, **Then** it is displayed in red with an "Error:" prefix.
3. **Given** a tool block, **When** rendered, **Then** it uses a specialized `ToolDisplay` component.
4. **Given** an image block, **When** rendered, **Then** it shows a placeholder or summary of the image.

---

## Edge Cases

- **What happens if there are more than 10 messages?** The system should only render the last 10 messages to ensure the terminal remains responsive and the scrollback doesn't become overwhelming.
- **What happens if `forceStatic` is true or the view is expanded?** All blocks, including those in the last message, should be rendered as static content, disabling any dynamic updates or spinners. This ensures the view remains "frozen" and performant when expanded.
- **What happens if a block type is unknown?** The system should handle it gracefully, either by ignoring it or displaying a generic placeholder, to prevent the entire UI from crashing.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST render a list of `Message` objects in chronological order.
- **FR-002**: System MUST flatten messages into individual `MessageBlock` items for rendering.
- **FR-003**: System MUST use Ink's `Static` component for rendering historical (non-dynamic) message blocks.
- **FR-004**: System MUST identify "dynamic" blocks and render them outside the `Static` component.
- **FR-004.1**: A block is dynamic IF `forceStatic` is false AND `isExpanded` is false AND the block belongs to the last message AND the message contains at least one active block (`tool` in `running`/`streaming`/`start` stage, or `bang` in `running` stage) AND the block itself is not a completed `text` or `reasoning` block (`stage === "end"`).
- **FR-004.2**: All other blocks MUST be rendered as static content, including text/reasoning blocks with `stage === "end"` even when other blocks in the same message are still active.
- **FR-004.3**: Blocks not in the last message MUST always be static, regardless of whether their message contains active blocks.
- **FR-005**: System MUST support a "welcome message" at the top of the message list showing version and environment info.
- **FR-006**: System MUST limit the number of rendered messages to a maximum of 10 by default.
- **FR-007**: System MUST provide a mechanism to measure the height of dynamic blocks and report it via a callback.
- **FR-008**: System MUST support both expanded and collapsed views for message blocks.

### Key Entities

- **MessageList**: The main container component that manages the rendering of the message history and active blocks.
- **MessageBlockItem**: A component that dispatches rendering to specialized components based on the block type.
- **BlockWithStatus**: An internal data structure that augments a `MessageBlock` with rendering metadata (e.g., `isDynamic`, `key`).
