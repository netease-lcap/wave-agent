# Feature Specification: CLI Worktree Support

**Feature Branch**: `068-worktree`  
**Created**: 2026-02-27  
**Input**: User description: "wave code cli support -w or --worktree <feat-name> to create worktree at .wave/worktrees/<feat-name>. if no <feat-name>, system should generate one, just like plan file name do. when exit wave code cli, it should popup this: Exiting worktree session
 You have 1 uncommitted file. These will be lost if you remove the worktree.

 ❯ Keep worktree    Stays at /path/to/repo/.wave/worktrees/merry-crafting-sutherland
   Remove worktree  All changes and commits will be lost.

 Enter to confirm · Esc to cancel

Exiting worktree session
 You have 1 commit on worktree-merry-crafting-sutherland. The branch will be deleted if you remove the worktree.

 ❯ Keep worktree    Stays at /path/to/repo/.wave/worktrees/merry-crafting-sutherland
   Remove worktree  All changes and commits will be lost.

 Enter to confirm · Esc to cancel. if no commit or uncommit, exit without confirm."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Create Worktree with Name (Priority: P1)

As a developer, I want to start a Wave session in a dedicated git worktree with a specific name so that I can work on a feature without affecting my main working directory.

**Why this priority**: This is the core functionality of the feature.

**Independent Test**: Run `wave code -w my-feature`, verify that a worktree is created at `.wave/worktrees/my-feature` and the CLI starts in that directory.

**Acceptance Scenarios**:

1. **Given** I am in a git repository, **When** I run `wave code --worktree my-feat`, **Then** a new git worktree is created at `.wave/worktrees/my-feat`.
2. **Given** a worktree is created, **When** the Wave CLI starts, **Then** its working directory is set to the new worktree path.

---

### User Story 2 - Auto-generated Worktree Name (Priority: P1)

As a developer, I want to quickly start a worktree session without thinking of a name, so that I can start working immediately.

**Why this priority**: Essential for ease of use and matches the requested behavior.

**Independent Test**: Run `wave code -w`, verify a worktree is created with a generated name (e.g., `gentle-swift-breeze`) at `.wave/worktrees/<generated-name>`.

**Acceptance Scenarios**:

1. **Given** I am in a git repository, **When** I run `wave code -w`, **Then** the system generates a name like `merry-crafting-sutherland`.
2. **Given** a name is generated, **When** the worktree is created, **Then** it uses the generated name.

---

### User Story 3 - Exit with Uncommitted Changes (Priority: P1)

As a developer, I want to be warned if I have uncommitted changes when exiting a worktree session, so that I don't accidentally lose my work.

**Why this priority**: Prevents data loss, which is critical for user trust.

**Independent Test**: Start a worktree session, create a new file, exit the CLI, and verify the "Exiting worktree session" prompt appears with the "uncommitted file" message.

**Acceptance Scenarios**:

1. **Given** I am in a worktree session with 1 uncommitted file, **When** I exit the CLI, **Then** I see a prompt: "You have 1 uncommitted file. These will be lost if you remove the worktree."
2. **Given** the exit prompt is shown, **When** I select "Keep worktree", **Then** the worktree remains at its location and the CLI exits.
3. **Given** the exit prompt is shown, **When** I select "Remove worktree", **Then** the worktree is deleted and the CLI exits.

---

### User Story 4 - Exit with New Commits (Priority: P2)

As a developer, I want to be warned if I have new commits when exiting a worktree session, so that I know the branch will be deleted if I remove the worktree.

**Why this priority**: Important for managing git history and branches.

**Independent Test**: Start a worktree session, make a commit, exit the CLI, and verify the prompt mentions the commit and branch deletion.

**Acceptance Scenarios**:

1. **Given** I am in a worktree session with 1 new commit, **When** I exit the CLI, **Then** I see a prompt: "You have 1 commit on worktree-<name>. The branch will be deleted if you remove the worktree."
2. **Given** the exit prompt is shown, **When** I select "Remove worktree", **Then** the worktree and its associated branch are deleted.

---

### User Story 5 - Clean Exit (Priority: P2)

As a developer, I want the CLI to automatically clean up the worktree if I haven't made any changes, so that I don't have to manually delete empty worktrees.

**Why this priority**: Improves user experience by automating cleanup for "read-only" or "no-change" sessions.

