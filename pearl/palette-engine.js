/* ════════════════════════════════════════════════════════════════
   Design Token Forge — Palette Engine (Browser IIFE)
   ════════════════════════════════════════════════════════════════
   Browser-ready version of /packages/generator/src/palette-engine.js
   Works with file:// protocol (no ES module CORS issues).
   Source of truth: /packages/generator/src/palette-engine.js (ESM)

   ════════════════════════════════════════════════════════════════ */
;(function(global) {
'use strict';

// ── Step names & indices ────────────────────────────────────
var STEP_NAMES = [
  'white','25','50','75','100','150','175','200','250','300','350',
  '400','450','500','550','600','700','750','800','850','900','black'
];
var KEY_INDEX = 13; // step 500

// ── Fixed Tone Scale ────────────────────────────────────────
var TONE_SCALE = [
  100,   // white
   98,   // 25
   95,   // 50
   92,   // 75
   88,   // 100
   83,   // 150
   78,   // 175
   73,   // 200
   68,   // 250
   63,   // 300
   59,   // 350
   55,   // 400
   52,   // 450
   49,   // 500 (key)
   45,   // 550
   40,   // 600
   33,   // 700
   26,   // 750
   19,   // 800
   12,   // 850
    5,   // 900
    0,   // black
];

// ══════════════════════════════════════════════════════════════
// Color Math
// ══════════════════════════════════════════════════════════════

function srgbToLinear(c) {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function linearToSrgb(c) {
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

function hexToRgb(hex) {
  var h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16) / 255,
    parseInt(h.substring(2, 4), 16) / 255,
    parseInt(h.substring(4, 6), 16) / 255,
  ];
}

function rgbToHex(r, g, b) {
  function cl(v) { return Math.max(0, Math.min(255, Math.round(v * 255))); }
  return '#' + [r, g, b].map(function(v) { return cl(v).toString(16).padStart(2, '0'); }).join('').toUpperCase();
}

function relativeLuminance(hex) {
  var c = hexToRgb(hex);
  return 0.2126 * srgbToLinear(c[0]) + 0.7152 * srgbToLinear(c[1]) + 0.0722 * srgbToLinear(c[2]);
}

function wcagContrast(hex1, hex2) {
  var L1 = relativeLuminance(hex1) + 0.05;
  var L2 = relativeLuminance(hex2) + 0.05;
  return Math.max(L1, L2) / Math.min(L1, L2);
}

function yToLstar(Y) {
  return Y <= 0.008856 ? 903.3 * Y : 116 * Math.pow(Y, 1 / 3) - 16;
}

function lstarToY(Lstar) {
  return Lstar <= 8 ? Lstar / 903.3 : Math.pow((Lstar + 16) / 116, 3);
}

function hexToLstar(hex) {
  return yToLstar(relativeLuminance(hex));
}

function rgbToOklab(r, g, b) {
  var lr = srgbToLinear(r), lg = srgbToLinear(g), lb = srgbToLinear(b);
  var l_ = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
  var m_ = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
  var s_ = 0.0883024619 * lr + 0.2024326643 * lg + 0.7092648738 * lb;
  l_ = Math.cbrt(l_); m_ = Math.cbrt(m_); s_ = Math.cbrt(s_);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}

function oklabToRgb(L, a, b) {
  var l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  var m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  var s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  l_ = l_ * l_ * l_; m_ = m_ * m_ * m_; s_ = s_ * s_ * s_;
  return [
    linearToSrgb(+4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_),
    linearToSrgb(-1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_),
    linearToSrgb(-0.0041960863 * l_ - 0.7034186147 * m_ + 1.7076147010 * s_),
  ];
}

function hexToOklch(hex) {
  var c = hexToRgb(hex);
  var lab = rgbToOklab(c[0], c[1], c[2]);
  return [lab[0], Math.sqrt(lab[1] * lab[1] + lab[2] * lab[2]), ((Math.atan2(lab[2], lab[1]) * 180) / Math.PI + 360) % 360];
}

function oklchToHex(L, C, H) {
  var a = C * Math.cos((H * Math.PI) / 180);
  var b = C * Math.sin((H * Math.PI) / 180);
  var rgb = oklabToRgb(L, a, b);
  return rgbToHex(Math.max(0, Math.min(1, rgb[0])), Math.max(0, Math.min(1, rgb[1])), Math.max(0, Math.min(1, rgb[2])));
}

function isInSrgb(L, C, H) {
  var a = C * Math.cos((H * Math.PI) / 180);
  var b = C * Math.sin((H * Math.PI) / 180);
  var rgb = oklabToRgb(L, a, b);
  return rgb[0] >= -0.002 && rgb[0] <= 1.002 && rgb[1] >= -0.002 && rgb[1] <= 1.002 && rgb[2] >= -0.002 && rgb[2] <= 1.002;
}

function toneToOklchL(tone) {
  var Y = lstarToY(tone);
  var gray = linearToSrgb(Math.max(0, Math.min(1, Y)));
  return rgbToOklab(gray, gray, gray)[0];
}

// ══════════════════════════════════════════════════════════════
// PALETTE GENERATOR
// ══════════════════════════════════════════════════════════════

function generatePalette(keyHex, opts) {
  var anchor = (opts && opts.anchor) || 'normalized';
  var oklch = hexToOklch(keyHex);
  var keyC = oklch[1], keyH = oklch[2];
  // Anchor math (only used when anchor === 'exact'):
  // rescale tone curve so KEY_INDEX lands on key's actual L*.
  // Light side lerps tone 100..keyTone, dark side lerps keyTone..0,
  // preserving monotonicity for any input hex.
  var keyToneActual = hexToLstar(keyHex);
  // Clamp tone for remap math so extreme inputs (near-black/near-white)
  // don't collapse the opposite-side ladder. Step 500 still outputs the
  // exact input hex; only the neighbor-step interpolation uses the clamp.
  var keyTone = Math.max(20, Math.min(80, keyToneActual));
  var baseKeyTone = TONE_SCALE[KEY_INDEX];

  var steps = TONE_SCALE.map(function(tone, i) {
    var name = STEP_NAMES[i];

    if (i === 0)                    return { name: name, hex: '#FFFFFF', tone: 100, contrast: 1.0 };
    if (i === STEP_NAMES.length - 1) return { name: name, hex: '#000000', tone: 0,   contrast: 21.0 };

    // 'exact' mode: anchor key step to input hex.
    if (anchor === 'exact' && i === KEY_INDEX) {
      return { name: name, hex: keyHex.toUpperCase(), tone: keyToneActual, contrast: wcagContrast(keyHex, '#FFFFFF') };
    }

    var targetL;
    if (anchor === 'exact') {
      var remappedTone = i < KEY_INDEX
        ? 100 + (tone - 100) * (100 - keyTone) / (100 - baseKeyTone)
        : keyTone * (tone / baseKeyTone);
      targetL = toneToOklchL(remappedTone);
    } else {
      targetL = toneToOklchL(tone);
    }

    // Chroma: asymmetric bell curve — light side decays faster, dark side slower
    var isLight = i < KEY_INDEX;
    var range = isLight ? KEY_INDEX : (STEP_NAMES.length - 1 - KEY_INDEX);
    var distFromKey = Math.abs(i - KEY_INDEX) / range;
    var decayFactor = isLight ? 0.6  : 0.35;
    var decayPower  = isLight ? 1.3  : 1.8;
    var chroma = keyC * Math.max(0, 1 - decayFactor * Math.pow(distFromKey, decayPower));
    var hue = keyH;

    while (chroma > 0.0005 && !isInSrgb(targetL, chroma, hue)) {
      chroma *= 0.97;
    }

    var hex = oklchToHex(targetL, chroma, hue);
    var contrast = wcagContrast(hex, '#FFFFFF');

    return { name: name, hex: hex, tone: tone, contrast: contrast };
  });

  return { keyHex: keyHex, steps: steps };
}

// ══════════════════════════════════════════════════════════════
// TRUST CERTIFICATION
// ══════════════════════════════════════════════════════════════

function certifyPalette(palette) {
  var hexes = palette.steps.map(function(s) { return s.hex; });
  var tests = [];
  var totalPass = 0, totalWarn = 0, totalFail = 0;
  var N = STEP_NAMES.length;
  function idx(name) { return STEP_NAMES.indexOf(name); }

  // Test 1: Valid sRGB
  (function() {
    var details = hexes.map(function(h, i) {
      var valid = /^#[0-9A-Fa-f]{6}$/.test(h);
      var rgb = hexToRgb(h);
      var inRange = rgb[0] >= 0 && rgb[0] <= 1 && rgb[1] >= 0 && rgb[1] <= 1 && rgb[2] >= 0 && rgb[2] <= 1;
      return { step: STEP_NAMES[i], hex: h, pass: valid && inRange };
    });
    var passed = details.filter(function(d) { return d.pass; }).length;
    var status = passed === N ? 'PASS' : 'FAIL';
    tests.push({ name: '1. Valid sRGB Colors', description: 'Every step is a displayable sRGB hex color', status: status, checked: N, passed: passed, details: details });
    if (status === 'PASS') totalPass++; else totalFail++;
  })();

  // Test 2: Monotonic Lightness
  (function() {
    var tones = hexes.map(function(h) { return hexToLstar(h); });
    var details = [];
    for (var i = 0; i < N - 1; i++) {
      var delta = +(tones[i] - tones[i + 1]).toFixed(2);
      details.push({ from: STEP_NAMES[i], to: STEP_NAMES[i + 1], delta: delta, pass: delta >= 0 });
    }
    var passed = details.filter(function(d) { return d.pass; }).length;
    var status = passed === N - 1 ? 'PASS' : 'FAIL';
    tests.push({ name: '2. Monotonic Lightness', description: 'Every step is darker than the previous (no brightness reversals)', status: status, checked: N - 1, passed: passed, details: details.filter(function(d) { return !d.pass; }) });
    if (status === 'PASS') totalPass++; else totalFail++;
  })();

  // Test 3: WCAG Contrast Compliance
  (function() {
    var checks = [
      { label: 'Step 600 on white (body text)',  fg: hexes[idx('600')], bg: '#FFFFFF', threshold: 4.5, level: 'AA' },
      { label: 'Step 700 on white (body text)',  fg: hexes[idx('700')], bg: '#FFFFFF', threshold: 4.5, level: 'AA' },
      { label: 'Step 500 on white (large text)', fg: hexes[idx('500')], bg: '#FFFFFF', threshold: 3.0, level: 'AA-lg' },
      { label: 'Step 900 on white (AAA text)',   fg: hexes[idx('900')], bg: '#FFFFFF', threshold: 7.0, level: 'AAA' },
      { label: 'White on step 500 (button)',     fg: '#FFFFFF', bg: hexes[idx('500')], threshold: 3.0, level: 'AA-lg' },
      { label: 'Step 600 on step 50 (card text)',fg: hexes[idx('600')], bg: hexes[idx('50')],  threshold: 4.5, level: 'AA' },
    ];
    var details = checks.map(function(c) {
      var ratio = +wcagContrast(c.fg, c.bg).toFixed(2);
      return { label: c.label, fg: c.fg, bg: c.bg, threshold: c.threshold, level: c.level, ratio: ratio, pass: ratio >= c.threshold };
    });
    var passed = details.filter(function(d) { return d.pass; }).length;
    var status = passed === details.length ? 'PASS' : passed >= details.length - 1 ? 'WARN' : 'FAIL';
    tests.push({ name: '3. WCAG Contrast Compliance', description: 'Critical steps meet WCAG AA/AAA contrast requirements', status: status, checked: details.length, passed: passed, details: details });
    if (status === 'PASS') totalPass++; else if (status === 'WARN') totalWarn++; else totalFail++;
  })();

  // Test 4: Dark Mode Readability
  (function() {
    var checks = [
      { label: 'Step 200 on step 900', light: idx('200'), dark: idx('900'), threshold: 4.5 },
      { label: 'Step 300 on step 900', light: idx('300'), dark: idx('900'), threshold: 4.5 },
      { label: 'Step 200 on step 850', light: idx('200'), dark: idx('850'), threshold: 4.5 },
      { label: 'Step 100 on step 800', light: idx('100'), dark: idx('800'), threshold: 4.5 },
      { label: 'Step 50 on step 900',  light: idx('50'),  dark: idx('900'), threshold: 7.0 },
    ];
    var details = checks.map(function(c) {
      var ratio = +wcagContrast(hexes[c.light], hexes[c.dark]).toFixed(2);
      return { label: c.label, ratio: ratio, threshold: c.threshold, pass: ratio >= c.threshold };
    });
    var passed = details.filter(function(d) { return d.pass; }).length;
    var status = passed === details.length ? 'PASS' : passed >= details.length - 1 ? 'WARN' : 'FAIL';
    tests.push({ name: '4. Dark Mode Readability', description: 'Light-on-dark combinations meet WCAG AA for dark themes', status: status, checked: details.length, passed: passed, details: details });
    if (status === 'PASS') totalPass++; else if (status === 'WARN') totalWarn++; else totalFail++;
  })();

  // Test 5: Perceptual Distinguishability
  (function() {
    var Ls = hexes.map(function(h) { return hexToOklch(h)[0]; });
    var inner = N - 2;
    var details = [];
    for (var i = 1; i < N - 1; i++) {
      var delta = +Math.abs(Ls[i] - Ls[i + 1]).toFixed(4);
      if (delta < 0.015) details.push({ from: STEP_NAMES[i], to: STEP_NAMES[i + 1], delta: delta });
    }
    var clumps = details.length;
    var status = clumps <= 1 ? 'PASS' : clumps <= 3 ? 'WARN' : 'FAIL';
    tests.push({ name: '5. Perceptual Distinguishability', description: 'Adjacent steps are visually different (no invisible transitions)', status: status, checked: inner, passed: inner - clumps, clumps: clumps, details: details });
    if (status === 'PASS') totalPass++; else if (status === 'WARN') totalWarn++; else totalFail++;
  })();

  // Test 6: White/Black Anchoring
  (function() {
    var whiteOk = hexes[0].toUpperCase() === '#FFFFFF';
    var blackOk = hexes[N - 1].toUpperCase() === '#000000';
    var status = whiteOk && blackOk ? 'PASS' : 'FAIL';
    tests.push({ name: '6. White/Black Anchoring', description: 'Palette anchors at pure #FFFFFF and #000000', status: status, checked: 2, passed: (whiteOk ? 1 : 0) + (blackOk ? 1 : 0), details: [] });
    if (status === 'PASS') totalPass++; else totalFail++;
  })();

  // Test 7: Hue Consistency
  (function() {
    var keyHue = hexToOklch(hexes[KEY_INDEX])[2];
    var maxDrift = 0, sumDrift = 0, count = 0;
    for (var i = 1; i < N - 1; i++) {
      var oklch = hexToOklch(hexes[i]);
      if (oklch[1] < 0.01) continue;
      var d = Math.abs(oklch[2] - keyHue);
      if (d > 180) d = 360 - d;
      maxDrift = Math.max(maxDrift, d);
      sumDrift += d;
      count++;
    }
    var avgDrift = count > 0 ? sumDrift / count : 0;
    var status = maxDrift < 15 ? 'PASS' : maxDrift < 30 ? 'WARN' : 'FAIL';
    tests.push({ name: '7. Hue Consistency', description: 'All steps maintain the same perceived color family', status: status, checked: count, passed: count, maxDrift: +maxDrift.toFixed(1), avgDrift: +avgDrift.toFixed(1), details: [] });
    if (status === 'PASS') totalPass++; else if (status === 'WARN') totalWarn++; else totalFail++;
  })();

  var overall = totalFail === 0 && totalWarn <= 1 ? 'CERTIFIED' : totalFail <= 1 ? 'CONDITIONAL' : 'FAILED';
  return { overall: overall, pass: totalPass, warn: totalWarn, fail: totalFail, tests: tests };
}

// ══════════════════════════════════════════════════════════════
// CSS / JSON EXPORT
// ══════════════════════════════════════════════════════════════

function toCss(paletteName, palette) {
  var lines = palette.steps.map(function(s) {
    return '  --prim-' + paletteName + '-' + s.name + ': ' + s.hex + ';';
  });
  return ':root {\n' + lines.join('\n') + '\n}';
}

function toDtcgJson(paletteName, palette) {
  var tokens = {};
  palette.steps.forEach(function(s) {
    tokens[s.name] = { $type: 'color', $value: s.hex };
  });
  var wrapper = {};
  wrapper[paletteName] = tokens;
  return JSON.stringify(wrapper, null, 2);
}

function contrastAtTone(tone) {
  var Y = lstarToY(tone);
  return (1.0 + 0.05) / (Y + 0.05);
}

// ── Expose public API ───────────────────────────────────────
global.PaletteEngine = {
  STEP_NAMES: STEP_NAMES,
  KEY_INDEX: KEY_INDEX,
  TONE_SCALE: TONE_SCALE,
  generatePalette: generatePalette,
  certifyPalette: certifyPalette,
  toCss: toCss,
  toDtcgJson: toDtcgJson,
  contrastAtTone: contrastAtTone,
  hexToRgb: hexToRgb,
  rgbToHex: rgbToHex,
  relativeLuminance: relativeLuminance,
  wcagContrast: wcagContrast,
  hexToLstar: hexToLstar,
  hexToOklch: hexToOklch,
  oklchToHex: oklchToHex,
  yToLstar: yToLstar,
  lstarToY: lstarToY,
};

})(typeof window !== 'undefined' ? window : this);
