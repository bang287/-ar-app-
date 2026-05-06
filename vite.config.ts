import { execSync } from "node:child_process";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const readGitVersion = () => {
  if (process.env.COMMIT_REF) return process.env.COMMIT_REF.slice(0, 7);
  if (process.env.DEPLOY_ID) return `deploy-${process.env.DEPLOY_ID.slice(0, 7)}`;
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "local";
  }
};

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(readGitVersion()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  server: {
    proxy: {
      "/api": "http://localhost:8787",
    },
  },
});
