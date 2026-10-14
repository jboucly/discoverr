import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5175,
    // En dev, l'API Nest tourne à côté (npm run start dans api/).
    proxy: { "/api": "http://localhost:3000" },
  },
});
