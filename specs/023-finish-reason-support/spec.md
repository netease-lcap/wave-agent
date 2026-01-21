# Feature Specification: Finish Reason Support

**Feature Branch**: `023-finish-reason-support`  
**Created**: 2026-01-21  
**Status**: Completed  
**Input**: User description: "include stop reason in Block and auto call again if stop reason is length and no tools called" (Adjusted to include in Message instead of Block per feedback)

## User Scenarios & Testing

### User Story 1 - Persist Stop Reason (Priority: P1)

As a developer, I want to see why the AI stopped generating a message in the message history so that I can debug issues related to truncation or content filtering.

**Acceptance Scenarios**:
1. **Given** the AI completes a response, **When** I inspect the message history, **Then** the last assistant message MUST contain a `finish_reason` field.

---

### User Story 2 - Auto-continue Truncated Responses (Priority: P1)

As a user, I want the agent to automatically continue its response if it was cut off due to token limits, so that I don't have to manually ask it to "continue".

**Acceptance Scenarios**:
1. **Given** the AI response is truncated (`finish_reason === 'length'`), **When** no tools were called, **Then** the agent MUST automatically initiate another AI call to continue the response.
2. **Given** the AI response is truncated, **When** tools WERE called, **Then** the agent MUST execute the tools and then initiate another AI call (existing behavior, but now also triggered by 'length').

## Requirements

### Functional Requirements

- **FR-001**: The `Message` interface MUST include an optional `finish_reason` string field.
- **FR-002**: `AIManager` MUST set the `finish_reason` on the assistant message after each AI call.
- **FR-003**: `AIManager` MUST trigger a recursive AI call if the `finish_reason` is `"length"`.
- **FR-004**: The recursion MUST respect the `recursionDepth` limit to prevent infinite loops.

## Assumptions

- The underlying LLM provides a reliable `finish_reason` (OpenAI and Claude models via the gateway do this).
- The `MessageManager` correctly handles updating and saving messages when `setMessages` is called.
