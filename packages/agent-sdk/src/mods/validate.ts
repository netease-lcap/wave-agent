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

/**
 * 每个元素认的 prop 名（spec「元素（一期）」那张表）。
 *
 * 是白名单，不是「认得的挑出来、别的不出声」：拼错一个 prop（`label2`、或者照
 * 别的框架习惯写 `className` / `style`）静默丢弃时，作者只看到效果没出现、却
 * 拿不到任何反馈。Claude Code 的元素校验同样按名字挑（它连 `variant` 的取值
 * 都会挑出来），这里的错误文案点名元素、prop 和该元素的可用名单。
 *
 * `onPress` / `onSubmit` 不列：它们在沙箱的 `h()` 里就被摘进处理函数表了，
 * 根本到不了树上（见 `ModPropValue`）。
 */
const ELEMENT_PROPS: Record<ModElementType, ReadonlySet<string>> = {
  Box: new Set([
    "flexDirection",
    "flexWrap",
    "flexGrow",
    "flexShrink",
    "gap",
    "padding",
    "columnGap",
    "rowGap",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "marginTop",
    "marginRight",
    "marginBottom",
    "marginLeft",
    "width",
    "height",
    "borderStyle",
    "alignItems",
    "justifyContent",
    "overflow",
  ]),
  Text: new Set(["color", "bold", "italic", "dimColor", "underline", "wrap"]),
  Button: new Set(["key", "label", "disabled", "variant"]),
  Input: new Set(["key", "label", "placeholder", "value", "submitLabel"]),
  Select: new Set(["key", "label", "options", "value", "autoFocus"]),
  Svg: new Set(["source", "alt", "width", "height", "isInteractive"]),
  Link: new Set(["href", "label"]),
  Code: new Set(["source", "language", "path", "startLine"]),
  Markdown: new Set(["text"]),
  Progress: new Set(["label", "value", "max", "valueText", "color"]),
};

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

/** 这三个都是叶子：带 children 说明作者把有内容的元素搞混了。 */
const LEAF_ELEMENTS = new Set(["Select", "Svg", "Progress"]);

/** `Svg` 的 `width` / `height`：可选，但给出来就是 0–4096 的有限正数。 */
function isSvgDimension(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isFinite(value) &&
      value > 0 &&
      value <= MOD_LIMITS.svgDimension)
  );
}

/** `Progress` 的 `value` / `max`：可选，给出来就必须是数字。 */
function isOptionalNumber(value: unknown): boolean {
  return value === undefined || typeof value === "number";
}

function checkSelectProps(props: Record<string, unknown>): void {
  const key = props.key;
  if (typeof key !== "string" || key === "") {
    throw new Error(
      `Select 必须带一个非空的字符串 key（否则选择无法路由回 mod）`,
    );
  }
  const options = props.options;
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error(
      `Select「${key}」需要 options，一个 { value, label? } 的非空数组`,
    );
  }
  if (options.length > MOD_LIMITS.selectOptions) {
    throw new Error(
      `Select「${key}」的 options 最多 ${MOD_LIMITS.selectOptions} 项`,
    );
  }
  const seen = new Set<string>();
  for (const option of options) {
    const shape = option as { value?: unknown; label?: unknown } | null;
    if (
      typeof shape !== "object" ||
      shape === null ||
      Array.isArray(shape) ||
      Object.keys(shape).some((name) => name !== "value" && name !== "label")
    ) {
      throw new Error(
        `Select「${key}」的 options 每一项都得是 { value, label? }`,
      );
    }
    if (typeof shape.value !== "string") {
      throw new Error(`Select「${key}」的 options 里每一项的 value 是字符串`);
    }
    if (shape.label !== undefined && typeof shape.label !== "string") {
      throw new Error(`Select「${key}」的 options 里 label 是字符串`);
    }
    if (seen.has(shape.value)) {
      throw new Error(
        `Select「${key}」的 options 里 value「${shape.value}」重复（value 必须唯一）`,
      );
    }
    seen.add(shape.value);
  }
  for (const name of ["label", "value"] as const) {
    if (props[name] !== undefined && typeof props[name] !== "string") {
      throw new Error(`Select「${key}」的 ${name} 是字符串`);
    }
  }
  if (props.autoFocus !== undefined && typeof props.autoFocus !== "boolean") {
    throw new Error(`Select「${key}」的 autoFocus 是布尔值`);
  }
}

