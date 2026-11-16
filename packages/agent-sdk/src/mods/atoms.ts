import type { ModDollar } from "./runtime.js";

/**
 * `atom` / `read` / `update`（spec「兼容社区 mod」）。
 *
 * 社区 mod 的写法是「声明一个有初值的值，然后读写它」：
 *
 * ```ts
 * const turns = atom({ plugin: 'burn-rate', key: 'turns' }, [])
 * await update($, turns, list => [...list, stat])
 * const list = await read($, turns)
 * ```
 *
 * 我们把它落在 `$.store` 上：`$.store` 已经是**按插件隔离**的持久化键值表
 * （`~/.wave/plugin-mods/<plugin>.json`），跨会话还在，读写的都是 JSON。
 * 因此键名里那个 `plugin` 只是在文档与调试里有用 —— 隔离由 store 自己做，
 * 但它进了键里，`$.store.keys()` 上看得到来源。
 */
export interface ModAtom<T> {
  /** 声明时写的插件名（隔离由 `$.store` 自己保证，这里只用于键名与排查）。 */
  readonly plugin: string;
  /** 这个值的名字，插件内唯一。 */
  readonly key: string;
  /** 键不存在时 `read` 给的值。 */
  readonly initial: T;
  /** 判别标记：`read` / `update` 靠它认「这是 atom 还是裸键」。 */
  readonly __atom: true;
}

/**
 * 声明一个值。**不读写**任何东西 —— 真正的值在第一次 `read` / `update` 时
 * 才落到 store 上（模块顶层就写文件会让单纯的加载变成一次 I/O）。
 */
export function atom<T>(
  ref: { plugin: string; key: string },
  initial: T,
): ModAtom<T> {
  if (!ref || typeof ref.plugin !== "string" || typeof ref.key !== "string") {
    throw new Error("atom 需要 { plugin, key } 两个字符串");
  }
  return {
    plugin: ref.plugin,
    key: ref.key,
    initial,
    __atom: true,
  };
}

/** atom 在 store 里的键（`<plugin>/<key>`）。 */
function storeKey(atomRef: ModAtom<unknown>): string {
  return `${atomRef.plugin}/${atomRef.key}`;
}

/**
 * 读一个 atom：键不存在时返回初值。
 *
 * store 是用户能打开看的文件（`~/.wave/plugin-mods/*.json`），手改坏了不该让
 * mod 整个挂掉：读不会抛错，比较不了就按原样给（除非存的是 JSON 文本，那说明
 * 是旧版本写的，解析回原值）。
 */
export async function read<T>(
  $: Pick<ModDollar, "store">,
  atomRef: ModAtom<T>,
): Promise<T> {
  const raw: unknown = await $.store.get(storeKey(atomRef));
  if (raw === undefined) return atomRef.initial;
  // 兼容旧数据：`$.store` 以前只收字符串，atom 存进去的是 `JSON.stringify(值)`
  // 的文本，读回来会多一层引号。字符串能解析就用解析结果（下次 `update` 按新
  // 形状整份写回、自愈）；解析不了说明存的就是一个字符串，原样给。
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return raw as T;
    }
  }
  return raw as T;
}

/**
 * 写一个 atom，返回写进去的新值。
 *
 * 值或「上一份 → 新值」的函数都收（社区两种写法都有）。函数形态先读、再算、
 * 再写 —— 与 `$.store` 的「整份覆盖」口径一致，并发由插件作者自己小心
 * （spec「面板的归属」）。
 */
export async function update<T>(
  $: Pick<ModDollar, "store">,
  atomRef: ModAtom<T>,
  valueOrUpdater: T | ((previous: T) => T),
): Promise<T> {
  const next =
    typeof valueOrUpdater === "function"
      ? (valueOrUpdater as (previous: T) => T)(await read($, atomRef))
      : valueOrUpdater;
  await $.store.set(storeKey(atomRef), next);
  return next;
}
