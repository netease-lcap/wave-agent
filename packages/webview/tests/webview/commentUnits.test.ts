import { describe, it, expect, afterEach } from "vitest";
import {
  selectedUnitRange,
  selectionAnchor,
  toContainerPoint,
  unitIndexOf,
} from "../../src/utils/commentUnits";

/** A code view stub: three commentable lines inside a positioned container. */
function mount() {
  const container = document.createElement("div");
  container.className = "file-pane-code";
  container.innerHTML = [1, 2, 3]
    .map((n) => `<div class="line" data-comment-unit="${n}">line ${n}</div>`)
    .join("");
  document.body.appendChild(container);
  return {
    container,
    line: (n: number) =>
      container.querySelector<HTMLElement>(`[data-comment-unit="${n}"]`)!,
  };
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  document.body.innerHTML = "";
});

describe("unitIndexOf", () => {
  it("finds the line that owns an element or a text node", () => {
    const { container, line } = mount();
    const text = line(2).firstChild!;
    expect(unitIndexOf(text, container)).toBe(2);
    expect(unitIndexOf(line(3), container)).toBe(3);
  });

  it("returns null outside the view and for non-line nodes", () => {
    const { container } = mount();
    const stray = document.createElement("div");
    document.body.appendChild(stray);
    expect(unitIndexOf(stray, container)).toBeNull();
    expect(unitIndexOf(container, container)).toBeNull();
    expect(unitIndexOf(null, container)).toBeNull();
  });
});

describe("selectedUnitRange", () => {
  const select = (
    start: Node,
    startOffset: number,
    end: Node,
    endOffset: number,
  ) => {
    const range = document.createRange();
    range.setStart(start, startOffset);
    range.setEnd(end, endOffset);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  };

  it("spans every line the selection touches", () => {
    const { container, line } = mount();
    select(line(1), 0, line(3), 1);
    expect(selectedUnitRange(container)).toEqual({ from: 1, to: 3 });
  });

  it("ignores a caret", () => {
    const { container, line } = mount();
    select(line(2), 0, line(2), 0);
    expect(selectedUnitRange(container)).toBeNull();
  });

  it("does not claim the line the selection stops at", () => {
    const { container, line } = mount();
    // From the start of line 1 to the start of line 3: lines 1–2 are covered.
    select(line(1), 0, line(3), 0);
    expect(selectedUnitRange(container)).toEqual({ from: 1, to: 2 });
  });

  it("returns null for a selection outside the view", () => {
    const { container } = mount();
    const outside = document.createElement("p");
    outside.textContent = "elsewhere";
    document.body.appendChild(outside);
    const range = document.createRange();
    range.selectNodeContents(outside);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selectedUnitRange(container)).toBeNull();
  });
});

describe("anchors", () => {
  it("converts a client point into the container's content coordinates", () => {
    const { container } = mount();
    container.scrollTop = 40;
    container.scrollLeft = 10;
    container.getBoundingClientRect = () =>
      ({ left: 100, top: 200 }) as DOMRect;
    expect(toContainerPoint(container, 150, 260)).toEqual({ x: 60, y: 100 });
  });

  it("falls back to the last commented line when the selection has no rect", () => {
    const { container, line } = mount();
    container.scrollTop = 5;
    container.getBoundingClientRect = () => ({ left: 0, top: 0 }) as DOMRect;
    line(3).getBoundingClientRect = () =>
      ({ left: 0, top: 30, right: 80, bottom: 50 }) as DOMRect;
    expect(selectionAnchor(container, { from: 1, to: 3 })).toEqual({
      x: 80,
      y: 55,
    });
  });
});
