/**
 * Built-in skill holding the complete Workflow-script authoring reference.
 *
 * The Workflow tool description uses progressive disclosure: it keeps the
 * shape/signature essentials plus a pointer to this skill, and inlines the full
 * reference only when the model cannot load the skill on demand (skill disabled or
 * unavailable). `WORKFLOW_AUTHORING_REFERENCE` is the single source of truth for
 * that reference — the SKILL.md body and the tool's inline fallback are the same
 * string, so the two cannot drift apart.
 */

export const WORKFLOW_AUTHORING_REFERENCE = `# Workflow authoring reference

Complete reference for writing a Workflow script. Read it before writing one: a
misread signature does not fail loudly — it surfaces as \`undefined\` or empty
results and costs a probe round to track down.

## Script shape

Every script must begin with \`export const meta = {...}\` — a pure literal, and the
script's first statement. Variable references, function calls, spreads, template
interpolation and computed keys are rejected (they would break resume), as is a
\`meta\` that is not the first statement.

  export const meta = {
    name: 'find-flaky-tests',
    description: 'Find flaky tests and propose fixes',
    phases: [
      { title: 'Scan', detail: 'grep test logs for retries' },
      { title: 'Fix', detail: 'one agent per flaky test' },
    ],
  }
  // script body starts here — use agent()/parallel()/pipeline()/phase()/log()

\`name\` and \`description\` are required. \`phases\` is optional and display-only:
every element is \`{ title, detail? }\` (an element of any other shape is dropped).
\`phase(title)\` is what actually groups subsequent \`agent()\` calls.

## Hooks

- **agent(prompt, opts?)** — spawn a subagent. Without \`opts.schema\` it resolves to
  the subagent's final text, as a string. With \`opts.schema\` (a JSON Schema) the
  subagent is handed a StructuredOutput tool and asked to call it in the conversation
  (a nudge, retried at most 5 times — the schema is never forced through
  \`tool_choice\`, which would fail for thinking models), and \`agent()\` resolves to
  the validated object. An invalid or unsatisfiable schema fails before the subagent
  starts, and five nudges without a valid result throw instead of falling back to
  scraping JSON out of the text. It resolves to \`null\` only when the user skips that
  agent; a terminal error in the subagent throws, so catch it if you want a fallback
  (drop nulls with \`.filter(Boolean)\`). \`opts.label\` overrides the
  display label, \`opts.phase\` assigns the agent to a progress group, \`opts.model\`
  overrides the model for this call, and \`opts.agentType\` uses a custom subagent
  type instead of the default.
- **pipeline(items, stage1, stage2, ...)** — run each item through all stages
  independently, with NO barrier between stages: item A can be in stage 3 while item
  B is still in stage 1. This is the DEFAULT for multi-stage work. Every stage
  callback receives \`(prevResult, originalItem, index)\` — in the first stage
  \`prevResult\` is the item itself, in later stages it is the return value of the
  previous stage, and \`index\` is the item's position in \`items\`. A stage that
  throws drops that item to \`null\`; a stage that returns \`null\` skips the
  remaining stages for that item.
  - one stage: \`pipeline(files, (prev, file) => agent('Read ' + file))\`
  - two stages: \`pipeline(files, (prev, file) => agent('Read ' + file), (prev, file) => agent('Summarize: ' + prev))\`
- **parallel(thunks)** — \`thunks\` is an \`Array<() => Promise<any>>\`; runs them
  concurrently and resolves to their results in order. This is a BARRIER: it awaits
  all thunks before returning. Every entry must be a function — \`parallel([agent('x')])\`
  throws, because the calls would already have run eagerly, with no concurrency or
  ordering guarantee. A thunk that throws resolves to \`null\` in the result array.
  Use it ONLY when you genuinely need all results together.
- **phase(title)** — start a new phase; subsequent \`agent()\` calls are grouped under
  this title.
- **log(message)** — emit a progress message.
- **args** — the value passed as Workflow's \`args\` input, verbatim.
- **getFailures()** — the run's failure list, in Claude Code's format
  (\`pipeline[3] failed: <message>\`; token-budget drops appear as one aggregate
  \`… slot(s) dropped\` line instead of one per slot). \`pipeline()\`/\`parallel()\`
  fill it; so does **\`recordFailure(message)\`**, for a failure your own \`catch\`
  decided on. Use \`recordFailure()\` whenever you swallow an error — a run that
  hides why an item vanished is worse than one that reports it.
- **getAgentCount()** and **getStats()** — how far this run has got. \`getAgentCount()\`
  is the number of \`agent()\` calls started (entries replayed from a resumed
  journal included); \`getStats()\` is \`{ completed, failed, skipped, empty, toolUses }\`,
  the same per-outcome tallies the completion report's \`<usage>\` block is built
  from. Read them when the script has to ration its own fan-out (stop before a
  self-imposed ceiling) or to report honestly how much of the work it dropped.
- **budget** — \`{ total, spent(), remaining() }\`. The turn's token target: \`total\`
  is the number the user gave for this turn, or \`null\` when they gave none (then
  \`remaining()\` is \`Infinity\`). It is a hard cap, not a suggestion — once spent
  reaches the total, further \`agent()\` calls throw (in-flight agents still finish and
  their results are kept). A "loop until the budget runs out" pattern must therefore
  carry its own hard iteration cap. \`spent()\` is the whole turn's output-token spend,
  shared with the main loop and any other workflow of the same turn — not this run's
  own total.

Failures are surfaced, not swallowed: the completion notification carries a \`<usage>\`
block with the per-agent tallies (\`agent_count\` / \`agents_done\` / \`agents_error\` /
\`agents_skipped\` / \`agents_empty_result\` / \`subagent_tokens\` / \`tool_uses\` /
\`duration_ms\`), the individual \`pipeline[i] failed: …\` / \`parallel[i] failed: …\`
lines, and the per-agent result files, so read them before treating a finished run as
a good one. A skipped agent (\`agents_skipped\`) is NOT an error — it is the only
\`null\` return.

DEFAULT TO \`pipeline()\`. Only reach for a barrier (\`parallel\` between stages) when
you genuinely need ALL prior-stage results together.

## Determinism and limits

Scripts are plain JavaScript, NOT TypeScript — type annotations fail to parse. The
body runs in an async context, so use \`await\` directly. Standard JS built-ins
(\`JSON\`, \`Math\`, \`Array\`, …) are available — EXCEPT \`Date.now()\`,
\`Math.random()\` and argless \`new Date()\`, which throw (they would break resume).
No filesystem, network or Node.js API access, and no \`import\`.

Concurrent \`agent()\` calls are capped at \`min(16, cpu cores - 2)\` per workflow.
Total agent count is capped at 1000 per run — the 1001st \`agent()\` throws, which
usually means an unbounded loop. A single \`parallel()\`/\`pipeline()\` call accepts at
most 4096 items.

## Choosing a shape

Common single-phase workflows you can chain across turns:
- **Understand** — parallel readers over relevant subsystems → structured map
- **Design** — judge panel of N independent approaches → scored synthesis
- **Review** — dimensions → find → adversarially verify
- **Research** — multi-modal sweep → deep-read → synthesize
- **Migrate** — discover sites → transform each (worktree isolation) → verify

For larger work, run several in sequence — read each result before deciding the next
phase. The right move is often **hybrid**: scout inline first (list the files, find
the channels, scope the diff) to discover the work-list, then call Workflow to
pipeline over it.

## Quality patterns

- **Adversarial verify**: spawn N independent skeptics per finding, each prompted to
  REFUTE. Kill if >= majority refute.
- **Judge panel**: generate N independent approaches, score with parallel judges,
  synthesize from the winner.
- **Loop-until-dry**: keep spawning finders until K consecutive rounds return
  nothing new.
- **Multi-modal sweep**: parallel agents each searching a different way
  (by-container, by-content, by-entity).
- **Completeness critic**: a final agent that asks "what's missing?" — findings
  become the next round of work.
- **No silent caps**: if a workflow bounds coverage, \`log()\` what was dropped.

## Resume

The tool result includes a \`runId\`. To resume after a pause, kill, or script edit,
relaunch with \`Workflow({ scriptPath, resumeFromRunId })\` — the longest unchanged
prefix of \`agent()\` calls returns cached results instantly; the first edited/new
call and everything after it runs live. Only an identical script with identical
\`args\` is a full cache hit, so keep early calls stable when you edit a long run.

**Same session only.** A run belongs to the session that started it: its journal —
and therefore its cache — is reachable only from that session, so a run id from
another session or another working directory will not resume. Stop the prior run
first (\`TaskStop\` with the run id) if it is still going.

## Example — fan out, then adversarially verify

  export const meta = {
    name: 'audit-error-handling',
    description: 'Audit error handling across the API layer',
    phases: [
      { title: 'Find', detail: 'one finder per subsystem' },
      { title: 'Verify', detail: 'independent voters per finding' },
    ],
  }

  phase('Find')
  const subsystems = ['api', 'jobs', 'webhooks']
  const found = await pipeline(subsystems, (prev, name) =>
    agent('List every unhandled error path in the ' + name + ' subsystem. One bullet per finding.', {
      label: 'find:' + name,
      phase: 'Find',
    })
  )

  phase('Verify')
  const claims = found.filter(Boolean).flatMap(text => text.split('\\n').map(line => line.trim()).filter(Boolean))
  const verdicts = await parallel(claims.slice(0, 12).map(claim => () =>
    agent('Try to REFUTE this finding: ' + claim + ' — search for counter-evidence.', {
      phase: 'Verify',
    })
  ))

  return { claims, verdicts }
`;

export const workflowAuthoringSkill: Record<string, string> = {
  "skills/workflow-authoring/SKILL.md": `---
name: workflow-authoring
description: Complete authoring reference for Workflow scripts — hook signatures and options, meta shape, args/budget semantics, resume, concurrency and scale limits, quality patterns, and a runnable example. Load it before writing a workflow script.
---

${WORKFLOW_AUTHORING_REFERENCE}`,
};
