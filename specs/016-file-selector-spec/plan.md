# File Selector Plan

## Phase 1: Stability and Polish
- Ensure the file selector works correctly with paths containing spaces.
- Improve the "No files found" state with better suggestions.

## Phase 2: Feature Enhancements
- Implement fuzzy searching for better matching.
- Add support for `~` to search from the home directory.
- Add file size or modification date information in the selector UI.

## Phase 3: Performance
- Implement a local cache for frequently accessed directories.
- Optimize the `searchFiles` utility for large monorepos.
