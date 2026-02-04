# Tasks: Session Management Implementation

- [x] Implement `PathEncoder` for project-based directory grouping
- [x] Migrate from flat `~/.wave/sessions` to project-based `~/.wave/projects`
- [x] Implement `JsonlHandler` for efficient message appending
- [x] Switch session storage format from single JSON to JSONL
- [x] Implement filename-based session ID and type identification
- [x] Remove metadata header line from session files for better performance
- [x] Implement optimized session listing by reading only the last line of files
- [x] Add `subagent-` prefix for subagent session files
- [x] Implement automatic cleanup of sessions older than 14 days
- [x] Implement cleanup of empty project directories
- [x] Ensure backward compatibility with existing JSONL sessions during transition
- [x] Add timestamp to each message line in JSONL
- [x] Implement `handleSessionRestoration` logic
- [x] Implement `sessions-index.json` for O(1) session listing performance
- [x] Cache `firstMessage` content in session index for instant UI display
- [x] Remove redundant `getFirstMessageContent` calls from CLI to fully leverage index
