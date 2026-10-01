import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [inspectAttr(), react()],
  server: {
    // 固定空闲端口 7100（已用 netstat 确认未占用）；CLI --port/--host 参数可透传覆盖
    port: 7100,
    host: true,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src/ui"),
    },
  },
});
