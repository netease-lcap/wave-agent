# Claude Code Compaction Logic - Findings

## Overview

Claude Code implements a multi-layered conversation compaction system with several strategies that work together to manage context window limits. The system lives in `src/services/compact/` and `src/commands/compact/`.

## Architecture: Multiple Compaction Layers

### 1. Microcompact (Pre-processing, runs before every API call)

**File**: `src/services/compact/microCompact.ts`

Microcompact runs **before every API request** to reduce token usage without needing AI summarization. Two strategies:

#### a) Time-based Microcompact
- **Trigger**: Time gap since last assistant message exceeds threshold (e.g., 30 minutes)
- **Action**: Content-clears old tool results, keeping only the most recent N results
- **Mechanism**: Replaces tool_result content with `"[Old tool result content cleared]"`
- **Rationale**: Cache has expired due to inactivity, so rewriting the full prefix anyway - might as well clear old content to shrink what gets rewritten
- **Keeps**: At least 1 most recent tool result (never clears all)

#### b) Cached Microcompact (Cache-editing path)
- **Trigger**: Count-based threshold from GrowthBook remote config
- **Action**: Uses Anthropic's cache editing API to delete old tool results **without invalidating the cached prefix**
- **Key difference**: Does NOT modify local message content - adds `cache_reference` and `cache_edits` at the API layer
- **Only runs on main thread** to prevent forked agents from corrupting global state
- **Supported models only** (requires cache editing API support)

### 2. Auto-Compact (Token-based summarization)

**File**: `src/services/compact/autoCompact.ts`

#### Trigger Conditions
- Monitors `tokenCountWithEstimation(messages)` after each turn
- Fires when token count exceeds: `effectiveContextWindow - AUTOCOMPACT_BUFFER_TOKENS`
- **AUTOCOMPACT_BUFFER_TOKENS = 13,000** (buffer to leave headroom)
- **MAX_OUTPUT_TOKENS_FOR_SUMMARY = 20,000** (reserved for the summary output)
- Effective context window = model's context window - reserved output tokens

#### Suppression Guards (when NOT to auto-compact)
- `DISABLE_COMPACT` or `DISABLE_AUTO_COMPACT` env vars
- User config `autoCompactEnabled` = false
- Query source is `session_memory` or `compact` (prevents recursion/deadlock)
- `marble_origami` (context-collapse agent - own context management)
- `REACTIVE_COMPACT` feature flag with specific growthbook value
- `CONTEXT_COLLAPSE` feature enabled (alternative context management)

#### Circuit Breaker
- **MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3**
- Stops retrying after 3 consecutive failures to avoid wasting API calls
- Reset on success

#### Flow
1. Check `shouldAutoCompact()` - token count vs threshold
2. **First try Session Memory compaction** (if enabled via feature flags)
3. If SM compaction fails/skipped, fall back to `compactConversation()` (AI summarization)

### 3. Session Memory Compaction (Experimental)

**File**: `src/services/compact/sessionMemoryCompact.ts`

An **alternative to AI summarization** that uses structured session memory as the summary:

#### How it works
- Session memory is continuously updated during the conversation (extracted from interactions)
- When compaction is needed, instead of calling AI to summarize, the session memory file becomes the summary
- **No AI API call needed** for summarization

#### Configuration
- `minTokens`: 10,000 (minimum tokens to preserve)
- `minTextBlockMessages`: 5 (minimum messages with text to keep)
- `maxTokens`: 40,000 (hard cap)

#### Algorithm for `messagesToKeep`
1. Start from `lastSummarizedMessageId` + 1
2. Calculate tokens and text-block-message count from that point to end
3. **Expand backwards** from `startIndex` until:
   - Both minimums are met (minTokens AND minTextBlockMessages), OR
   - Max cap is reached
   - Floor: never goes past the last compact boundary
4. **Preserve API invariants**: `adjustIndexToPreserveAPIInvariants()` ensures:
   - tool_use/tool_result pairs aren't split
   - thinking blocks sharing message.id aren't split

#### Feature gates
- Requires BOTH `tengu_session_memory` AND `tengu_sm_compact` GrowthBook flags
- Env override: `ENABLE_CLAUDE_CODE_SM_COMPACT` / `DISABLE_CLAUDE_CODE_SM_COMPACT`

### 4. Full Conversation Compact (AI Summarization)

**File**: `src/services/compact/compact.ts`

The core summarization compaction that replaces the entire history with a summary.

