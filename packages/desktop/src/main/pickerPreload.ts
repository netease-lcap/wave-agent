/**
 * Element-picker preload injected into the preview <webview> guest.
 *
 * Runs in the guest's sandboxed preload context (DOM access, no Node APIs,
 * `require('electron')` limited to ipcRenderer et al).
 *
 *   host → guest : ipcRenderer.on('wave-picker', { action, palette? })
 *   guest → host : ipcRenderer.sendToHost('wave-picker', payload)
 *
 * Announces { type: 'ready' } on load so the host can tell picker-capable
 * pages apart from pages where injection failed.
 *
 * CSP note: dev servers may forbid <style> injection, so all styling goes
 * through CSSOM (adoptedStyleSheets / el.style.*).
 */
import { ipcRenderer } from "electron";

interface PickerPalette {
  accent?: string;
  accentForeground?: string;
  /** 元素高亮框/选中描边色。桌面 host 主按钮已中性化（accent=炭黑），
      高亮框须与焦点态一致用蓝，故单独取一个 token（评论：picker 框变黑）。 */
  accentOutline?: string;
  foreground?: string;
  background?: string;
  border?: string;
  inputBackground?: string;
  inputForeground?: string;
  /* ── 评论卡片的表单规范那一组（1029 评论「根据表单规范优化这个弹窗」）──
     host（`PreviewPane.readPalette()`）取样后随 activate 一起发过来；缺省时
     下面的 CSS 各自有回退，插件端 / 旧宿主不发这些键也能照常工作。 */
  cardBg?: string;
  cardBorder?: string;
  cardShadow?: string;
  fieldBg?: string;
  fieldBorder?: string;
  fieldBorderHover?: string;
  fieldBorderFocus?: string;
  fieldText?: string;
  fieldPlaceholder?: string;
  tagText?: string;
  actionBg?: string;
  actionBgHover?: string;
  actionBgActive?: string;
  actionText?: string;
  disabledBg?: string;
  disabledText?: string;
}

interface PickerMessage {
  action?: "activate" | "deactivate";
  palette?: PickerPalette;
}

const HIGHLIGHT_CLASS = "__wave-picker-highlight";
const CARD_WIDTH = 280;
/** 卡片高度估算（决定放元素下方还是翻到上方）：r12 浮层 8 内衬 + 字段（1px 边 +
 *  8 内衬 + 44 输入区）+ 8 间距 + 28 操作行 + 1px 边 = 116（1029 表单规范那轮
 *  从 100 长到 116：字号 12→14 让 `<textarea>` 的两行内容高 33.6→44）。 */
const CARD_HEIGHT_ESTIMATE = 116;
/** Pointer travel (px) between press and release still counted as a click. */
const CLICK_SLOP_PX = 4;

let active = false;
let palette: PickerPalette = {};
let hovered: Element | null = null;
let selected: Element | null = null;
let cardHost: HTMLDivElement | null = null;
let highlightSheet: CSSStyleSheet | null = null;
/** Where the current press started, while the pointer is down. */
let pressOrigin: { x: number; y: number } | null = null;

/** Short human-readable element description, e.g. `button.primary`. */
function summarize(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : "";
  const cls = Array.from(el.classList)
    .filter((c) => c !== HIGHLIGHT_CLASS)
    .slice(0, 3)
    .map((c) => `.${c}`)
    .join("");
  return `${tag}${id}${cls}`;
}

