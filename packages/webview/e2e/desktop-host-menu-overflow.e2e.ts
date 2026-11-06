import { test, expect } from "./utils/desktopTestHarness.js";
import { MessageInjector } from "./utils/messageInjector.js";

// Real-browser verification of the host dropdown's height cap
// (spec docs/specs/desktop/desktop-remote.md 「SSH 远程主机」场景 26): a
// customer's ~/.ssh/config can list hundreds of hosts, and the menu expands
// UPWARD from the input at the bottom of the window — with no cap it grows
// past the top of the viewport and 「本地」 (the first entry) becomes
// unreachable. jsdom computes no layout, so only a real engine can assert it.

const initialState = {
  messages: [],
  isStreaming: false,
  sessions: [],
  isAuthenticated: true,
  permissionMode: "default",
};

/** 80 SSH hosts — far past one screen, like the customer report. */
const MANY_HOSTS = Array.from(
  { length: 80 },
  (_, i) => `prod-server-${String(i + 1).padStart(2, "0")}`,
);

/** A handful of WSL distros: the second group, short but must stay whole. */
const WSL_DISTROS = ["Ubuntu-24.04", "Ubuntu", "Debian", "kali-linux"];

type Box = { x: number; y: number; width: number; height: number };

const boxOf = async (
  locator: import("@playwright/test").Locator,
): Promise<Box> => {
  const box = await locator.boundingBox();
  if (!box) throw new Error("no bounding box");
  return box;
};

/**
 * Effective outer cap of the menu, read from the computed style: the menus are
 * content-box, so `max-height` alone leaves padding + border outside the cap
 * (same shape as `.desktop-remote-browser`'s 340px).
 */
const menuHeightCap = (menu: import("@playwright/test").Locator) =>
  menu.evaluate((el) => {
    const s = getComputedStyle(el);
    const max = parseFloat(s.maxHeight);
    const padding = parseFloat(s.paddingTop) + parseFloat(s.paddingBottom);
    const border =
      parseFloat(s.borderTopWidth) + parseFloat(s.borderBottomWidth);
    return s.boxSizing === "content-box" ? max + padding + border : max;
  });

