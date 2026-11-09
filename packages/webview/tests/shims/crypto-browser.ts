/**
 * browser 探路配置专用的 `crypto` shim。
 *
 * 浏览器里没有 node 的 `crypto`。本仓 webview 测试之所以会碰到它，是因为有
 * 30 个测试文件从 `wave-agent-sdk` barrel 取值（本该走 `/constants` 或
 * `import type`），整张 barrel 图被拖进浏览器后 `pathEncoder` 的
 * `createHash("sha256")` 就暴露了。
 *
 * 这里只提供**同步**的 `createHash`，让加载层不再阻断，红单才能反映真正的
 * 行为差异（布局/时序/焦点）。它算的不是 sha256——凡断言具体哈希值的用例
 * 会如实变红，那正是红单该记录的成本。
 */

function pseudoDigest(input: string): string {
  let h1 = 5381;
  let h2 = 52711;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 = (h1 * 33) ^ c;
    h2 = (h2 * 31) ^ c;
  }
  const part = (((h1 >>> 0) * 0x100000000 + (h2 >>> 0)) >>> 0)
    .toString(16)
    .padStart(8, "0");
  return part.repeat(8).slice(0, 64);
}

export function createHash(_algorithm: string) {
  const chunks: string[] = [];
  return {
    update(data: string) {
      chunks.push(String(data));
      return this;
    },
    digest(_encoding?: string) {
      return pseudoDigest(chunks.join(""));
    },
  };
}

export function randomUUID(): string {
  const hex = pseudoDigest(String(Math.random())).slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function randomBytes(size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    out[i] = Math.floor(Math.random() * 256);
  }
  return out;
}

export function randomInt(max: number): number {
  return Math.floor(Math.random() * max);
}

export function createHmac(_algorithm: string, _key: string) {
  return createHash(_algorithm);
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export default {
  createHash,
  createHmac,
  randomUUID,
  randomBytes,
  randomInt,
  timingSafeEqual,
};
