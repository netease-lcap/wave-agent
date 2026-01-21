# Data Model: Prompt Cache Control for Claude Models

**Date**: 2025-12-02  
**Feature**: 021-prompt-cache-control  
**Purpose**: Define data structures and relationships for cache control functionality

## Core Entities

### Cache Control Marker

**Purpose**: Ephemeral cache directive attached to cacheable content

**Structure**:
```typescript
interface CacheControl {
  type: "ephemeral";
}
```

**Validation Rules**:
- `type` must be exactly "ephemeral" (only supported cache type)
- Applied only to text content parts, never to images or tool results
- Optional field - presence indicates content should be cached

**Relationships**:
- Attached to `ChatCompletionContentPartText` objects
- Attached to `ChatCompletionFunctionTool` objects (last tool only)
- Not attached to other content types (images, tool results)

### Enhanced Usage Metrics

**Purpose**: Extended usage tracking including cache-related token counts

**Structure**:
```typescript
interface ClaudeUsage extends CompletionUsage {
  // Standard OpenAI usage fields (unchanged)
  prompt_tokens: number;
  completion_tokens: number; 
  total_tokens: number;
  
  // Claude cache-specific extensions
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: {
    ephemeral_5m_input_tokens: number;
    ephemeral_1h_input_tokens: number;
  };
}
```

**Validation Rules**:
- All cache fields are optional (only present when cache is used)
- `cache_creation_input_tokens` equals sum of ephemeral cache tokens
- `cache_read_input_tokens` indicates tokens served from existing cache
- All token counts must be non-negative integers

**Relationships**:
- Extends existing `CompletionUsage` from OpenAI SDK
- Maintains backward compatibility with existing usage tracking
- Integrated into `CallAgentResult` interface

### Claude Model Detection

**Purpose**: Boolean determination of cache control applicability

**Structure**:
```typescript
interface ModelCacheConfig {
  modelName: string;
  isClaudeModel: boolean;
  shouldApplyCache: boolean;
}
```

**Validation Rules**:
- Case-insensitive detection: `modelName.toLowerCase().includes('claude')`
- `shouldApplyCache` equals `isClaudeModel` (1:1 relationship)
- Model name cannot be empty or undefined

**Relationships**:
- Determines cache control application for entire request
- Affects message transformation and tool processing
- Influences usage tracking structure

### Structured Message Content

**Purpose**: Array-based message content supporting selective cache control

**Structure**:
```typescript
// Extended OpenAI types for Claude cache support
interface ClaudeChatCompletionContentPartText extends ChatCompletionContentPartText {
  type: "text";
  text: string;
  cache_control?: CacheControl;
}

interface ClaudeChatCompletionFunctionTool extends ChatCompletionFunctionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: object;
  };
  cache_control?: CacheControl;
}

type ClaudeMessageContent = string | Array<
  ClaudeChatCompletionContentPartText | 
  ChatCompletionContentPartImage
>;
```

**Validation Rules**:
- String content must be transformed to structured arrays when adding cache control
- Existing structured content preserved, cache control added selectively
- Only text content parts receive cache_control markers
- Image and other content types remain unchanged

**Relationships**:
- Replaces simple string content in OpenAI message format
- Maintains compatibility with existing message processing
- Enables selective caching based on content type

## Entity State Transitions

### Message Content Transformation

```
String Content -> Structured Content + Cache Control
"system prompt" -> [{ type: "text", text: "system prompt", cache_control: { type: "ephemeral" } }]
```

### Cache Usage Lifecycle

```
Request 1: cache_creation_input_tokens > 0, cache_read_input_tokens = 0
Request 2+: cache_creation_input_tokens = 0, cache_read_input_tokens > 0 (cache hit)
```

### Model Detection Flow

```
ModelName -> isClaudeModel() -> shouldApplyCache -> Message Transformation
```

## Data Flow Patterns

### Cache Control Application

1. **Input**: Original OpenAI message parameters
2. **Detection**: Model name analysis for Claude identification  
3. **Selection**: Last 2 user messages + system message + last tool
4. **Transformation**: String content -> structured arrays + cache_control
5. **Preservation**: Existing structured content maintained
6. **Output**: Enhanced message parameters with selective cache markers

### Usage Tracking Extension

1. **Input**: Standard OpenAI usage response
2. **Detection**: Presence of cache-related fields
3. **Extension**: Add cache metrics to existing usage object
4. **Integration**: Maintain compatibility with existing usage tracking
5. **Output**: Enhanced usage object with cache information

## Validation Schema

### Cache Control Validation
```typescript
function isValidCacheControl(control: any): control is CacheControl {
  return control && 
         typeof control === 'object' && 
         control.type === 'ephemeral';
}
```

### Usage Metrics Validation
```typescript
function isValidClaudeUsage(usage: any): usage is ClaudeUsage {
  const hasStandardFields = typeof usage.prompt_tokens === 'number' &&
                           typeof usage.completion_tokens === 'number' &&
                           typeof usage.total_tokens === 'number';
  
  const hasCacheFields = usage.cache_read_input_tokens === undefined || 
                        typeof usage.cache_read_input_tokens === 'number';
  
  return hasStandardFields && hasCacheFields;
}
```

### Model Detection Validation  
```typescript
function isValidModelName(modelName: string): boolean {
  return typeof modelName === 'string' && 
         modelName.trim().length > 0;
}
```