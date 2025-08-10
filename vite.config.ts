import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// 读取 package.json 并生成外部依赖列表
const packageJson = JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf-8'));
const dependencies = Object.keys(packageJson.dependencies || {}).filter(
  (dep) => !packageJson.dependencies[dep].startsWith('workspace:'),
);

// 生成外部依赖匹配模式，支持子路径如 'yargs/helpers'
const createExternalPattern = (deps: string[]) => {
  return (id: string) => {
    // 检查是否匹配依赖包（支持子路径）
    return deps.some((dep) => {
      // 精确匹配包名
      if (id === dep) return true;
      // 匹配包的子路径，如 yargs/helpers
      if (id.startsWith(dep + '/')) return true;
      return false;
    });
  };
};

export default defineConfig(({ command, mode }) => {
  // 检查是否是 watch 模式（通过命令行参数）
  const isWatchMode = process.argv.includes('--watch');

  // watch 模式或开发模式下不压缩
  const shouldMinify = command === 'build' && mode !== 'development' && !isWatchMode;

  // 可选：简化的日志输出
  if (isWatchMode || mode === 'development') {
    console.log(`🚀 Development mode: minification disabled`);
  }

  return {
    test: {
      globals: true,
      environment: 'node',
      include: ['tests/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
      exclude: ['node_modules', 'dist'],
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      // 开启后无需external nodejs内置模块了，也无需 define process.env 了
      ssr: true,
      target: 'node16',
      // dev 模式（watch）时不压缩，build 模式时压缩混淆
      minify: shouldMinify ? 'esbuild' : false,
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/index.ts'),
        },
        external: createExternalPattern(dependencies),
        output: {
          format: 'es',
          entryFileNames: '[name].js',
        },
      },
    },
  };
});
