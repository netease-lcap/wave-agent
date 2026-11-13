import React, {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArtifactsIcon,
  FileCodeIcon,
  MoreIcon,
  PencilIcon,
  PlusIcon,
  QueueEditIcon,
  QueueTrashIcon,
  RefreshIcon,
  SearchIcon,
  SidebarExpandIcon,
} from "./HeaderIcons";
import { Tooltip } from "./Tooltip";
import { ToastGlyph } from "./ToastStack";
import { useHostMessage } from "../utils/useHostMessage";
import { useRovingMenu } from "../utils/useRovingMenu";
import { useClickOutside } from "../utils/useClickOutside";
import { useAnchoredMenuStyle } from "../utils/anchoredMenu";
import { createPortal } from "react-dom";
import type {
  ArtifactCategory,
  ArtifactGalleryItem,
  ArtifactMemberCandidate,
  ArtifactShareMode,
  ArtifactVersionOption,
} from "wave-webview-fixtures";
import "../styles/ArtifactsPage.css";
// 顶栏沿用看板那套壳类（`session-board-*`），与插件市场页同一段让位机制。
import "../styles/SessionBoard.css";

/**
 * 创作集（Artifacts 画廊）整页 —— desktop 独有、账号级。
 *
 * 形态与「插件市场」同源：替换 pane 行、保留侧栏、自带返回。数据全部经宿主
 * （主进程 → CLI 进程 RPC）取，webview 不直连网络；分类与归属写本机存储
 * （`desktopArtifactCategories*`），按账号隔离。
 *
 * 规格：docs/specs/desktop/desktop-artifacts.md。
 */

/** 新建模板（需求文档 v1.19 第二节的七张卡片，逐字保留提示词）。 */
const NEW_TEMPLATES: Array<{ id: string; name: string; prompt: string }> = [
  {
    id: "hifi",
    name: "高保真原型",
    prompt:
      "帮我做一个高保真原型：产品是【一句话说明】，面向【目标用户】，需要覆盖【关键页面和主流程】，视觉风格参考【参考产品或风格】，页面之间可以点击走查。",
  },
  {
    id: "game",
    name: "网页小游戏",
    prompt:
      "帮我做一个网页小游戏：玩法是【核心玩法一句话】，操作方式是【键盘/鼠标/触屏】，难度【简单/中等/挑战】，美术风格【像素/扁平/手绘】，并记录本地最高分。",
  },
  {
    id: "tool",
    name: "效率工具",
    prompt:
      "帮我做一个效率工具：它帮我解决【要解决的问题】，输入是【输入内容】，输出是【期望结果】，希望包含【必备功能】，界面风格【简洁/活泼】。",
  },
  {
    id: "landing",
    name: "运营活动页",
    prompt:
      "帮我做一个运营活动落地页：活动是【活动主题】，面向【目标人群】，希望用户完成【核心动作】，需要包含【活动介绍/规则/奖品/参与入口】，主色是【主视觉色】。",
  },
  {
    id: "doc",
    name: "文档和模板",
    prompt:
      "帮我写一份【文档或模板】：主题是【主题】，读者是【读者与使用场景】，需要包含【章节或字段】，篇幅【一页/多节】，输出为【Markdown/表格】。",
  },
  {
    id: "demo",
    name: "演示与教学",
    prompt:
      "帮我做一份演示与教学页面：主题是【主题】，面向【听众】，分【几个】章节，每章包含讲解要点和示例，形式是【分步教程/交互讲解/幻灯片】。",
  },
  {
    id: "scratch",
    name: "从零开始",
    prompt:
      "我想做【一句话描述】，它要解决【要解决的问题】，给【谁】用，希望包含【必备功能或想要的样子】，风格偏【】。",
  },
];

/**
 * 模板提示词统一追加的收尾口径（spec desktop/desktop-artifacts.md「模板新建直达
 * 对话页」场景 3）：先本地出稿，之后每轮生成结束都在「继续调整」与「发布为
 * 创作（artifact）」之间征求用户意见——七张卡共用一句，避免逐条散写后口径漂移。
 */
const PUBLISH_AFTER_REVIEW =
  "先在本地做好；每次生成结束后，都给我「继续调整」和「发布为创作（artifact）」两个选项让我选：选「继续调整」就按我的意见改，选「发布为创作（artifact）」才发布，不要自己直接发布。";

const CATEGORY_NAME_MAX = 20;

/** 创作名上限（spec「重命名创作」场景 6）：与发布时的标题口径一致。 */
const ARTIFACT_TITLE_MAX = 60;

/** 分类名不能与默认视图的分组同名（spec 场景 2 的保留名）。 */
const RESERVED_CATEGORY_NAMES = ["我发布的", "共享给我的", "全部"];

/**
 * 重命名的**原型期提交占位**：服务端还没有改标题接口（spec「外部依赖」第 8 条），
 * 所以这里既不读也不发任何东西，只把「异步」这件事先摆进状态机——接口到位后，
 * 把 `commitRenamePlaceholder` 换成「发宿主命令 + 等回执」即可，`saving` / 失败重试
 * 两条分支不用重写。
 *
 * `mode` 只给测试用：产品路径永远是 `"ok"`（resolve）。导出是为了让用例能确定性地
 * 演练「保存中」与「保存失败」—— 否则这两条分支没有任何可达入口。接口接上时连同
 * 这个导出一起删。
 */
export const renamePlaceholderSink: { mode: "ok" | "pending" | "fail" } = {
  mode: "ok",
};

function commitRenamePlaceholder(): Promise<void> {
  if (renamePlaceholderSink.mode === "pending") {
    return new Promise<void>(() => {});
  }
  if (renamePlaceholderSink.mode === "fail") {
    return Promise.reject(new Error("网络错误，请重试"));
  }
  return Promise.resolve();
}

