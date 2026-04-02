import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export class GitService {
  private getTimeout(): number {
    const envTimeout = process.env.WAVE_PLUGIN_GIT_TIMEOUT_MS;
    if (envTimeout) {
      const parsed = parseInt(envTimeout, 10);
      if (!isNaN(parsed)) {
        return parsed;
      }
    }
    return 120000; // Default 120 seconds
  }

  /**
   * Checks if git is installed and available in the system path
   */
  async isGitAvailable(): Promise<boolean> {
    try {
      await execAsync("git --version");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clones a Git repository to a local path
   */
  async clone(
    urlOrRepo: string,
    targetPath: string,
    ref?: string,
  ): Promise<void> {
    if (process.env.VITEST && !process.env.ALLOW_REAL_GIT) {
      throw new Error(
        `Real git clone is disabled in tests. URL: ${urlOrRepo}, Path: ${targetPath}`,
      );
    }
    if (!(await this.isGitAvailable())) {
      throw new Error(
        "Git is not installed or not found in PATH. Please install Git to use Git/GitHub marketplaces.",
      );
    }

    let url = urlOrRepo;
    if (
      !urlOrRepo.startsWith("http://") &&
      !urlOrRepo.startsWith("https://") &&
      !urlOrRepo.startsWith("git@") &&
      !urlOrRepo.startsWith("ssh://")
    ) {
      // Assume GitHub repo format: owner/repo
      url = `https://github.com/${urlOrRepo}.git`;
    }

    try {
      const refArgs = ref ? `-b "${ref}"` : "--depth 1";
      await execAsync(`git clone ${refArgs} "${url}" "${targetPath}"`, {
        env: { ...process.env, LC_ALL: "C" },
        timeout: this.getTimeout(),
      });
    } catch (error) {
      throw this.handleGitError(urlOrRepo, error);
    }
  }

  /**
   * Pulls the latest changes in a local repository
   */
  async pull(targetPath: string): Promise<void> {
    if (process.env.VITEST && !process.env.ALLOW_REAL_GIT) {
      throw new Error(
        `Real git pull is disabled in tests. Path: ${targetPath}`,
      );
    }
    if (!(await this.isGitAvailable())) {
      throw new Error(
        "Git is not installed or not found in PATH. Please install Git to use Git/GitHub marketplaces.",
      );
    }
    try {
      await execAsync(`git -C "${targetPath}" pull`, {
        env: { ...process.env, LC_ALL: "C" },
        timeout: this.getTimeout(),
      });
    } catch (error) {
      throw this.handleGitError(targetPath, error);
    }
  }

  private handleGitError(context: string, error: unknown): Error {
    const stderr = (error as { stderr?: string })?.stderr || "";
    const message = (error as Error)?.message || String(error);
    const killed = (error as { killed?: boolean })?.killed || false;

    if (message.includes("ETIMEDOUT") || killed) {
      return new Error(
        `Git operation timed out after ${this.getTimeout() / 1000}s. The repository may be too large or the network is slow. You can increase the timeout by setting the WAVE_PLUGIN_GIT_TIMEOUT_MS environment variable.`,
      );
    }

    if (
      stderr.includes("Repository not found") ||
      stderr.includes("not found")
    ) {
      return new Error(
        `Repository "${context}" not found. It might be private or doesn't exist.`,
      );
    }
    if (stderr.includes("Could not read from remote repository")) {
      return new Error(
        `Could not access repository "${context}". Please check your internet connection and permissions.`,
      );
    }
    if (stderr.includes("Authentication failed")) {
      return new Error(`Authentication failed for repository "${context}".`);
    }
    if (stderr.includes("rate limit")) {
      return new Error(`GitHub rate limit exceeded. Please try again later.`);
    }
    if (stderr.includes("not a git repository")) {
      return new Error(`The path "${context}" is not a valid git repository.`);
    }

    return new Error(`Git operation failed for "${context}": ${message}`);
  }
}