#### compactConversation()
- Takes all messages, sends them to AI for summarization
- Uses `getCompactPrompt()` for the summarization prompt
- **Forked agent path** (cache sharing): Reuses main conversation's prompt cache for the compact API call
  - Default enabled via `tengu_compact_cache_prefix` feature flag
  - Falls back to regular streaming if cache sharing fails
- **maxTurns: 1** for the forked agent (only one summary turn allowed)
- **Tool use disabled** during compaction (`createCompactCanUseTool()` always denies)

#### Streaming fallback path
- Strips images from messages (not needed for summary, reduces tokens)
- Strips reinjected attachments (skill_discovery/skill_listing)
- Only includes `FileReadTool` and optionally `ToolSearchTool` + MCP tools
- `thinkingConfig: disabled` for the compact call
- `maxOutputTokensOverride` = min(COMPACT_MAX_OUTPUT_TOKENS, model max)
- **Keep-alive**: Sends heartbeat signals every 30 seconds during compaction to prevent WebSocket timeouts

#### Prompt-Too-Long (PTL) Retry
- If the compact request itself hits prompt-too-long:
  - **MAX_PTL_RETRIES = 3**
  - Uses `truncateHeadForPTLRetry()` to drop oldest API-round groups
  - Drops groups until the token gap is covered (or 20% fallback)
  - Prepends a synthetic marker `[earlier conversation truncated for compaction retry]`

#### Post-Compact Attachments (Context Restoration)
After summarization, re-injects important context:
1. **File attachments**: Re-reads up to 5 recently accessed files
   - `POST_COMPACT_MAX_FILES_TO_RESTORE = 5`
   - `POST_COMPACT_TOKEN_BUDGET = 50,000` tokens total
   - `POST_COMPACT_MAX_TOKENS_PER_FILE = 5,000` per file
   - Skips files already present as Read tool results in preserved messages
2. **Plan attachment**: If a plan file exists
3. **Plan mode attachment**: If user is in plan mode
4. **Skill attachment**: Invoked skills content
   - `POST_COMPACT_SKILLS_TOKEN_BUDGET = 25,000`
   - `POST_COMPACT_MAX_TOKENS_PER_SKILL = 5,000` per skill
   - Sorted by most-recently-invoked, truncated per-skill
5. **Async agent attachments**: Running/finished background agents
6. **Delta attachments**: Re-announces full set of tools, agents, MCP instructions (diff against empty history)

#### Post-Compact Hooks
- `executePostCompactHooks()` with trigger ('auto'/'manual') and compactSummary

#### Result Structure
```typescript
interface CompactionResult {
  boundaryMarker: SystemMessage       // Compact boundary marker
  summaryMessages: UserMessage[]      // Summary text as user message
  attachments: AttachmentMessage[]    // Restored context attachments
  hookResults: HookResultMessage[]    // Post-compact hook results
  messagesToKeep?: Message[]          // For partial compact
  preCompactTokenCount: number
  postCompactTokenCount: number
  truePostCompactTokenCount: number   // Estimated size of resulting context
  compactionUsage?: TokenUsage
}
```

### 5. Partial Compact

**File**: `src/services/compact/compact.ts` - `partialCompactConversation()`

Allows summarizing only a **portion** of the conversation while preserving the rest.

#### Two directions
- **`'from'`**: Summarizes messages **after** the pivot index, keeps earlier ones
  - Preserves prompt cache for kept (earlier) messages
- **`'up_to'`**: Summarizes messages **before** the pivot index, keeps later ones
  - Invalidates prompt cache since summary precedes kept messages

#### Key differences from full compact
- Uses `getPartialCompactPrompt()` with different prompt variants
- Strips old compact boundaries from `messagesToKeep` only for `'up_to'` direction
- Re-announces delta attachments diffed against `messagesToKeep` (not full reset)
- Annotates boundary with `preservedSegment` metadata for message chain reconstruction

### 6. Reactive Compact (feature-flagged)

**File**: `src/services/compact/reactiveCompact.ts` (dynamically imported)

Reactive mode: Instead of proactively compacting before hitting the limit, it waits for the API to return a `prompt-too-long` error and then reactively compacts.

#### Flow (from command handler)
1. Try to send the request
2. If API returns `prompt-too-long`, peel messages from the tail and retry
3. Uses `groupMessagesByApiRound()` for fine-grained peeling

### 7. Manual Compact (`/compact` command)

**File**: `src/commands/compact/compact.ts`

