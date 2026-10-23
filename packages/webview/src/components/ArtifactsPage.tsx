import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ArtifactsIcon,
  MoreIcon,
  QueueEditIcon,
  QueueTrashIcon,
  SidebarExpandIcon,
} from "./HeaderIcons";
import { Tooltip } from "./Tooltip";
import { ToastGlyph } from "./ToastStack";
import { useHostMessage } from "../utils/useHostMessage";
import { useRovingMenu } from "../utils/useRovingMenu";
import { useClickOutside } from "../utils/useClickOutside";
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

const CATEGORY_NAME_MAX = 20;
/** 分类名不能与默认视图的分组同名（spec 场景 2 的保留名）。 */
const RESERVED_CATEGORY_NAMES = ["我发布的", "共享给我的", "全部"];

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

  // 与会话行菜单同宽同位置规则：右对齐触发按钮，并夹在视口内。
  const menuWidth = 148;
  const left = Math.max(
    8,
    Math.min(anchorRect.right - menuWidth, window.innerWidth - menuWidth - 8),
  );
  return (
    <div
      ref={menuRef}
      className="desktop-session-menu"
      role="menu"
      style={{
        position: "fixed",
        top: anchorRect.bottom + 4,
        left,
        width: menuWidth,
      }}
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
  items: Array<{ key: string; label: string; testId: string; run: () => void }>;
  testId: string;
  onClose: () => void;
  /** 面板宽：表格操作列 148（短动作），契约标准面板菜单 200。 */
  width?: number;
}> = ({ anchorRect, triggerRef, items, testId, onClose, width = 148 }) => {
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
  // 再按视口夹一次，保证不越界。
  const menuWidth = width;
  const left = Math.max(
    8,
    Math.min(anchorRect.left, window.innerWidth - menuWidth - 8),
  );
  // 必须挂到 body：操作列是 `position: sticky` + `z-index: 1` 的单元格，
  // 菜单若留在单元格内部，会被后面几行同样带背景的 sticky 单元格盖住
  // （浅色档实测只露出白框、文字全被压掉）。
  return createPortal(
    <div
      ref={menuRef}
      className="desktop-session-menu"
      role="menu"
      style={{
        position: "fixed",
        top: anchorRect.bottom + 4,
        left,
        width: menuWidth,
      }}
      data-testid={testId}
    >
      {items.map((item, index) => (
        <div
          key={item.key}
          className="desktop-session-menu-item"
          role="menuitem"
          {...getItemProps(index)}
          data-testid={item.testId}
        >
          <span>{item.label}</span>
        </div>
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
      // 没有布局的环境（jsdom 单测：clientWidth 恒 0）不做判定 —— 按「放得下」
      // 渲染原样三颗按钮，测试与无布局场景都不会平白把动作藏进菜单。
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

  const [view, setView] = useState<ArtifactsView>("default");
  const [defaultTab, setDefaultTab] = useState<DefaultTab>("mine");
  const [activeCategoryId, setActiveCategoryId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 「归类到…」下拉：null = 收起；非 null = 触发键的 rect（菜单左缘据此对齐按钮左缘）。
  const [batchAnchor, setBatchAnchor] = useState<DOMRect | null>(null);
  const batchTriggerRef = useRef<HTMLButtonElement>(null);

  const [categories, setCategories] = useState<ArtifactCategory[]>([]);
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const [categoryDialog, setCategoryDialog] =
    useState<CategoryDialogState | null>(null);
  const [categoryNameDraft, setCategoryNameDraft] = useState("");
  const [categoryMoveTarget, setCategoryMoveTarget] = useState<string>("");
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
  const categoriesRequestRef = useRef<string | null>(null);
  const categoriesSaveRequestRef = useRef<string | null>(null);
  const revokeRequestRef = useRef<string | null>(null);
  const revokeTargetRef = useRef<string | null>(null);
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
          setAuthRequired(true);
          setError(null);
          return;
        }
        setAuthRequired(false);
        if (payload.error) {
          // 已渲染的数据不清空（spec 场景 7）：只给出错误与重试。
          setError(payload.error);
          return;
        }
        setError(null);
        setItems(payload.items ?? []);
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

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of items) {
      const cat = assignments[item.slug];
      if (cat) counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  }, [items, assignments]);

  const emptyText =
    view === "default"
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
    setCategoryMoveTarget("");
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
      const affected = Object.entries(assignments).filter(
        ([, value]) => value === categoryId,
      );
      const nextCategories = categories.filter((c) => c.id !== categoryId);
      const nextAssignments = { ...assignments };
      if (affected.length > 0) {
        if (!categoryMoveTarget) {
          setCategoryError("请选择要把这些文件移入的分类");
          return;
        }
        for (const [slug] of affected) {
          if (categoryMoveTarget === "__none__") delete nextAssignments[slug];
          else nextAssignments[slug] = categoryMoveTarget;
        }
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
    categoryMoveTarget,
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

  /** 批量条下拉的选项：各分类 + 「移出分类」（沿用原 testid，走查脚本不用改）。 */
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
        label: "移出分类",
        testId: "artifacts-batch-remove",
        run: () => handleBatchAssign(null),
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
        <div className="artifacts-header">
          <div className="artifacts-header-left">
            <div className="artifacts-segment" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={view === "default"}
                className={`artifacts-segment-btn${view === "default" ? " is-active" : ""}`}
                onClick={() => {
                  setView("default");
                  setSelected(new Set());
                }}
                data-testid="artifacts-view-default"
              >
                默认视图
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === "custom"}
                className={`artifacts-segment-btn${view === "custom" ? " is-active" : ""}`}
                onClick={() => setView("custom")}
                data-testid="artifacts-view-custom"
              >
                自定义视图
              </button>
            </div>
            {view === "custom" && (
              <button
                type="button"
                className="artifacts-link-btn"
                onClick={() => openCategoryDialog({ kind: "create" })}
                data-testid="artifacts-new-category"
              >
                新建分类
              </button>
            )}
            <button
              type="button"
              className="artifacts-refresh-btn"
              onClick={() => requestList(true)}
              disabled={refreshing || loading}
              data-testid="artifacts-refresh"
            >
              {refreshing ? "刷新中…" : "刷新"}
            </button>
          </div>
          <div className="artifacts-header-right">
            <SearchField
              value={search}
              onChange={setSearch}
              placeholder="按文件名搜索"
              testId="artifacts-search"
              clearTestId="artifacts-search-clear"
            />
            <button
              type="button"
              className="artifacts-primary-btn"
              onClick={() => setNewOpen(true)}
              data-testid="artifacts-new"
            >
              新建
            </button>
          </div>
        </div>

        <div className="artifacts-body">
          <aside className="artifacts-nav" data-testid="artifacts-nav">
            {view === "default" ? (
              <>
                <button
                  type="button"
                  className={`artifacts-nav-item${defaultTab === "mine" ? " is-active" : ""}`}
                  onClick={() => {
                    setDefaultTab("mine");
                    setSelected(new Set());
                  }}
                  data-testid="artifacts-tab-mine"
                >
                  我发布的
                </button>
                <button
                  type="button"
                  className={`artifacts-nav-item${defaultTab === "shared" ? " is-active" : ""}`}
                  onClick={() => {
                    setDefaultTab("shared");
                    setSelected(new Set());
                  }}
                  data-testid="artifacts-tab-shared"
                >
                  共享给我的
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className={`artifacts-nav-item${activeCategoryId === null ? " is-active" : ""}`}
                  onClick={() => {
                    setActiveCategoryId(null);
                    setSelected(new Set());
                  }}
                  data-testid="artifacts-category-all"
                >
                  全部
                </button>
                {categories.map((category) => (
                  <div key={category.id} className="artifacts-nav-row">
                    <button
                      type="button"
                      className={`artifacts-nav-item${activeCategoryId === category.id ? " is-active" : ""}`}
                      onClick={() => {
                        setActiveCategoryId(category.id);
                        setSelected(new Set());
                      }}
                      data-testid={`artifacts-category-${category.id}`}
                    >
                      {category.name}
                      <span className="artifacts-nav-count">
                        {categoryCounts[category.id] ?? 0}
                      </span>
                    </button>
                    {/* 1022 评论：「编辑和删除的交互参考」侧栏会话行 ——
                        两个文字按钮换成一颗「⋯」（`.desktop-session-more-btn`
                        同款 24×24、行右 8px、hover 淡入），动作收进下拉菜单。 */}
                    <button
                      type="button"
                      ref={getCategoryMoreRef(category.id)}
                      className="artifacts-nav-more"
                      title="更多操作"
                      aria-label={`分类「${category.name}」更多操作`}
                      aria-haspopup="menu"
                      aria-expanded={
                        categoryMenu?.categoryId === category.id || undefined
                      }
                      // 会话行靠 ←/→ 从行本身进入这个按钮（那里有漫游焦点管理）；
                      // 创作集导航没有那套漫游 ⇒ 保留 Tab 可达，否则键盘用户
                      // 完全打不开菜单（旧的两颗文字按钮是 display:none，同样不可达，
                      // 这里顺带补上）。
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
                      <MoreIcon className="artifacts-nav-more-icon" />
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
              </>
            )}
          </aside>

          <div className="artifacts-main">
            {view === "custom" && selected.size > 0 && (
              <div className="artifacts-batch" data-testid="artifacts-batch">
                <span>已选 {selected.size} 项</span>
                {/* 1023 评论（点 `div.artifacts-batch-actions`「归类到… 取消选择」）：
                    「这里一个用填充按钮，一个用线型按钮，不要出现这种蓝色按钮」
                    ⇒ 归类到… = 填充主键（action-primary + action-primary-text），
                    取消选择 = 线型次键（透明底 + border-light + text-primary，
                    hover fill-hover）；原来那颗蓝色文字链（--vscode-textLink-foreground
                    浅 #0069CC / 深 #4DAAFC）去掉，本页不再有蓝色按钮。 */}
                <div className="artifacts-batch-actions">
                  <button
                    type="button"
                    ref={batchTriggerRef}
                    className="artifacts-primary-btn"
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setBatchAnchor((prev) => (prev ? null : rect));
                    }}
                    aria-haspopup="menu"
                    aria-expanded={batchAnchor ? true : undefined}
                    data-testid="artifacts-batch-assign"
                  >
                    归类到…
                  </button>
                  <button
                    type="button"
                    className="artifacts-secondary-btn"
                    onClick={() => setSelected(new Set())}
                  >
                    取消选择
                  </button>
                  {/* 1023 评论（点 `div.artifacts-menu`）：「这里下拉要符合规范，且左侧
                      要和按钮对齐」⇒ 换掉本页自写的 `.artifacts-menu`（r8 / pad 4 /
                      12px 项 / 右对齐），改用与同页分类行、操作列共用的那一份
                      `.desktop-session-menu` 皮肤（契约 §Menus：r12 / pad 8 /
                      `--cc-shadow-popover` / 项 28px·14px·400·r6，hover fill-hover），
                      并复用同一套定位：左缘对齐触发键、按视口夹边、Esc / 点外关闭。
                      宽度取契约的标准面板宽 200。 */}
                  {batchAnchor && (
                    <RowActionsMenu
                      anchorRect={batchAnchor}
                      triggerRef={batchTriggerRef}
                      items={batchMenuItems}
                      testId="artifacts-batch-menu"
                      width={200}
                      onClose={() => setBatchAnchor(null)}
                    />
                  )}
                </div>
              </div>
            )}

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
              <table className="artifacts-table" data-testid="artifacts-table">
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
                    <th className="artifacts-col-actions">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {scopeItems.map((item) => {
                    const share = shareCell(item);
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
                        <td className="artifacts-col-name">
                          <button
                            type="button"
                            className="artifacts-file-btn"
                            title={item.title}
                            onClick={() => handleOpenInBrowser(item.slug)}
                            data-testid={`artifacts-open-${item.slug}`}
                          >
                            <span
                              className="codicon codicon-file-code"
                              aria-hidden="true"
                            />
                            <span className="artifacts-file-name">
                              {item.title}
                            </span>
                          </button>
                        </td>
                        <td className="artifacts-col-owner">
                          <span title={item.ownerEmail ?? ""}>
                            {item.ownerEmail ?? "—"}
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
          title="新建"
          testid="artifacts-new-dialog"
          onClose={() => setNewOpen(false)}
          footer={null}
        >
          <p className="artifacts-hint">
            选择你要创建的类型，跳转到对话页并预填提示词。
          </p>
          <div className="artifacts-template-grid">
            {NEW_TEMPLATES.map((template) => (
              <button
                key={template.id}
                type="button"
                className="artifacts-template-card"
                onClick={() => {
                  setNewOpen(false);
                  onNewFromTemplate(template.prompt);
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
              ? "新建分类"
              : categoryDialog.kind === "rename"
                ? "重命名分类"
                : "删除分类"
          }
          testid="artifacts-category-dialog"
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
              <p>
                {categoryDialog.name !== undefined
                  ? `删除分类「${categoryDialog.name}」后不可恢复。`
                  : "删除分类后不可恢复。"}
              </p>
              {(categoryCounts[categoryDialog.categoryId ?? ""] ?? 0) > 0 && (
                <>
                  <p>
                    该分类下有{" "}
                    {categoryCounts[categoryDialog.categoryId ?? ""] ?? 0}{" "}
                    个文件，请先把它们移入另一个分类。
                  </p>
                  <label className="artifacts-field">
                    <span>移入</span>
                    <select
                      value={categoryMoveTarget}
                      onChange={(event) =>
                        setCategoryMoveTarget(event.target.value)
                      }
                      data-testid="artifacts-category-move-target"
                    >
                      <option value="">请选择分类</option>
                      {categories
                        .filter((c) => c.id !== categoryDialog.categoryId)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      <option value="__none__">移出分类（全部）</option>
                    </select>
                  </label>
                </>
              )}
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
                    aria-invalid={categoryError ? true : undefined}
                    aria-describedby={
                      categoryError ? "artifacts-category-name-error" : undefined
                    }
                    onChange={(event) => {
                      setCategoryNameDraft(event.target.value);
                      setCategoryError(null);
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
              {!categoryError && (
                <p className="artifacts-hint">
                  最多 {CATEGORY_NAME_MAX} 个字，名称不能重复。
                </p>
              )}
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
}

const Modal: React.FC<ModalProps> = ({
  title,
  testid,
  children,
  footer,
  onClose,
}) => (
  <div className="artifacts-modal-backdrop" onClick={onClose}>
    <div
      className="artifacts-modal"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid={testid}
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
