// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
vi.mock("electron", () => ({ ipcRenderer }));

// jsdom lacks constructable stylesheets — stub the bits the preload uses.
class FakeSheet {
  css = "";
  replaceSync(css: string) {
    this.css = css;
  }
}
vi.stubGlobal("CSSStyleSheet", FakeSheet);

/**
 * jsdom has no hit testing (`document.elementFromPoint` is missing), so tests
 * register what each point resolves to. Only the coordinate matters, never the
 * element the events are dispatched on.
 */
const hits = new Map<string, Element>();
(
  document as unknown as {
    elementFromPoint: (x: number, y: number) => Element | null;
  }
).elementFromPoint = (x, y) => hits.get(`${x},${y}`) ?? null;

import "../src/main/pickerPreload";

// ipcRenderer.on('wave-picker', handler) was registered at import time.
const handler = ipcRenderer.on.mock.calls.find(
  (c) => c[0] === "wave-picker",
)?.[1] as (
  event: unknown,
  msg: { action?: string; palette?: Record<string, string> },
) => void;
const activate = (palette?: Record<string, string>) =>
  handler(null, { action: "activate", palette });
const deactivate = () => handler(null, { action: "deactivate" });

function shadowRoot(): ShadowRoot {
  const host = document.body.lastElementChild;
  if (!host?.shadowRoot) throw new Error("picker card not found");
  return host.shadowRoot;
}

const mouseOver = (el: Element) =>
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));

const POINT = { x: 40, y: 40 };

type PressOptions = {
  /** Point the press lands on. Defaults to POINT. */
  at?: { x: number; y: number };
  /** Point the release lands on. Defaults to `at` (a click-like press). */
  releaseAt?: { x: number; y: number };
  /** What hit-testing resolves at the release point; `null` = nothing there.
      Defaults to the element the events are dispatched on. */
  hit?: Element | null;
  button?: number;
};

/**
 * A pointer press+release pair — the picker's pick trigger. Deliberately NOT
 * `click`: for a disabled form control the engine queues no click at all (the
 * whole mousedown/mouseup/click sequence is dropped; only mouseover and the
 * pointer events arrive), which is why picking a greyed-out element was dead.
 */
function press(el: Element, opts: PressOptions = {}) {
  const at = opts.at ?? POINT;
  const releaseAt = opts.releaseAt ?? at;
  const hit = opts.hit === undefined ? el : opts.hit;
  if (hit) hits.set(`${releaseAt.x},${releaseAt.y}`, hit);
  const init = { bubbles: true, button: opts.button ?? 0, cancelable: true };
  el.dispatchEvent(
    new MouseEvent("pointerdown", {
      ...init,
      clientX: at.x,
      clientY: at.y,
    }),
  );
  el.dispatchEvent(
    new MouseEvent("pointerup", {
      ...init,
      clientX: releaseAt.x,
      clientY: releaseAt.y,
    }),
  );
}

beforeEach(() => {
  // Reset module state + DOM; keep sendToHost trace so the ready call stays
  // observable for the handshake test.
  deactivate();
  document.body.innerHTML = "";
  hits.clear();
  (
    document as unknown as { adoptedStyleSheets: unknown[] }
  ).adoptedStyleSheets = [];
});

afterEach(() => deactivate());

function renderPage() {
  document.body.innerHTML =
    '<div id="app"><div class="card"><button class="primary">立即购买</button></div></div>';
  return {
    button: document.querySelector("button.primary") as Element,
    container: document.querySelector("#app > .card") as Element,
  };
}

