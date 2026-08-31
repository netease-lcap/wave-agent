/**
 * 原型 vite build 时替代 mermaid 的空桩（把 ~2MB 图表库从构建产物里裁掉）。
 *
 * dev server 不注入此别名（dev 保留真实 mermaid）；build 产物暂不支持
 * mermaid 图表——MermaidRenderer 只用了 mermaid.initialize / mermaid.render
 * 两个成员：initialize 在 MermaidRenderer 里被 try/catch 吞掉（保持静默），
 * render 抛出的错误会渲染进消息里的 .mermaid-error 区域（清晰提示）。
 */
export default {
  initialize: () => {},
  render: () => {
    throw new Error(
      "mermaid 图表在原型构建产物中暂不支持（体积考虑）。dev 预览可用真实图表。",
    );
  },
};
