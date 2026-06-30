# Research: Code Review Skill

## Decision: Use `git diff` Instead of `gh` for Change Discovery
- **Rationale**: `gh` ties the skill to GitHub-hosted repos and requires authentication. `git diff` works with any git host — GitLab, self-hosted, or local-only — and needs no credentials. The merge-base against `main` captures the full branch diff; `HEAD~1` is a safe fallback when `main` is absent.
- **Alternatives considered**:
  - `gh pr diff`: Rejected — GitHub-only, requires `gh` CLI + auth, fails on self-hosted/git-local repos.
  - `git diff` with hardcoded `main`: Rejected without fallback — breaks on repos without a local `main` branch.

## Decision: Configurable Effort Level (low/medium/high/max)
- **Rationale**: Review depth should scale with change risk. A one-line fix needs a quick high-confidence pass; a large refactor benefits from broader coverage. Mapping each level to a fixed agent count + confidence threshold makes the tradeoff explicit and predictable.
- **Alternatives considered**:
  - Single fixed depth: Rejected — either too noisy for small changes or too shallow for large ones.
  - Continuous confidence threshold argument: Rejected — users think in discrete effort tiers, not raw numbers.

## Decision: Parallel Review Agents per Dimension
- **Rationale**: Review dimensions (bugs, compliance, history, reuse, efficiency) are independent. Running them as parallel subagents reduces wall-clock latency and gives each dimension a focused context window.
- **Alternatives considered**:
  - Single agent reviewing all dimensions: Rejected — context dilution, slower, misses cross-dimension breadth.
  - Sequential dimension agents: Rejected — latency multiplies with dimension count.

## Decision: Independent Confidence Scoring per Finding
- **Rationale**: A reviewing agent that found an issue is biased toward believing it's real. A separate scoring agent, given the diff + issue description + AGENTS.md context, provides an independent 0–100 assessment. Filtering by threshold then suppresses false positives predictably.
- **Alternatives considered**:
  - Self-reported confidence from the reviewing agent: Rejected — same-context bias, tends to over-score its own findings.
  - No scoring, report everything: Rejected — too noisy, especially at higher effort levels.

## Decision: Report-Only (No Auto-Fix)
- **Rationale**: Code review reports findings; the developer decides what to fix. Auto-fixing would conflate review with modification and reduce trust in the report. This contrasts with the sibling `/simplify` skill, which does apply fixes.
- **Alternatives considered**:
  - Review + auto-fix: Rejected — scope creep; user may want to evaluate findings before acting. `/simplify` already covers the fix-applied workflow.

## Decision: `disable-model-invocation: true`
- **Rationale**: Code review is a deliberate, user-initiated action — it gathers the current diff and spends multiple subagent calls. Auto-triggering on casual "review my code" mentions would waste tokens and produce noisy reports against stale diffs. Restricting to explicit `/code-review` invocation keeps it intentional.
- **Alternatives considered**:
  - Model-invocable: Rejected — risk of unintended multi-agent fan-out on ambiguous requests.

## Decision: Fixed Rubric Anchors (0/25/50/75/100)
- **Rationale**: A fixed rubric with five anchors gives scoring agents a shared calibration scale, making scores comparable across findings and runs. The rubric text is passed verbatim to every scoring agent.
- **Alternatives considered**:
  - Free-form score: Rejected — no calibration, scores inconsistent across agents.

## Decision: Detect Platform and Post Comment via `gh`/`glab` (Optional)
- **Rationale**: Posting the review as a PR/MR comment makes findings visible to the whole team and persists alongside the code. Detecting the platform from the remote URL and checking for the corresponding CLI (`gh` for GitHub, `glab` for GitLab) keeps the skill host-agnostic — it works with either platform and falls back to direct terminal output when no CLI is available.
- **Alternatives considered**:
  - GitHub-only via `gh` (like Claude Code's plugin): Rejected — Wave supports GitLab and self-hosted git; locking comment posting to GitHub excludes non-GitHub users.
  - Always post via API calls (no CLI): Rejected — requires storing tokens and reimplementing API clients; `gh`/`glab` CLIs already handle auth.
  - Never post, always output directly: Rejected — loses the team visibility benefit when a CLI is available.

## Decision: Comment-First, Terminal Fallback (Not Both)
- **Rationale**: When a platform CLI (`gh`/`glab`) is available and a PR/MR exists, posting the review as a comment is the primary delivery — the team sees it on the PR/MR. Outputting to the terminal as well is redundant noise. Only when no CLI or PR/MR exists do we fall back to terminal output. This matches Claude Code's `/code-review` plugin, which posts to the PR and produces no terminal output.
- **Alternatives considered**:
  - Always output to terminal, optionally also comment: Rejected — redundant when a comment is posted; the user would see the same content twice.
  - Always comment, never output: Rejected — fails when no CLI is installed or no PR/MR exists; the user would lose the findings.

## Decision: No Output When No Issues
- **Rationale**: If no findings pass the confidence threshold, there is nothing to report. Posting an empty comment or printing "no issues" adds noise. The skill says "no issues" briefly and stops — no comment posted, no findings output. This matches Claude Code's behavior (step 6: "do not proceed").
- **Alternatives considered**:
  - Post a "no issues found" comment: Rejected — noise on the PR for no actionable content.

## Decision: Platform Detection via Remote URL Substring
- **Rationale**: Checking if the remote URL contains `github` or `gitlab` is simple and covers the common cases (github.com, gitlab.com, and most self-hosted instances with those names in the domain).
- **Alternatives considered**:
  - API probing (try `gh api` / `glab api`): Rejected — slower, requires auth just to detect the platform.
  - Config file: Rejected — adds configuration burden for something detectable from git.

## Integration Points
- Skill frontmatter (`allowed-tools`, `disable-model-invocation`) — parsed by the existing skill system (spec 006).
- `$ARGUMENTS` substitution — effort level passed by the existing parameter system (spec 006).
- Bash command placeholders (`!`git diff``) — executed by the existing skill bash substitution (spec 006).
- Agent tool — used to launch parallel review and scoring subagents (spec 009/041).
- `gh` CLI — used for GitHub PR comment posting (optional, detected at runtime).
- `glab` CLI — used for GitLab MR comment posting (optional, detected at runtime).
