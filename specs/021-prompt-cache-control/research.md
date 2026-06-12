# Research: Prompt Cache Control

**Date**: 2025-12-02  
**Feature**: 021-prompt-cache-control  
**Purpose**: Resolve technical clarifications for implementing Claude cache_control functionality

## Performance Goals Research

**Decision**: Acceptable latency increase of 25-50ms for cache_control transformation

**Rationale**: 
- Current message processing baseline: 50-100ms in aiService.ts
- Cache transformation adds structured content array creation and selective marker application
- ROI justifies overhead: 30-60% token cost savings after 2-3 requests with cache hits
- Expected cache hit rates: 40-70% for system messages and recent user context

**Alternatives considered**: 
- Async transformation: Rejected due to complexity and minimal benefit for small overhead
- Pre-transformation caching: Rejected due to memory usage and cache invalidation complexity

## Claude API Constraints Research

**Decision**: Support ephemeral cache with 5-minute to 1-hour duration, text-only content

**Rationale**:
- Claude API supports only "ephemeral" cache type with automatic duration management
- Text content parts only - images and tool results cannot be cached
- Case-insensitive model detection using `model.includes("claude")` pattern
- Cache metrics extend existing usage tracking with well-defined field structure

**Alternatives considered**:
- Custom cache duration: Not supported by Claude API
- Universal cache_control marker injection: Rejected due to cost and limited benefit for non-Claude models (only Claude API supports `cache_control: {type: "ephemeral"}` markers)
- Universal cache token extraction: Accepted — `prompt_tokens_details` is an OpenAI-standard field; extracting cache metrics from all models' usage is zero-cost and provides visibility
- Image content caching: Not supported by Claude API

## Implementation Architecture Research

**Decision**: Inject cache_control logic after message construction, before API call

**Rationale**:
- Clean separation: Transform messages after openaiMessages construction (line 183-207 in aiService.ts)
- Preserve existing flow: Minimal changes to callAgent function structure  
- Type safety: Extend OpenAI types with Claude-specific cache_control fields
- Utility pattern: New `utils/cacheControlUtils.ts` follows existing codebase organization

**Alternatives considered**:
- Early injection in convertMessagesForAPI: Rejected due to tight coupling with message conversion logic
- Post-API wrapper: Rejected due to complexity and performance overhead
- Inline transformation: Rejected for maintainability and separation of concerns

## Claude Cache Control API Specification

**Decision**: Structured content arrays with selective cache_control markers

**Rationale**:
```typescript
// Transform string content to structured arrays
{
  role: "system",
  content: "text" // Before
}
// Becomes:
{
  role: "system", 
  content: [
    {
      type: "text",
      text: "text",
      cache_control: { type: "ephemeral" }
    }
  ]
}
```

**Key Implementation Details**:
- **Content Type Support**: Only `type: "text"` parts receive cache_control markers
- **Placement Rules**: System messages (always), every 20th message (interval-based), last tool definition
- **Type Extension**: Extend OpenAI interfaces with optional cache_control field
- **Mixed Content**: Preserve existing structure, add cache_control only to text parts

**Alternatives considered**:
- Universal cache markers: Rejected due to API limitations and cost efficiency
- First/middle message caching: Rejected due to lower cache hit probability
- All tools caching: Rejected for cost optimization (last tool most frequently reused)

## Extended Usage Tracking Schema

**Decision**: Extend existing usage tracking with cache-specific metrics from both Claude top-level fields and OpenAI-standard `prompt_tokens_details`

**Rationale**:
```typescript
interface ExtendedPromptTokensDetails extends CompletionUsage.PromptTokensDetails {
  cache_creation_input_tokens?: number;  // Used by some non-Claude models
}

interface ClaudeUsage extends CompletionUsage {
  // Standard fields unchanged
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;

  // Cache fields (from Claude top-level OR OpenAI prompt_tokens_details)
  cache_read_input_tokens?: number;        // Claude: top-level / OpenAI: prompt_tokens_details.cached_tokens
  cache_creation_input_tokens?: number;    // Claude: top-level / OpenAI: prompt_tokens_details.cache_creation_input_tokens
  cache_creation?: {
    ephemeral_5m_input_tokens: number;     // Short-term cache (Claude-specific)
    ephemeral_1h_input_tokens: number;     // Extended cache (Claude-specific)
  };

  prompt_tokens_details?: ExtendedPromptTokensDetails;  // Override to include cache_creation_input_tokens
}
```

