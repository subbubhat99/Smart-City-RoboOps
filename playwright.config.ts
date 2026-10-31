import { defineConfig } from "@playwright/test";
import path from "node:path";

export default defineConfig({
  testDir: "./tests/browser",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:8765",
    channel:
      process.env.ROBOOPS_BROWSER_CHANNEL ||
      (process.platform === "win32" ? "msedge" : "chromium"),
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command:
      "uv run --no-project --directory backend --with-requirements requirements.txt uvicorn app.main:app --host 127.0.0.1 --port 8765",
    url: "http://127.0.0.1:8765/api/health",
    env: {
      ROBOOPS_DATABASE: path.resolve("backend/data/browser-tests.sqlite3"),
      ROBOOPS_OPERATOR_TOKEN: "browser-test-session",
    },
    reuseExistingServer: false,
  },
});
