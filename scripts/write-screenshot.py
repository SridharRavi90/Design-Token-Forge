import json

content = {
    "code": 'const { chromium } = require("@playwright/test");\nconst path = require("path");\n\n(async () => {\n  const browser = await chromium.launch();\n  const page = await browser.newPage({\n    viewport: { width: 1440, height: 900 },\n    deviceScaleFactor: 3,\n  });\n  const demoFile = path.resolve(__dirname, "../demo/avatar.html");\n  await page.goto("file://" + demoFile);\n  await page.waitForLoadState("load");\n  await page.waitForTimeout(600);\n\n  const density = page.locator("#sec-density .section-body");\n  await density.screenshot({ path: "/tmp/avatar-fix-density.png" });\n  console.log("Saved /tmp/avatar-fix-density.png");\n\n  const content = page.locator("#sec-content");\n  await content.screenshot({ path: "/tmp/avatar-fix-content.png" });\n  console.log("Saved /tmp/avatar-fix-content.png");\n\n  const hero = page.locator("#sec-hero");\n  await hero.screenshot({ path: "/tmp/avatar-fix-hero.png" });\n  console.log("Saved /tmp/avatar-fix-hero.png");\n\n  await browser.close();\n})();\n'
}

with open("scripts/screenshot-avatar.js", "w") as f:
    f.write(content["code"])
print("Done")
