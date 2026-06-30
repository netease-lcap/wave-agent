# Research: Simplify Skill

## Decision: Review + Auto-Fix (Not Report-Only)
- **Rationale**: `/simplify` is the "apply fixes" counterpart to `/code-review` (report-only). Developers want a one-step cleanup: review for quality issues, then fix them immediately. This avoids the round-trip of reading a report and manually applying fixes.
- **Alternatives considered**:
  - Report-only (like `/code-review`): Rejected — duplicates `/code-review`'s workflow; quality fixes are low-risk and safe to auto-apply.
  - Review + suggest fixes without applying: Rejected — extra step for the developer.

## Decision: Three Parallel Agents (Reuse / Quality / Efficiency)
- **Rationale**: The three quality dimensions are independent and cover the most common degradation patterns. Parallel execution reduces latency. Each agent gets a focused context for its dimension.
- **Alternatives considered**:
  - Single agent reviewing all dimensions: Rejected — context dilution, slower, shallower per-dimension coverage.
  - Sequential dimension agents: Rejected — latency multiplies.
  - Five agents (like `/code-review max`): Rejected — `/simplify` is quality-focused, not bug-focused; three dimensions suffice.

## Decision: Quality-Only (No Bug Hunting)
- **Rationale**: Separating quality from correctness lets developers choose the right tool. Bug hunting requires careful, confidence-scored review (provided by `/code-review`). Quality cleanup is lower-risk and faster, suitable for auto-fix.
- **Alternatives considered**:
  - Combined quality + bug review: Rejected — conflates two concerns; bug findings would need confidence scoring (adds latency), and auto-fixing bugs is riskier than auto-fixing quality issues.

## Decision: `git diff` with Staged-Change Fallback
- **Rationale**: `git diff` captures unstaged changes (the common case). When changes are staged, `git diff HEAD` captures both staged and unstaged. This covers the typical "I just edited some files" workflow without requiring commits.
- **Alternatives considered**:
  - `git diff --cached` only: Rejected — misses unstaged changes.
  - Review last commit: Rejected — too narrow; developers often clean up before committing.

## Decision: Fallback to Recently-Modified Files
- **Rationale**: When there are no git changes (e.g., the agent just edited files in-session), reviewing the files the user mentioned or the agent edited earlier keeps the skill useful in conversational workflows.
- **Alternatives considered**:
  - Stop with "nothing to review": Rejected — too rigid for in-session editing flows.

## Decision: `disable-model-invocation: true`
- **Rationale**: `/simplify` applies code changes and launches multiple subagents. Auto-triggering on casual mentions would make unintended modifications. Restricting to explicit `/simplify` invocation keeps it intentional.
- **Alternatives considered**:
  - Model-invocable: Rejected — risk of unintended code modifications and token spend.

## Integration Points
- Skill frontmatter (`disable-model-invocation`) — parsed by the existing skill system (spec 006).
- Agent tool — used to launch parallel review subagents (spec 009/041).
- Write/Edit tools — used to apply fixes in Phase 3.
- Bash command placeholders (`!`git diff``) — executed by the existing skill bash substitution (spec 006).
