import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error type error without @types/node package
import process from "node:process";
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
/**
 * Общий вход в разработке: `tauri dev` и браузер с мобильной версией отдают сюда токены и забирают их
 * (`devPullTokens` в src/api/client.ts). Хранится только в памяти дев-сервера, слушающего 127.0.0.1.
 */
function devAuthBridge(): Plugin {
  let shared: { access: string | null; refresh: string | null; set: boolean } = { access: null, refresh: null, set: false };
  return {
    name: "dev-auth-bridge",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/__dev/auth", (req, res) => {
        if (req.method === "POST") {
          let body = "";
          req.on("data", (chunk) => (body += chunk));
          req.on("end", () => {
            try {
              const { access, refresh } = JSON.parse(body || "{}");
              shared = { access: access || null, refresh: refresh || null, set: true };
              res.statusCode = 204;
            } catch {
              res.statusCode = 400;
            }
            res.end();
          });
          return;
        }
        res.setHeader("Content-Type", "application/json");
        res.setHeader("Cache-Control", "no-store");
        res.end(JSON.stringify(shared));
      });
    },
  };
}

export default defineConfig(() => ({
  plugins: [react(), devAuthBridge()],

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    // Без адреса Vite слушает только IPv6 [::1], а Tauri ждёт IPv4 — на этом компьютере они не встречаются
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
    proxy: {
      "/nh-api": {
        target: "https://nhentai.net",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/nh-api/, "/api/v2"),
      },
    },
  },
}));
