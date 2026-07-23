import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  use: {
    baseURL: "http://localhost:3100",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /mobile\.spec\.ts/,
      use: { viewport: { width: 1440, height: 900 } },
    },
    {
      // Phone layout guardrails: the mobile specs assert the collapsed
      // header, bottom sheets, and no-horizontal-overflow invariants.
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "npm run dev -- -p 3100",
    url: "http://localhost:3100",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