User-initiated compaction flow:
1. Strip snipped messages (UI scrollback that was removed)
2. Try session memory compaction first (if no custom instructions)
3. Run microcompact to reduce tokens before summarization
4. Run `compactConversation()` with custom instructions (if provided)
5. Post-compact cleanup

## Token Warning Thresholds

```typescript
AUTOCOMPACT_BUFFER_TOKENS = 13_000        // Buffer left after auto-compact
WARNING_THRESHOLD_BUFFER_TOKENS = 20_000  // Warning UI threshold
ERROR_THRESHOLD_BUFFER_TOKENS = 20_000    // Error UI threshold
MANUAL_COMPACT_BUFFER_TOKENS = 3_000      // Blocking limit for manual compact
```

## Compact Prompt Design

**File**: `src/services/compact/prompt.ts`

### Structure
1. **NO_TOOLS_PREAMBLE**: Explicit instruction to respond with text only, no tool calls
2. **DETAILED_ANALYSIS_INSTRUCTION**: Wraps analysis in `<analysis>` tags as a drafting scratchpad
3. **Summary sections** (9 structured sections):
   - Primary Request and Intent
   - Key Technical Concepts
   - Files and Code Sections (with full code snippets)
   - Errors and fixes
   - Problem Solving
   - All user messages (non-tool results)
   - Pending Tasks
   - Current Work
   - Optional Next Step (with verbatim quotes)
4. **NO_TOOLS_TRAILER**: Reinforcement of text-only requirement

### Prompt Variants
- `BASE_COMPACT_PROMPT`: Full conversation summary ("the conversation so far")
- `PARTIAL_COMPACT_PROMPT`: Recent messages only ("the RECENT portion")
- `PARTIAL_COMPACT_UP_TO_PROMPT`: Summary of prefix before kept messages, includes "Context for Continuing Work" section

### Summary Formatting
- `formatCompactSummary()`: Strips `<analysis>` tags, replaces `<summary>` tags with "Summary:" header
- `getCompactUserSummaryMessage()`: Wraps summary with session continuation preamble

## Grouping Messages by API Round

**File**: `src/services/compact/grouping.ts`

`groupMessagesByApiRound()` groups messages at API-round boundaries:
- One group per API round-trip
- Boundary fires when a NEW assistant response begins (different `message.id`)
- Streaming chunks from the same API response share an ID, so boundaries only fire at genuinely new rounds
- Used by PTL retry to drop oldest groups precisely

## Post-Compact Cleanup

**File**: `src/services/compact/postCompactCleanup.ts`

After any compaction (auto or manual):
1. Reset microcompact state
2. Reset context collapse state (main thread only)
3. Clear `getUserContext` cache and `getMemoryFiles` cache (main thread only)
4. Clear system prompt sections
5. Clear classifier approvals
6. Clear speculative checks
7. Clear beta tracing state
8. Clear session messages cache
9. **Intentionally does NOT** reset `sentSkillNames` (skill content survives across compactions)

## Subagent Awareness

- Subagents (agent:*) run in the same process and share module-level state with main thread
- `querySource` is used to distinguish main-thread vs subagent compactions
- Subagent compactions must NOT reset main-thread module-level state (context-collapse, memory file cache)
- Pattern: `querySource.startsWith('repl_main_thread') || querySource === 'sdk'`

## Telemetry Events

Key events tracked:
- `tengu_compact`: Main compaction event with full metrics
- `tengu_partial_compact`: Partial compaction
- `tengu_compact_failed`: Failure reasons (prompt_too_long, no_summary, api_error, no_streaming_response)
- `tengu_compact_ptl_retry`: Prompt-too-long retry attempts
- `tengu_compact_cache_sharing_success/fallback`: Cache sharing outcomes
- `tengu_compact_streaming_retry`: Streaming retry events
- `tengu_sm_compact_*`: Session memory compaction events
- `tengu_cached_microcompact`: Cache-editing microcompact
- `tengu_time_based_microcompact`: Time-based microcompact
- `tengu_post_compact_file_restore_*`: File restoration outcomes

## How the Layers Work Together

### The Query Loop Pipeline (`src/query.ts`)

Every turn through the main query loop, the following pipeline runs **in order**:

```
User Input
    ↓
1. getMessagesAfterCompactBoundary()   ← strip already-compacted history
    ↓
2. applyToolResultBudget()             ← enforce per-message tool result size limits
    ↓
3. snipCompactIfNeeded()               ← optional: drop old compacted segments
    ↓
4. microcompactMessages()              ← clear old tool results (time-based or cached)
    ↓
5. applyCollapsesIfNeeded()            ← optional: context-collapse feature
    ↓
6. autoCompactIfNeeded()               ← summarization if over token threshold
    ↓
7. callModel()                         ← send to API
```

