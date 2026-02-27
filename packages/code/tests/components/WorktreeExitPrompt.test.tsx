import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import { WorktreeExitPrompt } from '../../src/components/WorktreeExitPrompt.js';

describe('WorktreeExitPrompt', () => {
  it('should render the prompt with worktree name', () => {
    const { lastFrame } = render(
      <WorktreeExitPrompt
        name="gentle-swift-breeze"
        hasUncommittedChanges={true}
        hasNewCommits={false}
        onKeep={vi.fn()}
        onRemove={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(lastFrame()).toContain("Worktree 'gentle-swift-breeze' has changes");
    expect(lastFrame()).toContain("Uncommitted changes detected");
    expect(lastFrame()).toContain("Keep worktree");
    expect(lastFrame()).toContain("Remove worktree");
  });

  it('should show both changes and commits if present', () => {
    const { lastFrame } = render(
      <WorktreeExitPrompt
        name="gentle-swift-breeze"
        hasUncommittedChanges={true}
        hasNewCommits={true}
        onKeep={vi.fn()}
        onRemove={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(lastFrame()).toContain("Uncommitted changes detected");
    expect(lastFrame()).toContain("New commits detected");
  });

  it('should handle arrow keys and enter to select options', async () => {
    const onKeep = vi.fn();
    const onRemove = vi.fn();
    const { stdin, lastFrame } = render(
      <WorktreeExitPrompt
        name="gentle-swift-breeze"
        hasUncommittedChanges={true}
        hasNewCommits={false}
        onKeep={onKeep}
        onRemove={onRemove}
        onCancel={vi.fn()}
      />
    );

    // Default is Keep
    expect(lastFrame()).toContain("> Keep worktree");
    
    // Press down to select Remove
    stdin.write('\u001b[B'); // Down arrow
    await vi.waitFor(() => expect(lastFrame()).toContain("> Remove worktree"));

    // Press up to select Keep again
    stdin.write('\u001b[A'); // Up arrow
    await vi.waitFor(() => expect(lastFrame()).toContain("> Keep worktree"));

    // Press enter to confirm Keep
    stdin.write('\r');
    await vi.waitFor(() => expect(onKeep).toHaveBeenCalled());

    // Select Remove and confirm
    stdin.write('\u001b[B'); // Down arrow
    await vi.waitFor(() => expect(lastFrame()).toContain("> Remove worktree"));
    stdin.write('\r');
    await vi.waitFor(() => expect(onRemove).toHaveBeenCalled());
  });

  it('should handle escape to cancel', async () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <WorktreeExitPrompt
        name="gentle-swift-breeze"
        hasUncommittedChanges={true}
        hasNewCommits={false}
        onKeep={vi.fn()}
        onRemove={vi.fn()}
        onCancel={onCancel}
      />
    );

    stdin.write('\u001b'); // Escape
    await vi.waitFor(() => expect(onCancel).toHaveBeenCalled());
  });
});
