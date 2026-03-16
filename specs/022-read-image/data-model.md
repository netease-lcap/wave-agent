# Data Model: Read Tool Image Support

**Date**: 2025-12-04
**Feature**: Image support for Read tool
**Status**: Design Complete

## Overview

This feature extends the existing Read tool data flow to handle image files by leveraging existing data structures and adding image-specific processing logic.

## Core Entities

### ImageFile
Represents an image file that can be processed by the Read tool.

**Fields:**
- `path: string` - Absolute path to the image file
- `extension: string` - File extension (png, jpeg, gif, webp) 
- `size: number` - File size in bytes (must be ≤ 20MB)
- `mimeType: string` - MIME type (image/png, image/jpeg, image/gif, image/webp)

**Validation Rules:**
- Path must be absolute
- Extension must be one of: png, jpeg, jpg, gif, webp (case-insensitive)
- Size must not exceed 20,971,520 bytes (20MB)
- MIME type must match extension

**State Transitions:**
1. `Detected` - File path provided and extension validated
2. `Validated` - File exists and size is within limits
3. `Processed` - File read and converted to base64
4. `Error` - Processing failed due to corruption, size, or access issues

### Enhanced ToolResult (Existing)
The existing `ToolResult` interface already supports images through the `images` field.

**Existing Fields (Maintained):**
- `success: boolean` - Operation success status
- `content: string` - Human-readable description of the operation
- `error?: string` - Error message if operation failed
- `shortResult?: string` - Brief summary for UI display

**Image-Specific Fields (Already Available):**
- `images?: Array<ImageData>` - Array of processed image data

### ImageData (Existing)
Represents processed image data within ToolResult.

**Fields (Already Defined):**
- `data: string` - Base64 encoded image data
- `mediaType?: string` - MIME type of the image

## Data Flow

```
[File Path] 
    ↓
[Extension Detection] → [Supported Format?] → No → [Text Processing]
    ↓ Yes
[File Validation] → [Size Check] → [Too Large?] → Yes → [Error Response]
    ↓ No
[Image Processing] → [Base64 Conversion] → [ToolResult with Images]
    ↓
[ToolBlock Population] → [Agent Processing Pipeline]
```

## Processing Rules

### Image Detection Logic
1. Extract file extension from path
2. Normalize extension to lowercase
3. Check if extension matches supported formats: `['png', 'jpeg', 'jpg', 'gif', 'webp']`
4. If not supported → proceed with text file processing
5. If supported → proceed with image processing

### Size Validation Logic
1. Get file stats using `fs.stat()`
2. Check if file size ≤ 20,971,520 bytes (20MB)
3. If too large → return error with clear message
4. If acceptable → proceed with conversion

### MIME Type Mapping
- `.png` → `image/png`
- `.jpg`, `.jpeg` → `image/jpeg`
- `.gif` → `image/gif`
- `.webp` → `image/webp`

### Error Handling States
- **File Not Found**: Return standard file not found error
- **Size Exceeded**: "Image file exceeds 20MB limit (actual: {size}MB)"
- **Conversion Failed**: "Failed to process image file: {error_message}"
- **Access Denied**: "Permission denied accessing image file: {path}"

## Integration Points

### Existing Utilities Integration
- **File Extension**: Use `path.ts` patterns for extension detection
- **Base64 Conversion**: Use `convertImageToBase64()` from `messageOperations.ts`
- **File Operations**: Use Node.js `fs/promises` for file system operations

### UI Integration
- **ToolResultDisplay**: Component should already handle `images` array in ToolResult
- **ToolBlock**: Interface already includes `images` field for display

### AI Service Integration
- **Message Conversion**: `convertMessagesForAPI.ts` already handles ToolBlock images
- **Multimodal Processing**: Image data will be available to AI services in proper format

## Backward Compatibility

### Maintained Behaviors
- Text file reading continues unchanged
- Existing ToolResult fields remain the same
- Error handling patterns consistent with existing implementation
- File path resolution logic unchanged

### New Behaviors (Additive)
- Image files populate `images` array in ToolResult
- Image processing errors use established error patterns
- Content field includes descriptive text about image processing