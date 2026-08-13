import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { llmDevProxyMiddleware } from "./server/llm-dev-proxy.mjs";

function medprismLlmDevProxy(): Plugin {
  return {
    name: "medprism-llm-dev-proxy",
    configureServer(server) {
      server.middlewares.use("/__medprism/llm", (req, res, next) => {
        void llmDevProxyMiddleware(req, res).catch(next);
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // Relative base so Electron can load dist/ via file://
  base: "./",
  plugins: [react(), medprismLlmDevProxy()],
  server: {
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8788",
        changeOrigin: true,
      },
    },
  },
});
