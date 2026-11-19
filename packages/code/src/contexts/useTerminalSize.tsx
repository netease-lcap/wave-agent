import React, { createContext, useContext } from "react";
import { useStdout, useWindowSize } from "ink";

export interface TerminalSize {
  columns: number;
  rows: number;
}

const TerminalSizeContext = createContext<TerminalSize | undefined>(undefined);

/**
 * 终端尺寸的**唯一**订阅点。
 *
 * ink 的 `useWindowSize()` 是每个组件实例各挂一个 `stdout.on("resize")`（不是
 * 共享单例），常驻组件一多就撞 Node 的 10 个 listener 上限，在终端上打一行
 * `MaxListenersExceededWarning` —— 那行插在 UI 中间，还会被当成真泄漏去追。
 * 所以整个界面只在 `App` 这一层挂一个，其余组件读 context。
 */
export const TerminalSizeProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const size = useWindowSize();
  return (
    <TerminalSizeContext.Provider value={size}>
      {children}
    </TerminalSizeContext.Provider>
  );
};

/**
 * 读终端尺寸（`{ columns, rows }`，与 ink 的 `useWindowSize` 同一个值）。
 *
 * 没有 provider 时（组件被单独挂载，比如单测里只 `render(<X/>)`）按 ink 的同一条
 * 规则现读一次 ink 手里的 stdout，**只是不订阅 `resize`** —— 真机永远走 provider，
 * 这里的差别只在「终端被拖动时会不会自己重画」。
 */
export function useTerminalSize(): TerminalSize {
  const fromProvider = useContext(TerminalSizeContext);
  const { stdout } = useStdout();
  if (fromProvider !== undefined) return fromProvider;
  // ink 把 `stdout` 声明成 `WritableStream`，运行时就是那根 TTY 流（`columns` /
  // `rows` 在上面，与 `useWindowSize` 读的是同一份）。
  const stream = stdout as unknown as { columns?: number; rows?: number };
  return { columns: stream.columns ?? 80, rows: stream.rows ?? 24 };
}