### Decision Tree at Runtime

```
Each query turn:
│
├─ Is it main thread? (not a subagent)
│  ├─ YES → Run Time-based Microcompact
│  │         (gap since last assistant > threshold?)
│  │         ├─ YES → Clear old tool results, cache is cold
│  │         │        → Skip Cached MC (cache already expired)
│  │         └─ NO  → Fall through
│  │
│  ├─ Is Cached MC enabled + supported model?
│  │         ├─ YES → Register tool results, queue cache_edits
│  │         │        → Delete old tools via API (preserves cache prefix)
│  │         └─ NO  → No microcompact this turn
│  │
│  └─ NO (subagent) → Skip all microcompact
│
├─ Has Context Collapse run? (feature flag)
│  ├─ YES → May have archived old messages already
│  │         → Auto-compact might be a no-op (under threshold now)
│  └─ NO  → Continue
│
└─ Is token count > autoCompact threshold?
      ├─ YES → Auto-compact pipeline:
      │        ├─ Circuit breaker: < 3 consecutive failures?
      │        │  ├─ YES → Continue
      │        │  └─ NO  → Skip (irrecoverable context)
      │        │
      │        ├─ Is Session Memory available + enabled?
      │        │  ├─ YES → SM compaction (no AI call needed!)
      │        │  │         → Keep recent messages (expand to minTokens)
      │        │  │         → Use session memory file as summary
      │        │  │         → Done → runPostCompactCleanup()
      │        │  └─ NO  → Fall back to AI summarization:
      │        │            → compactConversation()
      │        │            → Forked agent (cache sharing) OR streaming
      │        │            → PTL retry if compact itself is too long
      │        │            → Post-compact attachments (files, skills, etc.)
      │        │            → Done → runPostCompactCleanup()
      │        └─ NO → No compaction this turn
      └─ NO  → No compaction needed
```

### Composition Rules

1. **Microcompact + Auto-compact are NOT mutually exclusive**
   - Microcompact runs **first** and reduces tool result tokens
   - Auto-compact checks threshold **after** microcompact has freed tokens
   - If microcompact gets us under threshold → auto-compact is skipped (keeps granular context)
   - If still over threshold → auto-compact fires

2. **Context Collapse takes priority over Auto-compact**
   - Collapse runs before auto-compact
   - If collapse archives enough messages to drop below threshold → auto-compact no-ops
   - This preserves granular individual messages instead of a single summary

3. **Session Memory beats AI summarization**
   - If session memory has content, it's used as the summary (no API call)
   - Only falls back to `compactConversation()` if session memory is empty/unavailable

4. **Snip + Microcompact compose cleanly**
   - Snip may remove old compacted segments
   - Cached MC operates by tool_use_id (never inspects content)
   - Content replacement (snip) is invisible to Cached MC

5. **Boundary marker prevents double-processing**
   - `getMessagesAfterCompactBoundary()` strips pre-compact history
   - Each new turn only processes messages since the last compact boundary
   - Old summaries are never re-summarized

6. **Post-compact cleanup is universal**
   - Runs after ALL compaction paths (auto, manual, session memory, reactive)
   - Resets caches, tracking state, system prompt sections
   - Intentionally preserves skill content across compactions

### The Session Memory + Auto-Compact Relationship

Session Memory acts as a **continuously-updating sidecar summary**:

```
Normal conversation turn:
  → AI responds to user
  → Background: session memory extraction updates the notes file
     (structured format: title, current state, files, errors, etc.)

Auto-compact fires:
  → Check: does session memory have real content?
  → YES → Use it as the compact summary (no AI call!)
     → Calculate messagesToKeep (minTokens + minTextBlockMessages)
     → Truncate oversized sections
     → Build CompactionResult with SM content as summary
  → NO  → Fall back to compactConversation() (AI summarization)
     → Send all messages to AI with compact prompt
     → Get structured summary back
```

### Manual `/compact` Command Flow

