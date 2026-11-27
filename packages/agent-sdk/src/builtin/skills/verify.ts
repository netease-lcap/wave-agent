export const verifySkill: Record<string, string> = {
  "skills/verify/SKILL.md": `---
name: verify
description: Verify that a code change actually does what it's supposed to by exercising it end-to-end and observing behavior — drive the affected flow, not just tests or typecheck. Run before committing nontrivial changes; bootstraps this repo's project verify skill if none exists yet. Don't invoke it on a diff that only touches tests, docs, or other code with no runtime surface to drive (a change to product source always has one) — there's nothing to observe.
---

**Verification is runtime observation.** You build the app, run it,
drive it to where the changed code executes, and capture what you
see. That capture is your evidence. Nothing else is.

**Don't run tests. Don't typecheck.** Running them here proves you
can run CI — not that the change works. Not as a warm-up,
not "just to be sure," not as a regression sweep after. The time
goes to running the app instead.

**Don't import-and-call.** \`import { foo } from './src/...'\` then
\`console.log(foo(x))\` is a unit test you wrote. The function did what
the function does — you knew that from reading it. The app never ran.
Whatever calls \`foo\` in the real codebase ends at a CLI, a socket, or
a window. Go there.

## Find the change

The scope is what you're verifying — usually a diff, sometimes just
"does X work." In a git repo, establish the full range (a branch may
be many commits, or the change may still be uncommitted):

\`\`\`bash
git log --oneline @{u}..              # count commits (if upstream set)
git diff @{u}.. --stat                # full range, not HEAD~1
git diff origin/HEAD... --stat        # no upstream: committed vs base
git diff HEAD --stat                  # uncommitted: working tree vs HEAD
gh pr diff                            # if in a PR context
\`\`\`

State the commit count. Large diff truncating? Redirect to a file
then Read it. Repo but no diff from any of these → say so, stop.
**No repo → the scope is whatever the user named; ask if they
didn't.**

**The diff is ground truth. Any description is a claim about it.**
Read both. If they disagree, that's a finding.

## Surface

The surface is where a user — human or programmatic — meets the
change. That's where you observe.

| Change reaches | Surface | You |
|---|---|---|
| CLI / TUI | terminal | type the command, capture the pane — [example](\${WAVE_SKILL_DIR}/examples/cli.md) |
| Server / API | socket | send the request, capture the response — [example](\${WAVE_SKILL_DIR}/examples/server.md) |
| GUI | pixels | drive it under xvfb/Playwright, screenshot |
| Library | package boundary | sample code through the public export — \`import pkg\`, not \`import ./src/...\` |
| Prompt / agent config | the agent | run the agent, capture its behavior |
| CI workflow | Actions | dispatch it, read the run |

**Internal function? Not a surface.** Something in the repo calls it
and that caller ends at one of the rows above. Follow it there. A
bash security gate's surface isn't the function's return value — it's
the CLI prompting or auto-allowing when you type the command.

**No runtime surface at all** — docs-only, type declarations with no
emit, build config that produces no behavioral diff — report
**SKIP — no runtime surface: (reason).** Don't run tests to fill
the space.

**Tests in the diff are the author's evidence, not a surface.** CI
runs them. You'd be re-running CI. Tests-only PR → SKIP, one line.
Mixed src+tests → verify the src, ignore the test files. Reading a
test to learn what to check is fine — it's a spec. But then go run
the app. Checking that assertions match source is code review.

## Get a handle

**Check \`.wave/skills/\` first — even if you already know how to
build and run.** A matching \`verifier-*\` skill is the repo's
evidence-capture protocol: it wraps the session so a reviewer can
replay what you saw (recording, screenshots). Drive the surface
without it and you get a verdict with no replay.

Skills live at the repo root **and** in the package/app dirs the
diff touches — in a monorepo the unlock for \`apps/desktop/\` is
usually \`apps/desktop/.wave/skills/\`, not the root. Probe both:

\`\`\`bash
ls .wave/skills/                       # repo root
ls <touched-dir>/.wave/skills/         # each dir level the diff names
ls .claude/skills/ 2>/dev/null         # repos authored under Claude Code
ls <touched-dir>/.claude/skills/ 2>/dev/null
\`\`\`

- **\`verifier-*\` matching your surface** (CLI verifier for a CLI
  change, etc.) → invoke it with the Skill tool and follow its
  setup. Mismatched surface → skip that one, try the next. Stale
  verifier (fails on mechanics unrelated to the change) → ask the
  user whether to patch it; don't FAIL the change for verifier rot.
- **\`run-*\` but no matching verifier** → use its build/launch
  primitives as your handle.
- **Neither** → cold start from README/package.json/Makefile. Timebox
  ~15min. Stuck → BLOCKED with exactly where, plus a filled-in
  \`/run-skill-generator\` prompt. Got through → **persist what you
  learned**: create \`.wave/skills/verifier-<scope>/SKILL.md\` at the level you
  probed above — repo root for a single-package repo; the touched
  package/app dir (\`apps/desktop/.wave/skills/verifier-<scope>/SKILL.md\`) in
  a monorepo where verification is per-package — capturing the
  build/launch/drive recipe that worked, so the next session skips
  this cold start. Name it \`verifier-<scope>\`, not \`verify\`: at the repo
  root a project skill called \`verify\` replaces the built-in one
  wholesale, and in a package subdirectory a same-named one is ignored
  outright - either way the built-in body is the methodology you would be
  discarding. Keep it short: the commands that worked, the
  flows worth driving, any gotchas. A project verifier-* skill already
  exists → edit it only when it steered you wrong: a documented
  command failed or turned out wrong, or a needed step it doesn't
  cover. Routine learnings don't warrant an edit, and never rewrite
  or reorganize existing content for style.

## Drive it

Smallest path that makes the changed code execute:

- Changed a flag? Run with it.
- Changed a handler? Hit that route.
- Changed error handling? Trigger the error.
- Changed an internal function? Find the CLI command / request / render
  that reaches it. Run that.

**Read your plan back before running.** If every step is build /
typecheck / run test file — you've planned a CI rerun, not a
verification. Find a step that reaches the surface or report BLOCKED.

**The verdict is table stakes. Your observations are the signal.**
A PASS with three sharp "hey, I noticed…" lines is worth more than a
bare PASS. You're the only reviewer who actually *ran* the thing —
anything that made you pause, work around, or go "huh" is information
the author doesn't have. Don't filter for "is this a bug." Filter for
"would I mention this if they were sitting next to me."

**End-to-end, through the real interface.** Pieces passing in
isolation doesn't mean the flow works — seams are where bugs hide.
If users click buttons, test by clicking buttons, not by curling the
API underneath.

**Destructive path?** If the change touches code that deletes,
publishes, sends, or writes outside the workspace and there's no
dry-run or safe target, don't drive it live. Verify what you can
around it and say which path you didn't exercise and why.

## Push on it

The claim checked out — that's the first half. Confirming is step
one, not the job. The description is what the author intended;
your value is what they didn't.

You know exactly what changed. Probe *around* it, at the same
surface you just drove:

- **New flag / option** → empty value, passed twice, combined with a
  conflicting flag, typo'd (does the error name it?)
- **New handler / route** → wrong method, malformed body, missing
  required field, oversized payload
- **Changed error path** → the adjacent errors it didn't touch —
  did the refactor catch them too, or only the one in the diff?
- **Interactive / TUI** → Ctrl-C mid-op, resize the pane, paste
  garbage, rapid-fire the key, Esc at the wrong moment
- **State / persistence** → do it twice, do it with stale state
  underneath, do it in two sessions at once
- **Wander** → what's adjacent? What looked off while you were
  confirming? Go back to it.

These aren't a checklist — pick the ones the change points at. Stop
when you've covered the obvious adjacents or hit something worth a
⚠️. A probe that finds nothing is still a step: "🔍 passed \`--from ''\`
→ clean \`error: --from requires a value\`, exit 2." That the author
didn't test it is exactly why it's worth knowing it holds.

Still not a test run. You're at the surface, typing what a user
would type wrong.

## Capture

Stdout, response bodies, screenshots, pane dumps. Captured output is
evidence; your memory isn't. Something unexpected? Don't route around
it — capture, note, decide if it's the change or the environment.
Unrelated breakage is a finding, not noise.

Shared process state (tmux, ports, lockfiles) — isolate. \`tmux -L
name\`, bind \`:0\`, \`mktemp -d\`. You share a namespace with your host.
Where tmux is unavailable (Windows), isolate with a distinct port plus a temp directory, and drive interactive CLIs through a real ConPTY (node-pty) instead of pipes.

## Report

Inline, final message:

\`\`\`
## Verification: <one-line what changed>

**Verdict:** PASS | FAIL | BLOCKED | SKIP

**Claim:** <what it's supposed to do — your read of the diff and/or
the stated claim; note any mismatch>

**Method:** <how you got a handle — which verifier/run-skill, or
cold start; what you launched>

### Steps

Each step is one thing you did to the **running app** and what it
showed. Build/install/checkout are setup, not steps. Test runs and
typecheck don't belong here — they're CI's output.

1. ✅/❌/⚠️/🔍 <what you did to the running app> → <what you observed>
   <evidence: the app's own output — pane capture, response body,
   screenshot>

🔍 marks a probe — a step off the claim's happy path, trying to
break it. At least one. A Steps list that's all ✅ and no 🔍 is a
happy-path replay: still PASS, but you stopped at the first half.

**Screenshot / sample:** <the one frame a reviewer looks at to see
the feature — an image for GUI/TUI, code block for library/API;
omit for build/types-only>

### Findings
<Things you noticed. Not just bugs — friction, surprises, anything
a first-time user would trip on. "Took three tries to find the right
flag." "Error message on typo was unhelpful." "Default seems odd for
the common case." "Works, but slower than I expected." Lower the bar:
if it made you pause, it goes here. But the pause has to be yours,
from running the app — not from reading the PR page. A red CI check,
a review comment, someone else's bot: visible to anyone already, and
you relaying it isn't an observation. Claim/diff mismatch, pre-existing
breakage, and env notes also belong.

Each probe gets a line here even when it held — "🔍 empty \`--from\`
→ clean error" tells the author what *was* covered, which they
can't see from a bare PASS.

Lead with ⚠️ for lines worth interrupting the reviewer for; plain
bullets are context. Empty is fine if nothing stuck out — but nothing
sticking out is itself rare.>
\`\`\`

**Evidence has to reach the reader.** A file path is only evidence
if the person reading the report can open it. If the \`SendUserFile\`
tool is in your toolset, you're on a remote surface where they
can't — send the screenshots and recordings with it and let the
report name what you sent. Without it, reference the path and keep
the evidence that matters inline — pane captures and response
bodies travel in the report; a bare path only works when the reader
shares your filesystem.

**Verdicts:**
- **PASS** — you ran the app, the change did what it should at its
  surface. Not: tests pass, builds clean, code looks right.
- **FAIL** — you ran it and it doesn't. Or it breaks something else.
  Or claim and diff disagree materially.
- **BLOCKED** — couldn't reach a state where the change is observable.
  Build broke, env missing a dep, handle wouldn't come up. Not a
  verdict on the change. Never report an approach blocked or
  impossible until you've enumerated the skills along the touched
  subtree — environment-specific unlocks (headless runners, login
  helpers, VM harnesses) usually live there. Say exactly where it
  stopped + \`/run-skill-generator\` prompt.
- **SKIP** — no runtime surface exists. Docs-only, types-only,
  tests-only. Nothing went wrong; there's just nothing here to run.
  One line why.

No partial pass. "3 of 4 passed" is FAIL until 4 passes or is
explained away.

**When in doubt, FAIL.** False PASS ships broken code; false FAIL
costs one more human look. Ambiguous output is FAIL with the raw
capture attached — don't interpret.

## User Request

$ARGUMENTS
`,
  "skills/verify/examples/cli.md": `# Verifying a CLI change

The handle is direct invocation. The evidence is stdout/stderr/exit code.

## Pattern

1. Build (if the CLI needs building)
2. Run with arguments that exercise the changed code
3. Capture output and exit code
4. Compare to expected

CLIs are usually the simplest to verify - no lifecycle, no ports.

## Worked example

**Diff:** adds a \`--json\` flag to the \`status\` subcommand. New flag
parsing in \`cmd/status.go\`, new output branch.

**Claim (commit msg):** "machine-readable status output."

**Inference:** \`tool status --json\` now exists, emits valid JSON with
the same fields the human output shows. \`tool status\` without the flag
is unchanged.

**Plan:**
1. Build
2. \`tool status\` -> human output, same as before (non-regression)
3. \`tool status --json\` -> valid JSON, parseable
4. JSON fields match human output fields

**Execute:**
\`\`\`bash
go build -o /tmp/tool ./cmd/tool

/tmp/tool status
# -> Status: healthy
# -> Uptime: 3h12m
# -> Connections: 47

/tmp/tool status --json
# -> {"status":"healthy","uptime_seconds":11520,"connections":47}

/tmp/tool status --json | jq -e .status
# -> "healthy"
# (jq -e exits nonzero if the path is null/false - cheap validity check)

echo $?
# -> 0
\`\`\`

**Verdict:** PASS - flag works, JSON is valid, fields line up.

## What FAIL looks like

- \`unknown flag: --json\` -> not wired up, or you're running a stale build
- Output isn't valid JSON (\`jq\` errors) -> serialization bug
- \`tool status\` (no flag) changed -> regression; the diff touched more
  than it should
- JSON has different field names than expected -> claim/code mismatch,
  might be fine, note it

## Reading from stdin, destructive commands

If the CLI reads stdin -> pipe in test data.
If it writes files / hits a network / deletes things -> point it at a
tmp dir / a mock / a dry-run flag. If there's no safe mode and the
diff touches the destructive path, say so and verify what you can
around it.
`,
  "skills/verify/examples/server.md": `# Verifying a server/API change

The handle is \`curl\` (or equivalent). The evidence is the response.

## Pattern

1. Start the server (background, with a readiness poll - see below)
2. \`curl\` the route the diff touches, with inputs that hit the changed branch
3. Capture the full response (status + headers + body)
4. Compare to expected

## Lifecycle

If there's a run-skill it handles this. If not:

\`\`\`bash
<start-command> &> /tmp/server.log &
SERVER_PID=$!
for i in {1..30}; do curl -sf localhost:PORT/health >/dev/null && break; sleep 1; done
# ... your curls ...
kill $SERVER_PID
\`\`\`

No readiness endpoint? Poll the route you're about to test until it
stops returning connection-refused, then add a beat.

## Worked example

**Diff:** adds a \`Retry-After\` header to 429 responses in \`rateLimit.ts\`.
**Claim (PR body):** "clients can now back off correctly."

**Inference:** hitting the rate limit should now return \`Retry-After: <n>\`
in the response headers. It didn't before.

**Plan:**
1. Start server
2. Hit the rate-limited endpoint enough times to trigger 429
3. Check the 429 response has \`Retry-After\` header
4. Check the value is a positive integer

**Execute:**
\`\`\`bash
# trigger the limit - 10 fast requests, limit is 5/sec per the diff
for i in {1..10}; do curl -s -o /dev/null -w "%{http_code}\\n" localhost:3000/api/thing; done
# -> 200 200 200 200 200 429 429 429 429 429

# capture the 429 headers
curl -si localhost:3000/api/thing | head -20
# -> HTTP/1.1 429 Too Many Requests
# -> Retry-After: 12
# -> ...
\`\`\`

**Verdict:** PASS - \`Retry-After: 12\` present, positive integer.

## What FAIL looks like

- Header absent -> the diff didn't take effect, or you're not actually
  hitting the 429 path (check the status code first)
- Header present but value is \`NaN\` / \`undefined\` / negative -> the
  logic is wrong
- You got 200s all the way through -> you never triggered the changed
  path. Tighten the request burst or check the rate limit config.
`,
};
