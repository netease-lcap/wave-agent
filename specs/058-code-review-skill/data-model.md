# Data Model: Code Review Skill

## Configuration

### EffortLevel Mapping

| Effort | Agent Count | Confidence Threshold | Review Agents |
|--------|-------------|----------------------|---------------|
| `low` | 2 | 90 | Bug Scanner, AGENTS.md Compliance |
| `medium` (default) | 3 | 80 | Bug Scanner, AGENTS.md Compliance, Git History Context |
| `high` | 4 | 70 | Bug Scanner, AGENTS.md Compliance, Git History Context, Code Reuse & Quality |
| `max` | 5 | 60 | Bug Scanner, AGENTS.md Compliance, Git History Context, Code Reuse & Quality, Efficiency Review |

## Review Agents

| Agent | Effort Levels | Focus |
|-------|---------------|-------|
| Bug Scanner | all | Shallow scan for obvious, large bugs in the diff; avoid nitpicks and false positives |
| AGENTS.md Compliance | all | Audit changes against root + modified-directory AGENTS.md files |
| Git History Context | medium+ | Read `git blame` and history of modified code to find context-dependent bugs |
| Code Reuse & Quality | high+ | Search for existing utilities; flag redundant state, parameter sprawl, copy-paste, leaky abstractions, stringly-typed code, unnecessary comments |
| Efficiency Review | max only | Unnecessary work, missed concurrency, hot-path bloat, no-op updates, existence checks, memory leaks, overly broad operations |

## Confidence Rubric

| Score | Meaning |
|-------|---------|
| `0` | False positive that doesn't stand up to light scrutiny, or a pre-existing issue |
| `25` | Might be real, may be a false positive; unverifiable. Stylistic issues not in AGENTS.md |
| `50` | Verified real issue, but a nitpick or rare in practice; not very important relative to the PR |
| `75` | Highly confident; double-checked; very likely hit in practice; existing approach insufficient; important or directly mentioned in AGENTS.md |
| `100` | Absolutely certain; confirmed real; happens frequently; evidence directly confirms |

## Finding

| Field | Type | Description |
|-------|------|-------------|
| `description` | `string` | Brief description of the bug/issue |
| `agentsMdQuote` | `string?` | Verbatim quote from AGENTS.md if the finding violates a rule |
| `contextSnippet` | `string?` | File and code snippet explaining the bug (e.g. "bug due to <file and code snippet>") |
| `file` | `string` | File path where the issue occurs |
| `lineRange` | `string` | Line range citation (e.g. `42-58`) |
| `confidence` | `number` | Independent 0–100 score from the scoring agent |

## Relationships
- An **EffortLevel** maps to a set of **ReviewAgent**s and a confidence threshold.
- Each **ReviewAgent** produces zero or more candidate **Finding**s (pre-scoring).
- Each candidate **Finding** is scored by exactly one independent **ScoringAgent**.
- Only **Finding**s with `confidence >= threshold` are delivered.
- Delivery is **comment-first**: if a **Platform** CLI is available and a **CommentTarget** (PR/MR) exists, findings are posted as a comment and NOT output to terminal. Otherwise, findings fall back to direct terminal output.
- If no findings pass the threshold, nothing is posted or output.

## Platform Detection

| Remote URL Pattern | Platform | CLI | Comment Command |
|--------------------|----------|-----|-----------------|
| contains `github` | `github` | `gh` | `gh pr comment --body "<review>"` |
| contains `gitlab` | `gitlab` | `glab` | `glab mr note --message "<review>"` |
| other | `unknown` | N/A | skip (direct output only) |

## CommentTarget

| Field | Type | Description |
|-------|------|-------------|
| `platform` | `'github' \| 'gitlab' \| 'unknown'` | Detected from remote URL |
| `cliInstalled` | `boolean` | Whether the corresponding CLI is available |
| `prOrMrExists` | `boolean` | Whether a PR/MR exists for the current branch |
| `commentPosted` | `boolean` | Whether the review was successfully posted as a comment |
