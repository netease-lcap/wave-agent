import { createRequire } from "node:module";
import * as os from "node:os";
import * as path from "node:path";

/**
 * `<home>/.wave/cli` — where the hosts copy the CLI into and where
 * `utils/runtimeDeps.ts` unpacks the dependencies that were not shipped.
 */
export function cliHomeDir(): string {
  return path.join(os.homedir(), ".wave", "cli");
}

/**
 * The require anchors a runtime dependency is looked up through, in order.
 *
 * ## Why two, and why this order
 *
 * The same package reaches the process by one of two independent routes, and
 * each route fails independently:
 *
 * - **The module's own position.** In a bundled CLI `import.meta.url` is
 *   `dist/bundle/wave.mjs`, so Node walks up through whatever `node_modules`
 *   sits above it. `npm i -g wave-code` and a pnpm workspace both put the
 *   wrapper somewhere on that chain, so search works with nothing downloaded.
 * - **{@link cliHomeDir}.** A host hands the CLI three files (`bin`,
 *   `dist/bundle`, `package.json`) — no `node_modules` of its own — and the
 *   installer unpacks into `~/.wave/cli/node_modules`. Layouts that do not hoist
 *   transitive dependencies (a pnpm global install,
 *   `npm --install-strategy=nested`) never expose the wrapper through the first
 *   anchor, and before this chain existed the CLI degraded to the system `grep`
 *   there: measured 190s versus 0.4s for the same repo-root search.
 *
 * Ordering the bundle first keeps the zero-download npm path free: the first
 * probe answers and the installer never runs. Ordering the download directory
 * second makes every install layout behave the same, without asking either
 * package.json to declare anything on the installer's behalf.
 */
export function runtimeRequireAnchors(): NodeRequire[] {
  return [
    createRequire(import.meta.url),
    createRequire(path.join(cliHomeDir(), "index.js")),
  ];
}

/**
 * The first anchor that resolves [probe], or `undefined` when none does.
 *
 * [probe] must not `require` a package it has not first confirmed on disk — a
 * miss is remembered for the rest of the process (`packageOnDisk.ts`).
 */
export function resolveFromAnchors<T>(
  probe: (requireFn: NodeRequire) => T | undefined,
): T | undefined {
  for (const requireFn of runtimeRequireAnchors()) {
    const found = probe(requireFn);
    if (found !== undefined) return found;
  }
  return undefined;
}
