# readTool Image Support Examples

This directory contains examples demonstrating the readTool's enhanced image support capabilities.

## Examples

### 1. `read-image-demo.ts` - Simple Demo
A straightforward demonstration of the readTool's ability to read both text and image files through the Wave Agent.

**Features demonstrated:**
- Reading text files via Agent messages
- Reading image files via Agent messages  
- Tool callback monitoring
- Automatic image detection and processing

**Usage:**
```bash
./examples/read-image-demo.ts
```

### 2. `read-tool-image-test.ts` - Comprehensive Test
A detailed test suite that validates the image reading functionality with extensive monitoring and validation.

**Features demonstrated:**
- Text file reading
- PNG image processing
- JPEG image processing
- Tool call monitoring with detailed callbacks
- Error handling validation
- Image processing detection and reporting

**Usage:**
```bash
./examples/read-tool-image-test.ts
```

## What Gets Tested

### Image Support
- **Supported formats:** PNG, JPEG, JPG, GIF, WEBP
- **Size limit:** 20MB maximum per file
- **Output:** Base64 encoded image data with proper MIME types
- **Integration:** Images flow through ToolResult → ToolBlock → UI display

### Functionality
1. **File Detection:** Automatically detects image files by extension
2. **Size Validation:** Enforces file size limits  
3. **Format Processing:** Converts images to base64 with MIME type mapping
4. **Error Handling:** Gracefully handles missing files, oversized files, and unsupported formats
5. **UI Integration:** Images appear with visual indicators (🖼️) in the CLI interface

## Running the Examples

Make sure you have built the SDK first:
```bash
cd packages/agent-sdk
npm run build
```

Then run either example:
```bash
# Simple demo
./examples/read-image-demo.ts

# Comprehensive test  
./examples/read-tool-image-test.ts
```

## Expected Output

When the readTool processes an image file, you should see:
- 🔧 Tool call notifications
- 🖼️ Image processing detection
- 📊 Tool results with success confirmation
- Agent responses analyzing the image content

The examples will automatically create temporary image files for testing and clean up afterwards.

## Notes

- The Agent may not always choose to read files depending on the message content and model behavior
- Image processing is confirmed by monitoring tool callbacks and results
- All temporary files are automatically cleaned up after testing
- The examples demonstrate real-world usage through natural language Agent interactions