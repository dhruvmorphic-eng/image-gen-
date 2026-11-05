import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://localhost:3107",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "node --import tsx scripts/ui-fixtures.ts && npm run start -- --port 3107",
    url: "http://localhost:3107",
    reuseExistingServer: false,
    timeout: 120000,
    env: {
      APP_ORIGIN: "http://localhost:3107",
      DATABASE_PATH: "./test-results/ui.sqlite",
      OPENAI_API_KEY: "",
    },
  },
});
