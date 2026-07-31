#!/usr/bin/env node
/**
 * predev — kill leftover dev Electron instances before launching a new one.
 *
 * The dev app shares the `wave-desktop-dev` userData across worktrees, so a
 * stale instance makes a new `pnpm run dev` silently exit 0 (focus jumps to
 * the old instance and edits look like they "didn't take"). We match only the
 * workspace-installed electron (path contains `node_modules/electron`); the
 * user's installed app never matches that fragment, so it is never touched.
 */
import { spawnSync } from 'node:child_process';

const NEEDLE = 'node_modules/electron';
const me = process.pid;

function listProcesses() {
  try {
    if (process.platform === 'win32') {
      const r = spawnSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          'Get-CimInstance Win32_Process | Where-Object CommandLine | ForEach-Object { "$($_.ProcessId)`t$($_.CommandLine)" }',
        ],
        { encoding: 'utf-8', timeout: 10000 },
      );
      return r.stdout.split(/\r?\n/).filter(Boolean);
    }
    const r = spawnSync('ps', ['-axo', 'pid=,command='], { encoding: 'utf-8', timeout: 10000 });
    return r.stdout.split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

const victims = [];
for (const raw of listProcesses()) {
  const norm = raw.replace(/\\/g, '/');
  if (!norm.includes(NEEDLE)) continue;
  const m = raw.match(/^\s*(\d+)/);
  if (!m) continue;
  const pid = Number(m[1]);
  if (pid === me) continue;
  if (norm.includes('/Applications/Wave.app')) continue; // installed app, never kill
  victims.push({ pid, snippet: norm.slice(norm.indexOf(NEEDLE)).slice(0, 80) });
}

if (victims.length === 0) {
  console.log('[predev] no stale dev instance found');
  process.exit(0);
}

for (const v of victims) {
  try {
    process.kill(v.pid, 'SIGKILL');
    console.log(`[predev] killed ${v.pid}  ${v.snippet}`);
  } catch {
    // already gone or no permission — ignore
  }
}
