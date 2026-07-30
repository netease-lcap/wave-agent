// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Tests for the guest picker preload. The module is side-effect-only: it
 * registers an ipcRenderer listener on import and announces { type: 'ready' }.
 * Imported once at module scope; each test resets module state via deactivate.
 * sendToHost is NOT cleared between tests so the ready announcement (fired
 * once at import) stays observable — assertions match specific payloads.
 */

const { ipcRenderer } = vi.hoisted(() => ({
  ipcRenderer: {
    on: vi.fn(),
    sendToHost: vi.fn(),
  },
}));
vi.mock('electron', () => ({ ipcRenderer }));

// jsdom lacks constructable stylesheets — stub the bits the preload uses.
class FakeSheet {
  css = '';
  replaceSync(css: string) {
    this.css = css;
  }
}
vi.stubGlobal('CSSStyleSheet', FakeSheet);

import '../src/main/pickerPreload';

// ipcRenderer.on('wave-picker', handler) was registered at import time.
const handler = ipcRenderer.on.mock.calls.find((c) => c[0] === 'wave-picker')?.[1] as (
  event: unknown,
  msg: { action?: string; palette?: Record<string, string> },
) => void;
const activate = (palette?: Record<string, string>) => handler(null, { action: 'activate', palette });
const deactivate = () => handler(null, { action: 'deactivate' });

function shadowRoot(): ShadowRoot {
  const host = document.body.lastElementChild;
  if (!host?.shadowRoot) throw new Error('picker card not found');
  return host.shadowRoot;
}

const mouseOver = (el: Element) => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

beforeEach(() => {
  // Reset module state + DOM; keep sendToHost trace so the ready call stays
  // observable for the handshake test.
  deactivate();
  document.body.innerHTML = '';
  (document as unknown as { adoptedStyleSheets: unknown[] }).adoptedStyleSheets = [];
});

afterEach(() => deactivate());

function renderPage() {
  document.body.innerHTML = '<div id="app"><div class="card"><button class="primary">立即购买</button></div></div>';
  return {
    button: document.querySelector('button.primary') as Element,
    container: document.querySelector('#app > .card') as Element,
  };
}

describe('pickerPreload', () => {
  it('announces { type: "ready" } on load', () => {
    expect(
      ipcRenderer.sendToHost.mock.calls.some(
        ([channel, payload]) => channel === 'wave-picker' && payload && payload.type === 'ready',
      ),
    ).toBe(true);
  });

  it('highlights hovered elements only while active', () => {
    const { button } = renderPage();
    mouseOver(button);
    expect(button.classList.contains('__wave-picker-highlight')).toBe(false);

    activate({ accent: '#ff0000' });
    mouseOver(button);
    expect(button.classList.contains('__wave-picker-highlight')).toBe(true);

    deactivate();
    expect(button.classList.contains('__wave-picker-highlight')).toBe(false);
  });

  it('moves the highlight between hovered elements', () => {
    const { button, container } = renderPage();
    activate();
    mouseOver(button);
    mouseOver(container);
    expect(button.classList.contains('__wave-picker-highlight')).toBe(false);
    expect(container.classList.contains('__wave-picker-highlight')).toBe(true);
  });

  it('click selects the element and shows the floating comment card', () => {
    const { button } = renderPage();
    activate();
    click(button);

    expect(button.classList.contains('__wave-picker-highlight')).toBe(true);
    const root = shadowRoot();
    // Card footer shows just the element tag name (selector on hover title).
    const tag = root.querySelector('.tag') as HTMLElement;
    expect(tag.textContent).toBe('button');
    expect(tag.title).toBe('#app > div > button');
    expect(root.querySelector('textarea')).toBeTruthy();
    // Submit button: plus ("add to input") icon, disabled until the user types.
    const send = root.querySelector('.send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.title).toBe('添加到输入框');
    expect(send.querySelector('svg path')?.getAttribute('d')).toBe('M14 7v1H8v6H7V8H1V7h6V1h1v6h6z');
  });

  it('intercepts page clicks and form submits while active', () => {
    renderPage();
    document.body.insertAdjacentHTML('beforeend', '<form><button type="submit">go</button></form>');
    const link = document.createElement('a');
    link.href = 'http://localhost:5173/other';
    link.textContent = 'nav';
    document.body.appendChild(link);
    activate();

    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);

    const form = document.querySelector('form') as HTMLFormElement;
    const submitEvent = new Event('submit', { bubbles: true, cancelable: true });
    form.dispatchEvent(submitEvent);
    expect(submitEvent.defaultPrevented).toBe(true);
  });

  it('Enter submits a structured comment and returns to hover-pick state', () => {
    const { button, container } = renderPage();
    activate({ accent: '#ff0000' });
    click(button);

    const root = shadowRoot();
    const textarea = root.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '这个按钮颜色太淡了';
    textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));

    expect(ipcRenderer.sendToHost).toHaveBeenCalledWith('wave-picker', {
      type: 'submit',
      url: 'http://localhost:3000/',
      selector: '#app > div > button',
      summary: 'button.primary',
      text: '立即购买',
      comment: '这个按钮颜色太淡了',
    });
    // Selection cleared: highlight gone, card removed.
    expect(button.classList.contains('__wave-picker-highlight')).toBe(false);
    expect(document.body.lastElementChild?.shadowRoot ?? null).toBeNull();
    // Picker stays active for the next pick: hover highlights again and a
    // second element can be selected for another comment.
    mouseOver(container);
    expect(container.classList.contains('__wave-picker-highlight')).toBe(true);
    click(container);
    expect(shadowRoot().querySelector('.tag')?.textContent).toBe('div');
  });

  it('send button is an equivalent submit entry once text is present', () => {
    const { button } = renderPage();
    activate();
    click(button);

    const root = shadowRoot();
    const textarea = root.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = '改大一点';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    const send = root.querySelector('.send') as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    send.click();

    expect(ipcRenderer.sendToHost).toHaveBeenCalledWith(
      'wave-picker',
      expect.objectContaining({ type: 'submit', comment: '改大一点' }),
    );
  });

  it('clicking outside the card cancels the current selection', () => {
    const { button, container } = renderPage();
    activate();
    click(button);
    expect(shadowRoot()).toBeTruthy();

    click(container); // outside the card → cancel, NOT reselect
    expect(button.classList.contains('__wave-picker-highlight')).toBe(false);
    expect(container.classList.contains('__wave-picker-highlight')).toBe(false);
    expect(document.body.lastElementChild?.shadowRoot ?? null).toBeNull();

    click(container); // next click selects
    expect(container.classList.contains('__wave-picker-highlight')).toBe(true);
    expect(shadowRoot().querySelector('.tag')?.textContent).toBe('div');
  });

  it('clicks inside the card do not cancel or propagate', () => {
    const { button } = renderPage();
    activate();
    click(button);
    const textarea = shadowRoot().querySelector('textarea') as HTMLTextAreaElement;

    const innerClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    textarea.dispatchEvent(innerClick);
    expect(innerClick.defaultPrevented).toBe(false);
    expect(button.classList.contains('__wave-picker-highlight')).toBe(true);
  });

  it('deactivate removes all picker artifacts', () => {
    const { button } = renderPage();
    activate();
    click(button);
    deactivate();

    expect(button.classList.contains('__wave-picker-highlight')).toBe(false);
    expect(document.body.lastElementChild?.shadowRoot ?? null).toBeNull();
    expect((document as unknown as { adoptedStyleSheets: unknown[] }).adoptedStyleSheets.length).toBe(0);
  });
});
