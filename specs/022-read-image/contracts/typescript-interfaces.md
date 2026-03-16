# TypeScript Interface Contracts

**Feature**: Read Tool Image Support
**Date**: 2025-12-04

## Core Type Definitions

### Enhanced Read Tool Parameters
```typescript
interface ReadToolParameters {
  file_path: string;          // Absolute path to file (text or image)
  offset?: number;            // Line offset for text files (ignored for images)
  limit?: number;             // Line limit for text files (ignored for images)
}
```

### Image Detection Types
```typescript
type SupportedImageExtension = 'png' | 'jpeg' | 'jpg' | 'gif' | 'webp';

type ImageMimeType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';

interface ImageFileInfo {
  path: string;
  extension: SupportedImageExtension;
  size: number;
  mimeType: ImageMimeType;
}
```

### Enhanced ToolResult (Existing - No Changes Required)
```typescript
// This interface already exists in agent-sdk/src/tools/types.ts
export interface ToolResult {
  success: boolean;
  content: string;
  error?: string;
  shortResult?: string;
  // Image support already available:
  images?: Array<{
    data: string;           // base64 encoded image data
    mediaType?: string;     // Image media type
  }>;
  // Other existing fields...
  originalContent?: string;
  newContent?: string;
  diffResult?: Array<any>;
  filePath?: string;
}
```

### Processing Result Types
```typescript
interface ImageProcessingResult {
  success: true;
  imageData: {
    data: string;           // base64 encoded
    mediaType: string;      // MIME type
  };
} | {
  success: false;
  error: string;
}

interface FileTypeDetectionResult {
  isImage: boolean;
  extension?: SupportedImageExtension;
  mimeType?: ImageMimeType;
}
```

## Function Signatures

### Core Processing Functions
```typescript
// Image detection function
function isImageFile(filePath: string): FileTypeDetectionResult;

// Image processing function
function processImageFile(
  filePath: string, 
  maxSize: number = 20 * 1024 * 1024
): Promise<ImageProcessingResult>;

// Enhanced read tool execute function
async function execute(
  args: ReadToolParameters,
  context: ToolContext
): Promise<ToolResult>;
```

### Utility Function Extensions
```typescript
// File size validation
function validateImageFileSize(filePath: string, maxBytes: number): Promise<boolean>;

// Extension to MIME type mapping
function getImageMimeType(extension: string): ImageMimeType | null;

// Comprehensive file type detection
function detectFileType(filePath: string): {
  isText: boolean;
  isImage: boolean;
  extension: string;
  mimeType?: string;
};
```

## Error Type Definitions

```typescript
type ImageProcessingError = 
  | 'FILE_NOT_FOUND'
  | 'FILE_TOO_LARGE'
  | 'UNSUPPORTED_FORMAT'
  | 'CONVERSION_FAILED'
  | 'ACCESS_DENIED'
  | 'CORRUPTED_FILE';

interface ImageError {
  type: ImageProcessingError;
  message: string;
  filePath: string;
  fileSize?: number;
  maxSize?: number;
}
```

## Integration Contracts

### Tool Manager Integration
```typescript
// No changes required - ToolResult interface already supports images
interface ToolExecutionContext {
  tool: ToolPlugin;
  parameters: ReadToolParameters;
  result: ToolResult;           // Contains images array when applicable
}
```

### UI Component Integration
```typescript
// ToolResultDisplay component should handle images array
interface ToolResultDisplayProps {
  result: ToolResult;           // May contain images array
  isCollapsed?: boolean;
  // ... other existing props
}
```

### Message Processing Integration
```typescript
// ToolBlock interface already supports images
interface ToolBlock {
  type: "tool";
  parameters?: string;
  result?: string;
  shortResult?: string;
  images?: Array<{            // Already available
    data: string;
    mediaType?: string;
  }>;
  // ... other existing fields
}
```

## Validation Contracts

### File Validation Rules
```typescript
interface ImageFileValidationRules {
  maxFileSize: 20 * 1024 * 1024;     // 20MB in bytes
  supportedExtensions: ['png', 'jpeg', 'jpg', 'gif', 'webp'];
  supportedMimeTypes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
}

// Validation function contract
function validateImageFile(
  filePath: string, 
  rules: ImageFileValidationRules
): Promise<{
  isValid: boolean;
  errors: string[];
}>;
```

## Backward Compatibility Contracts

### Legacy Behavior Preservation
```typescript
// Text file processing remains unchanged
interface TextFileProcessingContract {
  // These behaviors must remain identical:
  lineNumbering: boolean;       // cat -n format
  lineLimits: {
    default: 2000;
    withOffset: number;
    withLimit: number;
  };
  contentTruncation: {
    maxBytes: 100 * 1024;       // 100KB for text
    indicator: string;          // "... more lines not shown"
  };
}
```

### Interface Stability
```typescript
// These interfaces must not change:
// - ToolPlugin structure
// - ToolContext interface  
// - Core ToolResult fields (success, content, error, shortResult)
// - Tool manager execution patterns
```