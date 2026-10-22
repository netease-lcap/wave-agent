import React, { useState } from "react";
import { QUICK_START_CATEGORIES } from "../utils/quickStartTemplates";
import "../styles/QuickStartTemplates.css";

interface QuickStartTemplatesProps {
  /** 点二级分类：把整段模板填进输入框（调用方走 MessageInput 的 loadDraft）。 */
  onApplyTemplate: (prompt: string) => void;
}

/**
 * 空态页「快捷方式」区：一级 12 个开发场景分类 ⇄ 二级「返回 + 该分类的模板」。
 *
 * 整行替换而不是叠一块面板：子分类紧跟着所点分类出现，返回胶囊即当前分类本身
 * （与侧栏选中行同一套选中底），所以切层级时整行高度不变、页面不位移。
 *
 * 位置在输入卡下方（设计师 1022 评论「这块放在输入框下面」）；左右限宽与输入卡
 * 同档，两条边线对齐。
 *
 * 只在空态（尚无消息）出现——它是「第一次怎么开口」的入口，有对话历史后再常驻
 * 只会占掉消息区高度。
 */
export const QuickStartTemplates: React.FC<QuickStartTemplatesProps> = ({
  onApplyTemplate,
}) => {
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = QUICK_START_CATEGORIES.find((c) => c.id === activeId) ?? null;

  return (
    <div className="quick-start" data-testid="quick-start">
      <div className="quick-start-row">
        {active === null
          ? QUICK_START_CATEGORIES.map((category) => (
              <button
                key={category.id}
                type="button"
                className="quick-start-cat"
                data-testid={`quick-start-cat-${category.id}`}
                onClick={() => setActiveId(category.id)}
              >
                {category.label}
              </button>
            ))
          : [
              <button
                key="back"
                type="button"
                className="quick-start-back"
                data-testid="quick-start-back"
                aria-label={`返回分类列表（当前：${active.label}）`}
                onClick={() => setActiveId(null)}
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                  <path
                    d="M10 3.5 5.5 8l4.5 4.5"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span>{active.label}</span>
              </button>,
              <span
                key="divider"
                className="quick-start-divider"
                aria-hidden="true"
              />,
              ...active.templates.map((template) => (
                <button
                  key={template.label}
                  type="button"
                  className="quick-start-sub"
                  data-testid="quick-start-sub"
                  onClick={() => onApplyTemplate(template.prompt)}
                >
                  {template.label}
                </button>
              )),
            ]}
      </div>
    </div>
  );
};

export default QuickStartTemplates;
