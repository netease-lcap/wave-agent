# Feature Specification: Subagent Support

**Feature Branch**: `009-subagent-support`  
**Created**: 2024-12-19  
**Status**: Draft  
**Input**: User description: "Support Subagents. Subagents are pre-configured AI personalities that Wave Agent can delegate tasks to. Each subagent has a specific purpose and expertise area, uses its own context window separate from the main conversation, can be configured with specific tools it's allowed to use, and includes a custom system prompt that guides its behavior.

Subagent configuration files are stored as Markdown files with YAML frontmatter in `.wave/agents/` (project-level) and `~/.wave/agents/` (user-level) directories. Example format:

```
---
name: test-runner
description: Use proactively to run tests and fix failures
---

You are a test automation expert. When you see code changes, proactively run the appropriate tests. If tests fail, analyze the failures and fix them while preserving the original test intent.
```

Project-level subagents take precedence over user-level subagents when names conflict."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Load and Parse User-Created Subagents (Priority: P1)

As a developer, I want the Wave Agent SDK to automatically discover and load my manually-created subagent configuration files so that I can use specialized AI assistants with domain expertise and appropriate tool access.

**Why this priority**: This is the foundation of the subagent system - the SDK must be able to discover, load, and parse user-created subagent configurations before any delegation can occur. The SDK focuses on reading capabilities while users manage creation through their preferred editors.

**Independent Test**: Can be fully tested by manually creating a subagent configuration file in the correct location with valid YAML frontmatter and verifying it can be discovered, loaded and parsed by the SDK.

**Acceptance Scenarios**:

1. **Given** I manually create a markdown file in `.wave/agents/` with valid YAML frontmatter, **When** the SDK scans for subagents, **Then** the subagent is discovered and available for use
2. **Given** I have a user-level subagent in `~/.wave/agents/`, **When** the SDK loads configurations, **Then** the subagent is available across all projects
3. **Given** I have both project and user subagents with the same name, **When** the SDK loads configurations, **Then** the project-level subagent takes precedence
4. **Given** I manually configure a subagent with specific tools, **When** the subagent is invoked, **Then** it only has access to those specified tools
5. **Given** I manually configure a subagent with a specific model, **When** the subagent is invoked, **Then** it uses the specified model for responses

---

### User Story 2 - Automatic Task Delegation (Priority: P2)

As a user, I want Wave Agent to automatically recognize when a task matches a subagent's expertise and delegate it appropriately, so that I get specialized assistance without having to manually specify which subagent to use.

**Why this priority**: This provides the intelligent automation that makes subagents truly useful - users shouldn't have to manually manage which subagent to use for each task.

**Independent Test**: Can be tested by configuring subagents with clear expertise descriptions and issuing tasks that match those descriptions, then verifying automatic delegation occurs.

**Acceptance Scenarios**:

1. **Given** I have a test-runner subagent configured, **When** I ask to "fix failing tests", **Then** the task is automatically delegated to the test-runner subagent
2. **Given** I have multiple subagents with different expertise, **When** I describe a task, **Then** the most appropriate subagent is selected based on the task description and subagent descriptions
3. **Given** I have a subagent with "PROACTIVELY" in its description, **When** any related task is mentioned, **Then** the system preferentially delegates to that subagent
4. **Given** no subagent matches my task description, **When** I request assistance, **Then** the main agent handles the task directly

---

### User Story 3 - Explicit Subagent Invocation (Priority: P3)

As a user, I want to explicitly request a specific subagent for a task, so that I have full control over which specialized agent handles my request when needed.

**Why this priority**: While automatic delegation is convenient, users sometimes need direct control over which subagent to use, especially for complex scenarios or when they know a specific subagent is best suited.

**Independent Test**: Can be tested by mentioning a specific subagent by name in a request and verifying that the named subagent handles the task.

**Acceptance Scenarios**:

1. **Given** I have multiple configured subagents, **When** I say "Use the code-reviewer subagent to look at my changes", **Then** the code-reviewer subagent specifically handles the request
2. **Given** I mention a subagent that doesn't exist, **When** I make the request, **Then** I receive an error message listing available subagents
3. **Given** I explicitly invoke a subagent, **When** the task completes, **Then** I can see which subagent handled the request in the response

---

### User Story 4 - Subagent Context Isolation (Priority: P2)

As a user, I want each subagent to maintain its own context window separate from the main conversation, so that specialized agents can focus on their specific tasks without being influenced by unrelated conversation history.

**Why this priority**: Context isolation is crucial for subagent effectiveness - it prevents subagents from being confused by irrelevant conversation history and allows them to maintain focus on their specialized domain.

**Independent Test**: Can be tested by having a long main conversation, then delegating to a subagent and verifying it doesn't reference unrelated previous conversation elements.

**Acceptance Scenarios**:

1. **Given** I have a long conversation with the main agent, **When** I delegate a task to a subagent, **Then** the subagent operates with only relevant context for its task
2. **Given** I use multiple subagents in sequence, **When** each subagent operates, **Then** they don't interfere with each other's context
3. **Given** a subagent completes a task, **When** control returns to the main agent, **Then** the main agent has access to the subagent's results but maintains its own context

---

### User Story 5 - Subagent Message Display (Priority: P2)

As a user, I want subagent conversations to be displayed as expandable blocks within the message list so that I can track subagent activity while maintaining focus on the main conversation flow.

**Why this priority**: Clear visual representation of subagent activity is essential for user understanding and debugging. Users need to see what subagents are doing without losing context of the main conversation.

