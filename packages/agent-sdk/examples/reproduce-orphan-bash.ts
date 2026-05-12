/**
 * Tests that BackgroundTaskManager cleanup kills child process trees.
 *
 * Spawns a shell that forks a long-running grandchild (`sleep 300`),
 * then calls cleanup(). Verifies all descendants are killed.
 *
 * Expected BEFORE fix: "FAIL - orphaned processes still alive"
 * Expected AFTER fix:  "PASS - all child processes were killed"
 */

import { execSync } from "child_process";
import { Container } from "../src/utils/container.js";
import { BackgroundTaskManager } from "../src/managers/backgroundTaskManager.js";

/**
 * Check if a PID is alive (works on Linux/macOS).
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Find all descendant PIDs of a given parent PID.
 */
function getChildPids(ppid: number): number[] {
  try {
    const output = execSync(`pgrep -P ${ppid} 2>/dev/null || true`, {
      encoding: "utf8",
    });
    return output.trim().split("\n").filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

/**
 * Recursively collect ALL descendant PIDs (children, grandchildren, etc.).
 */
function getAllDescendantPids(ppid: number): Set<number> {
  const result = new Set<number>();
  const queue = [ppid];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const children = getChildPids(current);
    for (const c of children) {
      if (c > 0 && !result.has(c)) {
        result.add(c);
        queue.push(c);
      }
    }
  }

  return result;
}

async function main() {
  const workdir = process.cwd();
  const container = new Container();

  const manager = new BackgroundTaskManager(container, { workdir });

  // sh -c "sleep 300 & echo SLEEP_PID=$! && wait"
  //   - `&` forks sleep into background
  //   - `wait` keeps the shell alive
  //   - When we kill the shell, sleep should die too (with detached + pgid kill)
  const command = 'sh -c "sleep 300 & echo SLEEP_PID=$! && wait"';

  console.log(`Starting: ${command}`);

  const { id, child } = manager.startShell(command);
  const shellPid = child.pid!;

  // Wait for the shell to print the grandchild PID
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Parse the grandchild PID from stdout
  const task = manager.getTask(id);
  const pidMatch = task?.stdout?.match(/SLEEP_PID=(\d+)/);
  let grandchildPid: number | undefined;
  if (pidMatch) {
    grandchildPid = parseInt(pidMatch[1], 10);
  }

  // Fallback: scan descendants
  const descendants = getAllDescendantPids(shellPid);
  if (!grandchildPid && descendants.size > 0) {
    grandchildPid = descendants.values().next().value;
  }

  console.log(`Shell PID:  ${shellPid}`);
  console.log(`Grandchild (sleep) PID: ${grandchildPid ?? "(unknown)"}`);

  // Simulate agent destroy → cleanup
  console.log("\nCalling manager.cleanup() ...");
  manager.cleanup();

  // Wait for kill to take effect
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Check results
  const shellAlive = isProcessAlive(shellPid);
  const grandchildAlive = grandchildPid ? isProcessAlive(grandchildPid) : false;

  // Also scan for any remaining descendants
  const remainingDescendants = getAllDescendantPids(shellPid);

  console.log(`\n--- Results ---`);
  console.log(`Shell alive after cleanup:      ${shellAlive}`);
  console.log(`Grandchild (sleep) alive:        ${grandchildAlive}`);
  console.log(
    `Remaining descendant PIDs:      ${[...remainingDescendants].join(", ") || "none"}`,
  );

  if (grandchildAlive || remainingDescendants.size > 0) {
    console.log("\nFAIL - orphaned child processes still alive!");
    console.log("  spawn() is missing `detached: true`");
    process.exitCode = 1;
  } else {
    console.log("\nPASS - all child processes were killed correctly.");
    process.exitCode = 0;
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
