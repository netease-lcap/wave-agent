import {
  MOD_ELEMENT_TYPES,
  MOD_LIMITS,
  type ModElementType,
  type ModTreeNode,
} from "../types/mods.js";
import { isAllowedUrl } from "./url.js";

/**
 * mod 返回的元素树校验（spec「限额」）。
 *
 * 校验发生在**宿主侧**，也就是 mod 的返回值离开沙箱之后、进 RPC 之前：
 * 沙箱只能保证它自己没被 `eval` 逃出去，树有多大、`href` 指向哪里得由宿主
 * 说了算。任一条不过就整棵树不画，并给出一条可见的错误摘要 —— 静默丢弃会
 * 让插件作者对着空白面板猜。
 */

const ELEMENT_TYPES = new Set<string>(MOD_ELEMENT_TYPES);

export type ModTreeValidation =
  | { ok: true; tree: ModTreeNode }
  | { ok: false; error: string };

function fail(error: string): ModTreeValidation {
  return { ok: false, error };
}

/**
 * `Link.href` 的白名单与 `$.http.fetch` 共用一份（`./url.js`）。
 *
 * 两处各写一份必然漂移，而漂移的方向总是更宽松的那份。
 */
function isAllowedHref(href: string): boolean {
  return isAllowedUrl(href, MOD_LIMITS.hrefChars);
}

interface WalkState {
  nodes: number;
  textChars: number;
}

function walkNode(
  node: unknown,
  depth: number,
  state: WalkState,
): ModTreeNode | string {
  if (typeof node === "string") {
    state.textChars += node.length;
    if (state.textChars > MOD_LIMITS.treeTextChars) {
      throw new Error(`元素树文本超过 ${MOD_LIMITS.treeTextChars} 字符上限`);
    }
    return node;
  }
  if (typeof node !== "object" || node === null) {
    throw new Error(`元素树里有非法节点：${typeof node}`);
  }
  const element = node as Partial<ModTreeNode>;
  const type = element.type;
  if (typeof type !== "string" || !ELEMENT_TYPES.has(type)) {
    throw new Error(`未知元素类型：${String(type)}`);
  }
  if (depth > MOD_LIMITS.treeDepth) {
    throw new Error(`元素树深度超过 ${MOD_LIMITS.treeDepth} 层上限`);
  }
  state.nodes += 1;
  if (state.nodes > MOD_LIMITS.treeNodes) {
    throw new Error(`元素树节点数超过 ${MOD_LIMITS.treeNodes} 上限`);
  }

  const props = element.props ?? {};
  if (typeof props !== "object" || props === null || Array.isArray(props)) {
    throw new Error(`${type} 的 props 必须是对象`);
  }
  for (const [name, value] of Object.entries(props)) {
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean" &&
      value !== null
    ) {
      throw new Error(`${type} 的 prop「${name}」不是可序列化的原始值`);
    }
  }
  if (type === "Link") {
    const href = props.href;
    if (typeof href !== "string" || !isAllowedHref(href)) {
      throw new Error(
        `Link.href 只允许 https: 或本地 http:，且不超过 ${MOD_LIMITS.hrefChars} 字符`,
      );
    }
  }
  if (
    (type === "Button" || type === "Input") &&
    typeof props.key !== "string"
  ) {
    throw new Error(`${type} 必须带一个字符串 key（否则点击无法路由回 mod）`);
  }

  const children = element.children ?? [];
  if (!Array.isArray(children)) {
    throw new Error(`${type} 的 children 必须是数组`);
  }
  const outChildren: Array<ModTreeNode | string> = [];
  for (const child of children) {
    outChildren.push(walkNode(child, depth + 1, state));
  }
  return {
    type: type as ModElementType,
    props: props as ModTreeNode["props"],
    children: outChildren,
  };
}

/** 校验一棵树；通过时返回**规范化**后的副本（只保留已知字段）。 */
export function validateModTree(input: unknown): ModTreeValidation {
  try {
    const state: WalkState = { nodes: 0, textChars: 0 };
    const tree = walkNode(input, 1, state);
    if (typeof tree === "string") {
      // 根节点是裸文本：包一个 Text，免得 webview 侧要处理两种根类型。
      return {
        ok: true,
        tree: { type: "Text", props: {}, children: [tree] },
      };
    }
    return { ok: true, tree };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
