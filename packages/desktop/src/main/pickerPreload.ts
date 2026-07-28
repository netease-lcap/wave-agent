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
import { ipcRenderer } from 'electron';

interface PickerPalette {
  accent?: string;
  accentForeground?: string;
  foreground?: string;
  background?: string;
  border?: string;
  inputBackground?: string;
  inputForeground?: string;
}

interface PickerMessage {
  action?: 'activate' | 'deactivate';
  palette?: PickerPalette;
}

const HIGHLIGHT_CLASS = '__wave-picker-highlight';
const CARD_WIDTH = 280;
const CARD_HEIGHT_ESTIMATE = 120;

let active = false;
let palette: PickerPalette = {};
let hovered: Element | null = null;
let selected: Element | null = null;
let cardHost: HTMLDivElement | null = null;
let highlightSheet: CSSStyleSheet | null = null;

/** Short human-readable element description, e.g. `button.primary`. */
function summarize(el: Element): string {
  const tag = el.tagName.toLowerCase();
  const id = el.id ? `#${el.id}` : '';
  const cls = Array.from(el.classList)
    .filter((c) => c !== HIGHLIGHT_CLASS)
    .slice(0, 3)
    .map((c) => `.${c}`)
    .join('');
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
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === node!.tagName);
      if (sameTag.length > 1) part += `:nth-of-type(${sameTag.indexOf(node) + 1})`;
    }
    parts.unshift(part);
    node = parent;
  }
  return parts.join(' > ');
}

function snippet(el: Element): string {
  const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 30 ? `${text.slice(0, 30)}…` : text;
}

function ensureHighlightSheet(): void {
  if (highlightSheet) return;
  highlightSheet = new CSSStyleSheet();
  highlightSheet.replaceSync(
    `.${HIGHLIGHT_CLASS} { outline: 2px solid ${palette.accent ?? '#0e639c'} !important; outline-offset: -2px; cursor: crosshair !important; }`,
  );
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, highlightSheet];
}

function removeHighlightSheet(): void {
  if (!highlightSheet) return;
  document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== highlightSheet);
  highlightSheet = null;
}

function clearHover(): void {
  if (hovered && hovered !== selected) hovered.classList.remove(HIGHLIGHT_CLASS);
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
 * Position the (fixed) card next to the element: below by default, flipped
 * above when space runs out, clamped into the viewport. Hidden while the
 * element is scrolled out of view.
 */
function placeCard(el: Element): void {
  if (!cardHost) return;
  const rect = el.getBoundingClientRect();
  const outOfView = rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth;
  cardHost.style.visibility = outOfView ? 'hidden' : 'visible';
  if (outOfView) return;
  const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - CARD_WIDTH - 8));
  const below = rect.bottom + 8;
  const fitsBelow = below + CARD_HEIGHT_ESTIMATE < window.innerHeight;
  const top = fitsBelow ? below : Math.max(8, rect.top - CARD_HEIGHT_ESTIMATE - 8);
  cardHost.style.left = `${left}px`;
  cardHost.style.top = `${top}px`;
}