**Independent Test**: Start a worktree session, make no changes, exit the CLI, and verify it exits immediately and the worktree directory and branch are deleted.

**Acceptance Scenarios**:

1. **Given** I am in a worktree session with no uncommitted changes and no new commits, **When** I exit the CLI, **Then** it exits immediately, and the git worktree and its associated branch are deleted.

---

### User Story 6 - Mid-Session EnterWorktree Tool (Priority: P1)

As a developer using Wave, I want to create a worktree mid-session by asking the AI, so that I can isolate my work without restarting the session.

**Why this priority**: Matches Claude Code's EnterWorktree tool behavior and enables AI-driven workflow.

**Independent Test**: Start a Wave session in any directory, ask the AI to "create a worktree", verify that a worktree is created and the session's working directory changes to the new worktree.

**Acceptance Scenarios**:

1. **Given** I am in a git repository, **When** I ask the AI to "create a worktree", **Then** the AI invokes the `EnterWorktree` tool and a new git worktree is created.
2. **Given** EnterWorktree is invoked, **When** the tool executes, **Then** the session's working directory switches to the new worktree path.
3. **Given** I ask the AI to create a worktree with a specific name, **When** the AI invokes EnterWorktree with `name`, **Then** the worktree uses that name.
4. **Given** no name is provided, **When** EnterWorktree is invoked, **Then** a random name is generated (e.g., `swift-fox-123`).
5. **Given** I am already in a worktree session, **When** the AI invokes EnterWorktree, **Then** the tool fails with an error indicating I'm already in a worktree session.
6. **Given** I am not in a git repository, **When** the AI invokes EnterWorktree, **Then** the tool fails with an error indicating no git repository is available.

---

### User Story 7 - Mid-Session ExitWorktree Tool (Priority: P1)

As a developer using Wave, I want to exit a worktree mid-session by asking the AI, so that I can return to my original working directory without ending the session.

**Why this priority**: Matches Claude Code's ExitWorktree tool behavior and enables AI-driven workflow.

**Independent Test**: Start a worktree session via EnterWorktree, ask the AI to "exit the worktree" with `action: "keep"`, verify the session returns to the original directory and the worktree is preserved.

**Acceptance Scenarios**:

1. **Given** I am in a worktree session created by EnterWorktree, **When** I ask the AI to "exit the worktree" with `action: "keep"`, **Then** the session returns to the original directory and the worktree is preserved.
2. **Given** I am in a worktree session, **When** I ask the AI to "exit the worktree" with `action: "remove"`, **Then** the session returns to the original directory and the worktree is deleted.
3. **Given** I am in a worktree session with uncommitted changes, **When** the AI invokes ExitWorktree with `action: "remove"` and no `discard_changes`, **Then** the tool refuses and lists the uncommitted files and commits.
4. **Given** I am in a worktree session with uncommitted changes, **When** the user confirms discard, **Then** the AI re-invokes with `discard_changes: true` and the worktree is removed.
5. **Given** no EnterWorktree session is active, **When** the AI invokes ExitWorktree, **Then** the tool returns a no-op message without making any filesystem changes.

---

### Edge Cases

- **What happens when the worktree directory already exists?** The system should probably error out or ask to reuse it.
- **How does system handle git errors during worktree creation?** It should display a clear error message and exit gracefully.
- **What if the user is not in a git repository?** The `-w` flag should fail with an error message.

## Assumptions

