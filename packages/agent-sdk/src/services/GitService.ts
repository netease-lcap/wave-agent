import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export class GitService {
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
   * Clones a GitHub repository to a local path
   */
  async clone(repo: string, targetPath: string): Promise<void> {
    if (!(await this.isGitAvailable())) {
      throw new Error(
        "Git is not installed or not found in PATH. Please install Git to use GitHub marketplaces.",
      );
    }
    const url = `https://github.com/${repo}.git`;
    try {
      await execAsync(`LC_ALL=C git clone --depth 1 ${url} "${targetPath}"`);
    } catch (error) {
      throw this.handleGitError(repo, error);
    }
  }

  /**
   * Pulls the latest changes in a local repository
   */
  async pull(targetPath: string): Promise<void> {
    if (!(await this.isGitAvailable())) {
      throw new Error(
        "Git is not installed or not found in PATH. Please install Git to use GitHub marketplaces.",
      );
    }
    try {
      await execAsync(`LC_ALL=C git -C "${targetPath}" pull`);
    } catch (error) {
      throw this.handleGitError(targetPath, error);
    }
  }

  private handleGitError(context: string, error: unknown): Error {
    const stderr = (error as { stderr?: string })?.stderr || "";
    const message = (error as Error)?.message || String(error);

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
