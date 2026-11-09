// Global module declarations for asset imports processed by esbuild.
// Required since TS 6/7 enable noUncheckedSideEffectImports by default.
declare module "*.css";

// `?raw` imports (the CSS contract guards under tests/ read a stylesheet as
// text). Vite inlines the file contents; this only teaches TS the shape.
declare module "*?raw" {
  const content: string;
  export default content;
}
