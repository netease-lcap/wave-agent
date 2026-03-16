# Research: Read Tool Image Support

**Date**: 2025-12-04
**Feature**: Image support for Read tool in agent-sdk
**Status**: Complete

## Research Summary

Investigation into enhancing the existing Read tool to support image files by leveraging existing infrastructure and utilities in the Wave Agent codebase.

## Key Decisions

### Decision: Leverage Existing Image Conversion Utility

**Rationale**: The codebase already contains a robust `convertImageToBase64` function in `messageOperations.ts` that:
- Handles multiple image formats (JPEG, PNG, GIF, WebP, BMP)
- Provides proper MIME type detection based on file extensions
- Includes error handling for conversion failures
- Returns data URLs in the correct format for AI service consumption

**Alternatives considered**: 
- Writing new image processing logic: Rejected due to code duplication
- Using external image processing libraries: Rejected due to added dependency complexity
- File format detection libraries: Rejected as path.ts already has extension lists

### Decision: Extend ToolResult Interface (Already Available)

**Rationale**: The `ToolResult` interface in `types.ts` already includes an `images` array field:
```typescript
images?: Array<{
  data: string; // base64 encoded image data
  mediaType?: string; // Image media type, such as "image/png"
}>
```

**Alternatives considered**: 
- Creating new image-specific result type: Rejected as it violates Constitution IX (Type System Evolution)
- Adding image data to content field: Rejected as it would break existing text processing expectations

### Decision: File Type Detection Strategy

**Rationale**: Use file extension-based detection leveraging existing patterns:
- `path.ts` already defines `binaryExtensions` array with image formats
- Extension-based detection is fast and sufficient for this use case
- Consistent with existing codebase patterns for file type handling

**Alternatives considered**: 
- File signature/magic number detection: Rejected as overkill for this feature
- MIME type libraries: Rejected due to added complexity
- Content-based detection: Rejected due to performance concerns with large files

### Decision: 20MB File Size Limit

**Rationale**: Balances functionality with performance:
- Larger than current 100KB text limit to accommodate image files
- Prevents memory exhaustion from extremely large image files
- Reasonable limit for typical screenshot and document image use cases

**Alternatives considered**: 
- No size limit: Rejected due to memory safety concerns
- 100MB limit: Rejected as excessive for typical use cases
- 5MB limit: Rejected as too restrictive for high-resolution screenshots

### Decision: Supported Image Formats

**Rationale**: Support JPEG, PNG, GIF, WebP formats as specified:
- Most common web and document image formats
- Already supported by existing `convertImageToBase64` utility
- Sufficient for multimodal AI processing needs

**Alternatives considered**: 
- Adding SVG support: Rejected as SVG is text-based and doesn't require base64 encoding
- Adding BMP support: Rejected per specification constraints
- Adding TIFF support: Rejected as uncommon in typical use cases

## Implementation Strategy

### Phase 1: Core Implementation
1. Modify `readTool.ts` to detect image files by extension
2. Use existing `convertImageToBase64` utility for image processing
3. Populate `ToolResult.images` array with converted image data
4. Maintain existing text file reading functionality

### Phase 2: Testing Strategy
1. Extend existing `readTool.test.ts` with image processing test cases
2. Test each supported image format (JPEG, PNG, GIF, WebP)
3. Test file size limit enforcement (20MB boundary)
4. Test error handling for corrupted images and unsupported formats
5. Verify backward compatibility with existing text file functionality

### Phase 3: Integration Verification
1. Verify ToolBlock interface correctly receives image data
2. Test image data propagation through the agent processing pipeline
3. Confirm multimodal AI service integration works with image data

## Technical Dependencies

### Existing Utilities to Leverage
- `convertImageToBase64()` from messageOperations.ts
- `binaryExtensions` array from path.ts
- `ToolResult` interface from types.ts
- File system utilities from fs/promises

### No New Dependencies Required
The implementation can be completed using only existing utilities and Node.js built-ins, maintaining the project's minimal dependency philosophy.

## Risk Assessment

### Low Risk
- **Backward Compatibility**: Text file reading functionality remains unchanged
- **Type Safety**: Using existing TypeScript interfaces
- **Performance**: Leveraging proven utilities

### Mitigation Strategies
- **Memory Usage**: 20MB file size limit prevents excessive memory consumption
- **Error Handling**: Graceful fallback for unsupported files or conversion failures
- **Testing**: Comprehensive test coverage including edge cases