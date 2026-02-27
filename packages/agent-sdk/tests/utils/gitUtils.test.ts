import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import {
  getGitRepoRoot,
  getDefaultRemoteBranch,
  hasUncommittedChanges,
  hasNewCommits,
} from '../../src/utils/gitUtils.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

describe('gitUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getGitRepoRoot', () => {
    it('should return the git repo root', () => {
      vi.mocked(execSync).mockReturnValue('/repo/root\n' as unknown as ReturnType<typeof execSync>);
      expect(getGitRepoRoot('/some/path')).toBe('/repo/root');
      expect(execSync).toHaveBeenCalledWith('git rev-parse --show-toplevel', expect.any(Object));
    });

    it('should return cwd if git command fails', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('Not a git repo');
      });
      expect(getGitRepoRoot('/some/path')).toBe('/some/path');
    });
  });

  describe('getDefaultRemoteBranch', () => {
    it('should return the default remote branch', () => {
      vi.mocked(execSync).mockReturnValue('refs/remotes/origin/main\n' as unknown as ReturnType<typeof execSync>);
      expect(getDefaultRemoteBranch('/repo/root')).toBe('origin/main');
    });

    it('should fallback to origin/main if command fails', () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error('No origin/HEAD');
      });
      expect(getDefaultRemoteBranch('/repo/root')).toBe('origin/main');
    });
  });

  describe('hasUncommittedChanges', () => {
    it('should return true if there are changes', () => {
      vi.mocked(execSync).mockReturnValue(' M file.ts\n' as unknown as ReturnType<typeof execSync>);
      expect(hasUncommittedChanges('/repo/root')).toBe(true);
    });

    it('should return false if there are no changes', () => {
      vi.mocked(execSync).mockReturnValue('' as unknown as ReturnType<typeof execSync>);
      expect(hasUncommittedChanges('/repo/root')).toBe(false);
    });
  });

  describe('hasNewCommits', () => {
    it('should return true if there are new commits', () => {
      vi.mocked(execSync).mockReturnValue('abc1234 Commit message\n' as unknown as ReturnType<typeof execSync>);
      expect(hasNewCommits('/repo/root', 'origin/main')).toBe(true);
    });

    it('should return false if there are no new commits', () => {
      vi.mocked(execSync).mockReturnValue('' as unknown as ReturnType<typeof execSync>);
      expect(hasNewCommits('/repo/root', 'origin/main')).toBe(false);
    });
  });
});