/** Structural CSS selector path, e.g. `#app > div:nth-of-type(2) > button`. */
function buildSelector(el: Element): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.documentElement && parts.length < 8) {
    let part = node.tagName.toLowerCase();
    if (node.id) {
      parts.unshift(`#${node.id}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    if (parent) {
      const sameTag = Array.from(parent.children).filter(
        (c) => c.tagName === node!.tagName,
      );
      if (sameTag.length > 1)
        part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(" > ");
}

function snippet(el: Element): string {
  const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}

function ensureHighlightSheet(): void {
  if (highlightSheet) return;
  highlightSheet = new CSSStyleSheet();
  highlightSheet.replaceSync(
    `.${HIGHLIGHT_CLASS} { outline: 2px solid ${palette.accentOutline ?? palette.accent ?? "#0e639c"} !important; outline-offset: -2px; cursor: crosshair !important; }`,
  );
  document.adoptedStyleSheets = [
    ...document.adoptedStyleSheets,
    highlightSheet,
  ];
}

function removeHighlightSheet(): void {
  if (!highlightSheet) return;
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
    (s) => s !== highlightSheet,
  );
  highlightSheet = null;
}

function clearHover(): void {
  if (hovered && hovered !== selected)
    hovered.classList.remove(HIGHLIGHT_CLASS);
  hovered = null;
}

function removeCard(): void {
  cardHost?.remove();
  cardHost = null;
}

function deselect(): void {
  if (selected) {
    selected.classList.remove(HIGHLIGHT_CLASS);
    selected = null;
  }
  removeCard();
}

function isInsideCard(e: Event): boolean {
  // composedPath crosses shadow boundaries (and works regardless of whether
  // the engine retargets shadow-internal events at the host).
  return cardHost !== null && e.composedPath().includes(cardHost);
}

/**
 * Element under a viewport point, or null when that is the card itself.
 *
 * Deliberately a hit test rather than `event.target`: the engine gives a
 * disabled form control no mouse-press events at all (see onPointerUp), and a
 * page that calls setPointerCapture retargets the pointer events to the
 * capturing ancestor — the hit test still resolves what the user is pointing
 * at. It also skips `pointer-events: none` boxes, so those picks fall through
 * to whatever is behind them (same as the hover highlight already does).
 *
 * Points over the card hit the card's host element (hit tests do not cross a
 * shadow boundary: measured in Chromium, the content inside the card's shadow
 * root is retargeted to the host), so comparing the host is enough.
 */
function elementAtPoint(x: number, y: number): Element | null {
  const el = document.elementFromPoint(x, y);
  return el && el !== cardHost ? el : null;
}

/**
 * Position the (fixed) card next to the element: below by default, flipped
 * above when space runs out, clamped into the viewport. Hidden while the
 * element is scrolled out of view.
 */
function placeCard(el: Element): void {
  if (!cardHost) return;
  const rect = el.getBoundingClientRect();
  const outOfView =
    rect.bottom < 0 ||
    rect.top > window.innerHeight ||
    rect.right < 0 ||
    rect.left > window.innerWidth;
  cardHost.style.visibility = outOfView ? "hidden" : "visible";
  if (outOfView) return;
  const left = Math.min(
    Math.max(8, rect.left),
    Math.max(8, window.innerWidth - CARD_WIDTH - 8),
  );
  const below = rect.bottom + 8;
  const fitsBelow = below + CARD_HEIGHT_ESTIMATE < window.innerHeight;
  const top = fitsBelow
    ? below
    : Math.max(8, rect.top - CARD_HEIGHT_ESTIMATE - 8);
  cardHost.style.left = `${left}px`;
  cardHost.style.top = `${top}px`;
}

function showCard(el: Element): void {
  removeCard();

  cardHost = document.createElement("div");
  cardHost.style.cssText = `position: fixed; z-index: 2147483647; width: ${CARD_WIDTH}px;`;
  const shadow = cardHost.attachShadow({ mode: "open" });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    /* 评论卡片按 skill 表单规范重做（1029 评论「根据表单规范优化这个弹窗」）：
       三层 —— 浮层容器（r12 / --cc-bg-overlay / --cc-border-lighter / --cc-shadow-popover
       / 8 内衬）、字段盒（r8 / --cc-field-*，hover 只换描边、focus 1px 沿边无外扩环、
       占位符 opacity 1）、操作行（tag 12/20 说明文字 + 「添加」紧凑主按钮 28 高 /
       14px-500 / r8 / 0·12 内衬）。改前是 r6 + 内衬 6 的一只「盒子套盒子」，按钮在
       字段盒里、11px 蓝字细边，禁用靠整颗 opacity .4。
       palette 里任何一个键缺省时走下面的回退值（插件端 / 旧宿主）。 */
    .card {
      display: flex; flex-direction: column; gap: 8px;
      background: ${palette.cardBg ?? palette.background ?? "#1e1e1e"};
      color: ${palette.fieldText ?? palette.foreground ?? "#cccccc"};
      border: 1px solid ${palette.cardBorder ?? palette.border ?? "rgba(128,128,128,0.35)"};
      border-radius: 12px;
      padding: 8px;
      font: 14px/22px -apple-system, "Segoe UI", sans-serif;
      box-shadow: ${palette.cardShadow ?? "0 4px 16px rgba(0,0,0,0.4)"};
    }
    .field {
      display: flex; flex-direction: column;
      background: ${palette.fieldBg ?? palette.inputBackground ?? "#3c3c3c"};
      border: 1px solid ${palette.fieldBorder ?? palette.border ?? "rgba(128,128,128,0.35)"};
      border-radius: 8px;
      padding: 8px;
    }
    /* 悬停只改描边、不换底；聚焦仍走沿边 1px（放在 hover 之后 → 焦点 + 悬停时胜出）。 */
    .field:hover {
      border-color: ${palette.fieldBorderHover ?? palette.fieldBorder ?? "rgba(128,128,128,0.35)"};
    }
    .field:focus-within {
      border-color: ${palette.fieldBorderFocus ?? palette.accent ?? "#0e639c"};
    }
    textarea {
      width: 100%; min-height: 40px; resize: vertical; box-sizing: border-box;
      background: transparent;
      color: ${palette.fieldText ?? palette.inputForeground ?? "#cccccc"};
      border: none; padding: 0; font: inherit; outline: none;
    }
    textarea::placeholder {
      color: ${palette.fieldPlaceholder ?? palette.foreground ?? "#a6a6a6"};
      opacity: 1;
    }
    .footer { display: flex; align-items: center; gap: 8px; }
    .tag {
      flex: 1; min-width: 0;
      color: ${palette.tagText ?? palette.accent ?? "#0e639c"};
      font-family: Menlo, Consolas, Monaco, monospace;
      font-size: 12px; line-height: 20px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .send {
      height: 28px; padding: 0 12px;
      border: 0; border-radius: 8px;
      background: ${palette.actionBg ?? palette.accent ?? "#0e639c"};
      color: ${palette.actionText ?? palette.accentForeground ?? "#ffffff"};
      font-family: inherit; font-size: 14px; font-weight: 500; line-height: 22px;
      cursor: pointer;
    }
    .send:hover:not(:disabled) {
      background: ${palette.actionBgHover ?? palette.accent ?? "#0e639c"};
    }
    .send:active:not(:disabled) {
      background: ${palette.actionBgActive ?? palette.accent ?? "#0e639c"};
    }
    /* 禁用走专用配色而不是整颗 opacity（改前的 .4 会把描边和字一起压淡），
       hover 与静止同色：与输入区发送键同一套配方。 */
    .send:disabled {
      background: ${palette.disabledBg ?? "transparent"};
      color: ${palette.disabledText ?? palette.foreground ?? "#8b8b8b"};
      cursor: default;
    }
  `);
  shadow.adoptedStyleSheets = [sheet];

  const card = document.createElement("div");
  card.className = "card";

  const field = document.createElement("div");
  field.className = "field";
  const textarea = document.createElement("textarea");
  textarea.placeholder = "评论这个元素…";
  field.append(textarea);

  const footer = document.createElement("div");
  footer.className = "footer";
  const tag = document.createElement("div");
  tag.className = "tag";
  tag.textContent = el.tagName.toLowerCase();
  tag.title = buildSelector(el);
  const send = document.createElement("button");
  send.type = "button";
  send.className = "send";
  send.title = "添加到输入框";
  send.textContent = "添加";
  footer.append(tag, send);

  card.append(field, footer);
  shadow.append(card);

  const submit = () => {
    const comment = textarea.value.trim();
    if (!comment) return;
    ipcRenderer.sendToHost("wave-picker", {
      type: "submit",
      url: location.href,
      selector: buildSelector(el),
      summary: summarize(el),
      text: snippet(el),
      comment,
    });
    // Back to hover-pick state (like cancel): the picker stays active so the
    // user can keep picking elements and batch several comments.
    deselect();
  };

  send.addEventListener("click", submit);
  textarea.addEventListener("input", () => {
    send.disabled = textarea.value.trim() === "";
  });
  textarea.addEventListener("keydown", (e) => {
    // IME composing (e.g. Chinese pinyin): Enter confirms the candidate, not a
    // submit. keyCode 229 covers older engines where isComposing is unset.
    if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.isComposing &&
      e.keyCode !== 229
    ) {
      e.preventDefault();
      submit();
    }
    e.stopPropagation();
  });

  send.disabled = true;
  document.body.appendChild(cardHost);
  placeCard(el);
  textarea.focus();
}

