# Quickstart: Read Tool Image Support Implementation

**Feature**: Read Tool Image Support
**Target**: Developers implementing the image processing enhancement
**Date**: 2025-12-04

## Overview

This quickstart guide covers implementing image support in the existing Read tool. The enhancement allows the tool to detect image files and return base64-encoded image data for multimodal AI processing.

## Prerequisites

- Existing Wave Agent development environment
- Node.js and pnpm installed
- Familiarity with TypeScript and Vitest testing

## Implementation Steps

### Step 1: Understand Current State

The Read tool currently:
- Processes text files with line numbering
- Handles file size limits (100KB for text)
- Returns formatted content in ToolResult
- Supports offset/limit parameters for large files

**Key Files:**
- `packages/agent-sdk/src/tools/readTool.ts` - Main implementation
- `packages/agent-sdk/src/tools/types.ts` - ToolResult interface (already has images support)
- `packages/agent-sdk/src/utils/messageOperations.ts` - Image conversion utilities
- `packages/agent-sdk/tests/tools/readTool.test.ts` - Existing tests

### Step 2: Implement Image Detection

Add image detection logic to `readTool.ts`:

```typescript
// Add at top of file
import { extname } from "path";

// Add helper function
function isImageFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase().substring(1);
  return ['png', 'jpeg', 'jpg', 'gif', 'webp'].includes(ext);
}

function getImageMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase().substring(1);
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'gif': return 'image/gif';
    case 'webp': return 'image/webp';
    default: return 'image/png';
  }
}
```

### Step 3: Add File Size Validation for Images

```typescript
import { stat } from "fs/promises";

async function validateImageSize(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    const maxSize = 20 * 1024 * 1024; // 20MB
    return stats.size <= maxSize;
  } catch {
    return false;
  }
}
```

### Step 4: Enhance Execute Function

Modify the main execute function in `readTool.ts`:

```typescript
// Import the image conversion utility
import { convertImageToBase64 } from "../utils/messageOperations.js";

// In the execute function, add image detection logic before text processing:
export const readTool: ToolPlugin = {
  // ... existing config
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const filePath = args.file_path as string;
    
    // ... existing validation logic
    
    // Add image detection
    if (isImageFile(filePath)) {
      return processImageFile(filePath, context);
    }
    
    // ... existing text processing logic
  }
};

async function processImageFile(
  filePath: string, 
  context: ToolContext
): Promise<ToolResult> {
  try {
    // Resolve path
    const actualFilePath = filePath.startsWith("/")
      ? filePath
      : resolvePath(filePath, context.workdir);
    
    // Validate file size
    const isValidSize = await validateImageSize(actualFilePath);
    if (!isValidSize) {
      const stats = await stat(actualFilePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      return {
        success: false,
        content: "",
        error: `Image file exceeds 20MB limit (actual: ${sizeMB}MB)`,
      };
    }
    
    // Convert image to base64
    const imageDataUrl = convertImageToBase64(actualFilePath);
    const mimeType = getImageMimeType(actualFilePath);
    
    // Extract base64 data from data URL
    const base64Data = imageDataUrl.split(',')[1] || '';
    
    return {
      success: true,
      content: `Image file processed: ${getDisplayPath(filePath, context.workdir)}\\nFormat: ${mimeType}\\nSize: Available for AI processing`,
      shortResult: `Image processed (${mimeType})`,
      images: [{
        data: base64Data,
        mediaType: mimeType,
      }],
    };
    
  } catch (error) {
    return {
      success: false,
      content: "",
      error: `Failed to process image: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
```

### Step 5: Write Tests (TDD Approach)

Add image processing tests to `readTool.test.ts`:

```typescript
// Add test cases for image processing
describe("readTool image support", () => {
  it("should detect and process PNG images", async () => {
    // Create test PNG file
    // Call readTool with PNG file path
    // Verify result contains images array with correct MIME type
  });
  
  it("should handle JPEG images correctly", async () => {
    // Similar test for JPEG format
  });
  
  it("should reject oversized images", async () => {
    // Create file > 20MB
    // Verify appropriate error message
  });
  
  it("should handle corrupted image files gracefully", async () => {
    // Create corrupted image file
    // Verify error handling
  });
  
  it("should maintain text file processing", async () => {
    // Verify existing text functionality still works
  });
});
```

### Step 6: Testing Strategy

**Unit Tests:**
```bash
cd packages/agent-sdk
pnpm test -- readTool.test.ts
```

**Integration Tests:**
```bash
# Test with real image files in examples directory
cd packages/agent-sdk
pnpm tsx examples/test-read-images.ts
```

**Type Checking:**
```bash
pnpm run type-check
```

### Step 7: Build and Validate

```bash
# Build agent-sdk after changes
cd packages/agent-sdk
pnpm build

# Run quality gates
pnpm run type-check
pnpm run lint

# Test in dependent packages
cd ../code
pnpm test
```

## Common Gotchas

### 1. Path Resolution
- Ensure both absolute and relative paths work correctly
- Use existing `resolvePath` utility for consistency

### 2. Memory Management
- 20MB limit prevents memory issues
- Base64 encoding increases memory usage by ~33%

### 3. Error Handling
- Maintain existing error patterns
- Provide clear, actionable error messages

### 4. Backward Compatibility
- Text file processing must remain unchanged
- Existing parameters (offset, limit) should be ignored for images

## Verification Checklist

- [ ] Image files are detected by extension
- [ ] Base64 conversion works for all supported formats
- [ ] File size limit (20MB) is enforced
- [ ] ToolResult.images array is populated correctly
- [ ] Text file processing remains unchanged
- [ ] All tests pass
- [ ] Type checking passes
- [ ] Linting passes
- [ ] Build succeeds

## Next Steps

After implementation:
1. Test with real image files from various sources
2. Verify integration with ToolResultDisplay component
3. Test multimodal AI service integration
4. Performance testing with various file sizes
5. Edge case testing (corrupted files, permission issues)

## Support

Refer to:
- [Data Model](data-model.md) for entity relationships
- [TypeScript Interfaces](contracts/typescript-interfaces.md) for type definitions
- [Research](research.md) for technical decisions and alternatives