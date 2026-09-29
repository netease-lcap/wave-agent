import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Whether [requireFn] can see a package directory called [name] on disk.
 *
 * ## Why an optional dependency must be checked before it is required
 *
 * Probing an *absent* package with `require` is not free: Node records the miss
 * (keyed by the `package.json` path it went looking for) for the rest of the
 * process, so a package that lands on disk later never resolves again in that
 * process. That is exactly the shape of the runtime-dependency installer in
 * `utils/runtimeDeps.ts` — it probes availability, downloads, then verifies
 * through the same `require` — and on Node 24 it made ripgrep unusable for the
 * whole run: the sharp step installed first and created
 * `~/.wave/cli/node_modules`, the rg probe then looked for
 * `~/.wave/cli/node_modules/@vscode/ripgrep/package.json` while that was still
 * missing, the install that followed succeeded, and the post-install verify
 * *still* reported "not found" — so the marker was cleared, `resetRipgrep` was
 * never called, and every Grep in that process answered "ripgrep is not
 * available" (a fresh process resolved it fine; a long-lived remote daemon
 * stayed broken).
 *
 * The candidate list is the resolver's own (`require.resolve.paths`), computed
 * without touching the filesystem or any package.json, so the check agrees with
 * what `require` would do: a package that is genuinely resolvable is never
 * skipped. A require function that cannot report its paths (test doubles) is not
 * gated — it never had a poisonable candidate list either.
 */
export function isPackageOnDisk(requireFn: NodeRequire, name: string): boolean {
  const dirs = requireFn.resolve?.paths?.(name);
  if (!dirs) return true;
  return dirs.some((dir) => fs.existsSync(path.join(dir, name)));
}
