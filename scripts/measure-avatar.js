const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const path = require("path");
  const demoFile = path.resolve(__dirname, "../demo/avatar.html");
  await page.goto("file://" + demoFile);
  await page.waitForLoadState("load");
  await page.waitForTimeout(500);

  const results = await page.evaluate(() => {
    const support = CSS.supports("text-box-trim", "both");

    // Measure visible ink center using canvas pixel analysis
    function measureCapOffset(fontFamily, fontWeight, fontSize) {
      const text = "JD";
      const canvasSize = fontSize * 4;
      const canvas = document.createElement("canvas");
      canvas.width = canvasSize;
      canvas.height = canvasSize;
      const ctx = canvas.getContext("2d");
      ctx.font = fontWeight + " " + fontSize + "px " + fontFamily;
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      ctx.fillStyle = "red";
      ctx.fillText(text, canvasSize / 2, canvasSize / 2);
      const data = ctx.getImageData(0, 0, canvasSize, canvasSize).data;
      let topInk = canvasSize, bottomInk = 0;
      for (let y = 0; y < canvasSize; y++) {
        for (let x = 0; x < canvasSize; x++) {
          const a = data[(y * canvasSize + x) * 4 + 3];
          if (a > 10) {
            if (y < topInk) topInk = y;
            if (y > bottomInk) bottomInk = y;
          }
        }
      }
      const inkCenter = (topInk + bottomInk) / 2;
      const canvasCenter = canvasSize / 2;
      // positive = ink is below center, negative = above
      return (inkCenter - canvasCenter) / fontSize;
    }

    const init0 = document.querySelector(".avatar__initials");
    const cs = getComputedStyle(init0);
    const fontFamily = cs.fontFamily;
    const fontWeight = cs.fontWeight;

    const items = document.querySelectorAll(".density-item");
    const measurements = [];
    items.forEach((item) => {
      const av = item.querySelector(".avatar");
      const init = item.querySelector(".avatar__initials");
      if (!av || !init) return;

      const fontSize = parseFloat(getComputedStyle(init).fontSize);
      const avatarSize = Math.round(av.getBoundingClientRect().height);
      const canvasOffset = measureCapOffset(fontFamily, fontWeight, fontSize);

      measurements.push({
        size: av.dataset.size,
        avatarH: avatarSize,
        fontSize: fontSize + "px",
        canvasCapOffsetEm: Math.round(canvasOffset * 1000) / 1000,
      });
    });

    // Get the ideal translate value: when textBaseline="middle", canvas already
    // tries to center. Any remaining offset is the correction we need.
    // But our CSS uses line-height:1 + flexbox centering, NOT textBaseline.
    // The real offset = (ascent - capHeight) / (2 * UPM)
    // Let's measure with textBaseline="alphabetic" to get true metrics.
    const probe = 200;
    const c = document.createElement("canvas");
    c.width = 600; c.height = 400;
    const ctx2 = c.getContext("2d");
    ctx2.font = fontWeight + " " + probe + "px " + fontFamily;
    const tm = ctx2.measureText("JD");
    const ascent = tm.fontBoundingBoxAscent;
    const descent = tm.fontBoundingBoxDescent;
    const capTop = ascent - tm.actualBoundingBoxAscent;
    const capBottom = ascent + tm.actualBoundingBoxDescent;
    const emHeight = ascent + descent;

    // With line-height:1 flexbox centering:
    // The line box = 1em. The browser places the baseline at ascent/emHeight from top.
    // So baseline is at (ascent/emHeight) em from top of line box.
    // Cap top is at (ascent - capAscent)/emHeight em from top.
    // Cap bottom is at (ascent + capDescent)/emHeight em from top.
    // Cap center = ((capTop + capBottom) / 2) / emHeight em from top.
    // Line box center = 0.5em from top.
    // Visual offset = capCenter - 0.5 (positive = below center = ok, negative = above center = needs correction)

    const capCenterNorm = ((capTop + capBottom) / 2) / emHeight;
    const visualOffset = capCenterNorm - 0.5;
    const correction = -visualOffset; // positive = we need to push down

    return {
      support,
      fontMetrics: {
        font: fontFamily.split(",")[0].trim(),
        ascent, descent, emHeight: emHeight,
        capAscent: tm.actualBoundingBoxAscent,
        capDescent: tm.actualBoundingBoxDescent,
        capTopNorm: Math.round((capTop / emHeight) * 1000) / 1000,
        capBottomNorm: Math.round((capBottom / emHeight) * 1000) / 1000,
        capCenterNorm: Math.round(capCenterNorm * 1000) / 1000,
        visualOffset: Math.round(visualOffset * 1000) / 1000,
        correctionEm: Math.round(correction * 1000) / 1000,
      },
      measurements,
    };
  });

  console.log("text-box-trim supported:", results.support);
  console.log("");
  console.log("FONT METRICS (at 200px):");
  const fm = results.fontMetrics;
  console.log("  Font:", fm.font);
  console.log("  Ascent:", fm.ascent, " Descent:", fm.descent);
  console.log("  Em height:", fm.emHeight);
  console.log("  Cap ascent:", fm.capAscent, " Cap descent:", fm.capDescent);
  console.log("  Cap top (norm):", fm.capTopNorm, " Cap bottom (norm):", fm.capBottomNorm);
  console.log("  Cap center (norm):", fm.capCenterNorm, " (vs line-box center: 0.5)");
  console.log("  Visual offset:", fm.visualOffset, "em (negative = caps sit above center)");
  console.log("  => Correction needed: translate 0", fm.correctionEm + "em downward");
  console.log("");
  console.log(
    "Size      | Avatar | Font  | CanvasCapOff(em)"
  );
  console.log(
    "----------|--------|-------|----------------"
  );
  results.measurements.forEach((m) => {
    console.log(
      [
        m.size.padEnd(9),
        String(m.avatarH).padEnd(6),
        String(m.fontSize).padEnd(5),
        String(m.canvasCapOffsetEm).padEnd(16),
      ].join(" | ")
    );
  });

  await browser.close();
})();
