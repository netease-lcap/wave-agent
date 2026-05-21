export interface AuthUser {
  id: string;
  email?: string;
}

export interface AuthConfig {
  SSO_TOKEN?: string;
  SSO_REFRESH_TOKEN?: string;
  SSO_TOKEN_EXPIRES_AT?: number; // Unix timestamp (ms) when SSO_TOKEN expires
  user?: AuthUser;
}

/** Server response from POST /api/auth/token */
export interface TokenResponse {
  token: string;
  refreshToken?: string;
  expiresIn?: number; // seconds until token expires
  user: { id: string; email?: string };
}
