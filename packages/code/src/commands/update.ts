import { spawn, spawnSync } from "child_process";
import chalk from "chalk";
import { isUpdateAvailable } from "../utils/version.js";
import { readNearestPackageJson } from "../utils/readPackageJson.js";

const currentVersion = readNearestPackageJson().version;

/** npm registry mirror for China users (the CLI downloads its runtime deps from the same one). */
const REGISTRY_MIRROR = "https://registry.npmmirror.com";
/** Official registry — the fallback when the mirror is unreachable. */
const REGISTRY_OFFICIAL = "https://registry.npmjs.org";
/** Cap each registry request so a hanging one cannot stall the fallback. */
const REGISTRY_TIMEOUT_MS = 5000;

interface LatestVersion {
  version: string;
  /** The registry that answered — the install reuses it (see getLatestVersion). */
  registry: string;
}

async function fetchLatestVersion(registry: string): Promise<string> {
  const response = await fetch(`${registry}/wave-code/latest`, {
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(
      `HTTP ${response.status} fetching ${registry}/wave-code/latest`,
    );
  }
  const json = (await response.json()) as { version?: string };
  if (!json.version) {
    throw new Error(`No version in the response from ${registry}`);
  }
  return json.version;
}

/**
 * The mirror answers first so the check is fast in CN; the official registry is
 * a silent fallback so an unreachable mirror never blocks the check.
 *
 * The install reuses whichever registry answered: a machine that can only reach
 * the official registry would fail the install for the very reason the check
 * fell back.
 */
async function getLatestVersion(): Promise<LatestVersion> {
  try {
    return {
      version: await fetchLatestVersion(REGISTRY_MIRROR),
      registry: REGISTRY_MIRROR,
    };
  } catch (mirrorError) {
    try {
      return {
        version: await fetchLatestVersion(REGISTRY_OFFICIAL),
        registry: REGISTRY_OFFICIAL,
      };
    } catch (officialError) {
      throw new Error(
        `Could not reach ${REGISTRY_MIRROR} (${errorText(mirrorError)}) ` +
          `or ${REGISTRY_OFFICIAL} (${errorText(officialError)})`,
      );
    }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function detectPackageManager(): "npm" | "pnpm" | "yarn" {
  // Check if wave-code is installed globally with pnpm
  const pnpmList = spawnSync("pnpm", ["list", "-g", "wave-code"], {
    encoding: "utf-8",
  });
  if (pnpmList.status === 0 && pnpmList.stdout?.includes("wave-code")) {
    return "pnpm";
  }

  // Check if wave-code is installed globally with yarn
  const yarnList = spawnSync("yarn", ["global", "list"], { encoding: "utf-8" });
  if (yarnList.status === 0 && yarnList.stdout?.includes("wave-code")) {
    return "yarn";
  }

  // Default to npm
  return "npm";
}

export async function updateCommand() {
  console.log(chalk.blue(`Checking for updates...`));
  console.log(chalk.dim(`Current version: ${currentVersion}`));

  try {
    const { version: latestVersion, registry } = await getLatestVersion();
    console.log(chalk.dim(`Latest version: ${latestVersion}`));

    if (!isUpdateAvailable(currentVersion, latestVersion)) {
      console.log(chalk.green("WAVE Code is already up to date!"));
      process.exit(0);
    }

    console.log(
      chalk.yellow(`A new version of WAVE Code is available: ${latestVersion}`),
    );

    const packageManager = detectPackageManager();
    let updateCmd: string;
    let args: string[];

    if (packageManager === "pnpm") {
      updateCmd = "pnpm";
      args = ["add", "-g", "wave-code@latest"];
    } else if (packageManager === "yarn") {
      updateCmd = "yarn";
      args = ["global", "add", "wave-code@latest"];
    } else {
      updateCmd = "npm";
      args = ["install", "-g", "wave-code@latest"];
    }
    // Appended once so every package manager (including a future branch) gets it.
    args.push(`--registry=${registry}`);

    console.log(chalk.blue(`Updating WAVE Code using ${packageManager}...`));
    console.log(chalk.dim(`Running: ${updateCmd} ${args.join(" ")}`));

    if (process.platform === "win32") {
      // On Windows the running `wave` process keeps the global bin shims
      // (e.g. %APPDATA%\npm\wave.cmd) locked, so npm cannot overwrite them
      // while we are still alive. Exit first and let a detached child process
      // perform the install after a short delay.
      console.log(
        chalk.yellow(
          "The update will finish in the background. Close and reopen wave afterwards.",
        ),
      );
      const child = spawn(
        "cmd.exe",
        ["/c", `timeout /t 2 /nobreak >nul & ${updateCmd} ${args.join(" ")}`],
        { detached: true, stdio: "ignore", windowsHide: true },
      );
      child.unref();
      process.exit(0);
    }

    const result = spawnSync(updateCmd, args, { stdio: "inherit" });

    if (result.status === 0) {
      console.log(chalk.green("WAVE Code updated successfully!"));
      process.exit(0);
    } else {
      console.log(chalk.red("Failed to update WAVE Code."));
      console.log(
        chalk.yellow(
          `Please try running the update command manually: ${updateCmd} ${args.join(" ")}`,
        ),
      );
      console.log(
        chalk.yellow(
          "You might need to run it with sudo if you encounter permission issues.",
        ),
      );
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red("Error checking for updates:"), error);
    process.exit(1);
  }
}
