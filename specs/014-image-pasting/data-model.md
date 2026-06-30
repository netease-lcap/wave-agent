# Data Model: Image Pasting

This document describes the data structures and state management for the image pasting feature.

## State Management

The image pasting feature is managed within the `InputState` of the `InputManager`.

### InputState

The following fields are added to the `InputState` to support image pasting:

- **`attachedImages`**: `AttachedImage[]` - A list of images that have been pasted into the input.
- **`imageIdCounter`**: `number` - A counter used to generate unique IDs for each pasted image.

### AttachedImage

Each image in the `attachedImages` list has the following structure:

```typescript
export interface AttachedImage {
  id: number;
  path: string;
  mimeType: string;
}
```

- **`id`**: A unique identifier for the image, used in the placeholder.
- **`path`**: The absolute path to the temporary file where the image is saved.
- **`mimeType`**: The MIME type of the image (e.g., `image/png`).

## Placeholders

When an image is pasted, a placeholder is inserted into the `inputText` at the current `cursorPosition`.

- **Format**: `[Image #<ID>]`
- **Example**: `[Image #1]`

## Message Payload

When a message is submitted, the `attachedImages` are parsed and included in the message payload sent to the AI service.

### Message Content

The `inputText` is processed to remove the image placeholders before being sent as the text content of the message.

### Message Images

The images referenced by the placeholders are included in the `images` field of the message payload:

```typescript
export interface MessageImage {
  path: string;
  mimeType: string;
}
```

- **`path`**: The absolute path to the image file.
- **`mimeType`**: The MIME type of the image.

## Clipboard Result

The result of reading the clipboard image is represented by the `ClipboardImageResult` interface:

```typescript
export interface ClipboardImageResult {
  success: boolean;
  imagePath?: string;
  error?: string;
  mimeType?: string;
}
```

- **`success`**: Whether the image was successfully read and saved.
- **`imagePath`**: The path to the saved image file (if successful).
- **`error`**: An error message (if unsuccessful).
- **`mimeType`**: The MIME type of the image (if successful).
