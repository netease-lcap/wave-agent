/**
 * 桌面端主机下拉菜单的**高度封顶**（spec `desktop/desktop-remote.md`「SSH 远程
 * 主机」场景 26）。
 *
 * 迁移自 `e2e/desktop-host-menu-overflow.e2e.ts`。客户的 `~/.ssh/config` 能列上百台
 * 主机，而菜单是从输入框（窗口底部）**向上**展开的：没有封顶就会长过视口上沿，
 * 第一项「本地」永远点不到。jsdom 没有布局，所以这套用例跑在真 Chromium 里，
 * 逐条量盒、量滚动容器。宿主档由 `desktopHarness` 打开（`data-host="desktop"` +
 * host-desktop.css），viewport 用真机 e2e 的原尺寸。
 */

import { describe, it, expect, afterEach } from "vitest";
import { page, userEvent } from "vitest/browser";
import { sendCommand } from "./test-utils";
import {
  isVisible,
  renderDesktopApp,
  resetHostTier,
  resetPanelState,
} from "./desktopHarness";

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/** 80 台 SSH 主机 —— 远超一屏，与客户报的场景同量级。 */
const MANY_HOSTS = Array.from(
  { length: 80 },
  (_, i) => `prod-server-${String(i + 1).padStart(2, "0")}`,
);

/** 几条 WSL 发行版：第二个分组，短，但必须整组留着。 */
const WSL_DISTROS = ["Ubuntu-24.04", "Ubuntu", "Debian", "kali-linux"];

/** 宿主下发的顺序：本地 → WSL 发行版 → SSH 主机（desktopHost.hostOptions()）。 */
const WSL_AND_SSH_OPTIONS = [
  { id: "local", label: "本地", kind: "local" },
  ...WSL_DISTROS.map((name) => ({
    id: `wsl:${name}`,
    label: name,
    kind: "wsl",
  })),
  ...MANY_HOSTS.map((name) => ({ id: name, label: name, kind: "ssh" })),
];

const MENU = '[data-testid="desktop-host-menu"]';
const TRIGGER = '[data-testid="desktop-host"]';
const LOCAL_ITEM = '[data-testid="desktop-host-local"]';
const SSH_ITEMS = '[data-testid="desktop-host-item"]';
const ADD_ENTRY = '[data-testid="desktop-host-add-entry"]';

afterEach(() => {
  resetHostTier();
  resetPanelState();
});

const q = (selector: string) => {
  const node = document.querySelector<HTMLElement>(selector);
  if (!node) throw new Error(`no element for ${selector}`);
  return node;
};

const qa = (selector: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(selector));

/** 元素盒（等价 Playwright 的 `boundingBox()`，元素一定存在时用它）。 */
const box = (node: Element) => node.getBoundingClientRect();

/** 真焦点落在第 `index` 个匹配上（等价 Playwright 的 `toBeFocused`）。 */
async function expectFocused(selector: string, index = 0): Promise<void> {
  await expect
    .poll(() => document.activeElement === qa(selector)[index], {
      timeout: 2000,
    })
    .toBe(true);
}

/**
 * 菜单的**有效外沿上限**，读计算样式：菜单是 content-box，只看 `max-height`
 * 会把 padding + border 留在上限之外（与 `.desktop-remote-browser` 的 340px
 * 同一种形状）。
 */
function menuHeightCap(menu: HTMLElement): number {
  const s = getComputedStyle(menu);
  const max = parseFloat(s.maxHeight);
  const padding = parseFloat(s.paddingTop) + parseFloat(s.paddingBottom);
  const border = parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth);
  return s.boxSizing === "content-box" ? max + padding + border : max;
}

const scrollState = (node: HTMLElement) => ({
  scrollTop: node.scrollTop,
  clientHeight: node.clientHeight,
  scrollHeight: node.scrollHeight,
  overflowY: getComputedStyle(node).overflowY,
});

const text = (node: Element) => (node.textContent ?? "").trim();

/**
 * 起一个桌面分屏并把主机菜单的候选列表推下去。载荷与真机一致：`desktopWorkdirState`
 * 里带 `host` / `hosts`（老宿主的回退形态）或 `hostOptions`（新宿主的分组形态）。
 */