function showCard(el: Element): void {
  removeCard();

  cardHost = document.createElement('div');
  cardHost.style.cssText = `position: fixed; z-index: 2147483647; width: ${CARD_WIDTH}px;`;
  const shadow = cardHost.attachShadow({ mode: 'open' });

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    .card {
      background: ${palette.background ?? '#1e1e1e'};
      color: ${palette.foreground ?? '#cccccc'};
      border: 1px solid ${palette.border ?? 'rgba(128,128,128,0.35)'};
      border-radius: 6px;
      padding: 8px;
      font: 12px/1.4 -apple-system, "Segoe UI", sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
    }
    .head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    .target { flex: 1; color: ${palette.accent ?? '#0e639c'}; font-family: monospace; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cancel { background: none; border: none; color: inherit; cursor: pointer; padding: 0 2px; font: inherit; opacity: 0.7; }
    .cancel:hover { opacity: 1; }
    .row { display: flex; gap: 6px; align-items: flex-end; }
    textarea {
      flex: 1; min-height: 40px; resize: vertical;
      background: ${palette.inputBackground ?? '#3c3c3c'};
      color: ${palette.inputForeground ?? '#cccccc'};
      border: 1px solid ${palette.border ?? 'rgba(128,128,128,0.35)'};
      border-radius: 4px; padding: 4px 6px; font: inherit; outline: none;
    }
    textarea:focus { border-color: ${palette.accent ?? '#0e639c'}; }
    .send {
      background: ${palette.accent ?? '#0e639c'};
      color: ${palette.accentForeground ?? '#ffffff'};
      border: none; border-radius: 4px; width: 28px; height: 28px;
      cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0;
    }
    .send:disabled { opacity: 0.5; cursor: default; }
    svg { width: 14px; height: 14px; fill: currentColor; }
  `);
  shadow.adoptedStyleSheets = [sheet];

  const card = document.createElement('div');
  card.className = 'card';

  const head = document.createElement('div');
  head.className = 'head';
  const target = document.createElement('div');
  target.className = 'target';
  target.textContent = `${summarize(el)} ${snippet(el)}`.trim();
  target.title = buildSelector(el);
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'cancel';
  cancel.title = '取消';
  cancel.textContent = '×';
  head.append(target, cancel);

  const row = document.createElement('div');
  row.className = 'row';
  const textarea = document.createElement('textarea');
  textarea.placeholder = '评论这个元素…';
  const send = document.createElement('button');
  send.type = 'button';
  send.className = 'send';
  send.title = '发送';
  send.innerHTML =
    '<svg viewBox="0 0 16 16"><path d="M1.5 1.2l13 6.3-13 6.3-.03-4.9 8.5-1.4-8.5-1.4z"/></svg>';
  row.append(textarea, send);

  card.append(head, row);
  shadow.append(card);

  const submit = () => {
    const comment = textarea.value.trim();
    if (!comment) return;
    ipcRenderer.sendToHost('wave-picker', {
      type: 'submit',
      url: location.href,
      selector: buildSelector(el),
      summary: summarize(el),
      text: snippet(el),
      comment,
    });
    deactivate();
  };

  send.addEventListener('click', submit);
  cancel.addEventListener('click', () => deselect());
  textarea.addEventListener('input', () => {
    send.disabled = textarea.value.trim() === '';
  });
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
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

function onClick(e: MouseEvent): void {
  if (isInsideCard(e)) return;
  e.preventDefault();
  e.stopPropagation();
  // Clicking outside the card cancels the current selection back to
  // hover-pick state; the next click selects.
  if (selected) {
    deselect();
    return;
  }
  const el = e.target as Element | null;
  if (!el || el === cardHost) return;
  selected = el;
  el.classList.add(HIGHLIGHT_CLASS);
  showCard(el);
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
  document.addEventListener('mouseover', onMouseOver, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('submit', onSubmit, true);
  window.addEventListener('scroll', onScrollOrResize, true);
  window.addEventListener('resize', onScrollOrResize);
}

function deactivate(): void {
  if (!active) return;
  active = false;
  document.removeEventListener('mouseover', onMouseOver, true);
  document.removeEventListener('click', onClick, true);
  document.removeEventListener('submit', onSubmit, true);
  window.removeEventListener('scroll', onScrollOrResize, true);
  window.removeEventListener('resize', onScrollOrResize);
  clearHover();
  deselect();
  removeHighlightSheet();
}

ipcRenderer.on('wave-picker', (_event, msg: PickerMessage) => {
  if (msg?.action === 'activate') activate(msg);
  else if (msg?.action === 'deactivate') deactivate();
});

ipcRenderer.sendToHost('wave-picker', { type: 'ready' });

export {};
