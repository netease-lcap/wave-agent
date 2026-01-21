# File Selector Research

## Current Implementation Analysis

- **Trigger Logic**: The `@` trigger is detected in `handleSpecialCharInput`. It works at any position in the input string.
- **Search Utility**: It relies on `searchFiles` from `wave-agent-sdk`, which likely uses `glob` or `fs.readdir` under the hood.
- **Debouncing**: A 300ms debounce is implemented in `InputManager` to avoid rapid-fire file system queries while typing.
- **UI Rendering**: The `FileSelector` component uses a "sliding window" to display a maximum of 10 items, which is efficient for large directories.

## Observations

- **Path Completion**: The selector handles both files and directories. Selecting a directory inserts its path, allowing the user to continue typing to search within that directory.
- **Conflict Prevention**: `InputManager` uses a `selectorJustUsed` flag to prevent the `Enter` key that selects a file from also submitting the entire message.

## Potential Improvements

- **Fuzzy Search**: Currently, the search seems to be a simple prefix or substring match. Implementing fuzzy search would improve the user experience.
- **Icon Customization**: Use more specific icons for different file types (e.g., 📦 for `package.json`, 📜 for `.md`).
- **Performance**: For very large projects, the initial `searchFiles("")` might be slow. Consider caching or indexing.
