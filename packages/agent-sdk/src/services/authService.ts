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
  statSync,
} from "fs";
import * as path from "path";
import * as os from "os";
import { randomBytes } from "crypto";
import { createServer, Server } from "http";
import { URL } from "url";
import type { AuthConfig, AuthUser, TokenResponse } from "../types/auth.js";
import { logger } from "../utils/globalLogger.js";

/** Persistent anonymous ID for telemetry fallback when SSO is not authenticated. */
let _anonymousId: string | undefined;

export class AuthService {
  private static instance: AuthService;
  private _serverUrl: string | undefined;
  private onAuthChangeCallbacks: Array<(event: "login" | "logout") => void> =
    [];
  private _refreshPromise: Promise<boolean> | null = null;
  private _authFileMtime: number = 0;
  private static readonly REFRESH_BUFFER_MS = 5 * 60 * 1000;

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  /**
   * Set server URL programmatically (e.g. from AgentOptions.serverUrl).
   * Takes priority over WAVE_SERVER_URL environment variable.
   */
  setServerUrl(url: string): void {
    this._serverUrl = url;
  }

  /**
   * Register a callback for auth state changes.
   * Returns an unsubscribe function.
   */
  onAuthChange(callback: (event: "login" | "logout") => void): () => void {
    this.onAuthChangeCallbacks.push(callback);
    return () => {
      this.onAuthChangeCallbacks = this.onAuthChangeCallbacks.filter(
        (cb) => cb !== callback,
      );
    };
  }

  private notifyAuthChange(event: "login" | "logout"): void {
    for (const cb of this.onAuthChangeCallbacks) {
      try {
        cb(event);
      } catch {
        // Don't let callback errors break auth flow
      }
    }
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
      // Best-effort mtime tracking for multi-process detection
      try {
        this._authFileMtime = statSync(authPath).mtimeMs;
      } catch {
        // ignore stat errors
      }
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
    // Update mtime after write
    try {
      this._authFileMtime = statSync(authPath).mtimeMs;
    } catch {
      // ignore stat errors
    }
  }

  clearAuth(): void {
    const config = this.loadAuth();
    delete config.SSO_TOKEN;
    delete config.SSO_REFRESH_TOKEN;
    delete config.SSO_TOKEN_EXPIRES_AT;
    if (Object.keys(config).length === 0) {
      const authPath = this.getAuthPath();
      if (existsSync(authPath)) {
        rmSync(authPath);
      }
    } else {
      this.saveAuth(config);
    }
    this.notifyAuthChange("logout");
  }

  getSSOToken(): string | undefined {
    const config = this.loadAuth();
    return config.SSO_TOKEN;
  }

  getServerUrl(): string {
    const url = this._serverUrl || process.env.WAVE_SERVER_URL;
    if (!url) {
      throw new Error(
        "WAVE_SERVER_URL environment variable is not set. SSO authentication requires this to be configured.",
      );
    }
    return url;
  }

  async login(options?: {
    /** Callback to receive the auth URL (for display in CLI). */
    onAuthUrl?: (url: string) => void;
    /** Read authorization code manually (e.g. from stdin). Resolves with code or rejects on cancel. */
    readToken?: () => Promise<string>;
    /** Server URL override. Falls back to setServerUrl() or WAVE_SERVER_URL env var. */
    serverUrl?: string;
  }): Promise<string> {
    const serverUrl = options?.serverUrl || this.getServerUrl();

    // Start local server, open browser, wait for callback or manual input
    const { code } = await this.startLocalAuthServer(serverUrl, {
      onAuthUrl: options?.onAuthUrl,
      readToken: options?.readToken,
    });

    // Exchange authorization code for JWT (includes user info)
    const { token, refreshToken, expiresIn, user } = await this.exchangeCode(
      serverUrl,
      code,
    );

    // Save the token and user info (preserve existing keys)
    const existing = this.loadAuth();
    this.saveAuth({
      ...existing,
      SSO_TOKEN: token,
      SSO_REFRESH_TOKEN: refreshToken,
      SSO_TOKEN_EXPIRES_AT: expiresIn
        ? Date.now() + expiresIn * 1000
        : undefined,
      user,
    });

    this.notifyAuthChange("login");

    return token;
  }