describe("pickerPreload", () => {
  it('announces { type: "ready" } on load', () => {
    expect(
      ipcRenderer.sendToHost.mock.calls.some(
        ([channel, payload]) =>
          channel === "wave-picker" && payload && payload.type === "ready",
      ),
    ).toBe(true);
  });

  it("highlights hovered elements only while active", () => {
    const { button } = renderPage();
    mouseOver(button);
    expect(button.classList.contains("__wave-picker-highlight")).toBe(false);

    activate({ accent: "#ff0000" });
    mouseOver(button);
    expect(button.classList.contains("__wave-picker-highlight")).toBe(true);

    deactivate();
    expect(button.classList.contains("__wave-picker-highlight")).toBe(false);
  });

  it("moves the highlight between hovered elements", () => {
    const { button, container } = renderPage();
    activate();
    mouseOver(button);
    mouseOver(container);
    expect(button.classList.contains("__wave-picker-highlight")).toBe(false);
    expect(container.classList.contains("__wave-picker-highlight")).toBe(true);
  });

  it("press selects the element and shows the floating comment card", () => {
    const { button } = renderPage();
    activate();
    press(button);

    expect(button.classList.contains("__wave-picker-highlight")).toBe(true);
    const root = shadowRoot();
    // Card footer shows just the element tag name (selector on hover title).
    const tag = root.querySelector(".tag") as HTMLElement;
    expect(tag.textContent).toBe("button");
    expect(tag.title).toBe("#app > div > button");
    expect(root.querySelector("textarea")).toBeTruthy();
    // Submit button: "add to input" text button, disabled until the user types.
    const send = root.querySelector(".send") as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(send.title).toBe("添加到输入框");
    expect(send.textContent).toBe("添加");
  });

  it("picks a disabled control, which gets no click event at all", () => {
    // Blink drops the whole mousedown/mouseup/click sequence when the press
    // lands on a disabled form control or one of its descendants — only
    // mouseover/pointerdown/pointerup arrive. Picking a greyed-out element used
    // to be impossible: the click-driven pick never ran.
    document.body.innerHTML =
      '<div id="app"><button class="scope" disabled><span class="label">项目共享（project）</span></button></div>';
    const label = document.querySelector("span.label") as Element;
    activate();

    press(label);
    // No click follows the release; the pick must already have happened.
    expect(label.classList.contains("__wave-picker-highlight")).toBe(true);
    expect(shadowRoot().querySelector(".tag")?.textContent).toBe("span");
  });

  it("resolves the pick from the pointer coordinates, not the event target", () => {
    // A page can retarget the pointer events (setPointerCapture) — measured in
    // Chromium: pointerup/mouseup/click then report the capturing ancestor,
    // while elementFromPoint still resolves the element under the cursor.
    const { button, container } = renderPage();
    activate();

    press(container, { hit: button });
    expect(button.classList.contains("__wave-picker-highlight")).toBe(true);
    expect(container.classList.contains("__wave-picker-highlight")).toBe(false);
    expect(shadowRoot().querySelector(".tag")?.textContent).toBe("button");
  });

  it("does not pick when the pointer moved between press and release", () => {
    const { button } = renderPage();
    activate();

    // A drag (text selection, slider, scrollbar) is not a pick.
    press(button, { at: { x: 40, y: 40 }, releaseAt: { x: 90, y: 40 } });
    expect(button.classList.contains("__wave-picker-highlight")).toBe(false);
    expect(document.body.lastElementChild?.shadowRoot ?? null).toBeNull();
  });

  it("ignores non-primary buttons", () => {
    const { button } = renderPage();
    activate();

    press(button, { button: 2 });
    expect(button.classList.contains("__wave-picker-highlight")).toBe(false);
    expect(document.body.lastElementChild?.shadowRoot ?? null).toBeNull();
  });

  it("intercepts page clicks and form submits while active", () => {
    renderPage();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<form><button type="submit">go</button></form>',
    );
    const link = document.createElement("a");
    link.href = "http://localhost:5173/other";
    link.textContent = "nav";
    document.body.appendChild(link);
    activate();

    const clickEvent = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    link.dispatchEvent(clickEvent);
    expect(clickEvent.defaultPrevented).toBe(true);

    const form = document.querySelector("form") as HTMLFormElement;
    const submitEvent = new Event("submit", {
      bubbles: true,
      cancelable: true,
    });
    form.dispatchEvent(submitEvent);
    expect(submitEvent.defaultPrevented).toBe(true);
  });

  it("Enter submits a structured comment and returns to hover-pick state", () => {
    const { button, container } = renderPage();
    activate({ accent: "#ff0000" });
    press(button);

    const root = shadowRoot();
    const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "这个按钮颜色太淡了";
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
      }),
    );

    expect(ipcRenderer.sendToHost).toHaveBeenCalledWith("wave-picker", {
      type: "submit",
      url: "http://localhost:3000/",
      selector: "#app > div > button",
      summary: "button.primary",
      text: "立即购买",
      comment: "这个按钮颜色太淡了",
    });
    // Selection cleared: highlight gone, card removed.
    expect(button.classList.contains("__wave-picker-highlight")).toBe(false);
    expect(document.body.lastElementChild?.shadowRoot ?? null).toBeNull();
    // Picker stays active for the next pick: hover highlights again and a
    // second element can be selected for another comment.
    mouseOver(container);
    expect(container.classList.contains("__wave-picker-highlight")).toBe(true);
    press(container);
    expect(shadowRoot().querySelector(".tag")?.textContent).toBe("div");
  });

  it("Enter does not submit while IME is composing (e.g. pinyin)", () => {
    // sendToHost is intentionally NOT cleared between tests (the ready
    // handshake test relies on the import-time call), so scope the assertion
    // to calls made within this test only.
    ipcRenderer.sendToHost.mockClear();
    const { button } = renderPage();
    activate({ accent: "#ff0000" });
    press(button);

    const root = shadowRoot();
    const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "这个按钮颜色太淡了";
    // Chinese IME uses Enter to confirm the candidate; that keydown fires with
    // isComposing=true (keyCode 229) and must NOT submit the draft comment.
    textarea.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        isComposing: true,
        keyCode: 229,
      }),
    );
    expect(ipcRenderer.sendToHost).not.toHaveBeenCalledWith(
      "wave-picker",
      expect.objectContaining({ type: "submit" }),
    );
    // Card stays open so the user can keep composing.
    expect(document.body.lastElementChild?.shadowRoot ?? null).not.toBeNull();
  });

  it("send button is an equivalent submit entry once text is present", () => {
    const { button } = renderPage();
    activate();
    press(button);

    const root = shadowRoot();
    const textarea = root.querySelector("textarea") as HTMLTextAreaElement;
    textarea.value = "改大一点";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const send = root.querySelector(".send") as HTMLButtonElement;
    expect(send.disabled).toBe(false);
    send.click();

    expect(ipcRenderer.sendToHost).toHaveBeenCalledWith(
      "wave-picker",
      expect.objectContaining({ type: "submit", comment: "改大一点" }),
    );
  });

  it("pressing outside the card cancels the current selection", () => {
    const { button, container } = renderPage();
    activate();
    press(button);
    expect(shadowRoot()).toBeTruthy();

    press(container); // outside the card → cancel, NOT reselect
    expect(button.classList.contains("__wave-picker-highlight")).toBe(false);
    expect(container.classList.contains("__wave-picker-highlight")).toBe(false);
    expect(document.body.lastElementChild?.shadowRoot ?? null).toBeNull();

    press(container); // next press selects
    expect(container.classList.contains("__wave-picker-highlight")).toBe(true);
    expect(shadowRoot().querySelector(".tag")?.textContent).toBe("div");
  });

  it("never picks the card itself", () => {
    const { button } = renderPage();
    activate();
    press(button);
    const textarea = shadowRoot().querySelector(
      "textarea",
    ) as HTMLTextAreaElement;

    // Clicks inside the card must not be swallowed either way: the card's own
    // textarea/"添加" button keep working.
    const innerClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(innerClick);
    expect(innerClick.defaultPrevented).toBe(false);
    expect(button.classList.contains("__wave-picker-highlight")).toBe(true);

    // Hit-testing over the card resolves the card's host element (a shadow
    // boundary is not crossed by hit tests), so it is never picked — and it
    // does not cancel the current selection either.
    press(textarea, { hit: document.body.lastElementChild });
    expect(button.classList.contains("__wave-picker-highlight")).toBe(true);
    expect(textarea.classList.contains("__wave-picker-highlight")).toBe(false);
  });

  it("deactivate removes all picker artifacts", () => {
    const { button } = renderPage();
    activate();
    press(button);
    deactivate();

    expect(button.classList.contains("__wave-picker-highlight")).toBe(false);
    expect(document.body.lastElementChild?.shadowRoot ?? null).toBeNull();
    expect(
      (document as unknown as { adoptedStyleSheets: unknown[] })
        .adoptedStyleSheets.length,
    ).toBe(0);
  });
});
