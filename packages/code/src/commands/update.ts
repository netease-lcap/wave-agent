import { spawnSync } from "child_process";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import https from "https";
import chalk from "chalk";
import { isUpdateAvailable } from "../utils/version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJsonPath = path.resolve(__dirname, "../../package.json");
const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf-8"));
const currentVersion = packageJson.version;

async function getLatestVersion(): Promise<string> {
  return new Promise((resolve, reject) => {
    https
      .get("https://registry.npmjs.org/wave-code/latest", (res) => {
        let data = "";
        res.on("data", (chunk) => {
          data += chunk;
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve(json.version);
          } catch {
            reject(new Error("Failed to parse npm registry response"));
          }
        });
      })
      .on("error", (err) => {
        reject(err);
      });
  });
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
    const latestVersion = await getLatestVersion();
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

    console.log(chalk.blue(`Updating WAVE Code using ${packageManager}...`));
    console.log(chalk.dim(`Running: ${updateCmd} ${args.join(" ")}`));

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
      if (process.platform !== "win32") {
        console.log(
          chalk.yellow(
            "You might need to run it with sudo if you encounter permission issues.",
          ),
        );
      }
      process.exit(1);
    }
  } catch (error) {
    console.error(chalk.red("Error checking for updates:"), error);
    process.exit(1);
  }
}
