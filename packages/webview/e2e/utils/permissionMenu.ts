import { expect, type Page } from "@playwright/test";

/**
 * 权限下拉菜单项的排布：图标与文案是否落在同一条水平线上、两者之间留了多少间距。
 *
 * 为什么单独读这两个数：菜单项是「图标 + 文案」一行，写成普通的 `<li>`（不声明
 * display）时两者按**基线**排——图标底边压在文字基线上，圆心比文字中心高一截，
 * 字形盒还紧贴文字。这条缺陷肉眼一看就能看出「图标浮在文字上面」，但用文本断言
 * 抓不到（文案本身没变），只能用几何量。修复前实测：插件端 −4px / 间距 0，远控页
 * −5px / 间距 0；修复后两端都是 −1～−1.5px / 间距 8px。
 */
export type PermissionMenuItemGeometry = {
  label: string;
  display: string;
  /** 图标圆心 Y − 文案墨盒中心 Y：负值 = 图标偏上。 */
  iconCenterMinusTextCenter: number;
  /** 图标右缘到文案左缘的水平距离（= flex gap 的实测值）。 */
  iconRightToTextLeft: number;
};

/** 打开权限下拉（点底栏那枚按钮）并读回四个菜单项的排布。 */
export async function readPermissionMenuItems(
  page: Page,
): Promise<PermissionMenuItemGeometry[]> {
  await page.locator(".permission-mode-select").click();
  await expect(page.locator(".permission-mode-menu")).toBeVisible();

  return page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll(".permission-mode-item"),
    ) as HTMLElement[];
    return items.map((li) => {
      const icon = li.querySelector(".permission-mode-icon") as SVGElement;
      const iconRect = icon.getBoundingClientRect();
      // 文案是 li 的文本节点（不是子元素），只能用 Range 取墨盒。
      const textNode = Array.from(li.childNodes).find(
        (n) => n.nodeType === Node.TEXT_NODE,
      )!;
      const range = document.createRange();
      range.selectNodeContents(textNode);
      const textRect = range.getBoundingClientRect();
      return {
        label: (textNode.textContent || "").trim(),
        display: getComputedStyle(li).display,
        iconCenterMinusTextCenter: +(
          (iconRect.top + iconRect.bottom) / 2 -
          (textRect.top + textRect.bottom) / 2
        ).toFixed(2),
        iconRightToTextLeft: +(textRect.left - iconRect.right).toFixed(2),
      };
    });
  });
}

/**
 * 三个宿主共用的断言：四档都是「图标与文案同一水平线、中间留出间距」。
 *
 * 容差说明：`align-items: center` 居中的是行盒，而 Range 取到的是文字**墨盒**，
 * 两者按字体度量天然差 1～1.5px（三端实测都是这个量级），所以取 ±2px；缺陷态是
 * −4～−5px，落在容差外，红得出来。
 */
export async function expectPermissionMenuAligned(page: Page): Promise<void> {
  const items = await readPermissionMenuItems(page);
  expect(items).toHaveLength(4);
  for (const item of items) {
    expect(
      Math.abs(item.iconCenterMinusTextCenter),
      `${item.label} 图标与文案应在同一水平线（实测差 ${item.iconCenterMinusTextCenter}px）`,
    ).toBeLessThanOrEqual(2);
    expect(
      item.iconRightToTextLeft,
      `${item.label} 图标与文案之间应留出间距（实测 ${item.iconRightToTextLeft}px）`,
    ).toBeGreaterThanOrEqual(6);
    // 上面两条是用户看到的现象；这条是成因（不声明 display 时 `<li>` 走基线排）。
    expect(item.display, `${item.label} 应是 flex 行`).toBe("flex");
  }
}
