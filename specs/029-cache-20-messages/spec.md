# Feature Specification: Hardcoded Cache Strategy Replacement

**Feature Branch**: `029-cache-20-messages`  
**Created**: 2025-12-10  
**Status**: Draft  
**Input**: User description: "current cache  strategy is to add cache maker to system prompt and tools and last 2 user messages. last 2 user messages is not good, as for long task, there are very small number of user messages. I want to cache the last 20 times messages, for example, if I have 19 messsages, no cache, if 20 messages, cache 20th, if 39, still cache 20th, if 40, cache 40th." **Breaking Change**: Complete replacement with hardcoded strategy - no backward compatibility.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hardcoded Cache Strategy Replacement (Priority: P1)

When users engage in long-running tasks that involve many AI agent interactions but relatively few direct user messages, the system needs to replace the configurable "last 2 user messages" cache with a hardcoded interval-based strategy that caches every 20th message regardless of role.

**Why this priority**: This is a breaking change that completely replaces the existing configurable cache system with a simplified, hardcoded approach that eliminates configuration complexity while providing better context for extended work sessions.

**Independent Test**: Can be fully tested by initiating a conversation with 20 or more messages and verifying that the system applies hardcoded caching rules (system messages, tools, and 20-message intervals) without any configuration parameters, delivering improved contextual responses through the simplified cache strategy.

**Acceptance Scenarios**:

1. **Given** a conversation has exactly 19 messages, **When** the system processes the next interaction, **Then** no cache marker should be created
2. **Given** a conversation has exactly 20 messages, **When** the system processes the interaction, **Then** a cache marker should be created at the 20th message position
3. **Given** a conversation has 39 messages, **When** the system processes the next interaction, **Then** the cache marker should remain at the 20th message position
4. **Given** a conversation has exactly 40 messages, **When** the system processes the interaction, **Then** the cache marker should move to the 40th message position (20th marker removed)

---

### Edge Cases

- What happens when a conversation reaches exactly 20, 40, 60, etc. messages and the cache point needs to be updated?
- How does the system handle cache management when messages are deleted or modified after cache points are established?
- What occurs if the system needs to create a cache point but encounters memory or storage limitations?
- How does the system handle concurrent conversations with different message counts and cache requirements?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST track the total message count (all message types: user, assistant, system, tool) for each conversation thread
- **FR-002**: System MUST create a cache marker when total message count reaches multiples of 20 (20, 40, 60, etc.)
- **FR-003**: System MUST NOT create cache markers when total message count is below 20 or not a multiple of 20
- **FR-004**: System MUST maintain cache markers at the most recent multiple-of-20 message position
- **FR-005**: System MUST include cached messages in the context provided to the AI agent
- **FR-006**: System MUST preserve the existing cache composition (system prompt + tools + cached messages)
- **FR-007**: System MUST update cache markers when conversation length increases to the next 20-message interval (sliding window: remove previous markers)
- **FR-008**: System MUST ensure cache markers remain accessible for the duration of the conversation session

### Key Entities *(include if feature involves data)*

- **Conversation Thread**: Represents a sequence of messages between user and AI agent, with properties including message count, cache markers, and session context
- **Cache Marker**: Represents a point in the conversation where messages are preserved for context, containing the message position and associated conversation content
- **Message Context**: Represents the combination of system prompt, tools, and cached messages that provide context for AI agent responses