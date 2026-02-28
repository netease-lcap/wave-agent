import { WorktreeSession } from "./utils/worktree.js";

export interface BaseAppProps {
  bypassPermissions?: boolean;
  pluginDirs?: string[];
  tools?: string[];
  worktreeSession?: WorktreeSession;
  workdir?: string;
  version?: string;
  model?: string;
}
