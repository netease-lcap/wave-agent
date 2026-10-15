/**
 * Creation actions a tool call performed, for the `wave.commits` /
 * `wave.pull_requests` counters (see docs/specs/enterprise/opentelemetry.md).
 *
 * Both counters follow Claude Code's `commit.count` / `pull_request.count`
 * semantics: they count an action the agent took **through a tool, and that
 * succeeded** — never the outcome. Two consequences decide the shape here:
 *
 * - Nothing is asked of a Git host, so a private GitLab reads exactly like
 *   github.com, and no repository credential ever enters the agent.
 * - The action is recognized from **the command the tool was asked to run**,
 *   not from repository state. `git rev-parse HEAD` before and after a call
 *   would also see commits a build script made on its own, and would spend a
 *   git process on every Bash call; "created through Wave" is a property of
 *   the invocation.
 *
 * The command is read through the same parser the permission rules use, so
 * `git add -A && git commit`, `git -C <dir> commit` and a leading
 * `GIT_AUTHOR_NAME=…` are recognized, while `git log --grep commit` is not.
 */

import {
  GIT_SCOPE_FLAGS,
  splitBashCommand,
  stripEnvVars,
} from "../utils/bashParser.js";

/** Creation actions one tool call performed; each is counted once at most. */
export interface ToolActivity {
  /** A commit was created by this call */
  commits: boolean;
  /** A pull request / merge request was created by this call */
  pullRequests: boolean;
}

/** Create-PR/MR subcommand path per CLI. */
const PULL_REQUEST_COMMANDS: Array<{ cli: string; path: string[] }> = [
  { cli: "gh", path: ["pr", "create"] },
  { cli: "glab", path: ["mr", "create"] },
];

/**
 * MCP tool names that create a PR/MR — `mcp__github__create_pull_request`,
 * `mcp__gitlab__create_merge_request`, `mcp__gitlab__createMergeRequest`, or a
 * server that names them `pull_request_create`. Both word orders and either
 * separator; an update/list/get tool matches nothing.
 */
const MCP_PULL_REQUEST_PATTERN =
  /(?:create|open|new|submit|add)_?(?:pull|merge)_?request|(?:pull|merge)_?request_?(?:create|open|new|submit|add)/i;

/** One command leaf's tokens, quotes and all — the rule matcher's view. */
const TOKEN_PATTERN = /(?:[^\s"']+|"[^"]*"|'[^']*')+/g;

function tokensOf(leaf: string): string[] {
  const tokens = stripEnvVars(leaf).trim().match(TOKEN_PATTERN) ?? [];
  return tokens.map((token) => token.replace(/^["']|["']$/g, ""));
}

function baseName(executable: string): string {
  const parts = executable.split("/");
  return parts[parts.length - 1];
}

/**
 * The git subcommand a leaf runs, or undefined when the leaf is not a git call.
 * Leading `-C <dir>` / `-c <name>=<value>` scope flags are skipped the same way
 * the rule matcher skips them, so `git -C /repo commit` still reads `commit`.
 */
function gitSubcommand(leaf: string): string | undefined {
  const tokens = tokensOf(leaf);
  if (tokens.length < 2 || baseName(tokens[0]) !== "git") return undefined;

  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index];
    const flag = token.split("=")[0];
    if (!GIT_SCOPE_FLAGS.includes(flag)) break;
    // `--git-dir=x` carries its own value; `-C x` takes the next token.
    index += token.includes("=") ? 1 : 2;
  }
  return tokens[index];
}

function isPullRequestCommand(leaf: string): boolean {
  const tokens = tokensOf(leaf);
  if (tokens.length < 3) return false;
  const cli = baseName(tokens[0]);
  return PULL_REQUEST_COMMANDS.some(
    (command) =>
      command.cli === cli &&
      command.path.every((token, index) => tokens[index + 1] === token),
  );
}

/**
 * What one Bash command line created. Every leaf of a chain is judged, so
 * `git add -A && gh pr create` scores both — but each action is a boolean, so
 * a call can never count twice no matter how many commits it makes.
 */
export function detectBashActivity(command: string): ToolActivity {
  const leaves = splitBashCommand(command);
  return {
    commits: leaves.some((leaf) => gitSubcommand(leaf) === "commit"),
    pullRequests: leaves.some(isPullRequestCommand),
  };
}

/**
 * What one MCP tool call created. A commit counter needs the command line and
 * MCP gives none, so only the PR/MR action is recognized here — by name, which
 * is all a call leaves behind.
 */
export function detectMcpActivity(toolName: string): ToolActivity {
  return {
    commits: false,
    pullRequests: MCP_PULL_REQUEST_PATTERN.test(toolName),
  };
}
