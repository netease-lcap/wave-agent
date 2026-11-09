import type {
  AccountCredential,
  AccountCredentialKind,
} from "wave-webview-fixtures";

/**
 * 凭据形态归一（spec desktop-account.md「账户卡片 · 认证方式」）。
 *
 * 三态由宿主下发：`sso`（企业账号）/ `gateway`（自定义网关）/ `none`（无凭据）。
 * **webview 不自己推断**——组织托管 / 远端下发 / OS 环境变量三层只有会话进程看
 * 得全，卡片只消费 `credential`。
 *
 * 唯一的降级路径是 `credential` 缺失（旧版宿主 / 尚未接线的宿主）：此时回落到
 * 旧判据 `isAuthenticated`（已登录 = 企业账号，未登录 = 无凭据），保证接线期间
 * 卡片不空白、不抛错（同故事场景 9）。
 */
export function resolveCredentialKind(
  credential: AccountCredential | undefined | null,
  isAuthenticated: boolean,
): AccountCredentialKind {
  if (credential) return credential.kind;
  return isAuthenticated ? "sso" : "none";
}

/**
 * 「有可用凭据」——发送入口禁用与欢迎页登录 CTA 的判据（spec
 * enterprise/sso-auth.md 场景 5 / 8）。
 *
 * `gateway` 也算有凭据：没登录企业账号但配了 `WAVE_API_KEY` 的人照样能发消息，
 * 用 `isAuthenticated === false` 反推「不能用」会把这个人的输入框锁死。
 *
 * 注意这不判「这份凭据能不能用」——端点 401/403 只有真实响应知道，卡片刻意不
 * 降级（同故事场景 11）。
 */
export function hasUsableCredential(
  credential: AccountCredential | undefined | null,
  isAuthenticated: boolean,
): boolean {
  return resolveCredentialKind(credential, isAuthenticated) !== "none";
}

/**
 * 退出登录后的凭据形态（乐观预测，宿主随后推送的真值会覆盖）。
 *
 * 不是「从配置猜」：`sso` 形态的 `credential.gateway` 按契约就是「退出登录后会
 * 落到的那份」（菜单副标题也读它，见故事场景 4）。没有它时退出即无凭据。
 *
 * 为什么要预测：`logoutResponse` 先到、`authStatusResponse` / `desktopAccountInfo`
 * 后到，中间那一帧若沿用旧的 `sso` 会渲染出「已登录但没名字」的空壳；若清成
 * 未知又会闪一下「登录」按钮（还把刚变得可用的发送入口重新锁上）。
 */
export function credentialAfterLogout(
  credential: AccountCredential | undefined | null,
): AccountCredential {
  const gateway = credential?.gateway ?? null;
  return gateway ? { kind: "gateway", gateway } : { kind: "none" };
}

/**
 * 登录成功后的凭据形态：企业账号（SSO 在 `resolveGatewayConfig` 里恒优先）。
 *
 * 登录前状态里可能还是 `gateway`，而归一函数优先读 `credential` —— 只把
 * `isAuthenticated` 置真、不动 `credential`，卡片会停在网关形态。本机的网关凭据
 * 要带上：它此刻的语义变成「退出登录后会落到的那份」（菜单副标题读它）。
 */
export function credentialAfterLogin(
  credential: AccountCredential | undefined | null,
): AccountCredential {
  const gateway = credential?.gateway ?? null;
  return gateway ? { kind: "sso", gateway } : { kind: "sso" };
}

/**
 * 网关主机名的可读文案：`null` / 缺失 = 只配了 key、baseURL 走 SDK 默认端点，
 * 读「默认端点」而不是把 `undefined` 渲染上屏（同故事场景 6）。
 */
export function gatewayHostLabel(
  gateway: AccountCredential["gateway"] | undefined | null,
): string {
  return gateway?.host ?? "默认端点";
}