- The system has `git` installed and accessible in the environment's PATH.
- The current working directory is a git repository when `-w` is used.
- The auto-generated name follows the `adjective-adjective-noun` pattern from the `generateRandomName` utility.
- "Remove worktree" implies both `git worktree remove --force` and `git branch -D` to ensure cleanup even if changes exist or the branch isn't merged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support `-w` and `--worktree [feat-name]` command-line arguments.
- **FR-002**: System MUST generate a unique feature name (e.g., `adjective-adjective-noun`) if `<feat-name>` is not provided.
- **FR-003**: System MUST create a git worktree at `.wave/worktrees/<feat-name>` (absolute path) relative to the **main repository root** (even if run from within a worktree), branching from the default remote branch (identified via `git symbolic-ref refs/remotes/origin/HEAD`).
- **FR-004**: System MUST name the worktree branch `worktree-<feat-name>`.
- **FR-005**: System MUST call `process.chdir()` to the worktree path to ensure the process's working directory matches the worktree, facilitating tmux and other window-copying features.
- **FR-006**: System MUST detect uncommitted changes (staged or unstaged, identified via `git status --porcelain`) in the worktree upon exit.
- **FR-007**: System MUST detect commits made in the worktree that are not in the default remote branch (identified via `git log @{u}..HEAD`) upon exit.
- **FR-008**: System MUST display an interactive prompt if uncommitted changes or new commits exist upon exit.
- **FR-009**: The exit prompt MUST offer two options: "Keep worktree" and "Remove worktree".
- **FR-010**: "Keep worktree" MUST exit the CLI while leaving the worktree directory intact.
- **FR-011**: "Remove worktree" MUST delete the git worktree (using `git worktree remove --force`) and the worktree branch (using `git branch -D`).
- **FR-012**: System MUST exit without a prompt AND delete the git worktree and branch if no changes or commits are detected.
- **FR-013**: System MUST error and exit if `-w` or `--worktree` is used outside of a git repository.
- **FR-014**: System MUST handle `SIGINT` (Ctrl+C) and `SIGTERM` signals by triggering the exit detection and prompt flow.
- **FR-015**: If the user cancels the exit prompt (e.g., via Esc), the CLI MUST return to the active session.
- **FR-016**: If a worktree with the same name already exists, the system MUST reuse it and skip the creation step.
- **FR-017**: Exit detection MUST complete within 500ms to avoid noticeable lag for the user.
- **FR-018**: System MUST trigger a `WorktreeCreate` hook event when a new worktree is created.
- **FR-019**: The `WorktreeCreate` hook MUST provide a JSON input via stdin containing a `name` field. The hook MUST execute in the newly created worktree directory.
- **FR-020**: The `WorktreeCreate` hook MUST NOT be triggered when reusing an existing worktree.
- **FR-021**: System MUST automatically deny `Write` and `Edit` tool operations that attempt to modify files in the main repository (outside the current worktree) during a worktree session.
- **FR-022**: The auto-deny mechanism MUST provide a descriptive error message explaining that modifications to the main repository are restricted while in a worktree session.
- **FR-023**: The auto-deny mechanism MUST NOT restrict modifications to the current plan file, even if it is located outside the worktree.
- **FR-024**: System MUST provide an `EnterWorktree` tool that creates a git worktree and switches the session's working directory to it.
- **FR-025**: The `EnterWorktree` tool MUST accept an optional `name` parameter. If not provided, a random name MUST be generated.
- **FR-026**: The `EnterWorktree` tool MUST validate the worktree name to prevent path traversal and invalid characters (max 64 chars, only letters, digits, dots, underscores, dashes, and `/` for nesting).
- **FR-027**: The `EnterWorktree` tool MUST fail if already in an active worktree session (module-level state).
- **FR-028**: The `EnterWorktree` tool MUST fail if not in a git repository, with an error message suggesting WorktreeCreate/WorktreeRemove hooks.
- **FR-029**: The `EnterWorktree` tool MUST update the session's working directory via `AIManager.setWorkdir()` (which updates the DI container and calls `process.chdir()`).
- **FR-030**: System MUST provide an `ExitWorktree` tool that exits a worktree session and restores the original working directory.
- **FR-031**: The `ExitWorktree` tool MUST accept a required `action` parameter: `"keep"` (preserve worktree) or `"remove"` (delete worktree).
- **FR-032**: The `ExitWorktree` tool MUST accept an optional `discard_changes` parameter (default `false`). When `action` is `"remove"` and the worktree has uncommitted files or new commits, the tool MUST refuse unless `discard_changes: true`.
- **FR-033**: The `ExitWorktree` tool MUST be a no-op if no active EnterWorktree session exists (no filesystem changes).
- **FR-034**: The `ExitWorktree` tool MUST restore the session's working directory to the original CWD via `AIManager.setWorkdir()`.
- **FR-035**: When `action` is `"remove"`, the system MUST delete the worktree directory using `git worktree remove --force` and the associated branch using `git branch -D`.
- **FR-036**: The `EnterWorktree` tool MUST NOT trigger the `WorktreeCreate` hook event (hook support is out of scope for mid-session tools).

### Key Entities

- **Worktree**: Represents a git worktree session.
    - **Name**: The identifier for the worktree and branch.
    - **Path**: The filesystem path where the worktree is located (`.wave/worktrees/<name>`).
    - **Status**: Whether it has uncommitted changes or new commits.
