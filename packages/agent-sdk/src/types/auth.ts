export interface AuthUser {
  id: string;
  email?: string;
}

export interface AuthConfig {
  SSO_TOKEN?: string;
  user?: AuthUser;
}