  /**
   * Exchange a short-lived authorization code for a JWT token.
   * Returns token, optional refresh token, optional expiresIn, and user info.
   */
  private async exchangeCode(
    serverUrl: string,
    code: string,
  ): Promise<TokenResponse> {
    const exchangeUrl = `${serverUrl}/api/auth/token`;
    logger.info(`[Auth] Exchanging authorization code at ${exchangeUrl}`);
    const response = await fetch(exchangeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "authorization_code", code }),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.info(
        `[Auth] Authorization code exchange failed (${response.status}): ${text}`,
      );
      throw new Error(`Token exchange failed (${response.status}): ${text}`);
    }

    const data = (await response.json()) as TokenResponse;
    logger.info("[Auth] Authorization code exchanged successfully");
    return data;
  }

  private startLocalAuthServer(
    serverUrl: string,
    options?: {
      onAuthUrl?: (url: string) => void;
      readToken?: () => Promise<string>;
    },
  ): Promise<{ code: string; user: AuthUser }> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const server: Server = createServer((req, res) => {
        if (req.url) {
          const parsedUrl = new URL(req.url, `http://127.0.0.1`);
          const code = parsedUrl.searchParams.get("code");
          const error = parsedUrl.searchParams.get("error");

          if (error) {
            res.writeHead(200, { "Content-Type": "text/html" });
            res.end(
              `<html><body><h1>Authentication failed</h1><p>${parsedUrl.searchParams.get("error_description") || error}</p></body></html>`,
            );
            if (!settled) {
              settled = true;
              server.close();
              reject(new Error(`SSO login failed: ${error}`));
            }
            return;
          }

          if (!code) {
            res.writeHead(404, { "Content-Type": "text/html" });
            res.end("<html><body><h1>Not Found</h1></body></html>");
            return;
          }

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(
            "<html><body><h1>Authentication successful, you can close this window</h1></body></html>",
          );

          if (!settled) {
            settled = true;
            server.close();
            resolve({ code, user: { id: "", email: undefined } });
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
        const authUrl = `${serverUrl}/login?callback_url=${encodeURIComponent(callbackUrl)}`;

        // Notify caller of the auth URL; caller is responsible for opening browser
        options?.onAuthUrl?.(authUrl);
      });

      // If manual code reading is provided, race between server callback and user input
      if (options?.readToken) {
        options.readToken().then(
          (code) => {
            if (!settled) {
              settled = true;
              server.close();
              resolve({ code, user: { id: "", email: undefined } });
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

  isSSOAuthenticated(): boolean {
    const config = this.loadAuth();
    if (!config.SSO_TOKEN) return false;
    if (
      config.SSO_TOKEN_EXPIRES_AT &&
      Date.now() >= config.SSO_TOKEN_EXPIRES_AT
    )
      return false;
    return true;
  }

  /**
   * Check if the current token is expired or within the refresh buffer.
   * Returns false if no expiry info (backward compat — treated as never-expiring).
   */
  isTokenExpired(): boolean {
    const config = this.loadAuth();
    if (!config.SSO_TOKEN_EXPIRES_AT) return false;
    const expiresAt = config.SSO_TOKEN_EXPIRES_AT;
    const bufferMs = AuthService.REFRESH_BUFFER_MS;
    const now = Date.now();
    const remaining = expiresAt - now;
    const expired = now >= expiresAt - bufferMs;
    if (expired) {
      logger.info(
        `[Auth] Token expired or within refresh buffer: remaining=${Math.round(remaining / 1000)}s, buffer=${bufferMs / 1000}s`,
      );
    }
    return expired;
  }

  /**
   * Check if the token needs refresh and refresh it if possible.
   * Deduplicates concurrent refresh calls (401 dedup).
   */
  async checkAndRefreshTokenIfNeeded(): Promise<boolean> {
    if (!this.isTokenExpired()) return true;
    // Dedup: if a refresh is already in-flight, reuse the same promise
    if (this._refreshPromise) {
      logger.info(
        "[Auth] Token refresh already in-flight, reusing existing promise",
      );
      return this._refreshPromise;
    }
    logger.info("[Auth] Starting token refresh");
    this._refreshPromise = this.refreshToken();
    try {
      return await this._refreshPromise;
    } finally {
      this._refreshPromise = null;
    }
  }

  /**
   * Refresh the access token using the stored refresh token.
   * Returns true on success, false on failure.
   */
  private async refreshToken(): Promise<boolean> {
    const config = this.loadAuth();
    if (!config.SSO_REFRESH_TOKEN) {
      logger.info("[Auth] No refresh token available, cannot refresh");
      return false;
    }

    const serverUrl = this.getServerUrl();
    try {
      logger.info(`[Auth] Refreshing token via ${serverUrl}/api/auth/token`);
      const response = await fetch(`${serverUrl}/api/auth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "refresh_token",
          refresh_token: config.SSO_REFRESH_TOKEN,
        }),
      });

      if (response.status === 400 || response.status === 401) {
        // Refresh token revoked — clear auth
        logger.info(
          `[Auth] Refresh token rejected (${response.status}), clearing auth`,
        );
        this.clearAuth();
        return false;
      }

      if (!response.ok) {
        logger.info(
          `[Auth] Token refresh failed with status ${response.status}`,
        );
        return false;
      }

      const data = (await response.json()) as TokenResponse;
      const newExpiresAt = data.expiresIn
        ? Date.now() + data.expiresIn * 1000
        : undefined;
      this.saveAuth({
        ...config,
        SSO_TOKEN: data.token,
        SSO_REFRESH_TOKEN: data.refreshToken ?? config.SSO_REFRESH_TOKEN,
        SSO_TOKEN_EXPIRES_AT: newExpiresAt,
        user: data.user
          ? { id: data.user.id, email: data.user.email }
          : config.user,
      });
      logger.info(
        `[Auth] Token refreshed successfully, new token expires at ${newExpiresAt ? new Date(newExpiresAt).toISOString() : "never"}`,
      );
      this.notifyAuthChange("login");
      return true;
    } catch (err) {
      // Network error — don't clear auth (might be transient)
      logger.info(`[Auth] Token refresh failed with network error: ${err}`);
      return false;
    }
  }

  /**
   * Check if another process has refreshed the token on disk.
   * Returns true if a fresh token was found and loaded.
   */
  /** @internal Check if another process has refreshed the token on disk */
  tryReadRefreshedTokenFromDisk(): boolean {
    try {
      const authPath = this.getAuthPath();
      if (!existsSync(authPath)) return false;
      const stat = statSync(authPath);
      if (stat.mtimeMs <= this._authFileMtime) return false;
      // File was modified by another process — check if token is fresh
      const config = this.loadAuth();
      if (
        config.SSO_TOKEN_EXPIRES_AT &&
        Date.now() < config.SSO_TOKEN_EXPIRES_AT
      ) {
        logger.info(
          `[Auth] Detected token refreshed by another process (auth.json mtime changed)`,
        );
        this._authFileMtime = stat.mtimeMs;
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  getAuthUser(): AuthUser | undefined {
    const config = this.loadAuth();
    return config.user;
  }
}

export const authService = AuthService.getInstance();

/**
 * Create a fetch wrapper that handles SSO token refresh transparently.
 *
 * 1. Proactive refresh: calls checkAndRefreshTokenIfNeeded() before each request
 * 2. Updates Authorization header with fresh token
 * 3. Reactive 401/403 recovery: tries disk refresh then force refresh, retries once
 */
export function createAuthAwareFetch(innerFetch: typeof fetch): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    // Proactive refresh
    await authService.checkAndRefreshTokenIfNeeded();

    // Update Authorization header with fresh token
    const freshToken = authService.getSSOToken();
    const headers = new Headers(init?.headers);
    if (freshToken) {
      headers.set("Authorization", `Bearer ${freshToken}`);
    }
    const modifiedInit = { ...init, headers };

    const response = await innerFetch(input, modifiedInit);

    // Reactive 401/403 recovery (single retry)
    if (response.status === 401 || response.status === 403) {
      logger.info(
        `[Auth] Received ${response.status}, attempting token recovery`,
      );
      // Try disk refresh first (another process may have refreshed)
      if (authService.tryReadRefreshedTokenFromDisk()) {
        const retryToken = authService.getSSOToken();
        const retryHeaders = new Headers(init?.headers);
        if (retryToken) {
          retryHeaders.set("Authorization", `Bearer ${retryToken}`);
        }
        logger.info("[Auth] Retrying request with disk-refreshed token");
        return innerFetch(input, { ...init, headers: retryHeaders });
      }

      // Try force refresh
      if (await authService.checkAndRefreshTokenIfNeeded()) {
        const retryToken = authService.getSSOToken();
        if (retryToken) {
          const retryHeaders = new Headers(init?.headers);
          retryHeaders.set("Authorization", `Bearer ${retryToken}`);
          logger.info("[Auth] Retrying request with force-refreshed token");
          return innerFetch(input, { ...init, headers: retryHeaders });
        }
      }

      logger.info("[Auth] Token recovery failed, returning original response");
    }

    return response;
  };
}

/**
 * Get or create a persistent anonymous ID for telemetry.
 *
 * Stored in ~/.wave/config.json as { anonymousId: "..." }.
 * Generated once on first run (32-byte random hex) and reused thereafter.
 * Falls back to an in-memory ID if file I/O fails.
 */
export function getOrCreateAnonymousId(): string {
  if (_anonymousId) return _anonymousId;

  try {
    const configPath = path.join(os.homedir(), ".wave", "config.json");
    if (existsSync(configPath)) {
      const content = readFileSync(configPath, "utf-8");
      const config = JSON.parse(content) as { anonymousId?: string };
      if (config.anonymousId) {
        _anonymousId = config.anonymousId;
        return _anonymousId;
      }
    }

    // Generate and persist
    _anonymousId = randomBytes(32).toString("hex");
    const waveDir = path.dirname(configPath);
    if (!existsSync(waveDir)) {
      mkdirSync(waveDir, { recursive: true });
    }
    const existing = existsSync(configPath)
      ? (JSON.parse(readFileSync(configPath, "utf-8")) as Record<
          string,
          unknown
        >)
      : {};
    writeFileSync(
      configPath,
      JSON.stringify({ ...existing, anonymousId: _anonymousId }, null, 2),
      "utf-8",
    );
    chmodSync(configPath, 0o600);
  } catch {
    // File I/O failed — use in-memory fallback
    _anonymousId = randomBytes(32).toString("hex");
  }

  return _anonymousId;
}

/** @internal — reset anonymous ID cache for testing only */
export function __resetAnonymousIdForTesting(): void {
  _anonymousId = undefined;
}
