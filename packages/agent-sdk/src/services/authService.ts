/**
 * AuthService
 *
 * Handles SSO authentication via the admin server.
 * Manages auth token storage in ~/.wave/auth.json.
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  chmodSync,
  rmSync,
  mkdirSync,
} from "fs";
import * as path from "path";
import * as os from "os";
import { createServer, Server } from "http";
import { URL } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import type { AuthConfig } from "../types/auth.js";

const execFileAsync = promisify(execFile);

export class AuthService {
  private static instance: AuthService;

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  getAuthPath(): string {
    const homeDir = os.homedir();
    return path.join(homeDir, ".wave", "auth.json");
  }

  loadAuth(): AuthConfig {
    const authPath = this.getAuthPath();
    if (!existsSync(authPath)) {
      return {};
    }
    try {
      const content = readFileSync(authPath, "utf-8");
      return JSON.parse(content) as AuthConfig;
    } catch {
      return {};
    }
  }

  saveAuth(config: AuthConfig): void {
    const authPath = this.getAuthPath();
    const waveDir = path.dirname(authPath);
    if (!existsSync(waveDir)) {
      mkdirSync(waveDir, { recursive: true });
    }
    writeFileSync(authPath, JSON.stringify(config, null, 2), "utf-8");
    chmodSync(authPath, 0o600);
  }

  clearAuth(): void {
    const config = this.loadAuth();
    delete config.SSO_TOKEN;
    if (Object.keys(config).length === 0) {
      const authPath = this.getAuthPath();
      if (existsSync(authPath)) {
        rmSync(authPath);
      }
    } else {
      this.saveAuth(config);
    }
  }

  getSSOToken(): string | undefined {
    const config = this.loadAuth();
    return config.SSO_TOKEN;
  }

  getAdminBaseUrl(): string {
    const url = process.env.WAVE_ADMIN_URL;
    if (!url) {
      throw new Error(
        "WAVE_ADMIN_URL environment variable is not set. SSO authentication requires this to be configured.",
      );
    }
    return url;
  }

  async login(options?: {
    /** Callback to receive the auth URL (for display in CLI). */
    onAuthUrl?: (url: string) => void;
    /** Read token manually (e.g. from stdin). Resolves with token or rejects on cancel. */
    readToken?: () => Promise<string>;
  }): Promise<string> {
    const adminUrl = this.getAdminBaseUrl();

    // Step 1: Fetch available SSO providers
    const providersResponse = await fetch(`${adminUrl}/api/auth/sso-providers`);
    if (!providersResponse.ok) {
      throw new Error(
        `Failed to fetch SSO providers: ${providersResponse.status} ${providersResponse.statusText}`,
      );
    }
    const providers = (await providersResponse.json()) as {
      provider: string;
      displayName: string;
    }[];
    if (!providers || providers.length === 0) {
      throw new Error("No SSO providers available");
    }
    const provider = providers[0].provider;

    // Step 2-5: Start local server, open browser, wait for callback or manual input
    const token = await this.startLocalAuthServer(adminUrl, provider, {
      onAuthUrl: options?.onAuthUrl,
      readToken: options?.readToken,
    });

    // Save the token (preserve existing keys)
    const existing = this.loadAuth();
    this.saveAuth({ ...existing, SSO_TOKEN: token });

    return token;
  }

  private startLocalAuthServer(
    adminUrl: string,
    provider: string,
    options?: {
      onAuthUrl?: (url: string) => void;
      readToken?: () => Promise<string>;
    },
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const server: Server = createServer((req, res) => {
        if (req.url) {
          const parsedUrl = new URL(req.url, `http://127.0.0.1`);
          const token = parsedUrl.searchParams.get("token");

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h1>Authentication successful, you can close this window</h1></body></html>",
          );

          if (token && !settled) {
            settled = true;
            server.close();
            resolve(token);
          }
        }
      });

      // Listen on 127.0.0.1 (IPv4) for reliable localhost callback
      server.listen(0, "127.0.0.1", async () => {
        const address = server.address();
        if (typeof address !== "object" || !address) {
          server.close();
          reject(new Error("Failed to get server address"));
          return;
        }
        const port = address.port;
        const callbackUrl = `http://127.0.0.1:${port}`;
        const authUrl = `${adminUrl}/api/auth/sso/${provider}?callback_url=${encodeURIComponent(callbackUrl)}`;

        // Notify caller of the auth URL
        options?.onAuthUrl?.(authUrl);

        // Try to open browser; if it fails, keep server alive for manual visit
        try {
          await this.openBrowser(authUrl);
        } catch {
          // Browser not available — server stays alive
        }
      });

      // If manual token reading is provided, race between server callback and user input
      if (options?.readToken) {
        options.readToken().then(
          (token) => {
            if (!settled) {
              settled = true;
              server.close();
              resolve(token);
            }
          },
          () => {
            // Manual input cancelled or closed, server keeps waiting for callback
          },
        );
      }

      // Timeout after 5 minutes
      setTimeout(
        () => {
          if (!settled) {
            settled = true;
            server.close();
            reject(new Error("SSO authentication timed out after 5 minutes"));
          }
        },
        5 * 60 * 1000,
      );
    });
  }

  private async openBrowser(url: string): Promise<void> {
    const platform = process.platform;
    let command: string;
    let args: string[];

    if (platform === "darwin") {
      command = "open";
      args = [url];
    } else if (platform === "win32") {
      command = "cmd";
      args = ["/c", "start", "", url];
    } else {
      command = "xdg-open";
      args = [url];
    }

    await execFileAsync(command, args);
  }

  isSSOAuthenticated(): boolean {
    return this.getSSOToken() !== undefined;
  }
}

export const authService = AuthService.getInstance();
