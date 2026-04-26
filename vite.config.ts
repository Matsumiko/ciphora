import react from "@vitejs/plugin-react";
import tailwind from "tailwindcss";
import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const tauriDevHost = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  publicDir: "public",
  base: "/",
  envPrefix: ["VITE_", "TAURI_"],
  server: {
    host: tauriDevHost || "127.0.0.1",
    port: 5173,
    strictPort: true,
    hmr: tauriDevHost
      ? {
          protocol: "ws",
          host: tauriDevHost,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**", "**/android/**"],
    },
  },
  css: {
    postcss: {
      plugins: [tailwind()],
    },
  },
  resolve: {
    preserveSymlinks: true,
    alias: {
      "@": path.resolve(rootDir, "src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@phosphor-icons/")) return "icons";
          if (id.includes("node_modules/@serenity-kit/opaque")) return "opaque";
          if (id.includes("node_modules/@libsql/") || id.includes("node_modules/@libsql\\") || id.includes("node_modules/libsql")) return "libsql";
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom") || id.includes("node_modules/react-router-dom")) return "react-vendor";
          if (id.includes("/src/lib/account-client.ts") || id.includes("\\src\\lib\\account-client.ts")) return "account-client";
          if (
            id.includes("/src/lib/turso-vault-sync.ts")
            || id.includes("\\src\\lib\\turso-vault-sync.ts")
            || id.includes("/src/lib/d1-bridge-sync.ts")
            || id.includes("\\src\\lib\\d1-bridge-sync.ts")
            || id.includes("/src/lib/d1-direct-sync.ts")
            || id.includes("\\src\\lib\\d1-direct-sync.ts")
          ) return "sync-providers";
        },
      },
    },
  },
});
