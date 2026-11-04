/**
 * 破图兜底（spec `ui/markdown-images.md` 第二则用户故事）。
 *
 * markdown 正文是 marked + DOMPurify 产出的 HTML 字符串，走
 * `dangerouslySetInnerHTML`，没有可挂 `onError` 的 React 元素；而 `error` 事件
 * 不冒泡。所以唯一不用重写渲染管线的位置是：在正文容器上加**捕获阶段**的原生
 * 监听，命中后把 `<img>` 就地换成一段文字。
 *
 * 覆盖三类渲染期无法预判的失败：远端 404、被 CSP 拦下的 `http:`（桌面端
 * `img-src 'self' data: https:`）、坏掉的 data URL。本地路径不在此列——它们在
 * renderer 里就已经降级成路径链接，根本不产出 `<img>`。
 */

export const BROKEN_IMAGE_CLASS = "md-image-broken";

/** 已挂过监听的容器（ref 回调每次重渲染都会跑，别重复 addEventListener）。 */
const guarded = new WeakSet<HTMLElement>();

/** 地址里可读的文件名：去掉 query / hash，取最后一段。 */
const fileNameOf = (src: string): string => {
  const path = src.split(/[?#]/)[0] ?? "";
  return (path.split(/[\\/]/).pop() ?? "").trim();
};

const degrade = (img: HTMLImageElement): void => {
  const src = (img.getAttribute("src") ?? "").trim();
  const alt = (img.getAttribute("alt") ?? "").trim();
  const isDataUrl = /^data:/i.test(src);
  // 文案阶梯：alt → 地址里的文件名 → 「图片」。data URL 没有有意义的文件名。
  const label = alt || (isDataUrl ? "" : fileNameOf(src)) || "图片";

  const span = document.createElement("span");
  span.className = BROKEN_IMAGE_CLASS;
  span.textContent = label;
  // data: 地址可能是几 MB 的 base64，不放进悬停提示。
  if (src && !isDataUrl) span.title = src;

  img.replaceWith(span);
};

const onImageError = (event: Event): void => {
  const target = event.target;
  // `error` 不冒泡但会走捕获链，所以容器还可能收到别处冒上来的事件。
  if (!(target instanceof HTMLImageElement)) return;
  // 解不出宽度 = 这张图拿不到。CSP 拦截与 404 走到这里时是同一个状态，
  // 所以兜底不需要区分「被策略拦下」和「地址不存在」。
  if (target.naturalWidth > 0) return;
  degrade(target);
};

/**
 * 挂到正文容器上的 ref 回调：同一元素只挂一次监听。
 *
 * 替换是纯 DOM 操作、不进 React 状态，所以容器下次重渲染会重建 `<img>` 并重新
 * 尝试加载——流式期间会短暂重试，内容 settle 后稳定。
 */
export const attachBrokenImageFallback = (
  container: HTMLElement | null,
): void => {
  if (!container || guarded.has(container)) return;
  guarded.add(container);
  container.addEventListener("error", onImageError, true);
};
