import React, { useEffect, useRef } from "react";
import type { RefObject } from "react";
import { useRovingMenu } from "../utils/useRovingMenu";
import { useClickOutside } from "../utils/useClickOutside";
import { isRemotePageHost } from "../utils/platform";
import { viewportSize } from "../utils/viewport";
import {
  BellIcon,
  BellRingIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HouseIcon,
  LogOutIcon,
  MachineIcon,
  SettingsGearIcon,
} from "./HeaderIcons";
import type { PushNotificationControl } from "../types";
import type { AccountCredential } from "wave-webview-fixtures";
import { gatewayHostLabel, resolveCredentialKind } from "../utils/credential";
import "../styles/MoreMenu.css";

/** One roving item: what it says, what it does, how it is dressed. */
interface MoreMenuEntry {
  id: string;
  run: () => void;
  content: React.ReactNode;
  className?: string;
  separator?: boolean;
}

interface MoreMenuProps {
  onOpenSettings: () => void;
  onOpenEnterpriseConsole: () => void;
  onOpenHelpDocs: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onClose: () => void;
  isAuthenticated: boolean;
  /**
   * 凭据形态（spec desktop/desktop-account.md「认证方式」）。缺席 = 旧宿主，
   * 回落到 `isAuthenticated`：企业账号 = 4 项菜单，其余 = 无凭据形态。
   *
   * 网关形态的菜单是 3 项（设置 / 帮助文档↗ / ─── / 登录企业账号）——没有「企业
   * 控制台」（那是企业账号专属，网关形态下没有对应的运营端身份），也没有「退出
   * 登录」（没有登录可退）；企业账号且本机另有网关凭据时，「退出登录」项带副标题
   * 说明退出后会落到那份凭据（不是断网）。
   */
  credential?: AccountCredential | null;
  /**
   * Label of the auth subject this menu's 登录/退出登录 entry acts on —
   * set by the desktop host to the focused pane's host (e.g. 'lyq.u',
   * '本地'). Absent for hosts without the concept (VSCE/JetBrains), in which
   * case the entry shows no annotation.
   */
  hostLabel?: string;
  /**
   * Trigger button (更多 in the header); Escape and item activation return
   * focus here.
   */
  triggerRef?: RefObject<HTMLElement | null>;
  /**
   * Anchor rect for fixed-position anchoring (AccountCard's 更多 button, which
   * sits at the sidebar bottom). When present the menu positions itself ABOVE
   * the anchor — the sidebar's overflow:hidden clips absolute descendants, so
   * the card's menu must escape via fixed (SessionItemMenu pattern). The
   * header trigger omits it and keeps the absolute header-anchored layout.
   */
  anchorRect?: DOMRect;
  /**
   * Remote Web page (the fifth host) only: the Web Push switch (spec
   * remote/remote-pwa.md「锁屏也能知道」). The four local hosts pass nothing and
   * the entry is not rendered — they have no browser subscription to hold.
   */
  pushNotifications?: PushNotificationControl;
  /**
   * Remote Web page (the fifth host) only: the 切换电脑 entry that opens the
   * machine picker (spec remote/remote-machine.md「机器列表与切换」场景 5). One
   * home-screen icon serves every machine, so the page needs a way back to the
   * machine list from a live session; the command routes to the page shim (the
   * fifth router), not to any local host. It sits in this menu rather than in
   * the header: changing machines is a low-frequency action, and the header's
   * three icons are the high-frequency ones.
   */
  onSwitchMachine?: () => void;
}

/**
 * The 通知 entry, in whichever shape the shim's four facts call for (spec
 * 「锁屏也能知道」场景 6/7).
 *
 * The three "cannot do it" cases get a passive note rather than a disabled
 * item, because they are not actions and the *reason* is the whole message:
 * iOS in a Safari tab needs 「添加到主屏幕」 (16.4+ exposes PushManager only to a
 * home-screen web app), an old browser simply cannot, and a refused permission
 * is fixed in the browser's own settings, not here. They also must not take a
 * roving slot — Enter on a line that does nothing is worse than no line.
 *
 * `reason: "failed"` is reported on the actionable side instead: the switch is
 * in the state the user last saw, but the attempt to change it did not land, so
 * the label says 重试 rather than quietly reading as "nothing happened" (场景 7
 * — 拒绝授权与失败都不静默).
 */
