# Research: Image Pasting

This document summarizes the research and implementation details for the image pasting feature.

## Clipboard Image Reading

Reading images from the clipboard is platform-dependent. The following tools and scripts are used for each platform:

### macOS

- **Tool**: `osascript`
- **Script**:
  ```applescript
  tell application "System Events"
    try
      set imageData to the clipboard as «class PNGf»
      set fileRef to open for access POSIX file "${tempFilePath}" with write permission
      write imageData to fileRef
      close access fileRef
      return true
    on error errMsg
      try
        close access fileRef
      end try
      error errMsg
    end try
  end tell
  ```
- **MIME Type**: `image/png`

### Windows

- **Tool**: `powershell`
- **Script**:
  ```powershell
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $image = [System.Windows.Forms.Clipboard]::GetImage()
  if ($image -ne $null) {
    $image.Save("${tempFilePath.replace(/\\/g, "\\\\")}", [System.Drawing.Imaging.ImageFormat]::Png)
    Write-Output "true"
  } else {
    Write-Output "false"
  }
  ```
- **MIME Type**: `image/png`

### Linux

- **Tool**: `xclip`
- **Command**:
  ```bash
  xclip -selection clipboard -t image/png -o > "${tempFilePath}"
  ```
- **MIME Type**: `image/png`

## Temporary File Management

Images are saved to the system's temporary directory (`tmpdir()`) with a unique filename:

- **Format**: `clipboard-image-${Date.now()}.png`
- **Cleanup**: Temporary files should be deleted after they are no longer needed.

## Input Manager Integration

The image pasting feature is integrated into the `InputManager` through the following components:

- **`inputHandlers.ts`**: Handles the `Ctrl+V` key event and calls `readClipboardImage`.
- **`inputReducer.ts`**: Manages the `attachedImages` list and `imageIdCounter` in the `InputState`.
- **`useInputManager.ts`**: Provides the `handlePasteImage` method and syncs the `attachedImages` state with callbacks.

## AI Service Integration

When a message is sent, the `attachedImages` are parsed and included in the message payload. The AI service (e.g., OpenAI, Anthropic) must support image inputs.

- **OpenAI**: Supports image inputs via the `image_url` field in the message content.
- **Anthropic**: Supports image inputs via the `image` block in the message content.

The `convertMessagesForAPI` utility in `packages/agent-sdk/src/utils/convertMessagesForAPI.ts` is responsible for converting the message payload into the format required by the AI provider.
