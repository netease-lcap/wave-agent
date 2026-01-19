# Research: Support AskUserQuestion Tool

**Decision**: Implement `AskUserQuestion` as a built-in tool in `agent-sdk` and a corresponding UI component in `code`.

**Rationale**: 
- Structured questioning improves agent reliability by reducing guesswork.
- Multiple-choice interfaces are faster for users than typing free-form text.
- Aligning with industry standards (like Claude Code) ensures a familiar and powerful developer experience.

**Alternatives Considered**:
- **Plain Text Questions**: Rejected because they are easily missed by the agent's logic and don't provide a structured way to collect specific choices.
- **Single Question Tool**: Rejected in favor of a multi-question tool (up to 4) to allow batching related clarifications, reducing round-trips.

## Findings

### Tool Schema (agent-sdk)
- **Name**: `AskUserQuestion`
- **Input**:
  - `questions`: Array of objects (1-4)
    - `question`: string (the prompt)
    - `header`: string (max 12 chars, for UI chip)
    - `options`: Array of objects (2-4)
      - `label`: string
      - `description`: string (optional)
    - `multiSelect`: boolean (default: false)
- **Output**:
  - `answers`: Record<string, string> (question text -> selected label(s))

### UI Implementation (code)
- Use `ink` components to render the questions.
- **Visual Style**:
  - Display a header chip for each question (e.g., "Auth method" in a cyan/blue box).
  - Show the question text clearly.
  - List options with numeric shortcuts (1, 2, 3, etc.).
  - Highlight the currently selected option with a cursor (e.g., `>`).
  - Support keyboard navigation (arrows/numbers) for selection.
  - Automatically append an "Other" option to every question.
  - If `multiSelect` is true, use checkboxes; otherwise, use radio-style selection.
  - Show a "Confirm" button or instruction (e.g., "Press Enter to confirm") when all questions are answered.

### Integration Points
- **ToolManager**: Register the new tool.
- **PermissionManager**: Mark as a restricted tool requiring user interaction.
- **AIManager**: Update system prompts to encourage tool usage over plain text questions.
- **Confirmation Component**: Update to handle the specialized UI for `AskUserQuestion`.
