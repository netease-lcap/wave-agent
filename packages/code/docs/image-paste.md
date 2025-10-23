# Image Paste Feature

## Feature Overview

InputBox now supports pasting images from clipboard via `Ctrl+V` shortcut. This allows users to conveniently send images along with text to AI.

## Usage

1. **Copy image to clipboard**:
   - Screenshot (Cmd+Shift+4 on macOS, Win+Shift+S on Windows)
   - Copy image file from file manager
   - Copy image from web page or application

2. **Paste image**:
   - Press `Ctrl+V` in InputBox
   - Image will display as `[Image #1]` placeholder
   - Supports consecutive pasting of multiple images: `[Image #1][Image #2]`

3. **View attached images**:
   - Attached image list will display after pasting
   - Display format: `📎 Attached Images: • [Image #1] (image/png)`

4. **Send message**:
   - Enter text message (optional)
   - Press Enter to send
   - Image data will be automatically passed to AI
   - Image list will be automatically cleared after sending

## Technical Implementation

### Core Components

- **useImageManager**: Manages attached image state
- **useClipboardPaste**: Handles clipboard image reading
- **useInputKeyboardHandler**: Integrates Ctrl+V shortcut
- **InputBox**: Displays image placeholders and attachment list

### Message Format

Sent messages contain:

- Text content (after removing image placeholders)
- Image array: `[{path: string, mimeType: string}]`

### Supported Image Formats

- PNG
- JPEG/JPG
- Other clipboard-supported image formats

## Test Coverage

- Image paste functionality tests
- Multi-image support tests
- Failure case handling tests
- Message sending integration tests
- Image cleanup functionality tests

## Error Handling

- Silent failure when clipboard is empty
- No placeholder displayed for non-image content
- Warning displayed in console when reading fails
- Does not affect normal use of existing functionality

## Keyboard Shortcuts

| Shortcut | Function |
| -------- | ------------------------------ |
| `Ctrl+V` | Paste clipboard image                 |
| `Enter`  | Send message (including images)           |
| `Esc`    | Cancel selector (does not affect pasted images) |

## Integration with Existing Features

- Fully compatible with file selector (`@` function)
- Fully compatible with command selector (`/` function)
- Fully compatible with Bash history selector (`!` function)
- Supports history navigation
- Supports cursor movement and editing
