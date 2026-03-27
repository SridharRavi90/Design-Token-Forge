const { chromium } = require("@playwright/test");
const path = require("path");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 3,
  });
  const demoFile = path.resolve(__dirname, "../demo/avatar.html");
  await page.goto("file://" + demoFile);
  await page.waitForLoadState("load");
  await page.waitForTimeout(600);

  const density = page.locator("#sec-density .section-body");
  await density.screenshot({ path: "/tmp/avatar-fix-density.png" });
  console.log("Saved /tmp/avatar-fix-density.png");

  const content = page.locator("#sec-content");
  await content.screenshot({ path: "/tmp/avatar-fix-content.png" });
  console.log("Saved /tmp/avatar-fix-content.png");

  const hero = page.locator("#sec-hero");
  await hero.screenshot({ path: "/tmp/avatar-fix-hero.png" });
  console.log("Saved /tmp/avatar-fix-hero.png");

  await browser.close();
})();
