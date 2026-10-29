import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Suppress console output during tests to reduce noise
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});
vi.spyOn(console, "error").mockImplementation(() => {});
vi.spyOn(console, "info").mockImplementation(() => {});
vi.spyOn(console, "debug").mockImplementation(() => {});

// jsdom does not implement scrollIntoView; mock it so components that call it on mount don't throw
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function () {};
}

// jsdom does not implement Element.scrollTo. The virtualizer's scrollToFn uses
// it (optional-chained, so absence silently no-ops); provide a minimal version
// that mirrors the browser behavior (set scrollTop/scrollLeft). Tests that need
// to observe programmatic scrolls replace it with a spy.
if (typeof Element !== "undefined" && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function (
    this: Element,
    opts?: ScrollToOptions | number,
    y?: number,
  ) {
    if (typeof opts === "number") {
      this.scrollTop = opts;
      if (typeof y === "number") this.scrollLeft = y;
    } else if (opts) {
      if (typeof opts.top === "number") this.scrollTop = opts.top;
      if (typeof opts.left === "number") this.scrollLeft = opts.left;
    }
  };
}

// jsdom does no layout: offsetHeight/offsetWidth are always 0. Every message
// renders through the virtualizer, which measures the scroll container to size
// its viewport and every row to place it — with 0 it would render zero rows in
// every jsdom test.
//
// 视口和行高必须分开给：虚拟列表的窗口按**像素**算（上下各 600px 缓冲，见
// src/virtual/geometry.ts），如果行高和视口都是 600，一屏只放得下一行，窗口就退化
// 成「只渲染边缘两三行」，测试里根本查不到中间的消息。真实排版里行高几十像素、
// 视口几百像素，这里照那个比例给：容器 600（= 视口），其余元素 80（= 一行）。
const CONTAINER_VIEWPORT_HEIGHT = 600;
const ROW_HEIGHT = 80;

const isScrollContainer = (element: Element) =>
  element.id === "messagesContainer" ||
  element.getAttribute("data-testid") === "messages-container";

Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
  configurable: true,
  get(this: HTMLElement) {
    return isScrollContainer(this) ? CONTAINER_VIEWPORT_HEIGHT : ROW_HEIGHT;
  },
});
Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
  configurable: true,
  get: () => 800,
});

// jsdom does not have DataTransfer; polyfill a minimal version for paste/drop tests
if (typeof globalThis.DataTransfer === "undefined") {
  class DataTransferPolyfill {
    items: {
      type: string;
      kind: string;
      getAsString: (cb: (s: string) => void) => void;
      getAsFile: () => File | null;
    }[] = [];
    files: File[] = [];
    types: string[] = [];
    setData() {}
    getData() {
      return "";
    }
    clearData() {}
    add(data: string | File, type?: string) {
      if (typeof data === "string") {
        this.types.push(type || "text/plain");
        return null;
      }
      this.items.push({
        type: data.type,
        kind: "file",
        getAsString: () => {},
        getAsFile: () => data,
      });
      this.files.push(data);
      this.types.push("Files");
      return {
        type: data.type,
        kind: "file",
        getAsString: () => {},
        getAsFile: () => data,
      };
    }
  }
  (globalThis as unknown as Record<string, unknown>).DataTransfer =
    DataTransferPolyfill;
}

// jsdom does not implement innerText getter; polyfill it using textContent.
// The webview's MessageInput component reads `element.innerText` to sync state,
// and jsdom returns undefined for the getter, causing `message.trim()` to crash.
if (typeof HTMLElement !== "undefined") {
  const desc = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    "innerText",
  );
  if (!desc || !desc.get) {
    Object.defineProperty(HTMLElement.prototype, "innerText", {
      get() {
        return this.textContent || "";
      },
      set(value: string) {
        this.textContent = value ?? "";
      },
      configurable: true,
    });
  }
}