```
User types: /compact [optional custom instructions]
    ↓
1. Strip snipped messages (UI-only scrollback)
    ↓
2. Try Session Memory compaction first
   (only if no custom instructions provided)
    ↓
3. Is REACTIVE_COMPACT mode enabled?
   ├─ YES → Route through reactive compact path
   │         → Try to send, if prompt-too-long → peel + retry
   └─ NO  → Continue traditional path
    ↓
4. Run microcompactMessages() (reduce tool result tokens)
    ↓
5. Run compactConversation() with custom instructions
   (forked agent + cache sharing, or streaming fallback)
    ↓
6. Post-compact cleanup
    ↓
7. Display compacted message to user
```

## Key Differences from Wave's Current Implementation

1. **Microcompact layer**: Wave doesn't have pre-request tool result clearing
2. **Session Memory compaction**: Wave doesn't have an alternative summary source
3. **Partial compact**: Wave only has full conversation compaction
4. **Cache sharing**: Wave doesn't reuse prompt cache for the compact API call
5. **PTL retry**: Wave doesn't handle prompt-too-long during the compact request itself
6. **Post-compact context restoration**: Wave's implementation is simpler - no file re-reading, skill attachments, async agent tracking
7. **Circuit breaker**: Wave doesn't limit consecutive auto-compact failures
8. **Message grouping by API round**: Wave's spec mentions keeping last 3 messages; Claude groups by API rounds for more precise truncation
9. **Reactive compact**: Wave doesn't have a reactive (error-driven) compaction path
10. **Token estimation**: Claude uses `roughTokenCountEstimation` with 4/3 padding; Wave uses a different estimation method

## Related Prompt Files

### Core Compaction Prompts
- **`~/github/claude-code/src/services/compact/prompt.ts`** - Main compaction prompt templates
  - `BASE_COMPACT_PROMPT` - Full conversation summary prompt
  - `PARTIAL_COMPACT_PROMPT` - Recent messages only summary prompt
  - `PARTIAL_COMPACT_UP_TO_PROMPT` - Prefix summary for partial compact 'up_to' direction
  - `NO_TOOLS_PREAMBLE` - Text-only enforcement preamble
  - `DETAILED_ANALYSIS_INSTRUCTION_BASE` - Analysis instructions for base compact
  - `DETAILED_ANALYSIS_INSTRUCTION_PARTIAL` - Analysis instructions for partial compact
  - `getCompactPrompt()` - Assembles base compact prompt
  - `getPartialCompactPrompt()` - Assembles partial compact prompt
  - `formatCompactSummary()` - Strips analysis tags and formats summary
  - `getCompactUserSummaryMessage()` - Wraps summary for user display

### Session Memory Prompts
- **`~/github/claude-code/src/services/SessionMemory/prompts.ts`** - Session memory extraction and compaction
  - `DEFAULT_SESSION_MEMORY_TEMPLATE` - Session memory file structure (title, current state, task spec, files, workflow, errors, etc.)
  - `getDefaultUpdatePrompt()` - Instructions for updating session memory during conversation
  - `loadSessionMemoryTemplate()` - Loads custom template from `~/.claude/session-memory/config/template.md`
  - `loadSessionMemoryPrompt()` - Loads custom prompt from `~/.claude/session-memory/config/prompt.md`
  - `truncateSessionMemoryForCompact()` - Truncates oversized sections for compaction
  - `MAX_SECTION_LENGTH = 2000` - Max tokens per section
  - `MAX_TOTAL_SESSION_MEMORY_TOKENS = 12000` - Max total session memory tokens

### System Prompts and Instructions
- **`~/github/claude-code/src/constants/prompts.ts`** - System prompt generation
- **`~/github/claude-code/src/constants/systemPromptSections.ts`** - System prompt section management
- **`~/github/claude-code/src/utils/systemPrompt.ts`** - System prompt assembly utilities

### Hook-Related Prompts
- **`~/github/claude-code/src/utils/hooks.ts`** - Pre/Post compact hook execution
  - `executePreCompactHooks()` - Runs pre_compact hooks, can return custom instructions
  - `executePostCompactHooks()` - Runs post_compact hooks with compact summary

### Context and File References
- **`~/github/claude-code/src/utils/claudemd.ts`** - CLAUDE.md file loading (referenced post-compaction)
- **`~/github/claude-code/src/utils/attachments.ts`** - Attachment generation for post-compact context restoration
- **`~/github/claude-code/src/utils/sessionStart.ts`** - Session start hooks run after compaction
- **`~/github/claude-code/src/utils/sessionStorage.ts`** - Session transcript path management

### External Compact Instructions
Users can provide custom compact instructions via the `/compact` command. These are appended to the base prompt via `mergeHookInstructions()` in `compact.ts`.