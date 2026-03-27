// @ts-check
const { defineConfig } = require("@playwright/test");

/**
 * Visual-regression config for Design Token Forge component demos.
 *
 * Usage:
 *   npm run vrt              — run all visual tests
 *   npm run vrt:update       — update baselines after intentional changes
 *   npm run vrt -- --ui      — interactive viewer
 *
 * Baselines live in tests/visual/__screenshots__/ (committed to git).
 */
module.exports = defineConfig({
  testDir: "./tests/visual",
  snapshotDir: "./tests/visual/__screenshots__",
  snapshotPathTemplate:
    "{snapshotDir}/{testFilePath}/{arg}-{projectName}{ext}",

  /* Global timeout per test — generous for screenshot diffs */
  timeout: 30_000,
  expect: {
    toHaveScreenshot: {
      /* Allow tiny anti-aliasing differences (0.2%) */
      maxDiffPixelRatio: 0.002,
      /* Allow per-pixel color tolerance for sub-pixel rendering */
      threshold: 0.15,
    },
  },

  /* Fail fast in CI, retry once locally to handle flakes */
  retries: process.env.CI ? 0 : 1,
  fullyParallel: true,
  workers: process.env.CI ? 1 : undefined,

  /* HTML report for reviewing diffs */
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never" }]]
    : [["html", { open: "on-failure" }]],

  use: {
    /* Static file:// URLs — no server needed */
    baseURL: undefined,
    /* Consistent rendering */
    colorScheme: "light",
    deviceScaleFactor: 2,
    /* Hide caret blink */
    hasTouch: false,
  },

  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
        viewport: { width: 1440, height: 900 },
      },
    },
    /* Mobile viewport — catches overflow/clipping at narrow widths */
    {
      name: "mobile",
      use: {
        browserName: "chromium",
        viewport: { width: 375, height: 812 },
      },
    },
  ],
});
