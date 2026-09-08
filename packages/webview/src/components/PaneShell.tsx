import React from "react";

export interface PaneShellProps {
  /** aside 附加的 pane 类型类（如 "diff-pane"）；预览 pane 无附加类。 */
  kind?: string;
  dataTestId: string;
  width: number;
  /** aside ref（PreviewPane 拖拽把手几何测量用）。 */
  asideRef?: React.Ref<HTMLElement>;
  toolbarRef?: React.Ref<HTMLDivElement>;
  toolbar: React.ReactNode;
  /** 工具栏与内容区之间的可选元素（FilePane 搜索弹层 / PreviewPane 拾取
   * 不支持提示——两类面板的 body 之前还有一层与工具栏同级的浮层）。 */
  betweenToolbarAndBody?: React.ReactNode;
  /** body 类名（diff-pane-body / terminal-pane-body / preview-pane-body …）。 */
  bodyClassName: string;
  bodyTestId?: string;
  bodyRef?: React.Ref<HTMLDivElement>;
  children: React.ReactNode;
}

/**
 * 桌面右面板通用骨架：`aside.preview-pane > .preview-pane-inner >
 * (.preview-pane-toolbar + 可选浮层 + body)`。DOM 结构与类名和各 Pane 原本
 * 手写的结构一致（视觉零变化、测试断言零变化）。
 */
export function PaneShell({
  kind,
  dataTestId,
  width,
  asideRef,
  toolbarRef,
  toolbar,
  betweenToolbarAndBody,
  bodyClassName,
  bodyTestId,
  bodyRef,
  children,
}: PaneShellProps) {
  return (
    <aside
      ref={asideRef}
      className={`preview-pane${kind ? ` ${kind}` : ""}`}
      style={{ width }}
      data-testid={dataTestId}
    >
      <div className="preview-pane-inner">
        <div className="preview-pane-toolbar" ref={toolbarRef}>
          {toolbar}
        </div>
        {betweenToolbarAndBody}
        <div className={bodyClassName} ref={bodyRef} data-testid={bodyTestId}>
          {children}
        </div>
      </div>
    </aside>
  );
}

export interface PanePlaceholderProps {
  /** 附加类（如 "plan-pane-placeholder-empty"）。 */
  className?: string;
  children: React.ReactNode;
}

/** 面板空态/加载占位（`.desktop-panel-placeholder`，图标+文案竖排居中）。 */
export function PanePlaceholder({ className, children }: PanePlaceholderProps) {
  return (
    <div
      className={`desktop-panel-placeholder${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}
