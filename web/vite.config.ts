import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5175,
    // In dev, the Nest API runs alongside (npm run start in api/).
    proxy: { "/api": "http://localhost:3000" },
  },
});