**Field Relationships**:
- `cache_creation_input_tokens = ephemeral_5m_input_tokens + ephemeral_1h_input_tokens` (Claude-specific)
- Claude top-level fields take priority over `prompt_tokens_details` when both are present
- `prompt_tokens_details.cached_tokens` maps to `cache_read_input_tokens` as fallback
- `prompt_tokens_details.cache_creation_input_tokens` maps to `cache_creation_input_tokens` as fallback
- Backward compatibility maintained for existing usage tracking consumers

**Alternatives considered**:
- Separate cache usage object: Rejected for API consistency and complexity
- Simplified cache metrics: Rejected due to insufficient cost tracking granularity
- Breaking usage interface changes: Rejected for backward compatibility requirements
- Only support Claude top-level fields: Rejected because non-Claude models (Gemini, DeepSeek) return cache data via `prompt_tokens_details`

## System Prompt Stability: CWD Changes

**Decision**: Use `originalWorkdir` (immutable) instead of `workdir` (dynamic, tracks `cd`) for the `Primary working directory` field in the system prompt's `<env>` section.

**Rationale**:
- The system prompt is rebuilt every AI turn with `this.getWorkdir()` (current CWD from DI container)
- When an agent runs `cd subdir` in Bash, `workdir` updates, causing the `<env>` section to change
- This invalidates the entire cached system prompt prefix, negating cache benefits
- Claude Code accidentally avoids this by caching/freezing the env section at first computation
- Using `originalWorkdir` (set once at session start, never updated) keeps the `<env>` section stable
- The model still learns about CWD changes from the Bash tool's `"Shell working directory changed to X"` output
- The `buildPostCompactContext` `[Working Directory]` section was removed since it's redundant (system prompt already shows `Primary working directory`) and could vary across compactions

**Implementation**:
- `buildSystemPrompt` options: added `originalWorkdir?: string` field
- `<env>` section: `Working directory: ${options.workdir}` → `Primary working directory: ${options.originalWorkdir ?? options.workdir}`
- `enhanceSystemPromptWithEnvDetails`: added `originalWorkdir` parameter, same change
- `aiManager.ts` call site: pass `originalWorkdir: this.getOriginalWorkdir()`
- `buildPostCompactContext`: removed `[Working Directory]` section (Claude Code doesn't include it)

**Alternatives considered**:
- Show both `Primary working directory` and `Current shell directory`: Rejected because adding a varying field to the `<env>` section would still break prompt cache
- Reset CWD after every bash command (like Claude Code's opt-in `CLAUDE_BASH_MAINTAIN_PROJECT_WORKING_DIR`): Rejected as too disruptive to agent workflow; the model may legitimately need to run commands in a subdirectory
- Freeze/cached the env section like Claude Code: Rejected because Wave rebuilds the system prompt every turn (intentionally, for freshness of other fields like date); the better fix is to make the env section content stable

## Type Safety Strategy

**Decision**: Create Claude-specific type extensions without breaking existing contracts

**Rationale**:
- Extend OpenAI types with optional cache_control fields
- Maintain strict TypeScript compilation without `any` types
- Preserve existing message processing type safety
- Use composition over inheritance for type evolution (Constitution principle IX)

**Implementation Pattern**:
```typescript
interface ClaudeChatCompletionContentPartText extends ChatCompletionContentPartText {
  cache_control?: { type: "ephemeral" };
}
```

**Alternatives considered**:
- Type assertions: Rejected due to reduced type safety
- New interfaces: Rejected to follow type evolution principle
- Runtime type guards only: Rejected due to lack of compile-time safety