function checkSvgProps(props: Record<string, unknown>): void {
  const source = props.source;
  if (typeof source !== "string" || source === "") {
    throw new Error("Svg 需要 source（一段 SVG 标记），不能为空");
  }
  if (source.length > MOD_LIMITS.svgSourceChars) {
    throw new Error(`Svg.source 超过 ${MOD_LIMITS.svgSourceChars} 字符上限`);
  }
  if (typeof props.alt !== "string") {
    throw new Error("Svg 需要 alt（这张图在说什么），一段文字");
  }
  if (!isSvgDimension(props.width) || !isSvgDimension(props.height)) {
    throw new Error(
      `Svg 的 width / height 是像素数，最多 ${MOD_LIMITS.svgDimension}`,
    );
  }
  if (
    props.isInteractive !== undefined &&
    typeof props.isInteractive !== "boolean"
  ) {
    throw new Error("Svg 的 isInteractive 是布尔值");
  }
}

function checkProgressProps(props: Record<string, unknown>): void {
  const label = props.label;
  if (typeof label !== "string" || label.trim() === "") {
    throw new Error("Progress 需要 label（这一条在做什么），一段非空文字");
  }
  if (!isOptionalNumber(props.value) || !isOptionalNumber(props.max)) {
    throw new Error(`Progress「${label}」的 value 与 max 是数字`);
  }
  for (const name of ["valueText", "color"] as const) {
    if (props[name] !== undefined && typeof props[name] !== "string") {
      throw new Error(`Progress「${label}」的 ${name} 是字符串`);
    }
  }
}

const ELEMENT_CHECKS: Readonly<
  Record<string, (props: Record<string, unknown>) => void>
> = {
  Select: checkSelectProps,
  Svg: checkSvgProps,
  Progress: checkProgressProps,
};

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
  // 只有 `Select.options` 是数组（元素自己的检查负责它的形状）；其余元素的
  // prop 一律只认原始值 —— 树要过 RPC，函数与普通对象到不了渲染端。
  for (const [propName, value] of Object.entries(props)) {
    if (type === "Select" && propName === "options") continue;
    if (
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean" &&
      value !== null
    ) {
      throw new Error(`${type} 的 prop「${propName}」不是可序列化的原始值`);
    }
  }
  const allowed = ELEMENT_PROPS[type as ModElementType];
  for (const name of Object.keys(props)) {
    // `key` 每个元素都能带：列表里的稳定标识（`<Box key={...}>` 是自然写法，
    // Claude Code 也保留 Box 的 key）。渲染器不读它。
    if (name !== "key" && !allowed.has(name)) {
      throw new Error(
        `${type} 上没有 prop「${name}」（可用：${[...allowed].join("、")}）`,
      );
    }
  }
  if (type === "Button" && props.variant !== undefined) {
    if (props.variant !== "primary" && props.variant !== "secondary") {
      throw new Error(`Button.variant 只允许 "primary" 或 "secondary"`);
    }
  }
  // 三个新元素的语义全在 prop 上（选哪几项、画哪段图、填充到几分之几），所以
  // 名字对了还要查取值：空 options、重复 value、超限的 svg source 都当场点名。
  ELEMENT_CHECKS[type]?.(props);
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
  if (LEAF_ELEMENTS.has(type) && children.length > 0) {
    throw new Error(
      `${type} 是叶子元素，不带 children（内容全在它的 prop 里）`,
    );
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
