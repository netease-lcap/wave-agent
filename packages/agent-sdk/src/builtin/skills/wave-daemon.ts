import { BASH_TOOL_NAME, READ_TOOL_NAME } from "../../constants/tools.js";

export const waveDaemonSkill: Record<string, string> = {
  "skills/wave-daemon/SKILL.md": `---
name: wave-daemon
description: Delegate a development or research task to a background wave daemon session — session creation in an isolated worktree, dispatching messages, aborting and re-scoping, monitoring progress, approving permissions, answering AskUserQuestion, and tearing sessions down with destroy.
allowed-tools: ${BASH_TOOL_NAME}(wave daemon *), ${BASH_TOOL_NAME}(git *), ${READ_TOOL_NAME}
---

# Wave daemon delegation

Delegate development work (code changes, bug fixes, features) and research work (reading code and producing conclusions — which often turns into code changes) to a **wave daemon session** instead of doing the long task inline. A daemon session runs in the background with no UI window, keeps generating while no client is attached, and survives client disconnects.

The authoritative command reference is the Wave documentation, CLI → *Daemon client commands* (\`docs/cli.md\` in the Wave repo). This skill is the playbook: what to run, in what order, and the traps to avoid.

## 0. Mental model

- \`wave --daemon <socket>\` starts the daemon (server side). \`wave daemon <subcommand>\` is the client that talks to it. The two never interfere.
- Every client subcommand connects to the fixed socket \`~/.wave/daemon.sock\` (\`$HOME/.wave/daemon.sock\`); there is no \`--socket\` override, so you are always talking to this machine's daemon for the current user.
- The daemon is **resident**: once started it does not exit when idle. It goes away only when stopped (\`wave daemon stop\`), killed, restarted after a CLI upgrade, or the machine restarts. It is not supervised by pm2/systemd, so it does not come back by itself.
- Every subcommand except \`stop\` starts a daemon on demand when the socket is absent, then retries. "No daemon is running" is therefore never a problem to work around — just run the command.
- Sessions are persisted as transcripts under \`~/.wave/projects/<project>/<sessionId>.jsonl\`, so a session can be re-hosted from disk after the daemon restarts.
- All subcommands are non-interactive: results on stdout, diagnostics on stderr.

## 1. Daemon lifecycle

\`\`\`bash
wave daemon stop      # graceful: every hosted session is destroyed (each saves its transcript), the socket is removed, the process exits; idempotent ("Daemon is not running" when none is up)
wave daemon restart   # stop the old daemon (if any), then start a fresh one from the current CLI
\`\`\`

**After upgrading the CLI, restart the daemon** — it runs the code it was started with and will not pick up a new build on its own. This is the main reason \`restart\` exists.

One-off edge: \`stop\` / \`restart\` cannot stop a daemon that predates the \`shutdown\` RPC (i.e. one still running an older build). The wait times out — \`daemon did not exit within 10000ms\` — because the old process ignores the request and the socket stays up. Kill that process yourself, then run any client subcommand (e.g. \`wave daemon list\`) to start a daemon from the current CLI; \`restart\` works normally from then on.

## 2. Creating a session

\`\`\`bash
wave daemon create --worktree [name] --workdir <dir> --permission-mode bypassPermissions
\`\`\`

- Prints the new sessionId on the first line (scripts read it from there), plus a second line with the worktree path and branch when \`--worktree\` was used.
- \`--worktree\` creates the session in a fresh git worktree, so it never touches your main checkout. The name is optional — one is generated when omitted.
- \`--permission-mode\` defaults to \`bypassPermissions\` for daemon-created sessions, so a session created this way raises no approval prompts at all. Passing the flag explicitly is redundant but fine and self-documenting. Valid modes: \`default\`, \`bypassPermissions\`, \`acceptEdits\`, \`plan\`, \`dontAsk\`.
- \`--workdir\` defaults to the current directory.

## 3. Dispatching work and following up

\`\`\`bash
wave daemon send <sessionId> <message>                # async dispatch (the default)
wave daemon send <sessionId> <message> --wait 600     # wait up to 600s and print the reply
\`\`\`

- The default is fire-and-forget: the command exits 0 (printing \`Sent message to session: <sessionId>\`) as soon as the message is **delivered**. On an idle session it lands in history and the turn starts; on a busy session it is queued and takes effect when the current turn finishes.
- \`--wait <seconds>\` blocks until the reply to *that* message arrives and prints only the assistant's final reply text. On timeout it exits non-zero; if the session is stuck on a pending approval it says so and points at \`respond\`.
- A \`send --wait\` failure of \`Message aborted before producing a reply\` means the turn was interrupted mid-generation — the message was delivered, it just never produced text.

**An interrupted send is not a lost message.** If the shell or tool running \`wave daemon send\` is interrupted or times out, the message may already have been delivered and be executing in the daemon. Verify with \`wave daemon status <sessionId>\` before resending — a duplicate send duplicates the work.

## 4. Changing your mind: abort first

A \`send\` to a *generating* session is queued, not applied immediately — the current turn runs to completion first. To correct a task or change its scope mid-flight:

\`\`\`bash
wave daemon abort <sessionId>     # interrupt in-flight generation (subagents, bash commands and queued messages included)
wave daemon send <sessionId> <corrected task>
\`\`\`

\`abort\` is idempotent and a no-op on an idle session, so it is safe to run without checking first. It does not clear completed history, and it does **not** touch the session's permission mode — the session stays live in the daemon's memory.

## 5. Monitoring

\`\`\`bash
wave daemon list                   # sessions currently live in the daemon's in-memory registry
wave daemon status <sessionId>     # one session: status, pending approvals, and the last message
wave daemon status <id> --lines 0  # status line only — no message text (status-only polling)
wave daemon status <id> --lines 5  # widen the context window when the last message is not enough
\`\`\`

\`status\` reports one of three states — \`idle\`, \`generating\`, or \`waiting for approval\` (listed with the pending request ids). It is plain text; there is no \`--json\`.

\`--lines N\` prints the last N messages. **The default is 1** — the last message alone — because message text is never truncated, so a single long report is already tens of thousands of characters; the default has to stay bounded. N counts messages, not output lines.

- \`--lines 0\` prints no message text at all — just the header and the \`Status:\` line. Use it when a poll only needs the status (cheaper than pulling a report you will not read).
- text is whitespace-collapsed, and tool-only messages print nothing (they still count toward N);
- it is the last N **messages**, so behind a long tail of intermediate narration ("still investigating…") the final report can fall outside the window.

So the final report is what the default \`status <id>\` already gives you; raise \`--lines\` only when the last message is not the report you want.

Do not hand-parse the transcript jsonl (\`~/.wave/projects/<project>/<sessionId>.jsonl\`) to recover a report — \`status <id>\` is the supported path. If you ever do read the raw file: each line is one message (\`{"timestamp":…,"role":…,"blocks":[…]}\`) and text lives in \`blocks[].content\` on the \`{"type":"text"}\` block. There is no \`blocks[].text\` field, so a lookup by \`text\` silently returns nothing and looks like "the session never reported".

For long tasks, poll from a **background** command rather than blocking on \`--wait\`. Any periodic poll works — the shape is:

\`\`\`bash
while true; do
  out=$(wave daemon status "$SESSION_ID" --lines 0)
  echo "$out"
  case "$out" in
    *"Status: idle"*|*"waiting for approval"*) break ;;
  esac
  sleep 30
done
\`\`\`

There is no bundled watcher script — this loop is a pattern to re-create per session with whatever background-execution mechanism your host offers (on Windows, PowerShell's \`Start-Sleep\` in place of \`sleep\`), and one poller per session so they do not interfere. \`waiting for approval\` is an action signal (go answer it, §6); \`idle\` means the turn settled and is worth a look.

An \`idle\` reading can also be a transient pause between turns (waiting on a verification run, a CI job, or a pending approval). Re-check \`status\` before concluding the task is finished, and re-arm the poll if the session goes back to \`generating\`.

## 6. Permission approvals

\`\`\`bash
wave daemon respond <sessionId> <requestId> --allow
wave daemon respond <sessionId> <requestId> --deny --reason "why"
wave daemon respond <sessionId> <requestId> --allow --rule "Bash(ls)"              # persist this allow rule for the session
wave daemon respond <sessionId> <requestId> --allow --mode bypassPermissions      # switch the session's permission mode
\`\`\`

- Exactly one of \`--allow\` / \`--deny\` is required. \`respond\` validates the requestId first (\`Request not found or already handled\`) and refuses to touch another session's request.
- \`--mode\` also applies a mode switch, so after that one answer the session stops asking. Requests already queued still need their own \`respond\`.
- An \`acceptEdits\` session asks for approval on every shell command; approving them one at a time cannot keep up with generation. Switch the mode with \`--mode bypassPermissions\` instead of responding in a loop.

**The root cause of an approval flood is a restarted daemon process.** The permission mode is not recorded in the session transcript, so when a new daemon process re-hosts a session from disk (after \`stop\` / a kill, a CLI-upgrade restart, or a machine reboot), the mode is re-derived from the current configuration — \`permissions.defaultMode\` from settings, else \`default\`. A session created with \`bypassPermissions\` therefore comes back as \`default\` and starts asking for approvals.

- \`abort\` does **not** cause this: the session stays in the daemon's memory with its mode intact. If approvals suddenly flood after a long interruption, look for a daemon restart, not for \`abort\`.
- Recovery is one command: \`respond <requestId> --allow --mode bypassPermissions\`.
- The symptom can be masked: if the repository's settings set \`permissions.defaultMode: bypassPermissions\`, the re-derived mode is bypass anyway and you will never see the fallback.

## 7. AskUserQuestion requests

\`status\` renders a pending \`AskUserQuestion\` in full: every question as \`Q<i> [header] <question>\`, with its options numbered from 0. Those option numbers are what \`--answer\` accepts.

\`\`\`bash
wave daemon respond <sessionId> <requestId> --allow --answer "0"       # option 0 of the only question
wave daemon respond <sessionId> <requestId> --allow --answer "1,0"     # one option number per question, in order
\`\`\`

The older form still works: a JSON object keyed by the full question text, with the chosen option label as the value — exactly what the GUI dialog submits:

\`\`\`bash
wave daemon respond <sessionId> <requestId> --allow --answer '{"<full question text>":"<option label>"}'
\`\`\`

Whether to answer at all depends on whether the user is around:

- If the user can see the session (they have the desktop app open), do not answer for them — relay the question and let them choose.
- If the user has explicitly handed the work over and is away ("I'm offline, it's on you"), answer with the recommended option (the first one, or an option the question marks as recommended), then report what you answered so they can override it.

Answering resolves the request and the session resumes generating on its own — no extra nudge is needed, though \`status\` may briefly still read \`generating\`.

## 8. Finishing: destroy, and the worktree

\`\`\`bash
wave daemon destroy <sessionId> --remove-worktree
\`\`\`

- \`destroy\` is idempotent, and does not require the session to be live in the registry.
- \`--remove-worktree\` is **two steps**: it resolves the session's worktree from its working directory and removes it (path + branch, through the worktree-removal protocol, which also fires the WorktreeRemove hook) and then destroys the session. It refuses to remove the main working tree, so a session that was not created in a linked worktree just fails that step.
- Because it is two steps, an interrupted \`destroy --remove-worktree\` can be **half-done**: the worktree directory, its branch and uncommitted changes are already gone while the session is still alive. After such an interruption verify all three: \`wave daemon list\` / \`status\` (is the session still there?), \`git worktree list\` and the repo's worktree directory (folder + branch), and \`~/.wave/projects/\` (transcript). A session that was killed but whose transcript survives is still recoverable from the jsonl.
- Destroy is destructive and irreversible: confirm with the user before running it.

Whose session is it? Only tear down sessions you created with \`wave daemon create\`. Never destroy a session created by the desktop app — the user may still be using it — or one you do not recognize. If you cannot tell who created it, ask.

## 9. Checklist

- Create with \`--worktree\` and \`--permission-mode bypassPermissions\` (the mode default is already bypass, so no approvals appear).
- \`send\` is async by default; after any interruption, check \`status\` before resending.
- \`abort\` before re-scoping a running session.
- Read the final report with \`status <id>\` (defaults to the last message; raise \`--lines\` if that one is not it).
- An approval flood means the daemon process restarted and the mode fell back — recover with \`--mode bypassPermissions\`.
- After a CLI upgrade, \`wave daemon restart\` (kill the old process first if \`restart\` times out).
- \`destroy --remove-worktree\` last, after user confirmation, only for sessions you created.
- Sessions the desktop app manages churn quickly on their own; a shifting \`wave daemon list\` is normal, not a fault.
`,
};
