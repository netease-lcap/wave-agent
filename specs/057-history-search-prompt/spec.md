# Feature Specification: History Search Prompt

**Feature Branch**: `057-history-search-prompt`  
**Created**: 2026-02-02  
**Status**: Draft  
**Input**: User description: "refer to ~/.wave/history.jsonl, support ctrl r search history prompt, and remove bash history"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Search and Reuse Previous Prompts (Priority: P1)

As a user, I want to quickly find and reuse prompts I've previously sent to the agent so that I don't have to re-type complex instructions.

**Why this priority**: This is the core value of the feature, enabling faster interaction and reducing repetitive typing.

**Independent Test**: Can be fully tested by pressing Ctrl+R, typing a search term, and selecting a previous prompt to populate the input field.

**Acceptance Scenarios**:

1. **Given** I have a history of prompts in `~/.wave/history.jsonl`, **When** I press `Ctrl+R` in the agent's input field, **Then** a search interface appears showing my previous prompts.
2. **Given** the search interface is open, **When** I type a search query, **Then** the list of prompts is filtered to match my query.
3. **Given** a list of filtered prompts, **When** I use arrow keys to select one and press `Enter`, **Then** the selected prompt is placed into the main input field and the search interface closes.
4. **Given** the search interface is open, **When** I press `Esc`, **Then** the search interface closes without changing the main input field.

---

### User Story 2 - Migration from Bash History (Priority: P2)

As a user, I want the agent to use its own dedicated history file instead of relying on the system's bash history, so that my agent interactions are kept separate and clean.

**Why this priority**: Improves privacy and organization by separating agent prompts from general shell commands.

**Independent Test**: Can be tested by verifying that new prompts are saved to the JSONL history file and do NOT appear in the system's `.bash_history`.

**Acceptance Scenarios**:

1. **Given** I send a new prompt to the agent, **When** the prompt is processed, **Then** it is appended to `~/.wave/history.jsonl`.
2. **Given** I have sent multiple prompts, **When** I check my system's bash history (e.g., `history` command), **Then** the agent prompts are not present there.

---

### Edge Cases

- **Empty History**: What happens when `~/.wave/history.jsonl` does not exist or is empty? (System should show a "No history found" message or simply not open the search interface).
- **Large History File**: How does the system handle a very large history file? (Search should remain responsive; may need to limit the number of displayed results).
- **Corrupted JSONL**: How does the system handle a malformed `history.jsonl` file? (Should fail gracefully, perhaps by ignoring the malformed lines or showing an error message).
- **Duplicate Prompts**: Should the search interface show duplicate prompts? (Ideally, it should show unique prompts or the most recent instance of a prompt).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST read previous prompts from `~/.wave/history.jsonl`.
- **FR-002**: System MUST provide a searchable interface triggered by the `Ctrl+R` keyboard shortcut.
- **FR-003**: System MUST filter history results in real-time as the user types in the search interface.
- **FR-004**: System MUST allow selection of a history item using keyboard navigation (arrow keys).
- **FR-005**: System MUST populate the main input field with the selected history item upon confirmation (Enter key).
- **FR-006**: System MUST append every new prompt sent by the user to `~/.wave/history.jsonl`.
- **FR-007**: System MUST NOT save prompts to the system's bash history file.
- **FR-010**: System MUST remove any existing functionality that allows selecting or browsing prompts from the system's bash history.
- **FR-008**: System MUST perform case-insensitive history searching.
- **FR-009**: System MUST include prompts from all previous sessions in the history search.

### Key Entities *(include if feature involves data)*

- **History Entry**: Represents a single interaction.
    - **Prompt**: The text content of the user's message.
    - **Timestamp**: When the message was sent.
- **Search Interface**: A temporary UI component for searching history.
    - **Query**: The current search string entered by the user.
    - **Results**: A list of History Entries matching the query.