function nextRequestId(): string {
  return `artifact-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 时间列：服务端给 ISO 串，列表按本地 `YYYY-MM-DD HH:mm` 展示。 */
function formatTime(raw: string | undefined): string {
  if (!raw) return "—";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthDay = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  // 同一年不写年份：这一列在窄窗口里只有约 90px，带年份会被省略号吃掉。
  return date.getFullYear() === new Date().getFullYear()
    ? `${monthDay} ${clock}`
    : `${date.getFullYear()}-${monthDay} ${clock}`;
}

function timeValue(raw: string | undefined): number {
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

/**
 * 「分享给」列的文案（spec 场景 4）：
 * - 自有行：仅自己 / 企业成员 / 团队成员 + 最多两位账号（余下省略，`title` 给全）
 * - 共享行：`—`（范围由对方管理）
 */
function shareCell(item: ArtifactGalleryItem): { text: string; title: string } {
  if (item.rel === "shared") return { text: "—", title: "" };
  const mode = item.shareMode;
  if (mode === undefined) return { text: "—", title: "未知" };
  if (mode === "owner") return { text: "仅自己", title: "仅自己" };
  if (mode === "org") return { text: "企业成员", title: "企业成员" };
  const emails = item.sharedEmails ?? [];
  if (emails.length === 0) return { text: "团队成员", title: "团队成员" };
  const shown = emails.slice(0, 2).join("、");
  const text =
    emails.length > 2
      ? `团队成员：${shown} 等 ${emails.length} 人`
      : `团队成员：${shown}`;
  return { text, title: emails.join("、") };
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Electron 里 file:// 页面的 clipboard API 偶发不可用，退回旧式选区复制。
    try {
      const area = document.createElement("textarea");
      area.value = text;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * 搜索框 + 清除按钮（PM 缺陷 3500400967563520「搜索框内没有清除按钮」）。
 *
 * 列表搜索与分享弹层的成员搜索都走这一个形态：有内容时右侧出现 ×，点击清空
 * 并把焦点交还输入框（清空后再输入不用重新点一次框）。
 */
const SearchField: React.FC<{
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  testId: string;
  clearTestId: string;
}> = ({ value, onChange, placeholder, testId, clearTestId }) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  return (
    <span className="artifacts-search-field">
      {/* 1030 评论（锚点 `input.artifacts-search`）：「这里也统一一下，加个搜索
          图标」→ 用与侧栏搜索框 / 面板工具条同一颗 Figma 放大镜（16px、2 级
          字色），绝对定位在框内左侧，点击穿透到输入框，文字起始位右移到 30。 */}
      <SearchIcon className="artifacts-search-icon" />
      <input
        ref={inputRef}
        className="artifacts-search"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        data-testid={testId}
        aria-label={placeholder}
      />
      {value !== "" && (
        <button
          type="button"
          className="artifacts-search-clear"
          data-testid={clearTestId}
          aria-label="清除搜索"
          onClick={() => {
            onChange("");
            inputRef.current?.focus();
          }}
        >
          <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true">
            <path
              d="M2.6 2.6 L9.4 9.4 M9.4 2.6 L2.6 9.4"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              fill="none"
            />
          </svg>
        </button>
      )}
    </span>
  );
};

/**
 * 16×16 勾选指示器（contract：skill `references/common-components.md`
 * §Choice controls「Desktop Radio and Checkbox」）。原生 input 留在 DOM 里负责
 * 语义与键盘，视觉由这一个 span 画：方框几何/描边色在 `.artifacts-checkbox-indicator`
 * 里，选中态与焦点态按各自父级（成员行 / 表格多选格）各写一条。
 *
 * 设计师 2026-10-23「创作集表格的批量多选可以开始改」——表格的全选与行选从原生
 * 控件换成这一套，矢量只有这一份（勾的路径 M4 8 L6.75 10.75 L12 5.5，线宽
 * Light 1.7 / Dark 2.1 由 CSS 给）。
 */
const CheckIndicator: React.FC = () => (
  <span className="artifacts-checkbox-indicator" aria-hidden="true">
    <svg viewBox="0 0 16 16" fill="none">
      <path
        d="M4 8 L6.75 10.75 L12 5.5"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  </span>
);

export interface ArtifactsPageProps {
  /** 返回当前会话（顶栏返回钮；与再次点击侧栏入口等价）。 */
  onBack: () => void;
  /** 侧栏已收起：顶栏补「展开侧栏」入口与分割线（看板同款）。 */
  collapsed?: boolean;
  onExpandSidebar?: () => void;
  /** macOS 隐藏标题栏 + 侧栏收起 + 非全屏：顶栏最左端让出红绿灯区。 */
  macTrafficSpacer?: boolean;
  vscode?: { postMessage: (msg: unknown) => void };
  /** artifact 分享链接的前缀（`${serverUrl}/code/artifact/{slug}`）。 */
  serverUrl?: string;
  onLogin?: () => void;
  /** 选完模板：新建一条会话并把提示词预填进输入框（由宿主完成建会话）。 */
  onNewFromTemplate: (prompt: string) => void;
}

type ArtifactsView = "default" | "custom";
type DefaultTab = "mine" | "shared";

/**
 * 视图偏好（「默认视图 / 自定义视图」）的本机记忆（设计师 2026-11-06）：
 * 视图只是辅助开关，主 tab 是当前视图下的分类；但每次进创作集都从默认档
 * 起步会打断习惯，故记住上次选的那一档，下次直接落回去。
 *
 * 只落在 webview 本机存储：分类与归属是账号级数据、走宿主按账号隔离存，
 * 这条纯粹是浏览习惯，不值得为它新增一条宿主协议。
 */
const VIEW_STORAGE_KEY = "wave-artifacts-view";

/**
 * 存储不可用时的兜底：原型 artifact 是 `srcdoc` + sandbox iframe（origin 为
 * null），`localStorage` 一读就抛 SecurityError。没有这层兜底，设计师在预览里
 * 切到自定义视图、出门再回来就被打回默认视图 —— 看起来就是「没记住我的偏好」。
 * 只保本次页面会话内的选择（刷新后必然归位，沙箱没有可写的地方）。
 */
let memoryView: ArtifactsView | null = null;

function readStoredView(): ArtifactsView {
  try {
    // 存储可读时以它为准（即使为空）：模块级 memoryView 会被同一次页面会话里的
    // 其它用例/页面共享，不能让上一次的选择盖住「本机明确没存过」。
    return window.localStorage.getItem(VIEW_STORAGE_KEY) === "custom"
      ? "custom"
      : "default";
  } catch {
    return memoryView ?? "default";
  }
}

function writeStoredView(view: ArtifactsView) {
  memoryView = view;
  try {
    window.localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // 存储不可用（隐私模式 / 配额满 / 沙箱）只丢这次记忆，不阻断浏览。
  }
}

interface ConfirmState {
  kind: "revoke";
  slug: string;
  title: string;
}

interface CategoryDialogState {
  kind: "create" | "rename" | "delete";
  categoryId?: string;
  name?: string;
}

/**
 * 页头右上角「视图」开关的图标（设计师 2026-11-06：两个视图不能共用同一颗
 * 图标 —— 长得一样就只是装饰，看不出切了哪一档）。两档各给一颗轮廓完全不同
 * 的图标，切换时跟着变，下拉里也一项一颗：
 * - 默认视图：表格（外框 + 表头分隔线 + 行）；
 * - 自定义视图：宫格（2×2 方块），与表格的「横线」轮廓区分开。
 */
const DefaultViewIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <rect
      x="2"
      y="2.5"
      width="12"
      height="11"
      rx="1"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <path d="M2 6.3h12M2 9.9h12" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);

const CustomViewIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    width="16"
    height="16"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <rect
      x="2.6"
      y="2.6"
      width="4.8"
      height="4.6"
      rx="1"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <rect
      x="8.6"
      y="2.6"
      width="4.8"
      height="4.6"
      rx="1"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <rect
      x="2.6"
      y="9"
      width="4.8"
      height="4.6"
      rx="1"
      stroke="currentColor"
      strokeWidth="1.2"
    />
    <rect
      x="8.6"
      y="9"
      width="4.8"
      height="4.6"
      rx="1"
      stroke="currentColor"
      strokeWidth="1.2"
    />
  </svg>
);

/**
 * 「视图」下拉（默认视图 / 自定义视图）。
 *
 * 设计师 2026-11-06：视图是辅助功能，不该占主切换位 —— 收成页头右上角一颗
 * 图标键 + 下拉；主 tab 位让给「当前视图下的分类」。菜单皮肤与同页分类「⋯」
 * 菜单共用（`.desktop-session-menu*`），定位规则同：右对齐触发键 + 夹在视口内。
 *
 * 2026-11-13：当前档原来靠右侧一个 ✓ 标记，现按契约改成 fill-pressed 底色 +
 * 1 级字（`selection uses fill-pressed with primary text`）；她当日评论「选中的
 * ✓ 那一拿掉」⇒ ✓ 已删除，选中与否只由底色与字色表达。
 */
const ViewMenu: React.FC<{
  anchorRect: DOMRect;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  view: ArtifactsView;
  onSelect: (view: ArtifactsView) => void;
  onClose: () => void;
}> = ({ anchorRect, triggerRef, view, onSelect, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const options: Array<{
    value: ArtifactsView;
    label: string;
    testId: string;
    icon: React.ReactNode;
  }> = [
    {
      value: "default",
      label: "默认视图",
      testId: "artifacts-view-default",
      icon: <DefaultViewIcon className="artifacts-view-menu-icon" />,
    },
    {
      value: "custom",
      label: "自定义视图",
      testId: "artifacts-view-custom",
      icon: <CustomViewIcon className="artifacts-view-menu-icon" />,
    },
  ];
  const { getItemProps } = useRovingMenu(menuRef, {
    itemSelector: ".desktop-session-menu-item",
    itemCount: options.length,
    triggerRef,
    closeOnActivate: true,
    onRequestClose: onClose,
    onActivate: (i) => {
      const option = options[i];
      if (option) onSelect(option.value);
    },
  });
  useClickOutside({ refs: [menuRef], onClickOutside: onClose });

  const menuWidth = 148;
  // 右对齐触发键 + 夹进视口；纵向「下 → 翻上 → 夹取并内部滚动」与会话行菜单
  // 同一份实现（spec desktop-sessions.md「会话行菜单完整可见」场景 3）。
  const menuStyle = useAnchoredMenuStyle(menuRef, anchorRect, menuWidth);
  return createPortal(
    <div
      ref={menuRef}
      className="desktop-session-menu"
      role="menu"
      style={menuStyle}
      data-testid="artifacts-view-menu"
    >
      {options.map((option, i) => (
        <div
          key={option.value}
          className="desktop-session-menu-item artifacts-view-menu-item"
          role="menuitemradio"
          aria-checked={view === option.value}
          {...getItemProps(i)}
          data-testid={option.testId}
        >
          {option.icon}
          <span className="artifacts-view-menu-label">{option.label}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
};

/** 分类行的「更多」菜单打开状态：哪一行 + 触发按钮的位置（fixed 定位用）。 */
interface CategoryMenuState {
  categoryId: string;
  rect: DOMRect;
}

/**
 * 分类行的「⋯」菜单（重命名 / 删除）。
 *
 * 1022 评论（点 `button.artifacts-nav-item`「待整理 0」）：「编辑和删除的交互参考」
 * 侧栏会话行（`li.desktop-session-item`）——所以这里**复用会话行菜单的 DOM 与类名**
 * （`.desktop-session-menu` / `-item` / `-item--danger`），几何、配色、键盘漫游与
 * 会话行逐值相同；`fixed` 定位同样是为了逃出容器的 `overflow` 裁剪。
 * `DesktopApp.css` 在桌面端恒被 `DesktopApp`/`DesktopSidebar` 引入，本页只在桌面端
 * 渲染，故这些类名不会缺席。
 */
const CategoryItemMenu: React.FC<{
  anchorRect: DOMRect;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}> = ({ anchorRect, triggerRef, onRename, onDelete, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const { getItemProps } = useRovingMenu(menuRef, {
    itemSelector: ".desktop-session-menu-item",
    itemCount: 2,
    triggerRef,
    closeOnActivate: true,
    onRequestClose: onClose,
    onActivate: (i) => (i === 0 ? onRename() : onDelete()),
  });
  useClickOutside({ refs: [menuRef], onClickOutside: onClose });

  // 与会话行菜单同宽同位置规则：右对齐触发按钮 + 夹进视口（纵向同一份实现）。
  const menuWidth = 148;
  const menuStyle = useAnchoredMenuStyle(menuRef, anchorRect, menuWidth);
  return (
    <div
      ref={menuRef}
      className="desktop-session-menu"
      role="menu"
      style={menuStyle}
      data-testid="artifacts-category-menu"
    >
      <div
        className="desktop-session-menu-item"
        role="menuitem"
        {...getItemProps(0)}
        data-testid="artifacts-category-menu-rename"
      >
        <QueueEditIcon className="desktop-session-menu-icon" />
        <span>重命名</span>
      </div>
      <div
        className="desktop-session-menu-item desktop-session-menu-item--danger"
        role="menuitem"
        {...getItemProps(1)}
        data-testid="artifacts-category-menu-delete"
      >
        <QueueTrashIcon className="desktop-session-menu-icon" />
        <span>删除</span>
      </div>
    </div>
  );
};

/** 操作列收起后弹出的菜单：复用会话行皮肤（`.desktop-session-menu*`），
 * 与同页分类行菜单逐值同宽同位，`fixed` 定位避开表格的 `overflow` 裁剪。 */
const RowActionsMenu: React.FC<{
  anchorRect: DOMRect;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  items: Array<{
    key: string;
    label: string;
    testId: string;
    run: () => void;
    /** 在该项上方插一条分割线（不算菜单项，不参与 ↑↓ 走查与索引）。 */
    separatorBefore?: boolean;
  }>;
  testId: string;
  onClose: () => void;
  /** 面板宽：表格操作列 148（短动作），契约标准面板菜单 200。 */
  width?: number;
  /** 菜单顶部的说明行（只读提示，不算菜单项、不参与 ↑↓ 走查）。 */
  header?: string;
}> = ({
  anchorRect,
  triggerRef,
  items,
  testId,
  onClose,
  width = 148,
  header,
}) => {
  const menuRef = useRef<HTMLDivElement>(null);
  const { getItemProps } = useRovingMenu(menuRef, {
    itemSelector: ".desktop-session-menu-item",
    itemCount: items.length,
    triggerRef,
    closeOnActivate: true,
    onRequestClose: onClose,
    onActivate: (i) => items[i]?.run(),
  });
  useClickOutside({ refs: [menuRef], onClickOutside: onClose });

  // 操作列贴着表格右缘：菜单与「⋯」左对齐向下展开（右对齐会往左压住「分享给」列），
  // 再按视口夹一次，保证不越界；纵向「下 → 翻上 → 夹取并内部滚动」与会话行菜单
  // 同一份实现。
  const menuWidth = width;
  const menuStyle = useAnchoredMenuStyle(
    menuRef,
    anchorRect,
    menuWidth,
    "left",
  );
  // 必须挂到 body：操作列是 `position: sticky` + `z-index: 1` 的单元格，
  // 菜单若留在单元格内部，会被后面几行同样带背景的 sticky 单元格盖住
  // （浅色档实测只露出白框、文字全被压掉）。
  return createPortal(
    <div
      ref={menuRef}
      className="desktop-session-menu"
      role="menu"
      style={menuStyle}
      data-testid={testId}
    >
      {header && (
        <div
          className="desktop-session-menu-header"
          role="presentation"
          data-testid={`${testId}-header`}
        >
          {header}
        </div>
      )}
      {items.map((item, index) => (
        <Fragment key={item.key}>
          {item.separatorBefore && (
            <div
              className="desktop-session-menu-separator"
              aria-hidden="true"
              data-testid={`${item.testId}-separator`}
            />
          )}
          <div
            className="desktop-session-menu-item"
            role="menuitem"
            {...getItemProps(index)}
            data-testid={item.testId}
          >
            <span>{item.label}</span>
          </div>
        </Fragment>
      ))}
    </div>,
    document.body,
  );
};

/** 量宽镜像用的固定文案（= 操作列可能出现的最长组合）。 */
const MEASURE_LABELS = ["复制链接", "在浏览器中打开", "分享"];

/**
 * 表格操作列：宽窗口里三颗文字按钮并排；列放不下时收成一颗「⋯」，
 * 点开后把同样的动作放进下拉菜单（1023 评论：「在操作不能完整显示时，
 * 希望展示三个点的图标，然后点开后下拉显示全部的操作」）。
 *
 * 判定不写阈值常量：单元格里放一段 `width: max-content` + `visibility: hidden`
 * 的同字号镜像（`aria-hidden`，用 span 而非 button ⇒ 不进焦点链），拿它的
 * `offsetWidth` 与单元格内容盒宽度比 —— 这正是浏览器会不会挤掉一颗的判据，
 * 字号、缩放、列宽怎么变都跟着走。窗口尺寸变化由 `ResizeObserver` 触发重算。
 */
const RowActions: React.FC<{
  slug: string;
  onCopy: () => void;
  onOpen: () => void;
  onShare?: () => void;
}> = ({ slug, onCopy, onOpen, onShare }) => {
  const cellRef = useRef<HTMLTableCellElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [compact, setCompact] = useState(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const actions = useMemo(
    () => [
      {
        key: "copy",
        label: "复制链接",
        testId: `artifacts-copy-${slug}`,
        run: onCopy,
      },
      {
        key: "open",
        label: "在浏览器中打开",
        testId: `artifacts-browser-${slug}`,
        run: onOpen,
      },
      ...(onShare
        ? [
            {
              key: "share",
              label: "分享",
              testId: `artifacts-share-${slug}`,
              run: onShare,
            },
          ]
        : []),
    ],
    [slug, onCopy, onOpen, onShare],
  );

  useLayoutEffect(() => {
    const cell = cellRef.current;
    const measure = measureRef.current;
    if (!cell || !measure) return;
    const check = () => {
      // 还没量到宽度时（首帧、面板处于隐藏态，clientWidth 为 0）不做判定 —— 按
      // 「放得下」渲染原样三颗按钮，等 ResizeObserver 报出真实宽度再决定要不要
      // 把动作收进菜单。
      if (!cell.clientWidth) {
        setCompact(false);
        return;
      }
      const cs = getComputedStyle(cell);
      const available =
        cell.clientWidth -
        parseFloat(cs.paddingLeft || "0") -
        parseFloat(cs.paddingRight || "0");
      setCompact(measure.offsetWidth > available + 0.5);
    };
    check();
    // 首帧可能早于样式表/字体落地（那时镜像宽 0 ⇒ 误判成「放得下」）：补一帧、
    // 等字体就绪、并同时观察镜像本身，任一时刻量到真实宽度都会重判一次。
    const raf = requestAnimationFrame(check);
    document.fonts?.ready.then(check).catch(() => {});
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(check);
    observer?.observe(cell);
    observer?.observe(measure);
    window.addEventListener("resize", check);
    return () => {
      cancelAnimationFrame(raf);
      observer?.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [actions.length]);

  return (
    <td className="artifacts-col-actions" ref={cellRef}>
      {/* 量宽镜像：与按钮同字号同内衬，`aria-hidden` 且不是 button ⇒ 不参与键盘。
          固定按「三颗都在」量（含只在我发布的出现的「分享」）——同一列的所有行共用
          一个列宽，按最长那行判定，整列要么全并排、要么全收成「⋯」，不会一行三颗、
          另一行三点。 */}
      <span
        ref={measureRef}
        className="artifacts-actions-measure"
        aria-hidden="true"
      >
        {MEASURE_LABELS.map((label) => (
          <span key={label} className="artifacts-icon-btn">
            {label}
          </span>
        ))}
      </span>
      {compact ? (
        <>
          <button
            type="button"
            ref={triggerRef}
            className="artifacts-actions-more"
            title="更多操作"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={anchor ? true : undefined}
            onClick={(event) => {
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              setAnchor((prev) => (prev ? null : rect));
            }}
            data-testid={`artifacts-more-${slug}`}
          >
            <MoreIcon className="artifacts-actions-more-icon" />
          </button>
          {anchor && (
            <RowActionsMenu
              anchorRect={anchor}
              triggerRef={triggerRef}
              items={actions}
              testId={`artifacts-actions-menu-${slug}`}
              onClose={() => setAnchor(null)}
            />
          )}
        </>
      ) : (
        actions.map((action) => (
          <button
            key={action.key}
            type="button"
            className="artifacts-icon-btn"
            onClick={action.run}
            data-testid={action.testId}
          >
            {action.label}
          </button>
        ))
      )}
    </td>
  );
};

export const ArtifactsPage: React.FC<ArtifactsPageProps> = ({
  onBack,
  collapsed = false,
  onExpandSidebar,
  macTrafficSpacer = false,
  vscode,
  serverUrl,
  onLogin,
  onNewFromTemplate,
}) => {
  const postMessage = useCallback(
    (message: unknown) => vscode?.postMessage(message),
    [vscode],
  );

  const [items, setItems] = useState<ArtifactGalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  /**
   * 文件名行内重命名（设计师 2026-11-11）。
   *
   * 服务端目前只有发布时能写标题，没有单独的改标题接口（`PATCH /api/frame/{slug}`
   * 还不存在，见 docs/specs/desktop/desktop-artifacts.md「外部依赖」第 8 条）。
   * 这一版是**交互原型**：只改本页 state，刷新即还原；走的是异步状态机
   * （`saving` + 失败重试），接口到位后把 `commitRenamePlaceholder` 换成宿主命令即可，
   * 入口与校验规则不用动。
   */
  const [renaming, setRenaming] = useState<{
    slug: string;
    draft: string;
    /** 进入编辑态时的原名字，用来判断「有没有真的改」。 */
    original: string;
    error: string | null;
    /** 提交中：输入框禁用、只显示进行中态，重复回车不再发第二次。 */
    saving: boolean;
  } | null>(null);
  // Esc 关掉输入框时也会触发一次 blur，用它区分「主动取消」与「失焦保存」。
  const renameCanceledRef = useRef(false);
  // 提交序号：Esc / 换一行编辑都会 +1，让在途那次提交的结果作废（不写回列表、
  // 不吃掉用户后来的输入）。
  const renameRequestRef = useRef(0);

  const [view, setViewState] = useState<ArtifactsView>(readStoredView);
  // 视图切换：同时写回本机偏好（下次进页面沿用）；两个调用点（视图下拉 /
  // 进入自定义视图时清勾选）都走这一份。
  const setView = useCallback((next: ArtifactsView) => {
    setViewState(next);
    writeStoredView(next);
  }, []);
  // 视图下拉：null = 收起；非 null = 触发键的 rect（菜单贴着它向下展开）。
  const [viewMenu, setViewMenu] = useState<DOMRect | null>(null);
  const viewTriggerRef = useRef<HTMLButtonElement>(null);
  const [defaultTab, setDefaultTab] = useState<DefaultTab>("mine");
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 「修改分类」下拉：null = 收起；非 null = 触发键的 rect（菜单左缘据此对齐按钮左缘）。
  const [batchAnchor, setBatchAnchor] = useState<DOMRect | null>(null);
  const batchTriggerRef = useRef<HTMLButtonElement>(null);

  const [categories, setCategories] = useState<ArtifactCategory[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [categoryDialog, setCategoryDialog] =
    useState<CategoryDialogState | null>(null);
  const [categoryNameDraft, setCategoryNameDraft] = useState("");
  const [categoryError, setCategoryError] = useState<string | null>(null);
  // 分类行「⋯」菜单：哪一行开着 + 触发按钮 rect（fixed 定位）。
  const [categoryMenu, setCategoryMenu] = useState<CategoryMenuState | null>(
    null,
  );
  // 每行「⋯」的 ref 锚点（按 id 缓存同一对象，供菜单关闭后把焦点还回去）——
  // 与会话行的 `moreBtnAnchorsRef` 同款，避免每帧新建 ref 对象。
  const categoryMoreAnchorsRef = useRef(
    new Map<string, { current: HTMLButtonElement | null }>(),
  );
  const getCategoryMoreRef = (categoryId: string) => {
    let anchor = categoryMoreAnchorsRef.current.get(categoryId);
    if (!anchor) {
      anchor = { current: null };
      categoryMoreAnchorsRef.current.set(categoryId, anchor);
    }
    return anchor;
  };

  const [shareSlug, setShareSlug] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  // 页面内轻提示（复制链接 / 分类保存 / 撤销发布…）。设计师 2026-10-23 预览评论：
  // 「复制链接成功的提示应该出现在顶部用绿色的成功提示」⇒ 位置改顶部居中、
  // 成功走 --cc-color-success(+soft)、失败走 danger，并按 skill「不得只靠颜色」
  // 前置 16px 语义图标（与全局 `.toast-stack--top` 同一枚矢量）。
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  // toast 水平居中于**本页**（= 右侧主区）而不是视口：桌面侧栏 260px 固定，
  // 视口中心会比主区中心左 130px（实测主区 x=260 / w=1180 ⇒ 中心 850）。
  // 量不到时回退 CSS 的 left:50%（视口中心）。
  const [toastCenterX, setToastCenterX] = useState<number | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);

  const listRequestRef = useRef<string | null>(null);
  /** 当前这次列表请求是否来自手动刷新（用于回包后给「刷新成功」提示）。 */
  const refreshRequestRef = useRef(false);
  const categoriesRequestRef = useRef<string | null>(null);
  const categoriesSaveRequestRef = useRef<string | null>(null);
  const revokeRequestRef = useRef<string | null>(null);
  const revokeTargetRef = useRef<string | null>(null);
  // 主 tab 行的「添加分类」键：溢出语义照预览面板 tab 条（`DesktopPanelTabs`
  // 的 `pinned`，设计师 2026-11-13 预览评论「参考这里的实现，但是不要分割线」）——
  // tab 放得下时「＋」跟在最后一个 tab 后面；一放不下就搬到可横向滚动区之外、
  // 紧贴右侧动作键，永远不会被滚出视野。
  // 原来它固定排在 tab 末尾，分类名一长、tab 行溢出，它就被推到行外并压到搜索框
  // 底下（搜索框在 DOM 里更靠后 ⇒ 命中它是输入框），表现正是她说的「添加无法操作」。
  const tabsStripRef = useRef<HTMLDivElement>(null);
  const [categoryAddPinned, setCategoryAddPinned] = useState(false);
  // 登录态（null = 还没收到过）。只用来识别「未登录 → 已登录 / 已登录 → 未登录」
  // 这两个翻转：列表与分类都是账号级数据，翻转时必须重取，否则页面会一直停在
  // 打开那一刻的结果上（PM 缺陷 3500345467492608）。
  const authAuthedRef = useRef<boolean | null>(null);
  // useHostMessage 的处理器只在挂载时注册一次（经 latest ref 读最新闭包），
  // 撤销回包要调用的 handleRevoked 在其后定义 —— 经 ref 取。
  const handleRevokedRef = useRef<(slug: string) => void>(() => {});

  const showToast = useCallback(
    (message: string, type: "success" | "error" = "success") => {
      setToast({ message, type });
    },
    [],
  );

  // 「添加分类」键贴内还是贴外（见上面 `categoryAddPinned` 的注释）：按
  // 「全部 tab 宽 + 2px 间距 + 末尾这颗 24×24 键（含 2px 内缩）」与滚动区自身
  // 宽度比较，跟 `DesktopPanelTabs` 的判定式同一个思路 —— 拿内容需求宽度比容器，
  // 而不是比当前模式下的剩余空间，键在两处之间移动时才不会来回抖。
  useLayoutEffect(() => {
    if (view !== "custom") {
      setCategoryAddPinned(false);
      return;
    }
    const strip = tabsStripRef.current;
    if (!strip) return;
    const measure = () => {
      const tabEls = Array.from(
        strip.querySelectorAll<HTMLElement>(".artifacts-tab"),
      );
      const tabsTotal = tabEls.reduce((sum, el) => sum + el.offsetWidth, 0);
      // .artifacts-tabs 的 gap 2 + 「＋」自身 24 + margin-left 2
      const needed = tabsTotal + Math.max(0, tabEls.length - 1) * 2 + 26;
      const next = needed > strip.clientWidth + 1;
      setCategoryAddPinned((prev) => (prev === next ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(strip);
    strip
      .querySelectorAll<HTMLElement>(".artifacts-tab")
      .forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [view, categories]);

  // 选中那颗 tab 自动滚进视野（同预览面板页签的浏览器语义，设计师 2026-11-13
  // 「现在可以继续添加，但是不会自动滚动到选项」）：新建分类总排在末尾、且被自动
  // 选中 —— 整条滚到最右，新 tab 与「＋」一起露出来；点的是中间那颗（或「全部」）
  // 就只滚到「刚好可见」，已经看得见的位置一点都不动。
  useEffect(() => {
    const strip = tabsStripRef.current;
    if (!strip || view !== "custom") return;
    const last = categories[categories.length - 1];
    if (activeCategoryId && last && activeCategoryId === last.id) {
      strip.scrollLeft = strip.scrollWidth;
      return;
    }
    strip
      .querySelector('.artifacts-tab[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeCategoryId, categories, view]);

  // 没有触控板时怎么横滚这一行（设计师 2026-11-13「如果没有触控板，这里如何横滚？」）：
  // 实测鼠标只剩「倾斜滚轮（deltaX）」和方向键可用 —— 垂直滚轮完全没反应，Shift+
  // 滚轮在 macOS 的 Chromium 里也不映射横向，滚动条又是隐藏的。所以把纵向滚轮翻译成
  // 横向滚动：横向滚轮与触控板横扫交给浏览器，不重复处理；鼠标停在这一行时纵向滚轮
  // 一律被它吃掉（她 2026-11-13「鼠标停在这行时永远不带页面动」），滚到两端就停住，
  // 继续滚也不会带动页面。React 的 onWheel 是 passive 的（preventDefault 无效），
  // 因此挂原生监听。
  useEffect(() => {
    const strip = tabsStripRef.current;
    if (!strip) return;
    const onWheel = (event: WheelEvent) => {
      // ⌘/Ctrl + 滚轮是缩放，横向滚轮（触控板横扫 / 倾斜滚轮）走浏览器默认
      if (event.ctrlKey || event.metaKey) return;
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      const max = Math.max(0, strip.scrollWidth - strip.clientWidth);
      if (max <= 0) return;
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? strip.clientWidth
            : 1;
      strip.scrollLeft = Math.min(
        max,
        Math.max(0, strip.scrollLeft + event.deltaY * unit),
      );
    };
    strip.addEventListener("wheel", onWheel, { passive: false });
    return () => strip.removeEventListener("wheel", onWheel);
  }, [view]);

  // 方向键在页签之间移动焦点（设计师 2026-11-13「对齐」，参照预览面板页签的
  // roving tabindex：整组只留一个 Tab 停靠点，←/→ 串成一条）。这里只挪焦点、
  // 不顺手切换 —— 切换交给 Enter/Space 由 button 自身的 click 完成，和鼠标点
  // 一下等价；焦点落到被裁掉的那颗时浏览器会把它滚进视野。
  const handleTabsKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    const strip = tabsStripRef.current;
    if (!strip) return;
    const tabs = Array.from(
      strip.querySelectorAll<HTMLElement>(".artifacts-tab"),
    );
    if (tabs.length === 0) return;
    const cur = tabs.findIndex((el) => el.tabIndex === 0);
    // 当前位置优先看焦点：roving 让「Tab 停靠点」始终在选中的那颗上，光按 ←/→
    // 移动焦点并不改变选中 ⇒ 只按 tabIndex 找锚点会一直算回同一颗、第二次按就卡住。
    const focusedAt = tabs.indexOf(document.activeElement as HTMLElement);
    const index = focusedAt !== -1 ? focusedAt : cur === -1 ? 0 : cur;
    const next =
      event.key === "ArrowRight"
        ? (index + 1) % tabs.length
        : (index - 1 + tabs.length) % tabs.length;
    tabs[next].focus();
    // 脚本 focus() 不会替你把元素滚进视野（浏览器只对「用户直接操作」那次做），
    // 所以显式补一次 nearest —— 与自动滚动那条 effect 的语义一致。
    tabs[next].scrollIntoView({ block: "nearest", inline: "nearest" });
    event.preventDefault();
  };

  // 定位：toast 出现时量一次本页中心（layout effect ⇒ 在首次绘制前落定，
  // 不会先闪在视口中心）。
  useLayoutEffect(() => {
    if (!toast) {
      setToastCenterX(null);
      return;
    }
    const el = pageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setToastCenterX(Math.round(rect.left + rect.width / 2));
  }, [toast]);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const requestList = useCallback(
    (isRefresh = false) => {
      const requestId = nextRequestId();
      listRequestRef.current = requestId;
      refreshRequestRef.current = isRefresh;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      postMessage({ command: "desktopArtifactsList", requestId });
    },
    [postMessage],
  );

  const requestCategories = useCallback(() => {
    const requestId = nextRequestId();
    categoriesRequestRef.current = requestId;
    postMessage({ command: "desktopArtifactCategoriesGet", requestId });
  }, [postMessage]);

  useEffect(() => {
    requestList();
    requestCategories();
  }, [requestList, requestCategories]);

  const saveCategories = useCallback(
    (
      nextCategories: ArtifactCategory[],
      nextAssignments: Record<string, string>,
    ) => {
      // 先局部生效（分类是本机数据，写失败也不影响这次编辑的可见性），失败
      // 再以轻提示告知 —— 写的是 userData，失败意味着重启后这次编辑会丢。
      setCategories(nextCategories);
      setAssignments(nextAssignments);
      const requestId = nextRequestId();
      categoriesSaveRequestRef.current = requestId;
      postMessage({
        command: "desktopArtifactCategoriesSave",
        requestId,
        categories: nextCategories,
        assignments: nextAssignments,
      });
    },
    [postMessage],
  );

  useHostMessage((message) => {
    const data = message as { command?: string; requestId?: string };
    switch (data.command) {
      case "desktopArtifactsList": {
        if (data.requestId !== listRequestRef.current) return;
        const payload = message as {
          items?: ArtifactGalleryItem[];
          error?: string;
          authRequired?: boolean;
        };
        setLoading(false);
        setRefreshing(false);
        if (payload.authRequired) {
          // 失败分支把刷新标记清掉：下一次（非刷新）成功回包不该再提示。
          refreshRequestRef.current = false;
          setAuthRequired(true);
          setError(null);
          return;
        }
        setAuthRequired(false);
        if (payload.error) {
          // 已渲染的数据不清空（spec 场景 7）：只给出错误与重试。
          refreshRequestRef.current = false;
          setError(payload.error);
          return;
        }
        setError(null);
        setItems(payload.items ?? []);
        // 手动刷新成功后在页面顶部给一条轻提示（设计师 2026-11-06）：
        // 列表原地重排、没有别的可见反馈，不给提示会以为没点上。首次加载、
        // 登录态翻转等非手动刷新不提示。
        if (refreshRequestRef.current) showToast("刷新成功");
        refreshRequestRef.current = false;
        return;
      }
      case "desktopArtifactCategories": {
        if (data.requestId !== categoriesRequestRef.current) return;
        const payload = message as {
          categories?: ArtifactCategory[];
          assignments?: Record<string, string>;
        };
        setCategories(payload.categories ?? []);
        setAssignments(payload.assignments ?? {});
        return;
      }
      case "desktopArtifactCategoriesSaved": {
        if (data.requestId !== categoriesSaveRequestRef.current) return;
        categoriesSaveRequestRef.current = null;
        const payload = message as { ok?: boolean; error?: string };
        if (payload.ok === false) {
          showToast(payload.error ?? "分类保存失败", "error");
        }
        return;
      }
      case "desktopArtifactRevoke": {
        if (data.requestId !== revokeRequestRef.current) return;
        const payload = message as { ok?: boolean; error?: string };
        const slug = revokeTargetRef.current;
        revokeRequestRef.current = null;
        revokeTargetRef.current = null;
        if (payload.ok) {
          if (slug) handleRevokedRef.current(slug);
          showToast("已撤销发布");
        } else {
          showToast(payload.error ?? "撤销发布失败", "error");
        }
        return;
      }
      // 登录成功：列表与分类都按账号存，立刻重取一次。用户从空态里的「去登录」
      // 回来后必须直接看到自己的创作集，而不是继续停在「请先登录后再查看创作集」
      // （PM 缺陷 3500345467492608）。`loginResponse` 是确定性信号；这里同时把
      // 登录态 ref 置为 true，下面 desktopAccountInfo 那一支就不会再取一遍。
      case "loginResponse": {
        if ((message as { success?: boolean }).success) {
          authAuthedRef.current = true;
          requestList();
          requestCategories();
        }
        return;
      }
      // 登录态翻转（换账号 / 登出 / token 失效）：窗口级广播，无 paneId。
      case "desktopAccountInfo": {
        const authed = Boolean(
          (message as { isAuthenticated?: boolean }).isAuthenticated,
        );
        const was = authAuthedRef.current;
        authAuthedRef.current = authed;
        if (authed && was === false) {
          requestList();
          requestCategories();
          return;
        }
        if (!authed && was === true) {
          // 登出或换账号：先清掉上一个账号的数据，别让它留在页面上。
          setItems([]);
          setAuthRequired(true);
        }
        return;
      }
      default:
        return;
    }
  });

  // ── 派生数据 ────────────────────────────────────────────────────────────

  const scopeItems = useMemo(() => {
    const inScope = items.filter((item) => {
      if (view === "default") return item.rel === defaultTab;
      if (activeCategoryId === null) return true;
      return assignments[item.slug] === activeCategoryId;
    });
    const keyword = search.trim().toLowerCase();
    const filtered = keyword
      ? inScope.filter((item) => item.title.toLowerCase().includes(keyword))
      : inScope;
    return [...filtered].sort((a, b) => {
      const diff = timeValue(b.updatedAt) - timeValue(a.updatedAt);
      if (diff !== 0) return diff;
      return a.title.localeCompare(b.title);
    });
  }, [items, view, defaultTab, activeCategoryId, assignments, search]);

  // 「所属分类」列只在自定义视图的「全部」里出现（设计师 2026-11-06）：
  // 分类 tab 下每行都是同一个分类，再列一遍是重复；默认视图没有分类体系可对照。
  const showCategoryColumn = view === "custom" && activeCategoryId === null;
  const categoryNameById = useMemo(() => {
    const names: Record<string, string> = {};
    for (const category of categories) names[category.id] = category.name;
    return names;
  }, [categories]);

  // 搜索无结果和「这个分类本来就没文件」是两件事：前者是筛选没命中，
  // 文案要指向「相关文件」；分类下没有内容时才说「还没有文件」。
  const searching = search.trim().length > 0;
  const emptyText = searching
    ? view === "custom" && activeCategoryId !== null
      ? "该分类下暂无相关文件"
      : "没有找到相关文件"
    : view === "default"
      ? defaultTab === "mine"
        ? "还没有创作"
        : "还没有人分享给你"
      : activeCategoryId === null
        ? "还没有创作"
        : "这个分类下还没有文件";

  // ── 行内动作 ────────────────────────────────────────────────────────────

  const artifactUrl = useCallback(
    (slug: string) =>
      `${(serverUrl ?? "").replace(/\/$/, "")}/code/artifact/${slug}`,
    [serverUrl],
  );

  const handleCopyLink = useCallback(
    async (slug: string) => {
      const ok = await copyText(artifactUrl(slug));
      showToast(
        ok ? "链接已复制" : "复制失败，请手动复制",
        ok ? "success" : "error",
      );
    },
    [artifactUrl, showToast],
  );

  const handleOpenInBrowser = useCallback(
    (slug: string) => {
      postMessage({ command: "openExternal", url: artifactUrl(slug) });
    },
    [artifactUrl, postMessage],
  );

  const applyShareToRow = useCallback(
    (slug: string, mode: ArtifactShareMode, emails: string[]) => {
      setItems((prev) =>
        prev.map((item) =>
          item.slug === slug
            ? {
                ...item,
                shareMode: mode,
                sharedEmails: mode === "users" ? emails : undefined,
              }
            : item,
        ),
      );
    },
    [],
  );

  // ── 文件名重命名（交互原型，见上方 `renaming` 注释） ──────────────────────

  const startRename = useCallback((slug: string, title: string) => {
    renameCanceledRef.current = false;
    // 换一行编辑：上一行在途的提交作废，别把结果写到已经换人的输入框上。
    renameRequestRef.current += 1;
    setRenaming({
      slug,
      draft: title,
      original: title,
      error: null,
      saving: false,
    });
  }, []);

  const cancelRename = useCallback(() => {
    // 先打标记再退出：setRenaming(null) 卸载 input 会顺带触发一次 blur，
    // commitRename 见到这个标记就当作「主动取消」，不写数据。
    renameCanceledRef.current = true;
    renameRequestRef.current += 1;
    setRenaming(null);
  }, []);

  const commitRename = useCallback(async () => {
    if (!renaming || renaming.saving) return;
    if (renameCanceledRef.current) {
      renameCanceledRef.current = false;
      return;
    }
    // 换行 / 连续空白折叠成一个空格（spec 边界第 1 条）。
    const nextTitle = renaming.draft.replace(/\s+/g, " ").trim();
    if (!nextTitle) {
      setRenaming({ ...renaming, error: "名称不能为空" });
      return;
    }
    if (nextTitle.length > ARTIFACT_TITLE_MAX) {
      setRenaming({
        ...renaming,
        error: `名称最多 ${ARTIFACT_TITLE_MAX} 个字`,
      });
      return;
    }
    // 名字没动（只是点开又回车/失焦）：直接收起，不写数据也不给「已重命名」。
    if (nextTitle === renaming.original) {
      setRenaming(null);
      return;
    }
    const request = ++renameRequestRef.current;
    setRenaming({ ...renaming, saving: true, error: null });
    try {
      await commitRenamePlaceholder();
      // 期间用户按了 Esc 或点开另一行：这次结果作废。
      if (renameRequestRef.current !== request) return;
      setItems((prev) =>
        prev.map((item) =>
          item.slug === renaming.slug ? { ...item, title: nextTitle } : item,
        ),
      );
      setRenaming(null);
      // 原型期不能断言「已生效」：接口还没接，刷新列表就还原（spec 外部依赖
      // 第 8 条）。文案带限定语，避免把一次本页写当成服务端写成功。
      showToast("已重命名（本页演示，接口未接入）");
    } catch (error) {
      if (renameRequestRef.current !== request) return;
      // spec 场景 9：输入框保持打开、输入不被清空，就地给失败原因；
      // 原型期的重试入口就是「再按一次回车 / 再失焦一次」。
      setRenaming((prev) =>
        prev
          ? {
              ...prev,
              saving: false,
              error: `保存失败：${error instanceof Error ? error.message : String(error)}`,
            }
          : prev,
      );
    }
  }, [renaming, showToast]);

  const handleRevoked = useCallback((slug: string) => {
    setItems((prev) => prev.filter((item) => item.slug !== slug));
    setSelected((prev) => {
      if (!prev.has(slug)) return prev;
      const next = new Set(prev);
      next.delete(slug);
      return next;
    });
  }, []);

  handleRevokedRef.current = handleRevoked;

  // ── 分类写动作 ──────────────────────────────────────────────────────────

  const openCategoryDialog = useCallback((dialog: CategoryDialogState) => {
    setCategoryError(null);
    setCategoryNameDraft(dialog.name ?? "");
    setCategoryDialog(dialog);
  }, []);

  const validateCategoryName = useCallback(
    (name: string, excludeId?: string): string | null => {
      const trimmed = name.trim();
      if (!trimmed) return "请输入分类名称";
      if (trimmed.length > CATEGORY_NAME_MAX)
        return `分类名称最多 ${CATEGORY_NAME_MAX} 个字`;
      if (RESERVED_CATEGORY_NAMES.includes(trimmed)) {
        return "这是默认视图的分组名，请换一个";
      }
      if (categories.some((c) => c.id !== excludeId && c.name === trimmed)) {
        return "分类名称不能重复";
      }
      return null;
    },
    [categories],
  );

  const handleCategorySubmit = useCallback(() => {
    if (!categoryDialog) return;
    if (categoryDialog.kind === "delete") {
      const categoryId = categoryDialog.categoryId ?? "";
      const nextCategories = categories.filter((c) => c.id !== categoryId);
      // 设计师 2026-11-06（统一文案）：删分类不再要求先选迁移目标，原分类下的
      // 文件一律自动移出 —— 即删掉归属，回到「未分类」。
      const nextAssignments = { ...assignments };
      for (const [slug, value] of Object.entries(nextAssignments)) {
        if (value === categoryId) delete nextAssignments[slug];
      }
      saveCategories(nextCategories, nextAssignments);
      if (activeCategoryId === categoryId) setActiveCategoryId(null);
      setCategoryDialog(null);
      showToast("分类已删除");
      return;
    }

    const nameError = validateCategoryName(
      categoryNameDraft,
      categoryDialog.kind === "rename" ? categoryDialog.categoryId : undefined,
    );
    if (nameError) {
      setCategoryError(nameError);
      return;
    }
    const trimmed = categoryNameDraft.trim();
    if (categoryDialog.kind === "create") {
      // 新分类排在末尾并自动选中，列表随之切到该分类（此时为空态）。
      const created = { id: `cat-${Date.now()}`, name: trimmed };
      saveCategories([...categories, created], assignments);
      setActiveCategoryId(created.id);
      showToast("分类已创建");
    } else {
      saveCategories(
        categories.map((c) =>
          c.id === categoryDialog.categoryId ? { ...c, name: trimmed } : c,
        ),
        assignments,
      );
      showToast("分类已重命名");
    }
    setCategoryDialog(null);
  }, [
    categoryDialog,
    categoryNameDraft,
    assignments,
    categories,
    activeCategoryId,
    saveCategories,
    showToast,
    validateCategoryName,
  ]);

  const handleBatchAssign = useCallback(
    (categoryId: string | null) => {
      const nextAssignments = { ...assignments };
      for (const slug of selected) {
        if (categoryId === null) delete nextAssignments[slug];
        else nextAssignments[slug] = categoryId;
      }
      saveCategories(categories, nextAssignments);
      setSelected(new Set());
      setBatchAnchor(null);
      showToast(categoryId === null ? "已移出分类" : "已归类");
    },
    [assignments, categories, selected, saveCategories, showToast],
  );

  /** 页头「修改分类」下拉：各分类 + 「移出分类（未分类）」（沿用原 testid，
   *  走查脚本不用改）。末尾这一项与分类列表之间加分割线（设计师 2026-11-06：
   *  「此处可以加一个分割线」）—— 它是「退出分类」而不是某一个分类。 */
  const batchMenuItems = useMemo(
    () => [
      ...categories.map((category) => ({
        key: category.id,
        label: category.name,
        testId: `artifacts-batch-${category.id}`,
        run: () => handleBatchAssign(category.id),
      })),
      {
        key: "remove",
        label: "移出分类（未分类）",
        testId: "artifacts-batch-remove",
        run: () => handleBatchAssign(null),
        separatorBefore: true,
      },
    ],
    [categories, handleBatchAssign],
  );

  // ── 渲染 ────────────────────────────────────────────────────────────────

  const toggleSelection = (slug: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  };

  const allSelected =
    scopeItems.length > 0 &&
    scopeItems.every((item) => selected.has(item.slug));

  return (
    <div className="artifacts-page" data-testid="artifacts-page" ref={pageRef}>
      <div className="session-board-toolbar">
        {macTrafficSpacer && (
          <div
            className="session-board-mac-traffic"
            aria-hidden="true"
            data-testid="artifacts-mac-traffic"
          />
        )}
        {collapsed && (
          <>
            {onExpandSidebar && (
              <Tooltip text="展开侧边栏" position="bottom">
                <button
                  type="button"
                  className="session-board-icon-btn"
                  onClick={onExpandSidebar}
                  data-testid="artifacts-expand-sidebar"
                  aria-label="展开侧边栏"
                >
                  <SidebarExpandIcon />
                </button>
              </Tooltip>
            )}
            <span className="session-board-toolbar-divider" />
          </>
        )}
        <button
          type="button"
          className="session-board-back"
          onClick={onBack}
          title="返回当前会话"
          data-testid="artifacts-back"
        >
          <span className="codicon codicon-arrow-left" aria-hidden="true" />
          返回当前会话
        </button>
      </div>

      <div className="artifacts-content">
        {/* 页头：与插件市场同形（`h1` + 一句说明），让整页第一眼有标题。
            设计师 2026-11-06：「顶部最好和插件市场类似，有个主页面的标题和
            简单介绍文案」。 */}
        <header className="artifacts-page-header">
          <div className="artifacts-page-header-text">
            <h1>创作集</h1>
            <p>这里有发布和共享给你的作品，随时和团队一起分享创作吧</p>
          </div>
          <div className="artifacts-page-header-actions">
            {/* 视图是辅助开关（设计师 2026-11-06）：从主切换位收成页头右上角
                一颗图标键 + 下拉，主 tab 位让给当前视图下的分类。按钮上仍直接
                显示当前视图名，避免「图标看不出现在在哪一档」。
                按钮已有文字说明，不再挂 hover tooltip（设计师 2026-11-06：
                「这个 hover 说明不要」）。 */}
            <button
              type="button"
              ref={viewTriggerRef}
              className="artifacts-view-btn"
              aria-haspopup="menu"
              aria-expanded={viewMenu ? true : undefined}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setViewMenu((prev) => (prev ? null : rect));
              }}
              data-testid="artifacts-view-toggle"
              data-view={view}
            >
              {view === "default" ? (
                <DefaultViewIcon className="artifacts-view-icon" />
              ) : (
                <CustomViewIcon className="artifacts-view-icon" />
              )}
              <span className="artifacts-view-label">
                {view === "default" ? "默认视图" : "自定义视图"}
              </span>
              {/* 1113 评论（`svg.artifacts-view-caret`「这个三角也太小了」）：原来
                  复用自绘的 `ChevronDownIcon`，12px 盒里墨迹像素实测只有 4.0×2.5；改按契约
                  §Desktop select trigger 的官方下箭头矢量，元素盒 = 墨迹盒 8×4.5，
                  画法同本页 `select` 的箭头与会话看板筛选器（mask 取 16×16 正中窗口）。 */}
              <span className="artifacts-view-caret" aria-hidden="true" />
            </button>
            {viewMenu && (
              <ViewMenu
                anchorRect={viewMenu}
                triggerRef={viewTriggerRef}
                view={view}
                onSelect={(next) => {
                  setView(next);
                  if (next === "default") setSelected(new Set());
                }}
                onClose={() => setViewMenu(null)}
              />
            )}
            {/* 多选动作（设计师 2026-11-06）：「多选操作不在这里出现，统一作为
                按钮功能，未选时按钮置灰，勾选时激活」—— 原来是列表上方那条
                「已选 N 项 / 归类到… / 取消选择」批量条，选中才整条冒出来、
                会把表格往下顶；现在收进页头，一颗「修改分类」常驻、只靠禁用态
                表达有没有选中，也不显示选中计数。同日再改：「不要取消选择按钮」
                （清勾选直接点行首方框）、按钮文案两轮演进「归类到… → 移动分组 →
                修改分类」（末次为准）。
                只在自定义视图渲染：默认视图没有勾选列，常驻一颗永远置灰的键
                只是噪声。 */}
            {view === "custom" && (
              <>
                {/* 置灰态补一句 hover 提示（设计师 2026-11-06）：「修改分类 置灰
                    状态下，hover提示『请先选择文件』」—— 置灰的原因不在按钮上，
                    不解释一句就只像坏了。勾选后按钮可点、提示自动撤掉
                    （Tooltip 的 disabled 直接不渲染包装层）。 */}
                <Tooltip
                  text="请先选择文件"
                  position="bottom"
                  disabled={selected.size > 0}
                >
                  <button
                    type="button"
                    ref={batchTriggerRef}
                    className="artifacts-secondary-btn"
                    disabled={selected.size === 0}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setBatchAnchor((prev) => (prev ? null : rect));
                    }}
                    aria-haspopup="menu"
                    aria-expanded={batchAnchor ? true : undefined}
                    data-testid="artifacts-batch-category"
                  >
                    修改分类
                  </button>
                </Tooltip>
                {/* 1023 评论（点 `div.artifacts-menu`）：「这里下拉要符合规范，且左侧
                      要和按钮对齐」⇒ 换掉本页自写的 `.artifacts-menu`（r8 / pad 4 /
                      12px 项 / 右对齐），改用与同页分类行、操作列共用的那一份
                      `.desktop-session-menu` 皮肤（契约 §Menus：r12 / pad 8 /
                      `--cc-shadow-popover` / 项 28px·14px·400·r6，hover fill-hover），
                      并复用同一套定位：左缘对齐触发键、按视口夹边、Esc / 点外关闭。
                      宽度取契约的标准面板宽 200。 */}
                {batchAnchor && selected.size > 0 && (
                  <RowActionsMenu
                    anchorRect={batchAnchor}
                    triggerRef={batchTriggerRef}
                    items={batchMenuItems}
                    testId="artifacts-batch-menu"
                    width={200}
                    header={`已选 ${selected.size} 个文件移至分类…`}
                    onClose={() => setBatchAnchor(null)}
                  />
                )}
              </>
            )}
            <button
              type="button"
              className="artifacts-primary-btn"
              onClick={() => setNewOpen(true)}
              data-testid="artifacts-new"
            >
              添加作品
            </button>
          </div>
        </header>

        {/* 主 tab：当前视图下的分组 / 分类（设计师 2026-11-06：「主 tab 应该是
            每个视图下的分类 tab」）。默认视图 = 我发布的 / 共享给我的；自定义
            视图 = 全部 + 各分类 + 添加分类。横向独占一行、工具条下方，表格随之
            占满整宽（原来那列 172px 的竖排分类栏已去掉）。 */}
        <div className="artifacts-tabs-row">
          <div
            className="artifacts-tabs"
            role="tablist"
            ref={tabsStripRef}
            onKeyDown={handleTabsKeyDown}
          >
            {view === "default" ? (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={defaultTab === "mine"}
                  className={`artifacts-tab${defaultTab === "mine" ? " is-active" : ""}`}
                  onClick={() => {
                    setDefaultTab("mine");
                    setSelected(new Set());
                  }}
                  data-testid="artifacts-tab-mine"
                  tabIndex={defaultTab === "mine" ? 0 : -1}
                >
                  我发布的
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={defaultTab === "shared"}
                  className={`artifacts-tab${defaultTab === "shared" ? " is-active" : ""}`}
                  onClick={() => {
                    setDefaultTab("shared");
                    setSelected(new Set());
                  }}
                  data-testid="artifacts-tab-shared"
                  tabIndex={defaultTab === "shared" ? 0 : -1}
                >
                  共享给我的
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeCategoryId === null}
                  className={`artifacts-tab${activeCategoryId === null ? " is-active" : ""}`}
                  onClick={() => {
                    setActiveCategoryId(null);
                    setSelected(new Set());
                  }}
                  data-testid="artifacts-category-all"
                  tabIndex={activeCategoryId === null ? 0 : -1}
                >
                  全部
                </button>
                {categories.map((category) => (
                  <div key={category.id} className="artifacts-tab-item">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={activeCategoryId === category.id}
                      className={`artifacts-tab${activeCategoryId === category.id ? " is-active" : ""}`}
                      // 名字被 max-width 省略后，悬停仍要能看到全名 —— 与预览面板
                      // 页签（`.desktop-panel-tab` 的 `title={label}`）同一口径。
                      title={category.name}
                      onClick={() => {
                        setActiveCategoryId(category.id);
                        setSelected(new Set());
                      }}
                      data-testid={`artifacts-category-${category.id}`}
                      tabIndex={activeCategoryId === category.id ? 0 : -1}
                    >
                      <span className="artifacts-tab-label">
                        {category.name}
                      </span>
                    </button>
                    {/* 1022 评论：「编辑和删除的交互参考」侧栏会话行 ——
                        两个文字按钮换成一颗「⋯」（`.desktop-session-more-btn`
                        同款 24×24、hover 淡入），动作收进下拉菜单。tab 化之后
                        「⋯」贴在 tab 右缘，不论是否选中都只在 hover 时出现。 */}
                    <button
                      type="button"
                      ref={getCategoryMoreRef(category.id)}
                      className="artifacts-tab-more"
                      title="更多操作"
                      aria-label={`分类「${category.name}」更多操作`}
                      aria-haspopup="menu"
                      aria-expanded={
                        categoryMenu?.categoryId === category.id || undefined
                      }
                      // 会话行靠 ←/→ 从行本身进入这个按钮（那里有漫游焦点管理）；
                      // 创作集 tab 没有那套漫游 ⇒ 保留 Tab 可达，否则键盘用户
                      // 完全打不开菜单。
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation();
                        const rect = e.currentTarget.getBoundingClientRect();
                        setCategoryMenu((prev) =>
                          prev?.categoryId === category.id
                            ? null
                            : { categoryId: category.id, rect },
                        );
                      }}
                      data-testid={`artifacts-category-more-${category.id}`}
                    >
                      <MoreIcon className="artifacts-tab-more-icon" />
                    </button>
                    {categoryMenu?.categoryId === category.id && (
                      <CategoryItemMenu
                        anchorRect={categoryMenu.rect}
                        triggerRef={getCategoryMoreRef(category.id)}
                        onRename={() => {
                          setCategoryMenu(null);
                          openCategoryDialog({
                            kind: "rename",
                            categoryId: category.id,
                            name: category.name,
                          });
                        }}
                        onDelete={() => {
                          setCategoryMenu(null);
                          openCategoryDialog({
                            kind: "delete",
                            categoryId: category.id,
                            name: category.name,
                          });
                        }}
                        onClose={() => setCategoryMenu(null)}
                      />
                    )}
                  </div>
                ))}
                {/* 「添加分类」：放得下时跟在最后一个分类后面（浏览器 tab 条语义），
                    放不下才搬到滚动区外 —— 见上面 `categoryAddPinned`。 */}
                {!categoryAddPinned && (
                  <Tooltip text="添加分类" position="bottom">
                    <button
                      type="button"
                      className="artifacts-tab-add"
                      onClick={() => openCategoryDialog({ kind: "create" })}
                      aria-label="添加分类"
                      data-testid="artifacts-new-category"
                    >
                      <PlusIcon className="artifacts-tab-add-icon" />
                    </button>
                  </Tooltip>
                )}
              </>
            )}
          </div>
          {view === "custom" && categoryAddPinned && (
            <Tooltip text="添加分类" position="bottom">
              <button
                type="button"
                className="artifacts-tab-add artifacts-tab-add--pinned"
                onClick={() => openCategoryDialog({ kind: "create" })}
                aria-label="添加分类"
                data-testid="artifacts-new-category"
              >
                <PlusIcon className="artifacts-tab-add-icon" />
              </button>
            </Tooltip>
          )}
          <div className="artifacts-tabs-actions">
            <SearchField
              value={search}
              // 改搜索词会改变可见行集合，勾选一律清空（spec 分类场景 7 / 搜索
              // 场景 5：「不允许保留看不见的勾选项」）——与切 tab / 切视图同一口径，
              // 否则「修改分类」会改到已经被过滤掉的行。
              onChange={(next) => {
                setSearch(next);
                setSelected(new Set());
              }}
              placeholder="搜索文件名称"
              testId="artifacts-search"
              clearTestId="artifacts-search-clear"
            />
            {/* 刷新仍收成图标键（1030 评论：hover 出 tooltip；刷新中图标原地
                旋转 + aria-busy，不改文案以免撑宽整行）。 */}
            <Tooltip text="刷新" position="bottom">
              <button
                type="button"
                className="artifacts-header-icon-btn"
                onClick={() => requestList(true)}
                disabled={refreshing || loading}
                aria-label="刷新"
                aria-busy={refreshing}
                data-testid="artifacts-refresh"
              >
                <RefreshIcon
                  className={`artifacts-header-icon${refreshing ? " is-spinning" : ""}`}
                />
              </button>
            </Tooltip>
          </div>
        </div>

        <div className="artifacts-main">
          {authRequired ? (
            <div className="artifacts-state" data-testid="artifacts-auth">
              <p>请先登录后再查看创作集。</p>
              {onLogin && (
                <button
                  type="button"
                  className="artifacts-primary-btn"
                  onClick={onLogin}
                >
                  去登录
                </button>
              )}
            </div>
          ) : loading ? (
            <div className="artifacts-state" data-testid="artifacts-loading">
              加载中…
            </div>
          ) : error ? (
            <div className="artifacts-state" data-testid="artifacts-error">
              <p>{error}</p>
              <button
                type="button"
                className="artifacts-secondary-btn"
                onClick={() => requestList(true)}
              >
                重试
              </button>
            </div>
          ) : scopeItems.length === 0 ? (
            <div
              className="artifacts-state artifacts-state--empty"
              data-testid="artifacts-empty"
            >
              {/* 设计师 2026-10-23 预览评论（点 div.artifacts-state「还没有创作」）：
                    「文案上面加个创作集的图标」，并指定「参考」计划面板空态
                    （div.desktop-panel-placeholder.plan-pane-placeholder-empty）——
                    即图标在上、文案在下、竖排居中，图标 24px、与文案 12px。
                    图标复用侧栏「创作集」入口那一枚（ArtifactsIcon，16 画板、
                    stroke 1.4），颜色随空态的次级字色（currentColor 继承）。 */}
              <ArtifactsIcon className="artifacts-empty-icon" />
              <span>{emptyText}</span>
            </div>
          ) : (
            <table
              className={
                showCategoryColumn
                  ? "artifacts-table artifacts-table--with-category"
                  : "artifacts-table"
              }
              data-testid="artifacts-table"
            >
              <thead>
                <tr>
                  {view === "custom" && (
                    <th className="artifacts-col-check">
                      <label className="artifacts-table-check">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          aria-label="全选"
                          data-testid="artifacts-select-all"
                          onChange={(event) => {
                            if (event.target.checked) {
                              setSelected(
                                new Set(scopeItems.map((item) => item.slug)),
                              );
                            } else {
                              setSelected(new Set());
                            }
                          }}
                        />
                        <CheckIndicator />
                      </label>
                    </th>
                  )}
                  <th className="artifacts-col-name">文件名称</th>
                  <th className="artifacts-col-owner">发布人</th>
                  <th className="artifacts-col-time">最近发布时间</th>
                  <th className="artifacts-col-share">分享给</th>
                  {showCategoryColumn && (
                    <th className="artifacts-col-category">所属分类</th>
                  )}
                  <th className="artifacts-col-actions">操作</th>
                </tr>
              </thead>
              <tbody>
                {scopeItems.map((item) => {
                  const share = shareCell(item);
                  // 归属可能指向已删除的分类（旧数据），按「未分类」兜底。
                  const categoryName =
                    categoryNameById[assignments[item.slug] ?? ""] ?? "未分类";
                  // 当前账号自己发布的行：邮箱后标「（我）」。宿主的 `rel` 已经
                  // 区分 mine / shared，不用拿邮箱去比当前账号。
                  const ownerLabel =
                    item.rel === "mine"
                      ? `${item.ownerEmail ?? "—"}（我）`
                      : (item.ownerEmail ?? "—");
                  return (
                    <tr
                      key={item.slug}
                      data-testid={`artifacts-row-${item.slug}`}
                    >
                      {view === "custom" && (
                        <td className="artifacts-col-check">
                          <label className="artifacts-table-check">
                            <input
                              type="checkbox"
                              checked={selected.has(item.slug)}
                              aria-label={`选择 ${item.title}`}
                              onChange={() => toggleSelection(item.slug)}
                            />
                            <CheckIndicator />
                          </label>
                        </td>
                      )}
                      <td
                        className="artifacts-col-name"
                        data-renaming={
                          renaming?.slug === item.slug ? "true" : undefined
                        }
                      >
                        {renaming?.slug === item.slug ? (
                          /* 编辑态：图标 + 输入框（点开即全选，回车/失焦保存、
                             Esc 取消）。名称规则见 spec「重命名创作」。 */
                          <div className="artifacts-file-cell">
                            <FileCodeIcon
                              className="artifacts-file-icon"
                              aria-hidden
                            />
                            <input
                              className="artifacts-rename-input"
                              value={renaming.draft}
                              autoFocus
                              aria-label="创作名称"
                              aria-invalid={renaming.error ? true : undefined}
                              aria-busy={renaming.saving || undefined}
                              disabled={renaming.saving}
                              data-testid={`artifacts-rename-input-${item.slug}`}
                              onChange={(event) =>
                                setRenaming({
                                  ...renaming,
                                  draft: event.target.value,
                                  error: null,
                                })
                              }
                              onFocus={(event) => event.currentTarget.select()}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  commitRename();
                                } else if (event.key === "Escape") {
                                  event.preventDefault();
                                  cancelRename();
                                }
                              }}
                              onBlur={commitRename}
                            />
                            {/* 进行中与失败共用同一个浮层位置（二选一），
                                表格行高都不动。 */}
                            {renaming.saving ? (
                              <span
                                className="artifacts-rename-saving"
                                role="status"
                                data-testid="artifacts-rename-saving"
                              >
                                保存中…
                              </span>
                            ) : (
                              renaming.error && (
                                <span
                                  className="artifacts-rename-error"
                                  role="alert"
                                  data-testid="artifacts-rename-error"
                                >
                                  {renaming.error}
                                </span>
                              )
                            )}
                          </div>
                        ) : (
                          <div className="artifacts-file-cell">
                            <button
                              type="button"
                              className="artifacts-file-btn"
                              title={item.title}
                              onClick={() => handleOpenInBrowser(item.slug)}
                              data-testid={`artifacts-open-${item.slug}`}
                            >
                              <FileCodeIcon
                                className="artifacts-file-icon"
                                aria-hidden
                              />
                              <span className="artifacts-file-name">
                                {item.title}
                              </span>
                            </button>
                            {/* 只有自有行能改名（共享行没有写权限，不给入口）。 */}
                            {item.rel === "mine" && (
                              <button
                                type="button"
                                className="artifacts-rename-btn"
                                title="重命名"
                                aria-label={`重命名 ${item.title}`}
                                data-testid={`artifacts-rename-${item.slug}`}
                                onClick={() =>
                                  startRename(item.slug, item.title)
                                }
                              >
                                <PencilIcon className="artifacts-rename-icon" />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="artifacts-col-owner">
                        {/* 邮箱过长时只截邮箱，「（我）」不被省略号吃掉。 */}
                        <span className="artifacts-owner" title={ownerLabel}>
                          <span className="artifacts-owner-email">
                            {item.ownerEmail ?? "—"}
                          </span>
                          {item.rel === "mine" && (
                            <span className="artifacts-owner-self">（我）</span>
                          )}
                        </span>
                      </td>
                      <td className="artifacts-col-time">
                        {formatTime(item.updatedAt)}
                      </td>
                      <td className="artifacts-col-share">
                        <span
                          className="artifacts-share-text"
                          title={share.title}
                        >
                          {share.text}
                        </span>
                      </td>
                      {showCategoryColumn && (
                        <td className="artifacts-col-category">
                          <span
                            className="artifacts-category-name"
                            title={categoryName}
                          >
                            {categoryName}
                          </span>
                        </td>
                      )}
                      <RowActions
                        slug={item.slug}
                        onCopy={() => handleCopyLink(item.slug)}
                        onOpen={() => handleOpenInBrowser(item.slug)}
                        onShare={
                          item.rel === "mine"
                            ? () => setShareSlug(item.slug)
                            : undefined
                        }
                      />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {shareSlug && (
        <ShareDialog
          slug={shareSlug}
          postMessage={postMessage}
          onClose={() => setShareSlug(null)}
          onSaved={(mode, emails, message) => {
            applyShareToRow(shareSlug, mode, emails);
            showToast(message);
            setShareSlug(null);
          }}
          onRevokeRequest={(title) => {
            setShareSlug(null);
            setConfirm({ kind: "revoke", slug: shareSlug, title });
          }}
        />
      )}

      {confirm && (
        <Modal
          title="撤销发布"
          testid="artifacts-revoke-dialog"
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button
                type="button"
                className="artifacts-secondary-btn"
                onClick={() => setConfirm(null)}
              >
                取消
              </button>
              <button
                type="button"
                className="artifacts-danger-btn"
                onClick={() => {
                  const requestId = nextRequestId();
                  revokeRequestRef.current = requestId;
                  revokeTargetRef.current = confirm.slug;
                  postMessage({
                    command: "desktopArtifactRevoke",
                    requestId,
                    slug: confirm.slug,
                  });
                  setConfirm(null);
                }}
                data-testid="artifacts-revoke-confirm"
              >
                撤销发布
              </button>
            </>
          }
        >
          <p>
            「{confirm.title}」撤销后将不再出现在创作集里，分享链接失效；
            <strong>不会删除本地文件</strong>。
          </p>
        </Modal>
      )}

      {newOpen && (
        <Modal
          title="添加作品"
          testid="artifacts-new-dialog"
          onClose={() => setNewOpen(false)}
          footer={null}
          className="artifacts-modal-wide"
        >
          <p className="artifacts-hint">
            选择你要创建的类型，可通过预填的提示词修改并进行创作
          </p>
          <div className="artifacts-template-grid">
            {NEW_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className="artifacts-template-card"
                onClick={() => {
                  setNewOpen(false);
                  onNewFromTemplate(
                    `${template.prompt}${PUBLISH_AFTER_REVIEW}`,
                  );
                }}
                data-testid={`artifacts-template-${template.id}`}
              >
                <span className="artifacts-template-name">{template.name}</span>
                <span className="artifacts-template-desc">
                  {template.prompt}
                </span>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {categoryDialog && (
        <Modal
          title={
            categoryDialog.kind === "create"
              ? "添加分类"
              : categoryDialog.kind === "rename"
                ? "重命名分类"
                : // 设计师 2026-11-06 统一文案：主标题带分类名，副标题说明
                  // 原分类下的文件会被自动移出（不再让人先选迁移目标）。
                  `确定删除分类「${categoryDialog.name ?? ""}」吗？`
          }
          testid="artifacts-category-dialog"
          // 新建 / 重命名是单字段表单（compact 档 440 宽）；删除确认有多行说明、
          // 主标题还带分类名，走默认表单档。
          size={categoryDialog.kind === "delete" ? undefined : "compact"}
          onClose={() => setCategoryDialog(null)}
          footer={
            <>
              <button
                type="button"
                className="artifacts-secondary-btn"
                onClick={() => setCategoryDialog(null)}
              >
                取消
              </button>
              <button
                type="button"
                className={
                  categoryDialog.kind === "delete"
                    ? "artifacts-danger-btn"
                    : "artifacts-primary-btn"
                }
                onClick={handleCategorySubmit}
                data-testid="artifacts-category-confirm"
              >
                {categoryDialog.kind === "delete" ? "删除" : "确定"}
              </button>
            </>
          }
        >
          {categoryDialog.kind === "delete" ? (
            <div className="artifacts-form">
              <p>删除后，原分类下的文件将自动移出该分类</p>
              {categoryError && (
                <p className="artifacts-form-error">{categoryError}</p>
              )}
            </div>
          ) : (
            <div className="artifacts-form">
              {/* 1023 评论（她：「改创作集『重命名分类』」）：字段 + 错误行合成一组，
                  组内 4px、与说明行的 8px 拉开层级；错误出现时把它顶掉（同一位置只留
                  一条说明，不叠成「说明 + 错误」两行）。契约 :56 要求错误描边与文案
                  同为危险语义 ⇒ 输入框带 aria-invalid，描边走 --cc-color-danger。 */}
              <div className="artifacts-field-stack">
                <label className="artifacts-field">
                  <span>名称</span>
                  <input
                    value={categoryNameDraft}
                    maxLength={CATEGORY_NAME_MAX + 10}
                    autoFocus
                    // 设计师 2026-11-06：原来输入框下方那行说明（最多 N 个字、
                    // 名称不能重复）收进输入框里当占位符，弹窗少一行文案。
                    placeholder={`最多 ${CATEGORY_NAME_MAX} 个字，名称不能重复`}
                    aria-invalid={categoryError ? true : undefined}
                    aria-describedby={
                      categoryError
                        ? "artifacts-category-name-error"
                        : undefined
                    }
                    onChange={(event) => {
                      const value = event.target.value;
                      setCategoryNameDraft(value);
                      // 设计师 2026-11-06：「字数在输入时实时校验」——非空就立刻
                      // 给出超长 / 重名 / 保留名的理由；清空则不提示（空名的提醒
                      // 留给点「确定」时给，打字途中不刷存在感）。
                      setCategoryError(
                        value.trim()
                          ? validateCategoryName(
                              value,
                              categoryDialog?.kind === "rename"
                                ? categoryDialog.categoryId
                                : undefined,
                            )
                          : null,
                      );
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") handleCategorySubmit();
                    }}
                    data-testid="artifacts-category-name"
                  />
                </label>
                {categoryError && (
                  <p
                    className="artifacts-form-error"
                    id="artifacts-category-name-error"
                    role="alert"
                  >
                    {categoryError}
                  </p>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}

      {toast && (
        <div
          className={`artifacts-toast artifacts-toast--${toast.type}`}
          role="status"
          data-testid="artifacts-toast"
          style={toastCenterX !== null ? { left: toastCenterX } : undefined}
        >
          <ToastGlyph kind={toast.type} />
          <span className="artifacts-toast-message">{toast.message}</span>
        </div>
      )}
    </div>
  );
};

// ── 分享弹层 ──────────────────────────────────────────────────────────────

interface ShareDialogProps {
  slug: string;
  postMessage: (message: unknown) => void;
  onClose: () => void;
  onSaved: (mode: ArtifactShareMode, emails: string[], message: string) => void;
  onRevokeRequest: (title: string) => void;
}

const ShareDialog: React.FC<ShareDialogProps> = ({
  slug,
  postMessage,
  onClose,
  onSaved,
  onRevokeRequest,
}) => {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<ArtifactShareMode>("owner");
  const [pinnedVersion, setPinnedVersion] = useState<string>("");
  const [versions, setVersions] = useState<ArtifactVersionOption[]>([]);
  const [selectedMembers, setSelectedMembers] = useState<
    ArtifactMemberCandidate[]
  >([]);
  const [memberQuery, setMemberQuery] = useState("");
  const [candidates, setCandidates] = useState<ArtifactMemberCandidate[]>([]);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const viewRequestRef = useRef<string | null>(null);
  const memberRequestRef = useRef<string | null>(null);
  const saveRequestRef = useRef<string | null>(null);

  const requestMembers = useCallback(
    (query: string) => {
      const requestId = nextRequestId();
      memberRequestRef.current = requestId;
      setMemberError(null);
      postMessage({
        command: "desktopArtifactMembersSearch",
        requestId,
        search: query,
      });
    },
    [postMessage],
  );

  useEffect(() => {
    const requestId = nextRequestId();
    viewRequestRef.current = requestId;
    postMessage({ command: "desktopArtifactShareView", requestId, slug });
  }, [postMessage, slug]);

  useEffect(() => {
    if (mode !== "users") return;
    requestMembers(memberQuery);
  }, [mode, memberQuery, requestMembers]);

  useHostMessage((message) => {
    const data = message as { command?: string; requestId?: string };
    if (data.command === "desktopArtifactShareView") {
      if (data.requestId !== viewRequestRef.current) return;
      const payload = message as {
        title?: string;
        mode?: ArtifactShareMode;
        pinnedVersion?: number | null;
        sharedUsers?: ArtifactMemberCandidate[];
        versions?: ArtifactVersionOption[];
        error?: string;
      };
      setLoading(false);
      if (payload.error) {
        setLoadError(payload.error);
        return;
      }
      setTitle(payload.title ?? slug);
      setMode(payload.mode ?? "owner");
      setPinnedVersion(
        payload.pinnedVersion === null || payload.pinnedVersion === undefined
          ? ""
          : String(payload.pinnedVersion),
      );
      setVersions(payload.versions ?? []);
      setSelectedMembers(payload.sharedUsers ?? []);
      return;
    }
    if (data.command === "desktopArtifactMembersSearch") {
      if (data.requestId !== memberRequestRef.current) return;
      const payload = message as {
        members?: ArtifactMemberCandidate[];
        error?: string;
      };
      if (payload.error) {
        setMemberError(payload.error);
        return;
      }
      setMemberError(null);
      setCandidates(payload.members ?? []);
      return;
    }
    if (data.command === "desktopArtifactShareSave") {
      if (data.requestId !== saveRequestRef.current) return;
      const payload = message as {
        mode?: ArtifactShareMode;
        userIds?: string[];
        pinnedVersion?: number | null;
        error?: string;
        notFound?: boolean;
      };
      setSaving(false);
      if (payload.error) {
        setSaveError(payload.notFound ? "该创作已被撤销" : payload.error);
        return;
      }
      const emails = selectedMembers.map((m) => m.email);
      onSaved(payload.mode ?? mode, emails, "分享设置已保存");
      return;
    }
  });

  const toggleMember = (member: ArtifactMemberCandidate) => {
    setSelectedMembers((prev) =>
      prev.some((m) => m.userId === member.userId)
        ? prev.filter((m) => m.userId !== member.userId)
        : [...prev, member],
    );
  };

  const handleSave = () => {
    if (mode === "users" && selectedMembers.length === 0) {
      setSaveError("请至少选择 1 位用户");
      return;
    }
    setSaveError(null);
    setSaving(true);
    const requestId = nextRequestId();
    saveRequestRef.current = requestId;
    postMessage({
      command: "desktopArtifactShareSave",
      requestId,
      slug,
      mode,
      userIds:
        mode === "users" ? selectedMembers.map((m) => m.userId) : undefined,
      pinnedVersion: pinnedVersion === "" ? null : Number(pinnedVersion),
    });
  };

  return (
    <Modal
      title="分享"
      testid="artifacts-share-dialog"
      onClose={onClose}
      footer={
        <>
          <button
            type="button"
            className="artifacts-danger-link"
            onClick={() => onRevokeRequest(title || slug)}
            data-testid="artifacts-share-revoke"
          >
            撤销发布
          </button>
          <span className="artifacts-footer-spacer" />
          <button
            type="button"
            className="artifacts-secondary-btn"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            className="artifacts-primary-btn"
            onClick={handleSave}
            disabled={saving || loading || !!loadError}
            data-testid="artifacts-share-save"
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </>
      }
    >
      {/* 设计师 2026-10-23 预览评论：这组 radio「样式和间距也修改」⇒
                改为自绘指示器（原生 input 视觉隐藏、保留语义与键盘），规格取
                skill `references/common-components.md` §Choice controls
                「Desktop Radio and Checkbox」（16×16 环 / 选中实心 + 圆点）；
                inline 组只复用指示器几何与颜色，不带卡片内衬/描边/圆角。 */}
      {loading ? (
        <p>加载中…</p>
      ) : loadError ? (
        <p className="artifacts-form-error">{loadError}</p>
      ) : (
        <div className="artifacts-form">
          <p className="artifacts-share-title" title={title}>
            {title}
          </p>
          <fieldset className="artifacts-fieldset">
            <legend>分享给</legend>
            {(
              [
                ["owner", "仅自己"],
                ["users", "指定用户"],
                ["org", "企业成员"],
              ] as Array<[ArtifactShareMode, string]>
            ).map(([value, label]) => (
              <label key={value} className="artifacts-radio">
                <input
                  type="radio"
                  name="artifact-share-mode"
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  data-testid={`artifacts-share-mode-${value}`}
                />
                <span
                  className="artifacts-radio-indicator"
                  aria-hidden="true"
                />
                <span className="artifacts-radio-text">{label}</span>
              </label>
            ))}
          </fieldset>

          {mode === "users" && (
            <div
              className="artifacts-member-picker"
              data-testid="artifacts-member-picker"
            >
              {selectedMembers.length > 0 && (
                <div className="artifacts-selected-members">
                  {selectedMembers.map((member) => (
                    <span key={member.userId} className="artifacts-chip">
                      {member.email}
                      <button
                        type="button"
                        aria-label={`取消选择 ${member.email}`}
                        onClick={() => toggleMember(member)}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <SearchField
                value={memberQuery}
                onChange={setMemberQuery}
                placeholder="按邮箱搜索成员"
                testId="artifacts-member-search"
                clearTestId="artifacts-member-search-clear"
              />
              {memberError ? (
                <div className="artifacts-member-error">
                  <span>{memberError}</span>
                  <button
                    type="button"
                    className="artifacts-link-btn"
                    onClick={() => requestMembers(memberQuery)}
                  >
                    重试
                  </button>
                </div>
              ) : (
                <ul className="artifacts-member-list">
                  {candidates.length === 0 ? (
                    <li className="artifacts-member-empty">没有匹配的成员</li>
                  ) : (
                    candidates.map((member) => {
                      const checked = selectedMembers.some(
                        (m) => m.userId === member.userId,
                      );
                      return (
                        <li key={member.userId}>
                          <label className="artifacts-member-row">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleMember(member)}
                              data-testid={`artifacts-member-${member.userId}`}
                            />
                            {/* 设计师 2026-10-23 预览评论：成员多选框「样式也优化
                                一下」⇒ 按 skill `references/common-components.md`
                                §Choice controls「Desktop Radio and Checkbox」改成
                                16×16 自绘方框（1px 圆角方框 / 选中实心 + 对勾，
                                对勾 Light 1.7 / Dark 2.1 圆头），与上面那组 radio
                                同一套语言；原生 input 保留语义与键盘。 */}
                            <CheckIndicator />
                            <span className="artifacts-checkbox-text">
                              {member.email}
                            </span>
                          </label>
                        </li>
                      );
                    })
                  )}
                </ul>
              )}
            </div>
          )}

          <label className="artifacts-field">
            <span>查看者版本</span>
            <select
              value={pinnedVersion}
              onChange={(event) => setPinnedVersion(event.target.value)}
              data-testid="artifacts-share-version"
            >
              <option value="">最新版本</option>
              {versions.map((version) => (
                <option key={version.version} value={String(version.version)}>
                  {`v${version.version}${version.label ? ` · ${version.label}` : ""}`}
                </option>
              ))}
            </select>
          </label>

          {saveError && <p className="artifacts-form-error">{saveError}</p>}
        </div>
      )}
    </Modal>
  );
};

// ── 通用弹层 ──────────────────────────────────────────────────────────────

interface ModalProps {
  title: string;
  testid: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  onClose: () => void;
  /** 附加在 `.artifacts-modal` 上的类名（宽度等变体），默认不限。 */
  className?: string;
  /**
   * 尺寸档位，落到 `data-size`，宽度由 host-desktop.css 按档位给：`compact` = 只有
   * 一颗输入框的单字段表单（440 宽）。用属性而不是靠 `aria-label`（= 标题文案）
   * 匹配——标题一改，宽度就不会再静默漂回表单档的 560。
   */
  size?: "compact";
}

const Modal: React.FC<ModalProps> = ({
  title,
  testid,
  children,
  footer,
  onClose,
  className,
  size,
}) => (
  <div className="artifacts-modal-backdrop" onClick={onClose}>
    <div
      className={className ? `artifacts-modal ${className}` : "artifacts-modal"}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testid}
      data-size={size}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="artifacts-modal-header">
        <span>{title}</span>
        <button
          type="button"
          className="artifacts-modal-close"
          aria-label="关闭"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <div className="artifacts-modal-body">{children}</div>
      {footer && <div className="artifacts-modal-footer">{footer}</div>}
    </div>
  </div>
);

export default ArtifactsPage;
