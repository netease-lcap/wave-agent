# Data Model: ACP Protocol

## Session State
- `sessionId`: Unique identifier for the Wave agent session.
- `modeId`: Current permission mode (e.g., `default`, `plan`, `acceptEdits`).
- `configOptions`: List of session configuration options (e.g., `permission_mode`).

## Prompt Blocks
- `text`: Text content of the prompt.
- `resource_link`: Link to an external resource.
- `resource`: Embedded resource content.
- `image`: Image data (base64 or URI) and MIME type.

## Tool Call State
- `toolCallId`: Unique identifier for the tool call.
- `title`: Display title for the tool call.
- `status`: Current status of the tool call (`pending`, `in_progress`, `completed`, `failed`).
- `rawInput`: Raw arguments passed to the tool.
- `rawOutput`: Raw result or error from the tool.
- `content`: Structured content for display (e.g., diffs, text).
- `locations`: File paths and line numbers associated with the tool call.
- `kind`: Kind of tool (`read`, `edit`, `execute`, `other`).
