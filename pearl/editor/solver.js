/* ════════════════════════════════════════════════════════════
   DTF Token Solver — pure-function engine
   ────────────────────────────────────────────────────────────
   Owns ALL token derivation + AA contrast logic for the editor.
   No DOM, no global State. Inputs in → resolved tokens out.

   Why a separate file:
     • Reused across T1 (current), T2 Surfaces, T3 Components.
     • Powers Phase C (spectrum slider) without rewrite.
     • Tests in isolation.

   Public API:
     DTFSolver.contrastRatio(hexA, hexB)       → number
     DTFSolver.wcagJudge(ratio, isLargeText?)  → { grade, ratio, pass }
     DTFSolver.surfaceBgFor(mode)              → '#FFFFFF' | '#0A0A0A'
     DTFSolver.stepRel(name, delta)            → step name +/- N positions
     DTFSolver.deriveOnComponent(fillHex)      → '#FFFFFF' | '#0A0A0A'
     DTFSolver.deriveOnContainer(ladder, contentStep, containerHex)
                                               → { hex, step }
     DTFSolver.resolveSteps(picks, presetMap)  → { fillStep, contentStep, containerStep }
     DTFSolver.evaluate(ladder, picks, presetMap, mode)
                                               → full eval (see below)
     DTFSolver.autoFix(ladder, picks, presetMap, mode, levers)
                                               → new picks (minimum disturbance)
   ════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // Includes the L*100 extreme ('white') and L*0 extreme ('black')
  // so designers can pin a surface bg to literal #FFF / #000 from
  // the step picker, and so stepRel can step past 25/900 into them.
  var ALL_STEPS = ['white','25','50','75','100','150','175','200','250','300','350','400','450','500','550','600','700','750','800','850','900','black'];

  function stepRel(name, delta) {
    var i = ALL_STEPS.indexOf(name); if (i < 0) return name;
    i = Math.max(0, Math.min(ALL_STEPS.length - 1, i + delta));
    return ALL_STEPS[i];
  }

  function _hexToRgb(h) {
    h = (h || '').replace('#', '');
    if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
    return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
  }
  function _relLum(hex) {
    var c = _hexToRgb(hex);
    var f = function (v) { v = v / 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
    return 0.2126*f(c.r) + 0.7152*f(c.g) + 0.0722*f(c.b);
  }
  function contrastRatio(a, b) {
    var L1 = _relLum(a), L2 = _relLum(b);
    var hi = Math.max(L1, L2), lo = Math.min(L1, L2);
    return (hi + 0.05) / (lo + 0.05);
  }
  function wcagJudge(ratio, isLargeText) {
    if (ratio >= 7) return { grade: 'AAA', ratio: ratio, pass: true };
    if (ratio >= 4.5) return { grade: 'AA', ratio: ratio, pass: true };
    if (ratio >= 3 && isLargeText) return { grade: 'AA Large', ratio: ratio, pass: true };
    return { grade: 'Fail', ratio: ratio, pass: false };
  }

  function surfaceBgFor(mode) { return mode === 'dark' ? '#0A0A0A' : '#FFFFFF'; }

  /* ── Auto-pair derivations ────────────────────────────
     on-component: black or white, whichever beats the WORST
       fill in WCAG. A button has 3 fills (default/hover/pressed);
       designers don't change colour on hover, so the on-component
       value must be readable on the darkest AND lightest fill
       the role can produce, not just default. Pearl light-mode
       brand caught this: black passes AA on default (#C737D9)
       but fails on pressed (#9803A9) where white wins.
     on-container: nearest ladder step (to user's chosen content
       pick) that AA-passes vs the container hex. Walks outward
       so the answer stays close to user intent. */
  function deriveOnComponent(fills) {
    var list = Array.isArray(fills) ? fills.filter(Boolean) : [fills];
    if (!list.length) return '#FFFFFF';
    var minW = Infinity, minB = Infinity;
    for (var i = 0; i < list.length; i++) {
      var rW = contrastRatio(list[i], '#FFFFFF');
      var rB = contrastRatio(list[i], '#0A0A0A');
      if (rW < minW) minW = rW;
      if (rB < minB) minB = rB;
    }
    return minB > minW ? '#0A0A0A' : '#FFFFFF';
  }

  /* Diagnostic companion: returns the picked colour, its worst-case
     contrast across all supplied fills, and a flag telling the UI
     whether the chosen colour fails AA on ANY state (so the editor
     can surface a "fill range is too wide" warning and recommend
     tightening the hover/pressed step deltas). */
  function deriveOnComponentVerdict(fills) {
    var list = Array.isArray(fills) ? fills.filter(Boolean) : [fills];
    if (!list.length) return { hex: '#FFFFFF', worst: 0, passesAA: false, weakest: null };
    var minW = Infinity, minB = Infinity, weakW = null, weakB = null;
    for (var i = 0; i < list.length; i++) {
      var rW = contrastRatio(list[i], '#FFFFFF');
      var rB = contrastRatio(list[i], '#0A0A0A');
      if (rW < minW) { minW = rW; weakW = list[i]; }
      if (rB < minB) { minB = rB; weakB = list[i]; }
    }
    var pickWhite = minW >= minB;
    return {
      hex:      pickWhite ? '#FFFFFF' : '#0A0A0A',
      worst:    pickWhite ? minW : minB,
      passesAA: (pickWhite ? minW : minB) >= 4.5,
      weakest:  pickWhite ? weakW : weakB
    };
  }

  function deriveOnContainer(ladder, contentStep, containerHex) {
    var startIdx = ALL_STEPS.indexOf(contentStep);
    if (startIdx < 0) startIdx = ALL_STEPS.indexOf('600');
    var order = [startIdx];
    for (var d = 1; d < ALL_STEPS.length; d++) {
      if (startIdx + d < ALL_STEPS.length) order.push(startIdx + d);
      if (startIdx - d >= 0)               order.push(startIdx - d);
    }
    var bestHex = null, bestStep = null, bestRatio = 0;
    for (var i = 0; i < order.length; i++) {
      var step = ALL_STEPS[order[i]];
      var hex  = ladder[step];
      if (!hex) continue;
      var r = contrastRatio(hex, containerHex);
      if (r >= 4.5) return { hex: hex, step: step, ratio: r };
      if (r > bestRatio) { bestRatio = r; bestHex = hex; bestStep = step; }
    }
    return { hex: bestHex || ladder[contentStep] || '#000', step: bestStep || contentStep, ratio: bestRatio };
  }

  /* ── Resolve semantic picks ('soft'/'standard'/'bold') to ladder step
       names ('400'/'500'/'600') using the preset map for this role. */
  function resolveSteps(picks, presetMap) {
    return {
      fillStep:      presetMap.fill[picks.fill],
      contentStep:   presetMap.content[picks.content],
      containerStep: presetMap.container[picks.container]
    };
  }

  /* ── Full evaluation. Returns everything needed to render the role
       (resolved steps + hexes + on-pair derivations + 4 AA checks). */
  function evaluate(ladder, picks, presetMap, mode) {
    var resolved = resolveSteps(picks, presetMap);
    var pageBg = surfaceBgFor(mode);
    var fillHex      = ladder[resolved.fillStep]      || '#000';
    var contentHex   = ladder[resolved.contentStep]   || '#000';
    var containerHex = ladder[resolved.containerStep] || pageBg;
    var onComp = deriveOnComponent(fillHex);
    var onCont = deriveOnContainer(ladder, resolved.contentStep, containerHex);
    var checks = [
      { label: 'On-component on Fill',        ratio: contrastRatio(fillHex,    onComp)       },
      { label: 'Content on page',             ratio: contrastRatio(contentHex, pageBg)       },
      { label: 'Content on container',        ratio: contrastRatio(contentHex, containerHex) },
      { label: 'On-container on container',   ratio: contrastRatio(onCont.hex, containerHex) }
    ].map(function (c) {
      var j = wcagJudge(c.ratio, false);
      c.grade = j.grade; c.pass = j.pass; return c;
    });
    return {
      resolved:   resolved,
      hexes:      { fill: fillHex, content: contentHex, container: containerHex, page: pageBg },
      onComp:     onComp,
      onCont:     onCont.hex,
      onContStep: onCont.step,
      checks:     checks,
      allPass:    checks.every(function (c) { return c.pass; })
    };
  }

  /* ── Auto-fix: walk each lever to a passing pick (minimum disturbance).
       1. Keep current pick if it passes.
       2. Else prefer Standard / Light (the visual default).
       3. Else try Soft / Whisper, then Bold / Tinted.
       4. If none pass, pick the highest-ratio option.
     Returns NEW picks object — does not mutate input. */
  function autoFix(ladder, picks, presetMap, mode, levers) {
    var out = { fill: picks.fill, content: picks.content, container: picks.container, spread: picks.spread };

    function pickMinDisturbance(lever, currentId, evaluator) {
      var optionIds = lever.options.map(function (o) { return o.id; });
      var preferred = (lever.id === 'container')
        ? ['light', 'whisper', 'tinted']
        : ['standard', 'soft', 'bold', 'subtle', 'strong'];
      var order = [];
      function push(id) { if (optionIds.indexOf(id) >= 0 && order.indexOf(id) < 0) order.push(id); }
      push(currentId);
      preferred.forEach(push);
      optionIds.forEach(push);
      var best = null;
      for (var i = 0; i < order.length; i++) {
        var id    = order[i];
        var step  = presetMap[lever.id][id];
        var hex   = ladder[step] || '#000';
        var ratio = evaluator(hex);
        if (ratio >= 4.5) return id;
        if (!best || ratio > best.ratio) best = { id: id, ratio: ratio };
      }
      return best ? best.id : currentId;
    }

    var pageBg         = surfaceBgFor(mode);
    var fillLever      = levers.find(function (l) { return l.id === 'fill';      });
    var contentLever   = levers.find(function (l) { return l.id === 'content';   });
    var containerLever = levers.find(function (l) { return l.id === 'container'; });

    out.fill = pickMinDisturbance(fillLever, out.fill, function (hex) {
      var rW = contrastRatio(hex, '#FFFFFF'), rB = contrastRatio(hex, '#0A0A0A');
      return Math.max(rW, rB);
    });
    out.content = pickMinDisturbance(contentLever, out.content, function (hex) {
      return contrastRatio(hex, pageBg);
    });
    var newContentHex = ladder[presetMap.content[out.content]] || '#000';
    out.container = pickMinDisturbance(containerLever, out.container, function (hex) {
      return contrastRatio(newContentHex, hex);
    });
    return out;
  }

  /* ── Helper: convert a steps array (engine output) to a name→hex map.
       PaletteEngine returns [{name, hex, tone, contrast}, ...]; the solver
       wants a flat lookup. */
  function ladderFromSteps(stepsArr) {
    var ladder = {};
    if (!stepsArr) return ladder;
    for (var i = 0; i < stepsArr.length; i++) {
      ladder[stepsArr[i].name] = stepsArr[i].hex;
    }
    return ladder;
  }

  /* ── Step-based API (v2 — no presets) ─────────────────
     Direct callers pass step names ('25'..'900'). The carousel /
     palette-strip UI lives entirely in this world. */
  function evaluateBySteps(ladder, picks, mode) {
    var pageBg = surfaceBgFor(mode);
    var fillHex      = ladder[picks.fill]      || '#000';
    var contentHex   = ladder[picks.content]   || '#000';
    var containerHex = ladder[picks.container] || pageBg;
    var onComp = deriveOnComponent(fillHex);
    var onCont = deriveOnContainer(ladder, picks.content, containerHex);
    /* Three real-world checks. "Content on container" is intentionally
       NOT a separate check — components never render content-default
       directly on container-bg; they always use the auto-derived
       on-container token. Including it would double-count and conflict
       with what the container picker now reports. */
    var checks = [
      { label: 'On-component on Fill',        ratio: contrastRatio(fillHex,    onComp)       },
      { label: 'Content on page',             ratio: contrastRatio(contentHex, pageBg)       },
      { label: 'On-container on container',   ratio: contrastRatio(onCont.hex, containerHex) }
    ].map(function (c) {
      var j = wcagJudge(c.ratio, false);
      c.grade = j.grade; c.pass = j.pass; return c;
    });
    return {
      hexes:      { fill: fillHex, content: contentHex, container: containerHex, page: pageBg },
      onComp:     onComp,
      onCont:     onCont.hex,
      onContStep: onCont.step,
      checks:     checks,
      allPass:    checks.every(function (c) { return c.pass; })
    };
  }

  /* Per-lever AA judge for a candidate step. Pure: no state.
       lever ∈ 'fill' | 'content' | 'container'. The container case
       judges using deriveOnContainer — i.e. "can SOME on-container
       step in the ladder pass AA on this container?" — because that
       reflects what real components emit (always on-container, never
       raw content-default-on-container). */
  function judgeStepForLever(ladder, lever, step, picks, mode) {
    var hex = ladder[step]; if (!hex) return { ratio: 0, pass: false, grade: 'Fail' };
    var ratio;
    if (lever === 'fill') {
      var rW = contrastRatio(hex, '#FFFFFF'), rB = contrastRatio(hex, '#0A0A0A');
      ratio = Math.max(rW, rB);
    } else if (lever === 'content') {
      ratio = contrastRatio(hex, surfaceBgFor(mode));
    } else { // container
      // Use the same derivation the on-container card uses so the
      // picker badge and the auto-derived card always agree.
      ratio = deriveOnContainer(ladder, picks.content, hex).ratio;
    }
    return wcagJudge(ratio, false);
  }

  /* Walk to the nearest AA-passing step (minimum disturbance from
     current pick). Returns the same step if it already passes. */
  function snapStepToAA(ladder, lever, currentStep, picks, mode) {
    var startIdx = ALL_STEPS.indexOf(currentStep);
    if (startIdx < 0) startIdx = ALL_STEPS.indexOf('500');
    var order = [startIdx];
    for (var d = 1; d < ALL_STEPS.length; d++) {
      if (startIdx + d < ALL_STEPS.length) order.push(startIdx + d);
      if (startIdx - d >= 0)               order.push(startIdx - d);
    }
    var bestStep = currentStep, bestRatio = 0;
    for (var i = 0; i < order.length; i++) {
      var step = ALL_STEPS[order[i]];
      var j = judgeStepForLever(ladder, lever, step, picks, mode);
      if (j.pass) return step;
      if (j.ratio > bestRatio) { bestRatio = j.ratio; bestStep = step; }
    }
    return bestStep;
  }

  window.DTFSolver = {
    ALL_STEPS:         ALL_STEPS,
    stepRel:           stepRel,
    contrastRatio:     contrastRatio,
    wcagJudge:         wcagJudge,
    surfaceBgFor:      surfaceBgFor,
    deriveOnComponent: deriveOnComponent,
    deriveOnComponentVerdict: deriveOnComponentVerdict,
    deriveOnContainer: deriveOnContainer,
    resolveSteps:      resolveSteps,
    evaluate:          evaluate,
    autoFix:           autoFix,
    ladderFromSteps:   ladderFromSteps,
    /* v2 step-based API (used by the palette-strip UI): */
    evaluateBySteps:   evaluateBySteps,
    judgeStepForLever: judgeStepForLever,
    snapStepToAA:      snapStepToAA
  };
})();