function bootHostMenu(options: Record<string, unknown> = {}) {
  renderDesktopApp();
  sendCommand("desktopWorkdirState", {
    host: "local",
    hosts: MANY_HOSTS,
    recentWorkdirs: [],
    ...options,
  });
  sendCommand("setInitialState", initialState);
}

/** 点触发键开菜单，等菜单真的画出来。 */
async function openMenu() {
  await userEvent.click(q(TRIGGER));
  await expect.poll(() => isVisible(MENU)).toBe(true);
}

describe("Desktop host menu height cap", () => {
  it("长主机列表在菜单里滚，本地与 添加主机… 始终可达", async () => {
    await page.viewport(960, 640);
    bootHostMenu();
    await openMenu();

    const menuBox = box(q(MENU));
    const cap = menuHeightCap(q(MENU));
    expect(cap, "菜单必须声明一个高度上限").toBeGreaterThan(200);
    expect(menuBox.height).toBeLessThanOrEqual(cap + 1);
    expect(menuBox.y, "菜单不许冒出视口上沿").toBeGreaterThanOrEqual(0);

    // ── 本地 是钉住的：打开即可达，而且**不在**滚动容器里（只有远端主机滚动，
    // 规格场景 26）──
    await expectFocused(LOCAL_ITEM);
    const list = q(".desktop-host-menu-items");
    expect(list.querySelectorAll(LOCAL_ITEM).length).toBe(0);
    const localBox = box(q(LOCAL_ITEM));
    expect(localBox.y).toBeGreaterThanOrEqual(menuBox.y);
    expect(localBox.y + localBox.height).toBeLessThanOrEqual(
      menuBox.y + menuBox.height,
    );

    // ── 主机条目区是唯一的滚动容器：菜单本身、SSH 主机 分组标题都不跟着滚 ──
    expect(list.querySelectorAll(".desktop-workdir-menu-label").length).toBe(0);
    const groupLabel = q(".desktop-workdir-menu-label");
    const labelBox = box(groupLabel);
    expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(
      menuBox.y + menuBox.height,
    );
    const listBox = box(list);
    const listScroll = scrollState(list);
    expect(listScroll.overflowY).toBe("auto");
    expect(listScroll.scrollHeight).toBeGreaterThan(listScroll.clientHeight);
    expect(listScroll.scrollTop).toBe(0);
    expect(q(MENU).scrollHeight).toBe(q(MENU).clientHeight);

    // ── 本地、SSH 主机 标题、添加主机… 都是钉住的：把主机条目滚到底，它们
    // （连同菜单外框）一格都不动 ──
    const addBefore = box(q(ADD_ENTRY));
    expect(addBefore.y + addBefore.height).toBeLessThanOrEqual(
      menuBox.y + menuBox.height,
    );

    list.scrollTo(0, list.scrollHeight);

    expect(list.scrollTop).toBeGreaterThan(0);
    const addAfter = box(q(ADD_ENTRY));
    expect(Math.abs(addAfter.y - addBefore.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box(q(MENU)).y - menuBox.y)).toBeLessThanOrEqual(1);

    // 本地 与分组标题都不跟着滚：滚到最后一台主机时仍在原位、仍在菜单里
    expect(
      Math.abs(box(q(".desktop-workdir-menu-label")).y - labelBox.y),
    ).toBeLessThanOrEqual(1);
    expect(isVisible(LOCAL_ITEM)).toBe(true);
    const localAfterScroll = box(q(LOCAL_ITEM));
    expect(Math.abs(localAfterScroll.y - localBox.y)).toBeLessThanOrEqual(1);
    expect(localAfterScroll.y + localAfterScroll.height).toBeLessThanOrEqual(
      menuBox.y + menuBox.height,
    );

    // ── 列表末尾能滚到 ──
    const lastHost = qa(SSH_ITEMS)[MANY_HOSTS.length - 1];
    expect(text(lastHost)).toBe(MANY_HOSTS[MANY_HOSTS.length - 1]);
    const lastBox = box(lastHost);
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(
      listBox.y + listBox.height + 1,
    );

    // ── 键盘漫游仍能走完整张列表：从最后一台主机按 80+1 次 ArrowUp 回到 本地，
    // 路上把列表滚回顶部 ──
    lastHost.focus();
    await userEvent.keyboard("{ArrowUp}".repeat(MANY_HOSTS.length + 1));
    await expectFocused(LOCAL_ITEM);
    expect(list.scrollTop).toBe(0);
    const localBack = box(q(LOCAL_ITEM));
    expect(localBack.y).toBeGreaterThanOrEqual(menuBox.y);
    expect(localBack.y + localBack.height).toBeLessThanOrEqual(
      menuBox.y + menuBox.height,
    );

    // ── 添加主机… 把连接表单当模态打开：菜单收起，表单居中且整块在屏上（「主机」
    // 字段是用户第一个要打字的格子）──
    await userEvent.click(q(ADD_ENTRY));
    await expect.poll(() => isVisible(MENU)).toBe(false);
    expect(isVisible('[data-testid="desktop-ssh-connection-dialog"]')).toBe(
      true,
    );
    await expect
      .poll(() => isVisible('[data-testid="desktop-ssh-host"]'))
      .toBe(true);
    const fieldBox = box(q('[data-testid="desktop-ssh-host"]'));
    const dialogBox = box(q('[data-testid="desktop-ssh-connection-dialog"]'));
    expect(fieldBox.y).toBeGreaterThanOrEqual(dialogBox.y);
    expect(fieldBox.y + fieldBox.height).toBeLessThanOrEqual(
      dialogBox.y + dialogBox.height + 1,
    );
  });

  // 同一封顶规则下的第二个分组：host 下发的顺序是 本地 → WSL 发行版 → SSH 主机
  // （desktopHost.hostOptions()），所以上百台 SSH 主机和几条 WSL 发行版会同时出现。
  // 两个分组都在同一列里分高度，默认按内容高度等比例收缩会把只有 4 条的 WSL 组压成
  // 几个像素 —— 等于被 SSH 主机「顶没」，两组的标题也一起看不见。
  it("上百台 SSH 主机不会把 WSL 分组挤没", async () => {
    // 正常桌面窗口高度：封顶取 340px（不是 40vh），两组加起来还有富余。
    await page.viewport(960, 900);
    bootHostMenu({ hostOptions: WSL_AND_SSH_OPTIONS });
    await openMenu();

    const menuBox = box(q(MENU));

    const groups = qa(".desktop-host-menu-group");
    expect(groups.length).toBe(2);
    const [wslGroup, sshGroup] = groups;
    const wslLabel = wslGroup.querySelector<HTMLElement>(
      ".desktop-host-menu-label",
    );
    const sshLabel = sshGroup.querySelector<HTMLElement>(
      ".desktop-host-menu-label",
    );
    const wslList = wslGroup.querySelector<HTMLElement>(
      ".desktop-host-menu-items",
    );
    const sshList = sshGroup.querySelector<HTMLElement>(
      ".desktop-host-menu-items",
    );
    expect(wslLabel && sshLabel && wslList && sshList).toBeTruthy();
    if (!wslLabel || !sshLabel || !wslList || !sshList) return;

    // ── 两个分组标题都在屏上，WSL 在 SSH 主机 之上（宿主给的顺序）──
    expect(text(wslLabel)).toBe("WSL");
    expect(text(sshLabel)).toBe("SSH 主机");
    const wslLabelBox = box(wslLabel);
    const sshLabelBox = box(sshLabel);
    expect(wslLabelBox.y).toBeGreaterThan(menuBox.y);
    expect(sshLabelBox.y).toBeGreaterThan(wslLabelBox.y);
    expect(sshLabelBox.y + sshLabelBox.height).toBeLessThanOrEqual(
      menuBox.y + menuBox.height,
    );

    // ── WSL 分组保住自然高度：每条发行版整行可见，它自己没什么可滚的 ──
    const wslRows = Array.from(
      wslList.querySelectorAll<HTMLElement>(SSH_ITEMS),
    );
    expect(wslRows.length).toBe(WSL_DISTROS.length);
    const wslListBox = box(wslList);
    const wslListScroll = scrollState(wslList);
    expect(wslListScroll.clientHeight).toBeGreaterThanOrEqual(100);
    expect(wslListScroll.scrollHeight).toBe(wslListScroll.clientHeight);
    expect(wslListScroll.scrollTop).toBe(0);
    for (let i = 0; i < WSL_DISTROS.length; i += 1) {
      const row = wslRows[i];
      expect(text(row)).toBe(WSL_DISTROS[i]);
      const rowBox = box(row);
      expect(rowBox.height).toBeGreaterThanOrEqual(20);
      expect(rowBox.y).toBeGreaterThanOrEqual(wslListBox.y);
      expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(
        menuBox.y + menuBox.height,
      );
    }

    // ── 让出高度的是长的那组 SSH 主机：它滚，它的标题不动，它滚动时 WSL 组不动 ──
    const sshScroll = scrollState(sshList);
    expect(sshScroll.overflowY).toBe("auto");
    expect(sshScroll.scrollHeight).toBeGreaterThan(sshScroll.clientHeight);
    const addBefore = box(q(ADD_ENTRY));
    sshList.scrollTo(0, sshList.scrollHeight);
    expect(sshList.scrollTop).toBeGreaterThan(0);

    expect(Math.abs(box(wslLabel).y - wslLabelBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(box(sshLabel).y - sshLabelBox.y)).toBeLessThanOrEqual(1);
    const addAfter = box(q(ADD_ENTRY));
    expect(Math.abs(addAfter.y - addBefore.y)).toBeLessThanOrEqual(1);
    expect(addAfter.y + addAfter.height).toBeLessThanOrEqual(
      menuBox.y + menuBox.height,
    );

    // ── 键盘漫游跨得过分组边界：ArrowDown 依次走 本地 → 4 个 WSL 发行版 → 第一台
    // SSH 主机（DOM 顺序 === itemIndex）──
    q(LOCAL_ITEM).focus();
    await userEvent.keyboard("{ArrowDown}".repeat(WSL_DISTROS.length + 1));
    const firstSsh = sshList.querySelector<HTMLElement>(SSH_ITEMS);
    expect(firstSsh).toBeTruthy();
    if (!firstSsh) return;
    expect(text(firstSsh)).toBe(MANY_HOSTS[0]);
    await expect.poll(() => document.activeElement === firstSsh).toBe(true);
  });

  // 小窗口（640px 高 → 封顶取 40vh = 256px）里两组加起来放不下全部条目，此时按
  // 均分：谁都不许被压没，两组各留至少两行并能各自滚动。
  it("矮窗口里两个分组都还分得到地方", async () => {
    await page.viewport(960, 640);
    bootHostMenu({ hostOptions: WSL_AND_SSH_OPTIONS });
    await openMenu();

    const menuBox = box(q(MENU));
    const groups = qa(".desktop-host-menu-group");
    expect(groups.length).toBe(2);
    for (const group of groups) {
      const label = group.querySelector<HTMLElement>(
        ".desktop-host-menu-label",
      );
      const list = group.querySelector<HTMLElement>(".desktop-host-menu-items");
      expect(label && list).toBeTruthy();
      if (!label || !list) return;
      // 标题整行可见
      const labelBox = box(label);
      expect(labelBox.y).toBeGreaterThan(menuBox.y);
      expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(
        menuBox.y + menuBox.height,
      );
      // 条目区至少两行高（单行 28px），并且能滚
      const listBox = box(list);
      expect(listBox.height).toBeGreaterThanOrEqual(56);
      const scroll = scrollState(list);
      expect(scroll.overflowY).toBe("auto");
      expect(scroll.scrollHeight).toBeGreaterThanOrEqual(scroll.clientHeight);
      // 首位条目真的落在条目区里
      const firstRow = list.querySelector<HTMLElement>(SSH_ITEMS);
      expect(firstRow).toBeTruthy();
      if (!firstRow) return;
      const firstRowBox = box(firstRow);
      expect(firstRowBox.y).toBeGreaterThanOrEqual(listBox.y - 1);
      expect(firstRowBox.y + firstRowBox.height).toBeLessThanOrEqual(
        listBox.y + listBox.height + 1,
      );
    }
  });
});
