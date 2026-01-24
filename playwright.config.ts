import { defineConfig } from "@playwright/test";

const PORT = process.env.CONSENSUS_PORT || "8790";

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    headless: true,
  },
  webServer: {
    command: `CONSENSUS_PORT=${PORT} CONSENSUS_HOST=127.0.0.1 npm run dev`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: true,
  },
});
