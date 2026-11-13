/**
 * mod 能碰的 URL：`Link.href` 与 `$.http.fetch` **共用这一份白名单**。
 *
 * 只放行 `https:` 与本地回环的 `http:`（`localhost` / `127.0.0.1` / `[::1]`）。
 * 明文 http 打远端等于把 token 摊在链路上；回环那一条是 mod 与本机桥进程之间
 * 最常用的路（spec「发 HTTP 请求」「跨平台的双向连接」）。
 *
 * 一处定义、两处引用：名单各写一份必然漂移，而漂移的方向总是更宽松的那份。
 */
export function isAllowedUrl(value: string, maxChars: number): boolean {
  if (value.length > maxChars) return false;
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return true;
    if (url.protocol !== "http:") return false;
    return (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname === "[::1]"
    );
  } catch {
    return false;
  }
}
