# Feature Specification: CLI Worktree Support

**Feature Branch**: `068-cli-worktree`  
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
- **FR-003**: System MUST create a git worktree at `.wave/worktrees/<feat-name>` (absolute path) branching from the default remote branch (identified via `git symbolic-ref refs/remotes/origin/HEAD`).
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

### Key Entities

- **Worktree**: Represents a git worktree session.
    - **Name**: The identifier for the worktree and branch.
    - **Path**: The filesystem path where the worktree is located (`.wave/worktrees/<name>`).
    - **Status**: Whether it has uncommitted changes or new commits.
