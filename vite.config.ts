import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: fileURLToPath(new URL("./frontend", import.meta.url)),
  envDir: projectRoot,
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "../dist-web",
    emptyOutDir: true,
  },
  server: {
    host: "0.0.0.0",
    port: 8000,
    strictPort: true,
  },
});
