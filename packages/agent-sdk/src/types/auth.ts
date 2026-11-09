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

/**
 * 当前生效的凭据形态（`getAuthStatus` 回包 / 宿主账户卡片）。
 *
 * 优先级与 `resolveGatewayConfig` 一致：**企业账号（SSO token）> 自定义网关
 * （`WAVE_API_KEY`，`WAVE_BASE_URL` 可选）> 无凭据**。`sso` 与 `gateway` 都算
 * 「有可用凭据」——只问「有没有 SSO token」会把把 key 写在 settings.json 里的
 * 用户判成没有凭据（卡片显示登录按钮、发送入口被锁）。
 * spec: docs/specs/desktop/desktop-account.md「账户卡片 · 认证方式」。
 */
export type AccountCredentialKind = "sso" | "gateway" | "none";

export interface AccountCredential {
  /** 当前生效的那一份。 */
  kind: AccountCredentialKind;
  /**
   * 已配置的自定义网关（`host` = `baseURL` 的 host；null = 只配了 key、`baseURL`
   * 缺省 ⇒ 走 SDK 默认端点）。
   *
   * - `kind: "gateway"` 时它就是当前生效的网关；
   * - `kind: "sso"` 且存在时，它是**退出登录后会落到的那份**；
   * - null / 缺失 = 本机没有网关凭据。
   */
  gateway?: { host: string | null } | null;
}

/** Server response from POST /api/auth/token */
export interface TokenResponse {
  token: string;
  refreshToken?: string;
  expiresIn?: number; // seconds until token expires
  user: { id: string; email?: string };
}
