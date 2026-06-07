# Feature Specification: Workflow — Deterministic Multi-Subagent Orchestration

**Feature Branch**: `080-workflow`
**Created**: 2026-06-07
**Input**: Claude Code Dynamic Workflows — https://code.claude.com/docs/en/workflows

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Run a workflow to explore a codebase (Priority: P1)

As a user, I want to ask the agent to "use a workflow" to explore a codebase, so that it orchestrates multiple subagents in parallel (scan, analyze per-file, synthesize) instead of doing it sequentially in one context.

**Why this priority**: This is the core use case — parallel multi-agent work at scale that a single conversation turn cannot coordinate.

**Independent Test**: Create a sample project, send a message asking the agent to "use a workflow to explore this project", verify the Workflow tool is called with a script containing `agent()`, `pipeline()`, and `phase()`, and the final result is a synthesized overview.

**Acceptance Scenarios**:

1. **Given** a project directory with source files, **When** the user says "use a workflow to explore this project", **Then** the agent calls the Workflow tool with a JS script that uses `agent()`, `pipeline()`, and `phase()`.
2. **Given** a running workflow, **When** the workflow completes, **Then** a `<task-notification>` is injected into the conversation and the agent reports the results.
3. **Given** a workflow with multiple phases, **When** the user runs `/workflows`, **Then** the system lists the run with name, status, agent count, and token usage.

---

### User Story 2 - Opt-in enforcement (Priority: P1)

As a user, I want the Workflow tool to only be invoked when I explicitly request multi-agent orchestration, so that the agent doesn't silently spawn dozens of agents for simple tasks.

**Why this priority**: Without opt-in, workflows could consume massive tokens without user awareness.

**Independent Test**: Send a simple question that doesn't request a workflow, verify the agent uses the Agent tool or answers directly — NOT the Workflow tool.

**Acceptance Scenarios**:

1. **Given** the user says "find all TODO comments", **When** the agent processes the request, **Then** the agent does NOT call the Workflow tool (uses Agent tool or answers directly).
2. **Given** the user says "use a workflow to find all TODO comments", **When** the agent processes the request, **Then** the agent calls the Workflow tool.
3. **Given** the user invokes `/deep-research <question>`, **When** the slash command executes, **Then** the Workflow tool is called with the deep-research script.

---

### User Story 3 - Resume a workflow from journal (Priority: P2)

As a user, I want to resume a stopped workflow from where it left off, so that completed agents don't re-run and tokens aren't wasted.

**Why this priority**: Resume saves significant tokens for long workflows that are interrupted or need editing mid-run.

**Independent Test**: Run a workflow, stop it mid-execution, call Workflow with `resumeFromRunId`, verify cached agent results are returned instantly and only new/changed agents run live.

**Acceptance Scenarios**:

1. **Given** a workflow run that completed 5 of 10 agents before being stopped, **When** the user resumes with `resumeFromRunId`, **Then** agents 0-4 return cached results instantly and agents 5-9 run live.
2. **Given** a resumed workflow, **When** the script is identical with the same args, **Then** 100% of agent calls return cached results (full cache hit).

---

### User Story 4 - Structured output from agents (Priority: P2)

As a user, I want workflow agents to return structured JSON matching a schema, so that downstream stages can reliably process the results without fragile text parsing.

**Why this priority**: Multi-stage pipelines need machine-readable data flow between stages.

**Independent Test**: Call `agent('List all files', {schema: {type: 'object', properties: {files: {type: 'array'}}, required: ['files']}})`, verify the result is a validated object, not a string.

**Acceptance Scenarios**:

1. **Given** an agent call with `opts.schema`, **When** the subagent completes, **Then** the result is a validated object matching the schema.
2. **Given** an agent call with `opts.schema` where the subagent doesn't call StructuredOutput, **When** the agent completes, **Then** the system falls back to JSON.parse on the final text.
3. **Given** an agent call without `opts.schema`, **When** the subagent completes, **Then** the result is the agent's final text as a string.

---

### Edge Cases

