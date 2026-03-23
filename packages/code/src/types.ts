import { WorktreeSession } from "./utils/worktree.js";
import { PermissionMode } from "wave-agent-sdk";

export interface BaseAppProps {
  bypassPermissions?: boolean;
  permissionMode?: PermissionMode;
  pluginDirs?: string[];
  tools?: string[];
  allowedTools?: string[];
  disallowedTools?: string[];
  worktreeSession?: WorktreeSession;
  workdir?: string;
  version?: string;
  model?: string;
}
