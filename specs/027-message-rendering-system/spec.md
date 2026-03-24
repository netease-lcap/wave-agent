# Feature Specification: Message Rendering System

**Feature Branch**: `027-message-rendering-system`  
**Created**: 2026-03-24  
**Input**: User description: "The Wave Agent CLI needs a robust and performant way to render a list of messages and their constituent blocks in the terminal using Ink components. This includes support for static rendering of historical messages and dynamic rendering of active tool/command executions."

## User Scenarios & Testing

### User Story 1 - Message History Display (Priority: P1)

As a user, I want to see the history of my conversation with the agent so that I can refer back to previous interactions.

**Acceptance Scenarios**:
1. **Given** a list of messages, **When** rendered, **Then** they appear in chronological order.
2. **Given** a long history of messages, **When** rendered, **Then** only the most recent messages are shown to maintain performance and readability.
3. **Given** historical messages, **When** rendered, **Then** they are rendered using Ink's `Static` component to avoid unnecessary re-renders.

---

### User Story 2 - Dynamic Block Rendering (Priority: P1)

As a user, I want to see real-time updates for active tool executions or running commands so that I know the agent is working.

**Acceptance Scenarios**:
1. **Given** a tool block in the `running` stage, **When** rendered, **Then** it shows a dynamic display (e.g., a spinner or progress indicator).
2. **Given** a running `bang` command, **When** rendered, **Then** its output is updated in real-time.
3. **Given** a message being streamed, **When** rendered, **Then** the new content appears as it is received.

---

### User Story 3 - Diverse Block Type Support (Priority: P1)

As a user, I want different types of content (text, code, errors, images, tool calls) to be rendered appropriately so that I can easily distinguish between them.

**Acceptance Scenarios**:
1. **Given** a text block, **When** rendered, **Then** it is displayed as markdown or plain text depending on the context.
2. **Given** an error block, **When** rendered, **Then** it is displayed in red with an "Error:" prefix.
3. **Given** a tool block, **When** rendered, **Then** it uses a specialized `ToolDisplay` component.
4. **Given** an image block, **When** rendered, **Then** it shows a placeholder or summary of the image.

---

## Requirements

### Functional Requirements

- **FR-001**: System MUST render a list of `Message` objects.
- **FR-002**: System MUST support flattening messages into individual `MessageBlock` items for rendering.
- **FR-003**: System MUST use Ink's `Static` component for rendering historical (non-dynamic) message blocks.
- **FR-004**: System MUST identify "dynamic" blocks (e.g., running tools or commands) and render them outside the `Static` component for real-time updates.
- **FR-005**: System MUST support a "welcome message" at the top of the message list.
- **FR-006**: System MUST limit the number of rendered messages to a configurable maximum (e.g., 10) to ensure performance.
- **FR-007**: System MUST provide a mechanism to measure the height of dynamic blocks for layout management.
- **FR-008**: System MUST support both expanded and collapsed views for message blocks.

### Key Components

- **MessageList**: The main container component that manages the rendering of the message history and active blocks.
- **MessageBlockItem**: A component that dispatches rendering to specialized components based on the block type.
- **Markdown**: Component for rendering text blocks with markdown formatting.
- **ToolDisplay**: Component for rendering tool calls and results.
- **BangDisplay**: Component for rendering shell command executions.
- **ReasoningDisplay**: Component for rendering the agent's internal reasoning.