- **Banned patterns in scripts**: Scripts containing `require()`, `process.env`, `Date.now()`, `Math.random()`, `import`, `eval()` are rejected at validation time.
- **Common English words allowed**: "process" in descriptions (e.g., `{title: 'Process', detail: 'process each item'}`) does NOT trigger the banned pattern check — only `process.` (property access) is banned.
- **Agent limit exceeded**: If a script spawns more than 1000 agents, the 1001st agent() call throws an error.
- **Budget exceeded**: If a token budget is set and exceeded, further agent() calls throw.
- **Abort mid-run**: If the user stops a workflow, all in-flight agents are cancelled and the run status is set to "aborted".
- **Workflow tool in subagent**: The Workflow tool is denied in subagents (prevents infinite recursion).
- **Script persistence**: Every Workflow invocation persists the script to the session directory, even if execution fails.
- **Nested workflow stub**: The `workflow()` API function currently throws "not yet implemented" — it is a placeholder for future nested workflow support.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a `Workflow` tool that the AI model calls with a JavaScript `script`, optional `args`, optional `scriptPath`, and optional `resumeFromRunId`.
- **FR-002**: The Workflow tool MUST only be invoked when the user explicitly opts into multi-agent orchestration — via direct request in their words, a slash command, or a named workflow invocation.
- **FR-003**: Every workflow script MUST begin with `export const meta = {name, description, phases?}` followed by a plain JavaScript body. The meta MUST be a pure literal.
- **FR-004**: Scripts MUST execute in a sandboxed async context via `new Function()` with APIs injected as closure variables: `agent()`, `parallel()`, `pipeline()`, `phase()`, `log()`, `args`, `budget`, `workflow()`.
- **FR-005**: The runtime MUST reject scripts containing banned patterns: `require()`, `process.`, `eval()`, `import`, `Date.now()`, `Math.random()`, argless `new Date()`, `fs.*`/`require('fs')`, `child_process`, `__dirname`, `__filename`, `global.`, `globalThis`.
- **FR-006**: Workflows MUST run in the background. The Workflow tool returns immediately with a run ID and script path.
- **FR-007**: Concurrent `agent()` calls MUST be capped at `min(16, cpu_cores - 2)`. Total agent count per run MUST be capped at 1000. A single `parallel()`/`pipeline()` call MUST accept at most 4096 items.
- **FR-008**: `agent(prompt, opts?)` MUST accept `opts.schema`, `opts.label`, `opts.phase`, `opts.model`, `opts.agentType`, return `null` on user skip or terminal error, check budget before spawning, and check abort signal.
- **FR-009**: `pipeline(items, stage1, stage2, ...)` MUST run each item through all stages independently with no barrier between stages. Every stage callback receives `(prevResult, originalItem, index)`. In the first stage `prevResult` is `undefined`.
- **FR-010**: `parallel(thunks)` MUST run tasks concurrently and await ALL before returning. Rejected thunks resolve to `null`.
- **FR-011**: When `agent()` is called with `opts.schema`, the system MUST inject a StructuredOutput tool instruction, register a temporary StructuredOutput tool, extract and validate the result after completion, and fall back to JSON.parse on the agent's final text.
- **FR-012**: Every `agent()` call MUST append its result to a JSONL journal. On `resumeFromRunId`, cached results for the unchanged prefix MUST be returned instantly.
- **FR-013**: The system MUST track token usage across all workflow agents. `budget.total` is the ceiling, `budget.spent()` returns total output tokens, `budget.remaining()` returns the remaining amount. Agent calls MUST throw when budget is exceeded.
- **FR-014**: The system MUST report workflow progress via the `/workflows` slash command: current phase, agent counts per phase, token totals, elapsed time.
- **FR-015**: Every Workflow invocation MUST persist its script to the session directory. Users can edit and re-invoke with `{scriptPath}`.
- **FR-016**: System MUST provide a `/workflows` slash command listing all runs with name, status, agent count, token usage, and elapsed time.
- **FR-017**: System MUST provide a `/deep-research <question>` slash command that executes a built-in workflow: search → fetch → verify → synthesize.
- **FR-018**: A `WorkflowManager` MUST manage the full lifecycle: create, start, stop, resume, list, cleanup.
- **FR-019**: Workflows MUST respect `AbortSignal`. Stopping sets status to "aborted" and cancels in-flight agents.
- **FR-020**: Workflow completion notifications (`task-type=workflow`, `status=completed|failed|aborted`) MUST be enqueued via `NotificationQueue` and automatically injected into the AI conversation loop.

### Key Entities

- **WorkflowRun**: `{runId, meta, status, scriptPath, args, startTime, endTime, phases[], totalAgents, totalTokens, result, error}` — in-memory state of a workflow run.
- **WorkflowMeta**: `{name, description, whenToUse?, phases[]}` — script metadata declared at the top of every workflow script.
- **JournalEntry**: `{agentIndex, prompt, opts, result, tokens}` — one line in the JSONL journal, enabling deterministic resume.
- **BudgetInfo**: `{total, spent(), remaining()}` — token budget tracking object available in scripts.
- **WorkflowManager**: Lifecycle manager registered in the DI container. Delegates to `SubagentManager` for agent spawning, `BackgroundTaskManager` for background execution, and `NotificationQueue` for completion notifications.
- **ScriptRuntime**: Validates scripts, parses meta, and executes via `new Function()` with injected API closures.
