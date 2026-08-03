import { readFileSync } from "node:fs";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

const API_TARGET = process.env.API_TARGET ?? "http://127.0.0.1:8787";

// 版本号从 package.json 注入，避免在界面里硬编码后忘记同步
const { version } = JSON.parse(readFileSync(new URL("package.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    host: true, // 让同 WiFi 下的 iPhone 能连开发服务器
    port: 5173,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
        // SSE 必须关掉压缩缓冲
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (proxyRes.headers["content-type"]?.includes("text/event-stream")) {
              delete proxyRes.headers["content-encoding"];
            }
          });
        },
      },
    },
  },
});
