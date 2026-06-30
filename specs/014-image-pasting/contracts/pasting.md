# Contract: Clipboard Image Reading

This document defines the contract for reading images from the clipboard.

## Interface: `ClipboardImageResult`

The result of reading the clipboard image is represented by the `ClipboardImageResult` interface:

```typescript
export interface ClipboardImageResult {
  success: boolean;
  imagePath?: string;
  error?: string;
  mimeType?: string;
}
```

- **`success`**: `boolean` - Whether the image was successfully read and saved.
- **`imagePath`**: `string` (optional) - The absolute path to the saved image file (if successful).
- **`error`**: `string` (optional) - An error message (if unsuccessful).
- **`mimeType`**: `string` (optional) - The MIME type of the image (if successful).

## Function: `readClipboardImage`

Reads an image from the clipboard and saves it to a temporary file.

- **Signature**: `async function readClipboardImage(): Promise<ClipboardImageResult>`
- **Returns**: A `Promise` that resolves to a `ClipboardImageResult`.

## Function: `hasClipboardImage`

Checks if the clipboard contains an image without saving it to a file.

- **Signature**: `async function hasClipboardImage(): Promise<boolean>`
- **Returns**: A `Promise` that resolves to a `boolean`.

## Function: `cleanupTempImage`

Deletes a temporary image file.

- **Signature**: `function cleanupTempImage(imagePath: string): void`
- **Parameters**:
  - **`imagePath`**: `string` - The absolute path to the image file to delete.