function onMouseOver(e: MouseEvent): void {
  if (isInsideCard(e)) return;
  const el = e.target as Element | null;
  if (!el || el === cardHost) return;
  if (hovered === el) return;
  clearHover();
  hovered = el;
  el.classList.add(HIGHLIGHT_CLASS);
}

function onPointerDown(e: MouseEvent): void {
  // Only a primary press can start a pick: a right click never gets a `click`.
  pressOrigin = e.button === 0 ? { x: e.clientX, y: e.clientY } : null;
}

/**
 * Picking is driven by the pointer press/release pair instead of `click`:
 * the engine queues no click at all when the press lands on a disabled form
 * control or one of its descendants — HTML requires such controls to suppress
 * the click events, and Chromium drops the entire mousedown/mouseup/click
 * sequence. mouseover and the pointer events still arrive, so hover worked
 * while clicking a greyed-out row silently did nothing.
 */
function onPointerUp(e: MouseEvent): void {
  const origin = pressOrigin;
  pressOrigin = null;
  if (!origin) return;
  // Click-like only: a drag (text selection, slider, scrollbar) is not a pick.
  if (
    Math.abs(e.clientX - origin.x) > CLICK_SLOP_PX ||
    Math.abs(e.clientY - origin.y) > CLICK_SLOP_PX
  )
    return;
  // Releasing over our own card changes nothing (and never re-picks the card).
  const el = elementAtPoint(e.clientX, e.clientY);
  if (!el) return;
  // Picking outside the card cancels the current selection back to hover-pick
  // state; the next press selects.
  if (selected) {
    deselect();
    return;
  }
  selected = el;
  el.classList.add(HIGHLIGHT_CLASS);
  showCard(el);
}