function pushMenuShape(control: PushNotificationControl): {
  entry?: MoreMenuEntry;
  note?: string;
} {
  const { state } = control;
  if (!state.supported) {
    return {
      note: state.needsHomeScreen
        ? "添加到主屏幕后才能开启通知"
        : "此浏览器不支持通知",
    };
  }
  if (state.reason === "denied") {
    return { note: "通知权限已被拒绝，请在浏览器设置里开启" };
  }
  if (state.subscribed) {
    return {
      entry: {
        id: "more-menu-push-off",
        run: control.onDisable,
        content: (
          <>
            <BellRingIcon className="more-menu-item-icon" />
            <span>
              {state.reason === "failed" ? "重试关闭通知" : "关闭通知"}
            </span>
          </>
        ),
      },
    };
  }
  return {
    entry: {
      id: "more-menu-push-on",
      run: control.onEnable,
      content: (
        <>
          <BellIcon className="more-menu-item-icon" />
          <span>{state.reason === "failed" ? "重试开启通知" : "开启通知"}</span>
        </>
      ),
    },
  };
}

export const MoreMenu: React.FC<MoreMenuProps> = ({
  onOpenSettings,
  onOpenEnterpriseConsole,
  onOpenHelpDocs,
  onLogin,
  onLogout,
  onClose,
  isAuthenticated,
  credential,
  hostLabel,
  triggerRef,
  anchorRect,
  pushNotifications,
  onSwitchMachine,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  // 锚定定位的取景尺寸：扣掉经典滚动条的视口宽高（见 `viewportSize`）——贴卡片
  // 右缘的菜单不能把滚动条也算进取景宽。
  const viewport = anchorRect ? viewportSize() : null;
  // Remote-control Web page: 设置 and 登录/退出登录 act on the host (a settings
  // tab webview, a login flow) and this page has neither — clicking them would
  // do nothing at all, so they are not rendered. 企业控制台 / 帮助文档 stay: they
  // are just URLs, and the page's handler opens them in a browser tab
  // (spec remote/remote-web.md 场景 21).
  const remotePage = isRemotePageHost();

  // Roving keyboard model shared with the other custom dropdowns: Arrow keys
  // move, Enter/Space activate, Escape closes back to the trigger. The hook
  // calls onRequestClose for the in-menu close paths; this component keeps
  // its own click-outside / global-Escape listeners (see below). It is wired
  // below the entry list because `itemCount` is derived from it.

  const handleSettings = () => onOpenSettings();
  const handleEnterprise = () => onOpenEnterpriseConsole();
  const handleHelpDocs = () => onOpenHelpDocs();
  const authLabelSuffix = hostLabel ? `（${hostLabel}）` : "";
  const credentialKind = resolveCredentialKind(credential, isAuthenticated);
  // 网关形态下「登录企业账号」是唯一能改变凭据的动作，单独进一类。
  const isGateway = credentialKind === "gateway";
  // 双凭据时的后果说明：「退出登录」不是断网，而是落到本机配的那份网关凭据。
  const logoutSubtitle =
    credentialKind === "sso" && credential?.gateway
      ? `退出后使用自定义网关 ${gatewayHostLabel(credential.gateway)}`
      : undefined;

  // Web Push switch — remote page only. Only one of the two shapes renders:
  // an actionable 通知 entry while the browser can hold a subscription, or a
  // passive note when it cannot (see pushMenuShape for why that split).
  const push =
    remotePage && pushNotifications
      ? pushMenuShape(pushNotifications)
      : undefined;

  // Entry order matches focus order; the fourth slot is 登录/退出登录 by auth,
  // danger-styled and separated when it is 退出登录 (spec 场景 4). The remote
  // page drops the 设置 and auth slots, so `itemCount` is derived from the array
  // rather than the literal 4 it used to be — a hardcoded count would let the
  // arrow keys walk off the end of the list.
  //
  // 切换电脑 leads the remote page's list: it is a page-level action (which
  // machine this page is looking at) and the low-frequency one, so it yields
  // the header but not the menu's first slot.
  const entries: MoreMenuEntry[] = [
    ...(onSwitchMachine
      ? [
          {
            id: "more-menu-switch-machine",
            run: onSwitchMachine,
            content: (
              <>
                <MachineIcon className="more-menu-item-icon" />
                <span>切换电脑</span>
              </>
            ),
          },
        ]
      : []),
    ...(push?.entry ? [push.entry] : []),
    ...(remotePage
      ? []
      : [
          {
            id: "more-menu-settings",
            run: handleSettings,
            content: (
              <>
                <SettingsGearIcon className="more-menu-item-icon" />
                <span>设置{authLabelSuffix}</span>
              </>
            ),
          },
        ]),
    // 企业控制台是企业账号专属：网关形态下没有对应的运营端身份，不渲染
    // （spec「认证方式」场景 3）。远控页照旧——那是 URL 型入口，与凭据无关。
    ...(isGateway && !remotePage
      ? []
      : [
          {
            id: "more-menu-enterprise",
            className: "more-menu-item--between",
            run: handleEnterprise,
            content: (
              <>
                <span className="more-menu-item-leading">
                  <HouseIcon className="more-menu-item-icon" />
                  <span>企业控制台</span>
                </span>
                <ExternalLinkIcon className="more-menu-item-icon" />
              </>
            ),
          },
        ]),
    {
      id: "more-menu-help-docs",
      className: "more-menu-item--between",
      run: handleHelpDocs,
      content: (
        <>
          <span className="more-menu-item-leading">
            <FileTextIcon className="more-menu-item-icon" />
            <span>帮助文档</span>
          </span>
          <ExternalLinkIcon className="more-menu-item-icon" />
        </>
      ),
    },
    ...(remotePage
      ? []
      : [
          credentialKind === "sso"
            ? {
                id: "more-menu-logout",
                // 带副标题时条目要长高：两行文本塞不进 24px 的定高条目。
                className: logoutSubtitle
                  ? "more-menu-item--danger more-menu-item--stacked"
                  : "more-menu-item--danger",
                separator: true,
                run: onLogout,
                content: logoutSubtitle ? (
                  <>
                    <LogOutIcon className="more-menu-item-icon" />
                    <span className="more-menu-item-text">
                      <span>退出登录{authLabelSuffix}</span>
                      <span
                        className="more-menu-item-subtitle"
                        // 菜单最宽也不过 216px：副标题按单行省略，全文放 title。
                        title={logoutSubtitle}
                        data-testid="more-menu-logout-subtitle"
                      >
                        {logoutSubtitle}
                      </span>
                    </span>
                  </>
                ) : (
                  <>
                    <LogOutIcon className="more-menu-item-icon" />
                    <span>退出登录{authLabelSuffix}</span>
                  </>
                ),
              }
            : credentialKind === "gateway"
              ? {
                  id: "more-menu-login-sso",
                  separator: true,
                  run: onLogin,
                  content: (
                    <>
                      <LogOutIcon className="more-menu-item-icon" />
                      <span>登录企业账号{authLabelSuffix}</span>
                    </>
                  ),
                }
              : {
                  id: "more-menu-login",
                  run: onLogin,
                  content: (
                    <>
                      <LogOutIcon className="more-menu-item-icon" />
                      <span>登录{authLabelSuffix}</span>
                    </>
                  ),
                },
        ]),
  ];

  const { getItemProps } = useRovingMenu(menuRef, {
    itemSelector: ".more-menu-item",
    itemCount: entries.length,
    triggerRef,
    closeOnActivate: true,
    onRequestClose: onClose,
    onActivate: (i) => entries[i]?.run(),
  });

  // Click-outside + global Escape fallback (the hook only handles Escape from
  // a focused item). Focus returns to the trigger on those in-menu paths.
  // The trigger is excluded from click-outside so clicking it again toggles
  // the menu closed (AccountCard hotzone / header 更多). useClickOutside
  // registers the mousedown listener one tick later so the click that just
  // opened this menu is not treated as an outside click.
  useClickOutside({
    refs: [menuRef, ...(triggerRef ? [triggerRef] : [])],
    onClickOutside: onClose,
  });
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
    // triggerRef is a stable prop ref object (callers pass a useRef result), so
    // the listener set still only installs once per mount.
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className="more-menu"
      data-testid="more-menu"
      style={
        anchorRect && viewport
          ? {
              position: "fixed",
              top: "auto",
              bottom: viewport.height - anchorRect.top + 4,
              right: Math.max(8, viewport.width - anchorRect.right),
              left: "auto",
              // 与锚点（账户卡片）等宽，保证菜单项不超出面板；内容不足时以
              // 216px 为下限避免换行局促。
              width: Math.max(anchorRect.width, 216),
            }
          : undefined
      }
    >
      {entries.map((entry, i) => (
        <div key={`${entry.separator ? "sep-" : ""}${entry.id}`}>
          {entry.separator && (
            <div className="more-menu-separator" aria-hidden="true" />
          )}
          <div
            {...getItemProps(i)}
            className={`more-menu-item${entry.className ? ` ${entry.className}` : ""}`}
            role="menuitem"
            data-testid={entry.id}
          >
            {entry.content}
          </div>
        </div>
      ))}
      {push?.note && (
        // Not an action and not focusable — the note only explains why there is
        // no 通知 entry to press (see pushMenuShape).
        <div
          className="more-menu-note"
          role="note"
          data-testid="more-menu-push-note"
        >
          {push.note}
        </div>
      )}
    </div>
  );
};

export default MoreMenu;
