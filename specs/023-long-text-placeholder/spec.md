# Feature Specification: Long Text Placeholder

**Feature Branch**: `023-long-text-placeholder`  
**Created**: 2026-03-24  
**Input**: User description: "Manage long pasted text in the input field"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Long Input Placeholder (Priority: P1)

As a user, when I paste a large block of text into the input field, I want it to be replaced by a placeholder so that the UI remains clean and manageable.

**Why this priority**: Improves the user experience by preventing the input field from being overwhelmed by massive amounts of text.

**Independent Test**: Paste a string longer than 200 characters into the input field and verify it is replaced by a `[LongText#ID]` placeholder.

**Acceptance Scenarios**:

1. **Given** the user pastes text > 200 characters, **When** the paste event is processed, **Then** the text MUST be replaced by a `[LongText#ID]` placeholder.
2. **Given** a placeholder exists in the input, **When** the user submits the message, **Then** the placeholder MUST be expanded back to the original text before being sent to the agent.

---

### Edge Cases

- **Multiple Placeholders**: Users should be able to paste multiple long blocks, each getting its own unique ID.
- **History Navigation**: When navigating history, placeholders should be preserved in the input field, and their original text should be correctly mapped.
- **Mixed Content**: Placeholders should work correctly when mixed with other text, images, or slash commands.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST detect pasted text longer than 200 characters in the input field.
- **FR-002**: System MUST replace long pasted text with a `[LongText#ID]` placeholder.
- **FR-003**: System MUST maintain a mapping between placeholders and their original text.
- **FR-004**: System MUST expand placeholders back to original text upon submission.
- **FR-005**: System MUST preserve placeholders and their mappings when saving and restoring prompt history.

### Key Entities *(include if feature involves data)*

- **LongTextMap**: A mapping in `InputManager` for placeholders.
    - `key`: `[LongText#ID]`
    - `value`: Original text.

## Assumptions

- Users prefer a clean UI over seeing massive blocks of pasted text.
- The 200-character threshold is a reasonable limit for "long" text.