**Independent Test**: Can be tested by triggering a subagent and verifying the message block appears with correct visual indicators, collapse/expand behavior, and message preview functionality.

**Acceptance Scenarios**:

1. **Given** a subagent is triggered, **When** it processes a task, **Then** an expandable message block appears in the vertical message list with distinctive border and subagent name/icon header
2. **Given** a subagent block is collapsed, **When** I view the message list, **Then** I see up to 2 most recent subagent messages in the preview
3. **Given** a subagent has only 1 message, **When** the block is collapsed, **Then** I see that single message in the preview
4. **Given** a subagent block is expanded, **When** I view it, **Then** I see all subagent messages in the conversation
5. **Given** a subagent block is in the message list, **When** I compare it to regular messages, **Then** it is clearly distinguishable through visual indicators

---

### Edge Cases

- What happens when a subagent configuration file has invalid YAML frontmatter?
- How does the system handle circular delegation (subagent trying to delegate back to main agent or another subagent)?
- What occurs when a subagent is configured with tools that don't exist?
- How does the system behave when both project and user directories contain agents with the same name?
- What happens if a subagent's specified model is unavailable or invalid?
- How does the system handle subagent files that exist but have no content or missing required fields?
- What occurs when a user requests a subagent that exists but lacks permission to access required tools?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: SDK MUST discover and load user-created subagent configurations from both `.wave/agents/` (project-level) and `~/.wave/agents/` (user-level) directories
- **FR-002**: SDK MUST parse user-created subagent configuration files with YAML frontmatter containing required name and description fields, optional tools and model fields, followed by markdown system prompt content
- **FR-021**: SDK MUST NOT provide subagent creation functionality - users create configurations manually using their preferred text editors
- **FR-003**: System MUST prioritize project-level subagents over user-level subagents when names conflict
- **FR-004**: System MUST validate subagent configuration files and provide clear error messages for invalid configurations
- **FR-005**: System MUST automatically match user tasks to appropriate subagents based on task description and subagent description fields, selecting the subagent with the most specific description match when multiple candidates exist
- **FR-006**: System MUST support explicit subagent invocation when users mention subagent names in their requests
- **FR-007**: System MUST isolate each subagent's context window from the main conversation and other subagents
- **FR-008**: System MUST restrict subagents to only the tools specified in their configuration, or inherit all tools if none specified
- **FR-009**: System MUST support configurable models per subagent, with fallback to system default if not specified
- **FR-010**: System MUST provide clear feedback about which subagent is handling a task
- **FR-016**: System MUST display subagent messages as expandable blocks within the vertical message list
- **FR-017**: System MUST show up to 2 most recent subagent messages when the subagent block is collapsed
- **FR-018**: System MUST show all subagent messages when the subagent block is expanded
- **FR-020**: System MUST display subagent message blocks with distinctive borders and subagent name/icon headers to differentiate from regular messages
- **FR-011**: System MUST handle subagent task completion and return results to the main conversation context
- **FR-019**: System MUST implement subagents as tool calls that return either successful content or error messages to the main agent
- **FR-012**: System MUST prevent infinite delegation loops between agents
- **FR-013**: System MUST support markdown content in subagent configuration files as system prompts
- **FR-014**: System MUST validate that specified tools in subagent configurations exist and are available
- **FR-015**: System MUST gracefully handle cases where no subagent matches a task and fall back to main agent processing

### Key Entities

- **Subagent Configuration**: Represents a user-created subagent with required name and description fields in YAML frontmatter, optional tools list, optional model specification, and markdown system prompt content
- **Subagent Instance**: An active subagent handling a specific task with its own context window and tool access
- **Task Delegation**: The process of matching user requests to appropriate subagents based on expertise and availability
- **Agent Context**: Isolated conversation context maintained separately for each subagent and the main agent

## Clarifications

### Session 2024-12-19

- Q: When a subagent is triggered, should the subagent message block be displayed inline within the main conversation flow, or as a separate expandable/collapsible section alongside the main messages? → A: Separate expandable block in messagelist, not alongside, the message list is a vertical list.
- Q: When the subagent block shows "last 2 messages" in collapsed state, what should happen if the subagent conversation has only 1 message? → A: Show the single message (display up to 2, but show whatever exists)
- Q: How should the system handle task delegation when a subagent generates an error or fails to complete its task? → A: Return error message to main agent. subagent is tool calling, so it can return successful content or error message
- Q: When multiple subagents could match a task, what selection criteria should the system use to choose the most appropriate one? → A: Choose subagent with most specific/detailed description match
- Q: What visual indicators should distinguish the subagent message block from regular messages in the vertical message list? → A: Distinctive border with subagent name/icon header
- Q: Should the Wave Agent SDK provide functionality to create subagent configuration files, or only read/load/parse user-created configurations? → A: SDK only reads/loads/parses user-created subagent files - no creation functionality

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can successfully manually create and configure subagents within 5 minutes using provided documentation, with the SDK automatically discovering and loading the configurations
- **SC-002**: System correctly delegates 90% of tasks to appropriate subagents when clear expertise matches exist
- **SC-003**: Subagent task completion time is within 150% of main agent time for equivalent tasks (accounting for context switching overhead)
- **SC-004**: Zero context bleeding occurs between subagents and main agent during normal operation
- **SC-005**: Configuration validation catches 100% of invalid YAML and missing required field errors with clear error messages
- **SC-006**: Users can explicitly invoke specific subagents successfully 100% of the time when the subagent exists and is properly configured