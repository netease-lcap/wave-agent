import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { ModPanelRenderer } from "../../src/components/ModPanelRenderer";
import type { ModPanelTree } from "wave-agent-sdk/types";

// `Svg` 的 `source` 是 mod 写的一段标记，等价于不可信输入；净化白名单是这里
// 唯一要证明的东西，所以必须用真 DOMPurify（browser 的 setup 把它 mock 成了
// 直通，见 `tests/setup.browser.ts`）。
vi.unmock("dompurify");

function renderSvg(source: string) {
  const tree: ModPanelTree = {
    type: "Svg",
    props: { source, alt: "图" },
    children: [],
  };
  return render(<ModPanelRenderer tree={tree} onEvent={() => undefined} />)
    .container;
}

describe("mod Svg 的净化白名单", () => {
  it("留下 svg 图元，剥掉 script", () => {
    const container = renderSvg(
      '<svg viewBox="0 0 10 10"><script>alert(1)</script><circle cx="5" cy="5" r="4" /></svg>',
    );

    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("circle")).not.toBeNull();
  });

  it("剥掉事件属性与 javascript: 链接", () => {
    const container = renderSvg(
      '<svg viewBox="0 0 10 10" onload="alert(1)"><a href="javascript:alert(1)"><rect width="1" height="1" /></a></svg>',
    );

    expect(container.querySelector("svg")?.getAttribute("onload")).toBeNull();
    expect(container.querySelector("a")?.getAttribute("href")).toBeNull();
    // 图元本身留着：剥掉属性不等于整张图不画。
    expect(container.querySelector("rect")).not.toBeNull();
  });

  it("不引入 HTML 元素（foreignObject 这类嵌入点被剥掉）", () => {
    const container = renderSvg(
      '<svg viewBox="0 0 10 10"><foreignObject><div id="boom">x</div></foreignObject></svg>',
    );

    expect(container.querySelector("foreignObject")).toBeNull();
    expect(container.querySelector("#boom")).toBeNull();
  });
});
