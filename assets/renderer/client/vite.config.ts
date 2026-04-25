/**
 * 模块：Renderer Vite 构建配置
 *
 * 运行逻辑：
 * - 将 `assets/renderer/client` 作为前端 root。
 * - 构建产物输出到 `dist/live-renderer`，由 LiveRendererServer 静态服务。
 */
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  root: __dirname,
  publicDir: false,
  build: {
    outDir: path.resolve(__dirname, "../../../dist/live-renderer"),
    emptyOutDir: true,
    target: "es2022",
  },
});