test.describe("Desktop host menu height cap", () => {
  test("a long host list scrolls inside the menu; 本地 and 添加主机… stay reachable", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      host: "local",
      hosts: MANY_HOSTS,
      recentWorkdirs: [],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);

    await webviewPage.getByTestId("desktop-host").click();

    const menu = webviewPage.getByTestId("desktop-host-menu");
    await expect(menu).toBeVisible();
    const list = webviewPage.locator(".desktop-host-menu-items").first();
    const groupLabel = webviewPage
      .locator(".desktop-workdir-menu-label")
      .first();
    const localItem = webviewPage.getByTestId("desktop-host-local");
    const sshItems = webviewPage.getByTestId("desktop-host-item");
    const addEntry = webviewPage.getByTestId("desktop-host-add-entry");
    const lastHost = sshItems.nth(MANY_HOSTS.length - 1);

    // ── The menu is capped and stays inside the window ──
    const menuBox = await boxOf(menu);
    const cap = await menuHeightCap(menu);
    expect(cap, "the menu must declare a height cap").toBeGreaterThan(200);
    expect(menuBox.height).toBeLessThanOrEqual(cap + 1);
    expect(
      menuBox.y,
      "menu must not poke out above the viewport",
    ).toBeGreaterThanOrEqual(0);

    // ── 本地 is pinned: it is reachable on open, and lives OUTSIDE the scroll
    // container (only the remote hosts scroll — 规格场景 26) ──
    await expect(localItem).toBeFocused();
    await expect(
      list.locator('[data-testid="desktop-host-local"]'),
    ).toHaveCount(0);
    const localBox = await boxOf(localItem);
    expect(localBox.y).toBeGreaterThanOrEqual(menuBox.y);
    expect(localBox.y + localBox.height).toBeLessThanOrEqual(
      menuBox.y + menuBox.height,
    );

    // ── The host entries region is the only scroll container: neither the menu
    // itself nor the SSH 主机 group label scrolls with the hosts ──
    await expect(list.locator(".desktop-workdir-menu-label")).toHaveCount(0);
    const labelBox = await boxOf(groupLabel);
    expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(
      menuBox.y + menuBox.height,
    );
    const listBox = await boxOf(list);
    const listScroll = await list.evaluate((el) => ({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      overflowY: getComputedStyle(el).overflowY,
    }));
    expect(listScroll.overflowY).toBe("auto");
    expect(listScroll.scrollHeight).toBeGreaterThan(listScroll.clientHeight);
    expect(listScroll.scrollTop).toBe(0);
    expect(await menu.evaluate((el) => el.scrollHeight)).toBe(
      await menu.evaluate((el) => el.clientHeight),
    );

    // ── 本地、SSH 主机 标题、添加主机… are all pinned: scrolling the host entries
    // to their end moves none of them (nor the menu frame) ──
    const addBefore = await boxOf(addEntry);
    expect(addBefore.y + addBefore.height).toBeLessThanOrEqual(
      menuBox.y + menuBox.height,
    );

    await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));

    const scrolled = await list.evaluate((el) => el.scrollTop);
    expect(scrolled).toBeGreaterThan(0);
    const addAfter = await boxOf(addEntry);
    expect(Math.abs(addAfter.y - addBefore.y)).toBeLessThanOrEqual(1);
    expect(Math.abs((await boxOf(menu)).y - menuBox.y)).toBeLessThanOrEqual(1);

    // 本地 与分组标题都不跟着滚：滚到最后一台主机时仍在原位、仍在菜单里
    expect(
      Math.abs((await boxOf(groupLabel)).y - labelBox.y),
    ).toBeLessThanOrEqual(1);
    await expect(localItem).toBeVisible();
    const localAfterScroll = await boxOf(localItem);
    expect(Math.abs(localAfterScroll.y - localBox.y)).toBeLessThanOrEqual(1);
    expect(localAfterScroll.y + localAfterScroll.height).toBeLessThanOrEqual(
      menuBox.y + menuBox.height,
    );

    // ── The tail of the list is reachable by scrolling ──
    await expect(lastHost).toHaveText(MANY_HOSTS[MANY_HOSTS.length - 1]);
    const lastBox = await boxOf(lastHost);
    expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(
      listBox.y + listBox.height + 1,
    );

    // ── Keyboard roving still walks the whole list: ArrowUp from the last host
    // gets back to 本地, scrolling the list to its top on the way ──
    await lastHost.focus();
    for (let i = 0; i < MANY_HOSTS.length + 1; i += 1) {
      await webviewPage.keyboard.press("ArrowUp");
    }
    await expect(localItem).toBeFocused();
    expect(await list.evaluate((el) => el.scrollTop)).toBe(0);
    const localBack = await boxOf(localItem);
    expect(localBack.y).toBeGreaterThanOrEqual(menuBox.y);
    expect(localBack.y + localBack.height).toBeLessThanOrEqual(
      menuBox.y + menuBox.height,
    );

    // ── Expanding 添加主机… keeps the input inside the capped menu (it is the
    // pinned footer row, so the list can still scroll above it) ──
    await addEntry.click();
    const addInput = webviewPage.getByTestId("desktop-host-add");
    await expect(addInput).toBeVisible();
    const inputBox = await boxOf(addInput);
    const menuNow = await boxOf(menu);
    expect(inputBox.y).toBeGreaterThanOrEqual(menuNow.y);
    expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(
      menuNow.y + menuNow.height + 1,
    );
  });

  // 同一封顶规则下的第二个分组：host 下发的顺序是 本地 → WSL 发行版 → SSH 主机
  // （desktopHost.hostOptions()），所以上百台 SSH 主机和几条 WSL 发行版会同时出现。
  // 两个分组都在同一列里分高度，默认按内容高度等比例收缩会把只有 4 条的 WSL 组压成
  // 几个像素——等于被 SSH 主机「顶没」，两组的标题也一起看不见。
  test("many SSH hosts do not squeeze the WSL group out", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    // 正常桌面窗口高度：封顶取 340px（不是 40vh），两组加起来还有富余。
    await webviewPage.setViewportSize({ width: 960, height: 900 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      host: "local",
      hosts: MANY_HOSTS,
      hostOptions: [
        { id: "local", label: "本地", kind: "local" },
        ...WSL_DISTROS.map((name) => ({
          id: `wsl:${name}`,
          label: name,
          kind: "wsl",
        })),
        ...MANY_HOSTS.map((name) => ({ id: name, label: name, kind: "ssh" })),
      ],
      recentWorkdirs: [],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);

    await webviewPage.getByTestId("desktop-host").click();

    const menu = webviewPage.getByTestId("desktop-host-menu");
    await expect(menu).toBeVisible();
    const menuBox = await boxOf(menu);

    const wslGroup = webviewPage.locator(".desktop-host-menu-group").nth(0);
    const sshGroup = webviewPage.locator(".desktop-host-menu-group").nth(1);
    const wslLabel = wslGroup.locator(".desktop-host-menu-label");
    const sshLabel = sshGroup.locator(".desktop-host-menu-label");
    const wslList = wslGroup.locator(".desktop-host-menu-items");
    const sshList = sshGroup.locator(".desktop-host-menu-items");
    const wslRows = wslList.getByTestId("desktop-host-item");
    const addEntry = webviewPage.getByTestId("desktop-host-add-entry");

    // ── Both group headers are on screen, WSL 发行版 above SSH 主机 (host order) ──
    await expect(wslLabel).toHaveText("WSL 发行版");
    await expect(sshLabel).toHaveText("SSH 主机");
    const wslLabelBox = await boxOf(wslLabel);
    const sshLabelBox = await boxOf(sshLabel);
    expect(wslLabelBox.y).toBeGreaterThan(menuBox.y);
    expect(sshLabelBox.y).toBeGreaterThan(wslLabelBox.y);
    expect(sshLabelBox.y + sshLabelBox.height).toBeLessThanOrEqual(
      menuBox.y + menuBox.height,
    );

    // ── The WSL group keeps its natural height: every distro row is visible at
    // full height inside the menu, and its list has nothing to scroll ──
    await expect(wslRows).toHaveCount(WSL_DISTROS.length);
    const wslListBox = await boxOf(wslList);
    const wslListScroll = await wslList.evaluate((el) => ({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
    }));
    expect(wslListScroll.clientHeight).toBeGreaterThanOrEqual(100);
    expect(wslListScroll.scrollHeight).toBe(wslListScroll.clientHeight);
    expect(wslListScroll.scrollTop).toBe(0);
    for (let i = 0; i < WSL_DISTROS.length; i += 1) {
      const row = wslRows.nth(i);
      await expect(row).toHaveText(WSL_DISTROS[i]);
      const rowBox = await boxOf(row);
      expect(rowBox.height).toBeGreaterThanOrEqual(20);
      expect(rowBox.y).toBeGreaterThanOrEqual(wslListBox.y);
      expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(
        menuBox.y + menuBox.height,
      );
    }

    // ── The long SSH group is the one that gives up height: it scrolls, its
    // header stays put, and the WSL group does not move when it scrolls ──
    const sshScroll = await sshList.evaluate((el) => ({
      scrollTop: el.scrollTop,
      clientHeight: el.clientHeight,
      scrollHeight: el.scrollHeight,
      overflowY: getComputedStyle(el).overflowY,
    }));
    expect(sshScroll.overflowY).toBe("auto");
    expect(sshScroll.scrollHeight).toBeGreaterThan(sshScroll.clientHeight);
    const addBefore = await boxOf(addEntry);
    await sshList.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    expect(await sshList.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);

    expect(
      Math.abs((await boxOf(wslLabel)).y - wslLabelBox.y),
    ).toBeLessThanOrEqual(1);
    expect(
      Math.abs((await boxOf(sshLabel)).y - sshLabelBox.y),
    ).toBeLessThanOrEqual(1);
    const addAfter = await boxOf(addEntry);
    expect(Math.abs(addAfter.y - addBefore.y)).toBeLessThanOrEqual(1);
    expect(addAfter.y + addAfter.height).toBeLessThanOrEqual(
      menuBox.y + menuBox.height,
    );

    // ── Keyboard roving crosses the group boundary: ArrowDown walks 本地 → 4 个
    // WSL 发行版 → 第一台 SSH 主机 (DOM order === itemIndex) ──
    await webviewPage.getByTestId("desktop-host-local").focus();
    for (let i = 0; i <= WSL_DISTROS.length; i += 1) {
      await webviewPage.keyboard.press("ArrowDown");
    }
    const firstSsh = sshList.getByTestId("desktop-host-item").first();
    await expect(firstSsh).toHaveText(MANY_HOSTS[0]);
    await expect(firstSsh).toBeFocused();
  });

  // 小窗口（640px 高 → 封顶取 40vh = 256px）里两组加起来放不下全部条目，此时按
  // 均分：谁都不许被压没，两组各留至少两行并能各自滚动。
  test("in a short window both groups still get room", async ({
    webviewPage,
  }) => {
    const injector = new MessageInjector(webviewPage);
    await webviewPage.setViewportSize({ width: 960, height: 640 });

    await injector.simulateExtensionMessage("desktopWorkdirState", {
      host: "local",
      hosts: MANY_HOSTS,
      hostOptions: [
        { id: "local", label: "本地", kind: "local" },
        ...WSL_DISTROS.map((name) => ({
          id: `wsl:${name}`,
          label: name,
          kind: "wsl",
        })),
        ...MANY_HOSTS.map((name) => ({ id: name, label: name, kind: "ssh" })),
      ],
      recentWorkdirs: [],
    });
    await injector.waitForChatAppReady();
    await injector.simulateExtensionMessage("setInitialState", initialState);

    await webviewPage.getByTestId("desktop-host").click();

    const menu = webviewPage.getByTestId("desktop-host-menu");
    await expect(menu).toBeVisible();
    const menuBox = await boxOf(menu);

    const groups = webviewPage.locator(".desktop-host-menu-group");
    await expect(groups).toHaveCount(2);
    for (const index of [0, 1]) {
      const group = groups.nth(index);
      const label = group.locator(".desktop-host-menu-label");
      const list = group.locator(".desktop-host-menu-items");
      // 标题整行可见
      const labelBox = await boxOf(label);
      expect(labelBox.y).toBeGreaterThan(menuBox.y);
      expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(
        menuBox.y + menuBox.height,
      );
      // 条目区至少两行高（单行 28px），并且能滚
      const listBox = await boxOf(list);
      expect(listBox.height).toBeGreaterThanOrEqual(56);
      const scroll = await list.evaluate((el) => ({
        scrollHeight: el.scrollHeight,
        clientHeight: el.clientHeight,
        overflowY: getComputedStyle(el).overflowY,
      }));
      expect(scroll.overflowY).toBe("auto");
      expect(scroll.scrollHeight).toBeGreaterThanOrEqual(scroll.clientHeight);
      // 首位条目真的落在条目区里
      const firstRow = await boxOf(
        list.getByTestId("desktop-host-item").first(),
      );
      expect(firstRow.y).toBeGreaterThanOrEqual(listBox.y - 1);
      expect(firstRow.y + firstRow.height).toBeLessThanOrEqual(
        listBox.y + listBox.height + 1,
      );
    }
  });
});