/** Swallow the page's own click while picking (selection lives in onPointerUp). */
function onClick(e: MouseEvent): void {
  if (isInsideCard(e)) return;
  e.preventDefault();
  e.stopPropagation();
}

function onSubmit(e: Event): void {
  if (isInsideCard(e)) return;
  e.preventDefault();
  e.stopPropagation();
}

function onScrollOrResize(): void {
  if (selected) placeCard(selected);
}

function activate(msg?: PickerMessage): void {
  if (active) return;
  active = true;
  palette = msg?.palette ?? {};
  ensureHighlightSheet();
  document.addEventListener("mouseover", onMouseOver, true);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("submit", onSubmit, true);
  window.addEventListener("scroll", onScrollOrResize, true);
  window.addEventListener("resize", onScrollOrResize);
}

function deactivate(): void {
  if (!active) return;
  active = false;
  document.removeEventListener("mouseover", onMouseOver, true);
  document.removeEventListener("pointerdown", onPointerDown, true);
  document.removeEventListener("pointerup", onPointerUp, true);
  document.removeEventListener("click", onClick, true);
  document.removeEventListener("submit", onSubmit, true);
  window.removeEventListener("scroll", onScrollOrResize, true);
  window.removeEventListener("resize", onScrollOrResize);
  clearHover();
  deselect();
  removeHighlightSheet();
}

ipcRenderer.on("wave-picker", (_event, msg: PickerMessage) => {
  if (msg?.action === "activate") activate(msg);
  else if (msg?.action === "deactivate") deactivate();
});

ipcRenderer.sendToHost("wave-picker", { type: "ready" });
