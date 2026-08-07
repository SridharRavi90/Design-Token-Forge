/* ════════════════════════════════════════════════════════════
   Design Token Forge — Editor v2
   Step 2: T0 Palette intent end-to-end.

   Architecture:
   - State.baseline = original palette key colors (read from primitives)
   - State.proposed = currently-edited palette key colors
   - On edit: regenerate the 22-step ladder via PaletteEngine
              -> inject into preview iframe as --prim-{role}-{step}
              -> update topbar change count + Discard / Deploy enable
   - Discard reverts proposed to baseline
   - Deploy is wired in step 8 (commits proposed -> repo)
   ════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var TIER_META = {
    t0: { title: 'Palette',     sub: 'Your foundation colors. Editing here cascades to roles, surfaces, and every component.' },
    tt: { title: 'Type',        sub: 'Headline, body, and code fonts. Pick a pairing or type your own — the live preview updates instantly.' },
    t1: { title: 'Roles',       sub: 'Brand, danger, success, warning, info, neutral — the meaning your colors carry.' },
    t2: { title: 'Surfaces',    sub: 'Page and section backgrounds. Each surface defines text, components, and outlines that fit on top of it.' },
    t3: { title: 'Components',  sub: 'Per-component sizes, spacing and structural tokens. Density, padding, radii.' }
  };

  var ROLES = [
    { id: 'brand',   label: 'Brand',   prefix: 'brand'   },
    { id: 'danger',  label: 'Danger',  prefix: 'danger'  },
    { id: 'success', label: 'Success', prefix: 'success' },
    { id: 'warning', label: 'Warning', prefix: 'warning' },
    { id: 'info',    label: 'Info',    prefix: 'info'    }
  ];

  var AFFECTS = {
    brand:   ['Button', 'Badge', 'Toggle', 'Checkbox', 'Radio', 'Input', 'Slider', 'Tabs', '+12 more'],
    danger:  ['Alert', 'Toast', 'Button', 'Input', 'Badge', '+8 more'],
    success: ['Alert', 'Toast', 'Badge', 'Progress', '+6 more'],
    warning: ['Alert', 'Toast', 'Badge', '+5 more'],
    info:    ['Alert', 'Toast', 'Badge', 'Tooltip', '+5 more']
  };

  /* ── T1 Roles intent ──────────────────────────────────
     Each role has 3 levers (fill / content / container). Each lever
     picks a single step from the 20-step palette ladder and that step
     becomes the anchor of a slot family. Other slots in the family
     derive by index-stepping along the ladder.

     Step names are the only identifier the user sees. No "Soft /
     Standard / Bold" preset vocabulary — just the same step numbers
     that ship in the CSS output (`--brand-component-bg-default:
     var(--prim-brand-550)`). One word, one meaning, end-to-end.   */
  // Mirror of DTFSolver.ALL_STEPS — includes the 'white' (L*100) and
  // 'black' (L*0) extremes so designers can pin a surface bg to
  // literal #FFF / #000 from the picker.
  var ALL_STEPS = ['white','25','50','75','100','150','175','200','250','300','350','400','450','500','550','600','700','750','800','850','900','black'];
  function stepRel(name, delta) {
    var i = ALL_STEPS.indexOf(name); if (i < 0) return name;
    i = Math.max(0, Math.min(ALL_STEPS.length - 1, i + delta));
    return ALL_STEPS[i];
  }
  /* In dark mode, the visible "away from container" direction is
     LIGHTER (smaller idx in ALL_STEPS). In light mode, it's DARKER
     (larger idx). Use this multiplier wherever a delta should track
     surface luminance. Without it, a step-850 dark container would
     auto-derive a step-900 border that's INVISIBLE on the container. */
  function tonalDir(mode) { return mode === 'dark' ? -1 : 1; }
  /* Walk `offset` steps from `name` in the mode-default direction,
     but FLIP direction when there isn't enough headroom that way
     — otherwise borders/separators on extreme containers (e.g. a
     pinned-to-black container in light mode) clamp at the ladder
     edge and become invisible against the container itself.
     Strategy:
       1. desiredDir = tonalDir(mode) so light-mode walks darker,
          dark-mode walks lighter (the canonical "away from page").
       2. If `idx + offset*desiredDir` is out of bounds (or fewer
          than `offset` steps fit in that direction), use the
          opposite direction.
       3. As a last resort (offset bigger than the ladder itself)
          fall back to the ladder edge furthest from `name`. */
  function stepRelToward(name, offset, mode) {
    var i = ALL_STEPS.indexOf(name);
    if (i < 0) return name;
    var dir = tonalDir(mode);
    var forwardRoom  = dir > 0 ? (ALL_STEPS.length - 1 - i) : i;
    var backwardRoom = dir > 0 ? i : (ALL_STEPS.length - 1 - i);
    var useDir;
    if (forwardRoom >= offset)      useDir =  dir;
    else if (backwardRoom >= offset) useDir = -dir;
    else useDir = (forwardRoom >= backwardRoom) ? dir : -dir;
    var j = Math.max(0, Math.min(ALL_STEPS.length - 1, i + offset * useDir));
    return ALL_STEPS[j];
  }
  /* Resolve the auto-derived border/separator step for a role+mode.
     Honors a user override stored in State.t1[mode][roleId][key];
     otherwise computes the default offset from the container pick
     in the direction with headroom. */
  function resolveBorderStep(roleId, mode) {
    var t = State.t1[mode][roleId];
    if (t.borderStep && ALL_STEPS.indexOf(t.borderStep) >= 0) return t.borderStep;
    return stepRelToward(t.container, 6, mode);
  }
  function resolveSeparatorStep(roleId, mode) {
    var t = State.t1[mode][roleId];
    if (t.separatorStep && ALL_STEPS.indexOf(t.separatorStep) >= 0) return t.separatorStep;
    return stepRelToward(t.container, 2, mode);
  }
  /* Component-family equivalents: the outline + separator drawn on
     the COMPONENT fill (not the container). Defaults sit -2 steps
     from fill (outline) and -4 steps from fill (separator), matching
     the values semanticVarsFor() previously hardcoded inline. Users
     can override these from their Property Cards just like
     container-border / container-separator. */
  function resolveCmBorderStep(roleId, mode) {
    var t = State.t1[mode][roleId];
    if (t.cmBorderStep && ALL_STEPS.indexOf(t.cmBorderStep) >= 0) return t.cmBorderStep;
    return stepRel(t.fill, -2);
  }
  function resolveCmSeparatorStep(roleId, mode) {
    var t = State.t1[mode][roleId];
    if (t.cmSeparatorStep && ALL_STEPS.indexOf(t.cmSeparatorStep) >= 0) return t.cmSeparatorStep;
    return stepRel(t.fill, -4);
  }

  /* Per-role per-mode default step picks. Hand-tuned so every role
     ships AA-clean out of the box — derived from the prior preset
     system's verified math, then frozen as plain step numbers.

     Light-mode rationale:
       brand / danger:  fill 550 vs white = 5.8+, content 550 vs container 75 = 4.5+
       success:         fill 600 vs white = 6.07, container 50 keeps cohesion w/ Light
       warning:         amber needs darker steps — fill 600, content 750 (9:1+ on white)
       info:            container 50 lifts content/container to 4.5+

     Dark-mode rationale: lift fills to luminous mid-tones (no
     "saturated-on-near-black" bruise look); soften content to cream
     instead of bone white; keep containers at the deep desaturated
     end so alerts read as tinted dark surfaces. */
  var T1_DEFAULT_STEPS = {
    light: {
      brand:   { fill: '550', content: '550', container: '75'  },
      danger:  { fill: '550', content: '550', container: '75'  },
      success: { fill: '600', content: '700', container: '50'  },
      warning: { fill: '600', content: '750', container: '75'  },
      info:    { fill: '550', content: '550', container: '50'  }
    },
    dark: {
      brand:   { fill: '450', content: '200', container: '850' },
      danger:  { fill: '450', content: '200', container: '850' },
      success: { fill: '500', content: '200', container: '850' },
      warning: { fill: '550', content: '200', container: '850' },
      info:    { fill: '450', content: '200', container: '850' }
    }
  };
  function defaultT1ForRole(roleId, mode) {
    var src = (T1_DEFAULT_STEPS[mode] && T1_DEFAULT_STEPS[mode][roleId])
           || T1_DEFAULT_STEPS.light.brand;
    return { fill: src.fill, content: src.content, container: src.container };
  }
  function t1For(roleId, mode) { return State.t1[mode || State.editingMode][roleId]; }

  /* ── T2 Surfaces intent (data layer) ───────────────────
     Build step 3: model + state only. No UI is wired here — T2 still
     renders the placeholder route until step 4. This commit just
     defines the shape downstream code (renderer, bulk ops, preview,
     persistence) can rely on. See docs/editor-v2-tier-architecture.md
     §3.2 (taxonomy) and §11 (build order).

     Each surface has 16 properties grouped into 3 families.
     A T2 cell is EITHER a step on its source palette (default) OR
     a "follows" pointer to a T1 role pick (set in step 4). Defaults
     are derived from per-surface anchor steps + signed offsets that
     pass through tonalDir(mode) — so dark mode mirrors automatically
     and no inline `± constant` ever leaks in (decision D4). */
  /* T2 surfaces split into two tiers:
       • Canvases (bright, base, dim, deep, accent, inverse)  — page tones
       • Elevations (card, modal, float)                       — lifted regions
     `card` was previously `container`; `modal` was previously `over-container`.
     Old IDs are migrated on State load (see migrateLegacyT2Keys()). */
  var T2_SURFACES = [
    { id:'bright',  label:'Bright',  palette:'greyscale', tier:'canvas',    desc:'Brightest page background'              },
    { id:'base',    label:'Base',    palette:'greyscale', tier:'canvas',    desc:'Base page background'                   },
    { id:'dim',     label:'Dim',     palette:'greyscale', tier:'canvas',    desc:'Recessed background'                    },
    { id:'deep',    label:'Deep',    palette:'greyscale', tier:'canvas',    desc:'Most recessed background'               },
    { id:'accent',  label:'Accent',  palette:'brand',     tier:'canvas',    desc:'Branded panels'                         },
    { id:'card',    label:'Card',    palette:'greyscale', tier:'elevation', desc:'Resting lift — cards, panels on a surface' },
    { id:'modal',   label:'Modal',   palette:'greyscale', tier:'elevation', desc:'Blocking overlay — dialogs, sheets (has backdrop)' },
    { id:'float',   label:'Float',   palette:'greyscale', tier:'elevation', desc:'Transient overlay — menus, dropdowns, tooltips' },
    { id:'inverse', label:'Inverse', palette:'greyscale', tier:'canvas',    desc:'Dark on light, light on dark'           }
  ];

  /* Anchor step for each surface's `bg` per mode. All other props on
     a surface derive from this via T2_PROP_DEFS[].defaultOffset, in
     the mode-correct direction. Values are the v0 picks accepted in
     Q2 of docs §10 \u2014 step-4 render will paint from these, not from
     the existing surfaces.css output, and the \u00b1 stepper is the
     escape hatch when a surface needs a different anchor. */
  var T2_BASE_STEPS = {
    light: { bright:'white', base:'25',  dim:'50',  deep:'75',
             accent:'25',  card:'white', modal:'white', float:'white', inverse:'900' },
    dark:  { bright:'850',  base:'900', dim:'900', deep:'black',
             accent:'900', card:'850',   modal:'800',   float:'750',   inverse:'900' }
  };

  /* One-shot key migration. Older config.json files keyed t2 state by
     the legacy surface IDs (container, over-container). Rewrite to the
     canonical (card, modal) the first time we see them, so downstream
     resolvers don't have to know about the rename. */
  var T2_LEGACY_RENAME = { container: 'card', 'over-container': 'modal' };
  function migrateLegacyT2Keys(t2) {
    if (!t2) return t2;
    ['light','dark'].forEach(function (mode) {
      var bag = t2[mode]; if (!bag) return;
      Object.keys(T2_LEGACY_RENAME).forEach(function (oldK) {
        if (Object.prototype.hasOwnProperty.call(bag, oldK)) {
          var newK = T2_LEGACY_RENAME[oldK];
          bag[newK] = Object.assign({}, bag[newK] || {}, bag[oldK]);
          delete bag[oldK];
        }
      });
    });
    return t2;
  }

  /* The 16 properties per surface. Default offsets are signed in
     "lighter→darker" steps and get multiplied by tonalDir(mode) at
     resolve time — so light/dark mirror automatically. Numbers come
  /* The 16 properties per surface, modeled as a TREE so the renderer
     can show parent-child relationships and the resolver cascades
     overrides correctly. `parent` = prop id of the anchor (null for
     bg). `defaultDelta` = signed offset from parent (in lighter→
     darker steps); multiplied by tonalDir(mode) at resolve time so
     light/dark mirror automatically. `level` controls UI indent.

     Tree (anchored at bg):
       bg                                          — family root
         ├─ subtle      (+1 from bg)
         ├─ strong      (+2 from bg)
         ├─ outline     (+3 from bg)            — edges
         │   └─ separator  ( 0 from outline)
         ├─ ct-default  (+16 from bg)           — content
         │   ├─ ct-strong  (+3 from ct-default)
         │   ├─ ct-subtle  (-6 from ct-default)
         │   └─ ct-faint   (-8 from ct-default)
         └─ cm-bg       (-1 from bg)            — component
             ├─ cm-bg-hover       (+1 from cm-bg)
             ├─ cm-bg-pressed     (+2 from cm-bg)
             ├─ cm-outline        (+4 from cm-bg)
             │   ├─ cm-outline-hover   (+1 from cm-outline)
             │   └─ cm-outline-pressed (+1 from cm-outline)
             └─ cm-separator      (+4 from cm-bg) */
  var T2_PROP_DEFS = [
    { id:'bg',                 family:'surface',   parent:null,         defaultDelta:  0, level:0 },
    { id:'subtle',             family:'surface',   parent:'bg',         defaultDelta:  1, level:1 },
    { id:'strong',             family:'surface',   parent:'bg',         defaultDelta:  2, level:1 },
    { id:'outline',            family:'borders',   parent:'bg',         defaultDelta:  3, level:0 },
    { id:'separator',          family:'borders',   parent:'outline',    defaultDelta:  0, level:1 },
    { id:'ct-default',         family:'content',   parent:'bg',         defaultDelta: 16, level:0 },
    { id:'ct-strong',          family:'content',   parent:'ct-default', defaultDelta:  3, level:1 },
    { id:'ct-subtle',          family:'content',   parent:'ct-default', defaultDelta: -6, level:1 },
    { id:'ct-faint',           family:'content',   parent:'ct-default', defaultDelta: -8, level:1 },
    { id:'cm-bg',              family:'component', parent:'bg',         defaultDelta: -1, level:0 },
    { id:'cm-bg-hover',        family:'component', parent:'bg',         defaultDelta:  2, level:1 },
    { id:'cm-bg-pressed',      family:'component', parent:'bg',         defaultDelta:  3, level:1 },
    { id:'cm-outline',         family:'component', parent:'cm-bg',      defaultDelta:  4, level:1 },
    { id:'cm-outline-hover',   family:'component', parent:'cm-outline', defaultDelta:  1, level:2 },
    { id:'cm-outline-pressed', family:'component', parent:'cm-outline', defaultDelta:  1, level:2 },
    { id:'cm-separator',       family:'component', parent:'cm-bg',      defaultDelta:  4, level:1 }
  ];
  function propDefById(id) {
    for (var i = 0; i < T2_PROP_DEFS.length; i++) if (T2_PROP_DEFS[i].id === id) return T2_PROP_DEFS[i];
    return null;
  }
  /* Props whose defaultDelta means "go AWAY from bg in contrast
     direction" (vs. "go in an absolute brightness direction"). Used
     to flip deltas on polarity-inverted surfaces (inverse). The
     cm-bg subtree is EXCLUDED because it encodes elevation/press
     state, not contrast. */
  var POLARITY_SENSITIVE = {
    'subtle':1,'strong':1,'outline':1,'separator':1,
    'ct-default':1,'ct-strong':1,'ct-subtle':1,'ct-faint':1,
    'cm-outline':1,'cm-outline-hover':1,'cm-outline-pressed':1,
    'cm-separator':1
  };
  function isPolaritySensitive(propId) { return POLARITY_SENSITIVE[propId] === 1; }

  /* Inverse-only deltas for cm-bg-hover and cm-bg-pressed. These
     override the normal +1/+2 "darker" elevation deltas because the
     inverse bg sits one step away from the palette extreme — the
     standard deltas clamp at the wall and produce no motion. The
     overrides express elevation TOWARD the palette center (same
     direction cm-bg itself offsets from bg) at compressed magnitudes
     so hover reads as resting and pressed is a subtle 1-step shift.
     Tonal multiplier is applied at resolve time so light/dark mirror
     automatically. */
  var INVERSE_CM_BG_DELTAS = {
    'cm-bg-hover':   -2,   // light-mode only: 2 steps lighter than bg (bg+2 toward white)
    'cm-bg-pressed': -3    // light-mode only: 3 steps lighter than bg
  };

  function makeEmptyT2() {
    var out = {};
    ['light','dark'].forEach(function (mode) {
      out[mode] = {};
      T2_SURFACES.forEach(function (s) { out[mode][s.id] = {}; });
    });
    return out;
  }

  /* Anchor step for a surface's `bg` cell. Honors a user override
     stored on the bg cell; otherwise returns the per-mode default
     from T2_BASE_STEPS. This is what all other props on the surface
     offset from, so an override here cascades family-wide. */
  function surfaceBaseStep(surfaceId, mode) {
    var bgOv = State.t2 && State.t2[mode] && State.t2[mode][surfaceId] && State.t2[mode][surfaceId]['bg'];
    if (bgOv && bgOv.step && ALL_STEPS.indexOf(bgOv.step) >= 0) return bgOv.step;
    return (T2_BASE_STEPS[mode] && T2_BASE_STEPS[mode][surfaceId]) || '500';
  }
  function defaultT2Step(surfaceId, propId, mode) {
    var prop = propDefById(propId);
    if (!prop) return surfaceBaseStep(surfaceId, mode);
    if (!prop.parent) return surfaceBaseStep(surfaceId, mode); // bg = root
    // Walk: parent's RESOLVED step (so user's parent override
    // cascades into the child's default) + this prop's delta.
    var parentStep = resolveT2Step(surfaceId, prop.parent, mode);
    // Inverse surface compresses + reverses cm-bg elevation: the
    // bg sits adjacent to the palette extreme (light-mode inverse
    // bg = 900, dark-mode inverse bg = white) so the regular
    // +1 / +2 "darker" hover/pressed deltas clamp into the wall
    // and produce no visible motion. The natural "raised" feel on
    // an inverse panel goes back TOWARD the palette center —
    // matching the direction cm-bg itself offsets from bg. Magnitudes
    // are also compressed by one step: hover = 0 (same as cm-bg —
    // no motion required to read as resting), pressed = 1 step
    // toward center (subtle press indicator). cm-outline subtree
    // is still handled by POLARITY_SENSITIVE below.
    if (surfaceId === 'inverse' && INVERSE_CM_BG_DELTAS.hasOwnProperty(propId) && mode === 'light') {
      return stepRel(parentStep, INVERSE_CM_BG_DELTAS[propId] * tonalDir(mode));
    }
    // Polarity: most props (subtle/strong/outline/separator/ct-*/
    // cm-outline*/cm-separator) encode "contrast against bg" and
    // assume bg sits at the LIGHT end of its mode's palette. For
    // a polarity-inverted surface like `inverse` (bg pinned at the
    // dark end in light mode), those deltas have to flip or
    // ct-default falls past the end of the ladder and clamps back
    // onto bg — invisible text.
    //
    // In DARK mode the inverse bg is ALSO at step 900 (always-dark
    // surface — snackbars/toasts). tonalDir('dark')=-1 already drives
    // deltas toward lighter steps, so a second polarity flip here
    // would double-negate and push tokens PAST step 900 into 'black'.
    // Only apply the polarity flip in light mode. cm-bg/cm-bg-hover/
    // cm-bg-pressed encode ELEVATION — direction-agnostic, no flip.
    var polarity = (surfaceId === 'inverse' && isPolaritySensitive(propId) && mode === 'light') ? -1 : 1;
    var resolved = stepRel(parentStep, prop.defaultDelta * tonalDir(mode) * polarity);
    // cm-bg wall-clamp recovery: delta=-1 (lighter) on a bg that IS already at
    // the wall (white in light / black in dark) clamps back to bg, making
    // cm-bg === bg and displaying "0 FROM BG". Instead, step one notch in the
    // DARKER direction so the component bg is always distinct from its surface.
    if (propId === 'cm-bg' && resolved === parentStep) {
      resolved = stepRel(parentStep, 1 * tonalDir(mode));
    }
    return resolved;
  }
  function resolveT2Step(surfaceId, propId, mode) {
    var ov = State.t2 && State.t2[mode] && State.t2[mode][surfaceId] && State.t2[mode][surfaceId][propId];
    if (ov && ov.step && ALL_STEPS.indexOf(ov.step) >= 0) return ov.step;
    return defaultT2Step(surfaceId, propId, mode);
  }
  /* True if any cell in this surface (either mode) differs from the
     last-published baseline. Empty bag === clean. After save-as-
     default copies the current bag into t2Baseline, every override
     becomes part of the baseline and isT2Changed returns false. */
  function isT2Changed(surfaceId) {
    if (isSurfacePaletteCustom(surfaceId)) return true;
    return ['light','dark'].some(function (mode) {
      var cur = (State.t2 && State.t2[mode] && State.t2[mode][surfaceId]) || {};
      var base = (State.t2Baseline && State.t2Baseline[mode] && State.t2Baseline[mode][surfaceId]) || {};
      var keys = {};
      Object.keys(cur).forEach(function (k) { keys[k] = 1; });
      Object.keys(base).forEach(function (k) { keys[k] = 1; });
      return Object.keys(keys).some(function (propId) {
        var c = cur[propId]  || {};
        var b = base[propId] || {};
        return (c.step || null)    !== (b.step || null)
            || (c.follows || null) !== (b.follows || null);
      });
    });
  }
  function totalT2Changes() {
    return T2_SURFACES.reduce(function (n, s) { return n + (isT2Changed(s.id) ? 1 : 0); }, 0);
  }

  /* Family grouping for the T2 renderer — order matters, it's what
     the user sees top-to-bottom in the editing pane. 4 families:
     Surface tones, Edges, Content, Component. Each card shows its
     anchor reference (parent of the family's root prop) for context. */
  var T2_FAMILIES = [
    { id:'surface',   label:'Surface',   anchorRef:null  /* bg IS the anchor */ },
    { id:'borders',   label:'Borders',   anchorRef:'bg' },
    { id:'content',   label:'Content',   anchorRef:'bg' },
    { id:'component', label:'Component', anchorRef:'bg' }
  ];

  /* ── System surface palettes (brand-coupled) ──────────
     Two ship by default and are available to every project:
       greyscale   — chroma 0, achromatic ladder. Hue tracks
                     brand but is invisible at C=0; included so
                     the cache invalidates when brand changes
                     and the math stays consistent if a future
                     T0 control lifts chroma slightly ("warm grey").
       desaturated — low chroma (0.04 OKLCH C ≈ Tailwind "slate"),
                     hue tracks brand. Reads as branded gray.
     Both seed from brand's hue and use the PaletteEngine's
     normalized anchor mode (tone curve independent of seed L*),
     so the L* ladder ("lighting legacy") is identical to brand's
     and identical between greyscale + desaturated — only chroma
     differs. That's the property the user asked us to preserve. */
  var SYSTEM_PALETTE_IDS = { brand:1, danger:1, success:1, warning:1, info:1, greyscale:1, desaturated:1 };
  var SYSTEM_PALETTE_CHROMA = { greyscale: 0, desaturated: 0.04 };
  var _systemPaletteCache = {};

  function brandSeedHex() {
    if (State.proposed && State.proposed.brand) return State.proposed.brand;
    var cs = getComputedStyle(document.documentElement);
    return (cs.getPropertyValue('--prim-brand-500').trim() || '#3366F0');
  }
  function systemPaletteSeed(paletteId) {
    var brandHex = brandSeedHex();
    var oklch = window.PaletteEngine.hexToOklch(brandHex);
    var brandH = oklch[2];
    var chroma = SYSTEM_PALETTE_CHROMA[paletteId];
    if (chroma == null) chroma = 0;
    /* Seed L* doesn't matter in normalized-anchor mode — the engine
       re-derives every step's L from TONE_SCALE. Only keyC + keyH
       drive the ladder's chroma decay + hue. Use L=0.6 (≈step 500
       luminance) so the seed lives inside sRGB for any hue. */
    return window.PaletteEngine.oklchToHex(0.6, chroma, brandH);
  }
  function systemPaletteSteps(paletteId) {
    if (_systemPaletteCache[paletteId]) return _systemPaletteCache[paletteId];
    var seed = systemPaletteSeed(paletteId);
    _systemPaletteCache[paletteId] = window.PaletteEngine.generatePalette(seed, { anchor: 'normalized' }).steps;
    return _systemPaletteCache[paletteId];
  }

  /* ── Custom palettes (project-level, discovered) ──────
     Any --prim-<name>-500 token in the loaded primitives.css that
     isn't a system palette id is registered as a custom palette
     and surfaced under "Custom palettes" in the source-palette
     picker. Writer Handhelds' "neutral" palette gets picked up
     this way without any rename or migration. The ladder is read
     directly from the project's existing 22-step CSS variables
     (not regenerated) so custom palette colors stay byte-identical
     to what the project has shipped. */
  var _customPalettesCache = null;
  function discoverCustomPalettes() {
    if (_customPalettesCache) return _customPalettesCache;
    var found = {};
    var sheets = document.styleSheets;
    for (var i = 0; i < sheets.length; i++) {
      // Only consider THIS project's primitives sheet. Without
      // this scope check the package defaults
      // (packages/tokens/src/primitives.css ships --prim-neutral-*
      // because writer-handhelds needed it) bleed in as a "Custom
      // palette: Neutral" on every brand-new project.
      var sheetHref = sheets[i].href || '';
      var sheetNode = sheets[i].ownerNode;
      var isProjectSheet = (sheetNode && sheetNode.id === 'ev2-project-primitives')
        || /\/projects\/[^/]+\/primitives\.css/.test(sheetHref);
      if (!isProjectSheet) continue;
      var crs;
      try { crs = sheets[i].cssRules || sheets[i].rules; } catch (e) { continue; }
      if (!crs) continue;
      for (var j = 0; j < crs.length; j++) {
        var rule = crs[j];
        if (!rule.style) continue;
        for (var k = 0; k < rule.style.length; k++) {
          var p = rule.style[k];
          var m = /^--prim-([a-z][a-z0-9-]*)-500$/.exec(p);
          if (m && !SYSTEM_PALETTE_IDS[m[1]]) found[m[1]] = 1;
        }
      }
    }
    _customPalettesCache = Object.keys(found).map(function (id) {
      return {
        id: id,
        label: id.charAt(0).toUpperCase() + id.slice(1),
        desc: 'Custom palette \u2014 --prim-' + id + '-*'
      };
    });
    return _customPalettesCache;
  }
  function customPaletteSteps(paletteId) {
    if (_systemPaletteCache[paletteId]) return _systemPaletteCache[paletteId];
    var cs = getComputedStyle(document.documentElement);
    var first = cs.getPropertyValue('--prim-' + paletteId + '-' + ALL_STEPS[1]).trim();
    if (!first) return null;
    /* Read every step name from --prim-<id>-<step>; gaps fall back
       to engine-generated values from --prim-<id>-500 so a partial
       custom palette still renders something sensible. */
    var ladder = ALL_STEPS.map(function (name) {
      if (name === 'white') return { name:'white', hex:'#FFFFFF' };
      if (name === 'black') return { name:'black', hex:'#000000' };
      var v = cs.getPropertyValue('--prim-' + paletteId + '-' + name).trim();
      return { name: name, hex: v || null };
    });
    var missing = ladder.some(function (s) { return !s.hex; });
    if (missing) {
      var seed = cs.getPropertyValue('--prim-' + paletteId + '-500').trim();
      if (seed) {
        var gen = window.PaletteEngine.generatePalette(seed, { anchor:'normalized' }).steps;
        var byName = {};
        gen.forEach(function (s) { byName[s.name] = s.hex; });
        ladder = ladder.map(function (s) { return { name: s.name, hex: s.hex || byName[s.name] || '#888' }; });
      }
    }
    _systemPaletteCache[paletteId] = ladder;
    return ladder;
  }

  /* Resolve a T2 cell to its hex value by walking the surface's
     source palette ladder. Used for swatches + WCAG math. */
  function t2HexFor(surfaceId, propId, mode) {
    var step = resolveT2Step(surfaceId, propId, mode);
    var ladder = t2LadderFor(surfaceId);
    if (!ladder) return '#000';
    for (var i = 0; i < ladder.length; i++) {
      if (ladder[i].name === step) return ladder[i].hex;
    }
    return '#000';
  }

  /* ── T2 surface → source-palette mapping (user-overridable) ──
     Each surface declares a DEFAULT source palette in T2_SURFACES
     (neutral for page bgs, brand for accent, etc.). Designers can
     remap any surface to a different role's ladder at runtime via
     the picker in the surface header. Stored flat (NOT per-mode
     — palette source is the role-ladder name, and the ladder itself
     already has light/dark behaviour baked in via tonalDir).

     Override survives a step pick: switching Accent from `brand`
     to `info` keeps your CUSTOM step names; they just resolve
     against the new ladder. That's the whole point — you've tuned
     the elevation/contrast shape and you want to audition it
     against a different hue without losing the work. */
  function surfacePaletteFor(surfaceId) {
    var ov = State.t2SurfacePalette && State.t2SurfacePalette[surfaceId];
    if (ov && isValidSurfacePalette(ov)) return ov;
    var def = T2_SURFACES.find(function (s) { return s.id === surfaceId; });
    return def ? def.palette : 'greyscale';
  }
  function isSurfacePaletteCustom(surfaceId) {
    var def = T2_SURFACES.find(function (s) { return s.id === surfaceId; });
    if (!def) return false;
    var current  = surfacePaletteFor(surfaceId);
    // Baseline takes precedence over the hardcoded T2_SURFACES default
    // once the user has published — "custom" means "differs from the
    // last snapshot", not "differs from factory defaults".
    var baseline = (State.t2SurfacePaletteBaseline && State.t2SurfacePaletteBaseline[surfaceId])
                || def.palette;
    return current !== baseline;
  }
  function t2LadderFor(surfaceId) {
    var pal = surfacePaletteFor(surfaceId);
    if (pal === 'greyscale' || pal === 'desaturated') return systemPaletteSteps(pal);
    if (pal === 'brand' || pal === 'danger' || pal === 'success' || pal === 'warning' || pal === 'info') return stepsFor(pal);
    /* Custom palette (discovered from --prim-<id>-* tokens) */
    var custom = customPaletteSteps(pal);
    if (custom) return custom;
    /* Last-resort fallback if palette id is stale and points
       nowhere: greyscale keeps surfaces neutral instead of black. */
    return systemPaletteSteps('greyscale');
  }
  function isValidSurfacePalette(id) {
    if (SURFACE_PALETTE_OK[id]) return true;
    var customs = discoverCustomPalettes();
    for (var i = 0; i < customs.length; i++) if (customs[i].id === id) return true;
    return false;
  }
  /* Source-palette options for the custom popover picker.
     - DEFAULTS section (system-level, ship with every project):
         Greyscale   — brand-coupled, C=0 (true achromatic)
         Desaturated — brand-coupled, low chroma (≈ Tailwind slate)
         Brand       — the project's primary hue
       Status palettes (danger/success/info/warning) are intentionally
       NOT offered as surfaces — they're alert palettes (toasts,
       badges, callouts) and a "Danger" page bg has no real use
       case.
     - CUSTOM section: project-level palettes discovered at runtime
       from --prim-<name>-* tokens in primitives.css. Writer
       Handhelds' own "Neutral" palette surfaces here.
     SURFACE_PALETTE_OPTIONS (flat) + SURFACE_PALETTE_OK stay as
     the validation source for system palette ids; isValidSurfacePalette
     additionally consults discoverCustomPalettes() so a saved
     custom-palette override survives draft load. */
  var SURFACE_PALETTE_DEFAULTS = [
    { id:'greyscale',   label:'Greyscale',   desc:'Achromatic ladder, tracks brand hue at C=0' },
    { id:'desaturated', label:'Desaturated', desc:'Low-chroma branded gray, tracks brand hue' },
    { id:'brand',       label:'Brand',       desc:'Your project\u2019s primary hue'             }
  ];
  function buildSurfacePaletteGroups() {
    var customs = discoverCustomPalettes();
    return [
      { id:'defaults', label:'Default palettes', options: SURFACE_PALETTE_DEFAULTS.slice() },
      {
        id:'custom',
        label:'Custom palettes',
        options: customs,
        emptyState: customs.length ? null
          : 'No custom palettes in this project. Add a --prim-<name>-* ladder to surface one here.'
      }
    ];
  }
  var SURFACE_PALETTE_OPTIONS = SURFACE_PALETTE_DEFAULTS.slice();
  var SURFACE_PALETTE_OK = SURFACE_PALETTE_OPTIONS.reduce(function (m, o) { m[o.id] = true; return m; }, {});
  function paletteOptionFor(id) {
    for (var i = 0; i < SURFACE_PALETTE_DEFAULTS.length; i++) {
      if (SURFACE_PALETTE_DEFAULTS[i].id === id) return SURFACE_PALETTE_DEFAULTS[i];
    }
    var customs = discoverCustomPalettes();
    for (var j = 0; j < customs.length; j++) {
      if (customs[j].id === id) return customs[j];
    }
    return null;
  }

  var State = {
    activeTier: 't0',
    activeRole: 'brand',
    activeSurface: 'base',
    editingMode:'light',
    anchor:     'exact',
    baselineAnchor: 'exact',
    baseline:   {},
    proposed:   {},
    cachedSteps:{},
    // T1 lever state per editing mode. Light and dark each get their
    // own snapshot so users can dial in different step picks per mode.
    // Picks are step names from ALL_STEPS ('25'..'900'). The 5×2×3
    // defaults seeded here come straight from T1_DEFAULT_STEPS — the
    // exact same numbers that ship in the CSS output.
    t1: {
      light: {
        brand:   defaultT1ForRole('brand',   'light'),
        danger:  defaultT1ForRole('danger',  'light'),
        success: defaultT1ForRole('success', 'light'),
        warning: defaultT1ForRole('warning', 'light'),
        info:    defaultT1ForRole('info',    'light')
      },
      dark: {
        brand:   defaultT1ForRole('brand',   'dark'),
        danger:  defaultT1ForRole('danger',  'dark'),
        success: defaultT1ForRole('success', 'dark'),
        warning: defaultT1ForRole('warning', 'dark'),
        info:    defaultT1ForRole('info',    'dark')
      }
    },
    // Snapshot of t1 picks AFTER boot-time auto-AA-fix. This is the
    // "clean" baseline the change counter and Discard compare against,
    // so a Discard that re-applies auto-fix doesn't count its own
    // legitimate AA shifts as user changes.
    t1Baseline: {
      light: {
        brand:   defaultT1ForRole('brand',   'light'),
        danger:  defaultT1ForRole('danger',  'light'),
        success: defaultT1ForRole('success', 'light'),
        warning: defaultT1ForRole('warning', 'light'),
        info:    defaultT1ForRole('info',    'light')
      },
      dark: {
        brand:   defaultT1ForRole('brand',   'dark'),
        danger:  defaultT1ForRole('danger',  'dark'),
        success: defaultT1ForRole('success', 'dark'),
        warning: defaultT1ForRole('warning', 'dark'),
        info:    defaultT1ForRole('info',    'dark')
      }
    },
    // T2 Surfaces override map. Empty objects mean "use defaults for
    // every property". Step-4 renderer reads via resolveT2Step().
    // Keyed by [mode][surfaceId][propId] → { step?: '500', follows?: 'role.fill' }.
    // baseline mirrors t1Baseline: snapshot of overrides considered
    // "clean" so Discard / dirty-count don't compare against an
    // empty bag if seeding logic ever lands.
    t2:         makeEmptyT2(),
    t2Baseline: makeEmptyT2(),
    // Per-surface source-palette overrides. Keyed by surfaceId →
    // role id ('brand' / 'danger' / 'info' / 'success' / 'warning' /
    // 'neutral'). Absence means "use the default declared in
    // T2_SURFACES". Validated against SURFACE_PALETTE_OK on load.
    t2SurfacePalette: {},
    // Baseline mirror for surface-palette overrides. Promoted from
    // t2SurfacePalette on save-as-default so 'CUSTOM' pills clear
    // once the user publishes their picks as the new defaults.
    t2SurfacePaletteBaseline: {},
    // Tt Typography state. Phase 1: preset id + optional per-role
    // override strings (CSS font-family stacks). Persistence keys
    // mirror standalone demo/typography.html so the two surfaces
    // share state: dtf-typo-overrides-<projectId>.
    // `preset` = active preset id, OR the literal 'custom' when the
    // user picked their own fonts via the Custom Fonts dialog.
    // `custom` = the user's last picks {headline, body, code} — kept
    // even when the user switches back to a preset, so the Custom
    // card retains its labels.
    typo: { preset: 'neutral-system', overrides: { headline: '', body: '', code: '' }, custom: { headline: '', body: '', code: '' }, customFontFiles: { headline: null, body: null, code: null }, density: 'base' },
    // T0 sub-view selector. 'roles' = key-color editing for the 6
    // primary roles; 'palettes' = inventory + CRUD for the system
    // and custom palettes that surfaces consume in T2. Palette
    // *definition* lives in T0 (here); palette *consumption* lives
    // in T2 (surface→palette mapping).
    activeT0: 'roles',
    // Disclosure open-state persists across role / tier swaps.
    // Keyed by 'tierId:discId' so each tier can have its own pattern.
    // 't0:steps' starts OPEN so the 20-step ladder is visible the
    // moment a role is selected — this is the primary thing the user
    // came to T0 to see, hiding it behind a disclosure was a paper-cut.
    disclosure: { 't0:steps': true, 't0:affects': false, 't1:slots': false, 't1:affects': false },
    focusedLever: null,
    lastSavedAt: null
  };

  var DRAFT_KEY = 'dtf-editor-v2-draft-v2';
  var UI_KEY    = 'dtf-editor-v2-ui-v1';

  /* Per-project draft key. Drafts are project-scoped: editing
     project A and then switching to project B must NOT carry A's
     proposed.brand override into B. The global DRAFT_KEY remains
     as a legacy fallback for sessions started before scoping
     existed — read once, then promoted to the project-scoped key
     on first save. */
  function getDraftKey() {
    var id = '';
    try { id = localStorage.getItem('dtf-active-project') || ''; } catch (e) {}
    return id ? (DRAFT_KEY + '--' + id) : DRAFT_KEY;
  }

  /* ──────────────────────────────────────────────────────────
     Phase 3-lite: invalidate(key) dispatcher.

     Problem this solves: mutations (setHex, setT1Fill, applyPreset…)
     historically remembered which DOM panels to patch by hand. Over
     time this drifted — e.g. `setHex` invalidated the system-palette
     CACHE but forgot to repaint the system-palette DOM, leaving stale
     desaturated swatches on screen. Every silent miss is a bug.

     Solution: declare named "invalidation keys" with a fixed dep map.
     Each panel registers a patcher once. Mutations call invalidate(key)
     and the dispatcher fans out to every registered patcher for that
     key (and its fan-out keys). Unknown keys throw — so a typo or a
     missing registration is loud at dev time, not silent at runtime.

     Migration is incremental: new mutations should use invalidate();
     legacy hand-rolled DOM patches stay until each one is converted.
     The bridge case (`setHex` brand block) is converted below as the
     first usage. */
  var Invalidator = (function () {
    var patchers = Object.create(null); // key → [fn,…]
    /* DEP_MAP: which patcher keys does a logical event fan out to?
       Mutations call invalidate('event-key') and we walk the deps. */
    var DEP_MAP = {
      // Brand hue changed → surface palettes (greyscale/desaturated)
      // are re-seeded from brand's hue, so the System palettes panel
      // must repaint.
      'brand:hue': ['systemPalettesPanel']
    };
    function register(key, fn) {
      if (!patchers[key]) patchers[key] = [];
      patchers[key].push(fn);
    }
    function invalidate(key) {
      var deps = DEP_MAP[key];
      if (!deps) {
        // Loud failure: typos in keys must not silently no-op.
        throw new Error('Invalidator: unknown key "' + key + '" — add it to DEP_MAP');
      }
      for (var i = 0; i < deps.length; i++) {
        var panelKey = deps[i];
        var fns = patchers[panelKey];
        if (!fns || !fns.length) {
          // Patcher not yet registered (boot race) — silently skip.
          // First invalidate after registration will catch up.
          continue;
        }
        for (var j = 0; j < fns.length; j++) {
          try { fns[j](); } catch (e) {
            try { console.warn('Invalidator: patcher for "' + panelKey + '" threw', e); } catch (_e) {}
          }
        }
      }
    }
    return { register: register, invalidate: invalidate };
  })();

  /* Patcher: System palettes panel (T0 "System" tab).
     Swap innerHTML in place — no full T0 re-render so we don't
     kill the color picker's focus during a drag at 60Hz. The
     panel itself has no inputs, so replaceChild is safe. */
  Invalidator.register('systemPalettesPanel', function () {
    var sysPanel = document.querySelector('[data-sp-panel="system"]');
    if (!sysPanel || typeof renderSystemPalettesPanel !== 'function') return;
    var wrap = document.createElement('div');
    wrap.innerHTML = renderSystemPalettesPanel();
    var fresh = wrap.firstChild;
    if (fresh) sysPanel.parentNode.replaceChild(fresh, sysPanel);
  });

  /* ── UI state persistence (separate from draft — it survives Discard) ── */
  function saveUIState() {
    try {
      localStorage.setItem(UI_KEY, JSON.stringify({
        v: 1,
        activeTier: State.activeTier,
        activeRole: State.activeRole,
        activeT0:   State.activeT0,
        activeSurface: State.activeSurface,
        anchor:     State.anchor,
        baselineAnchor: State.baselineAnchor,
        disclosure: State.disclosure,
        mode: document.documentElement.getAttribute('data-theme') || 'light',
        showCss: !!document.body.classList.contains('ev2-show-css'),
        focusedLever: State.focusedLever || null
      }));
    } catch (e) {}
  }
  function loadUIState() {
    try {
      var raw = localStorage.getItem(UI_KEY);
      if (!raw) return null;
      var d = JSON.parse(raw);
      if (!d || d.v !== 1) return null;
      return d;
    } catch (e) { return null; }
  }

  var $listTitle = document.getElementById('listTitle');
  var $listSub   = document.getElementById('listSub');
  var $body      = document.getElementById('tokenListBody');
  var $frame     = document.getElementById('previewFrame');
  // The inline script in index.html fetches preview.html and sets
  // srcdoc to bypass X-Frame-Options headers on Zoho Pages hosting.
  // Only fall back to src= if srcdoc was never set (e.g. file:// open).
  if ($frame && !$frame.srcdoc && !$frame.src) {
    fetch('./preview.html?v=' + Date.now())
      .then(function(r){ return r.text(); })
      .then(function(html){ if($frame) $frame.srcdoc = html; })
      .catch(function(){ if($frame && !$frame.src) $frame.src = './preview.html?v=' + Date.now(); });
  }
  var $changeCt  = document.getElementById('changeCount');
  var $deploy    = document.getElementById('deployBtn');
  var $discard   = document.getElementById('discardBtn');
  var $deployN   = document.querySelector('.ev2-deploy-count');
  var $autosave  = document.getElementById('autosaveStatus');
  var $reload    = document.getElementById('previewReload');

  function readBaseline() {
    var cs = getComputedStyle(document.documentElement);
    ROLES.forEach(function (r) {
      var v = cs.getPropertyValue('--prim-' + r.prefix + '-500').trim();
      State.baseline[r.id] = v || '#000000';
      State.proposed[r.id] = State.baseline[r.id];
    });
    // Snapshot the anchor mode that goes WITH this baseline so a
    // subsequent exact↔normalized flip is detected as a change.
    State.baselineAnchor = State.anchor;
  }

  /* Lever metadata — just label + sub. The picker UI renders the
     full 20-step palette strip directly from ALL_STEPS; no preset
     enumeration lives here. */
  var T1_LEVERS = [
    { id: 'fill',      label: 'Component fill', sub: 'Solid backgrounds (buttons, badges, fills)' },
    { id: 'content',   label: 'Content',        sub: 'Text and icons rendered in this colour' },
    { id: 'container', label: 'Container',      sub: 'Soft tinted surfaces (alert bg, banners)' }
  ];

  /* Auto-derived cards on T1. Each ships with a sensible default
     computed from the three primary levers, BUT every one is
     overridable from its Property Card (stepper, ladder, reset).
       - border / separator: walk container ± offset in the mode-
         direction with headroom (stepRelToward).
       - on-component: white-or-black, whichever beats the fill.
       - on-container: nearest content step that AA-passes vs the
         container; falls back to the closest available step.
     State keys (per mode per role):
       borderStep, separatorStep, onComponent, onContainerStep
     Each is undefined when following the derivation. */
  var T1_DERIVED = [
    { id: 'cmBorder',     label: 'Component outline',   sub: 'Outline drawn around the component fill (border on outlined/ghost variants)' },
    { id: 'cmSeparator',  label: 'Component separator', sub: 'Dividers drawn on the component fill (split-buttons, segmented controls)' },
    { id: 'border',       label: 'Container border',    sub: 'Outline drawn around the container surface' },
    { id: 'separator',    label: 'Container separator', sub: 'Dividers inside the container surface' },
    { id: 'onComponent',  label: 'On-component',        sub: 'Text + icons on the component fill. Picker shows white, black, and any palette step that passes AA on every fill state.' },
    { id: 'onContainer',  label: 'On-container',        sub: 'Text drawn on the container surface' },
    { id: 'contentSubtle',  label: 'Content subtle',       sub: 'De-emphasized text (captions, placeholders). Lighter than content-default.' },
    { id: 'contentStrong',  label: 'Content strong',       sub: 'Emphasized text (headings, active links). Darker than content-default.' },
    { id: 'fillHover',       label: 'Component fill hover',   sub: 'Fill on pointer hover (buttons, chips). One step darker than default.' },
    { id: 'fillPressed',     label: 'Component fill pressed', sub: 'Fill on press/active state. Two steps darker than default.' },
    { id: 'cmBorderHover',   label: 'Outline hover',          sub: 'Component outline on pointer hover.' },
    { id: 'cmBorderPressed', label: 'Outline pressed',        sub: 'Component outline on press/active state.' }
  ];

  function isChanged(roleId) {
    return State.proposed[roleId].toUpperCase() !== State.baseline[roleId].toUpperCase();
  }
  function isT1ChangedInMode(roleId, mode) {
    var t = State.t1[mode][roleId];
    var b = (State.t1Baseline && State.t1Baseline[mode] && State.t1Baseline[mode][roleId])
         || defaultT1ForRole(roleId, mode);
    return t.fill !== b.fill || t.content !== b.content || t.container !== b.container
        || (t.borderStep      || null) !== (b.borderStep      || null)
        || (t.separatorStep   || null) !== (b.separatorStep   || null)
        || (t.cmBorderStep    || null) !== (b.cmBorderStep    || null)
        || (t.cmSeparatorStep || null) !== (b.cmSeparatorStep || null)
        || (t.onComponent     || null) !== (b.onComponent     || null)
        || (t.onContainerStep || null) !== (b.onContainerStep || null)
        || (t.contentSubtleStep    || null) !== (b.contentSubtleStep    || null)
        || (t.contentStrongStep    || null) !== (b.contentStrongStep    || null)
        || (t.fillHoverStep        || null) !== (b.fillHoverStep        || null)
        || (t.fillPressedStep      || null) !== (b.fillPressedStep      || null)
        || (t.cmBorderHoverStep    || null) !== (b.cmBorderHoverStep    || null)
        || (t.cmBorderPressedStep  || null) !== (b.cmBorderPressedStep  || null);
  }
  function isT1Changed(roleId) {
    return isT1ChangedInMode(roleId, 'light') || isT1ChangedInMode(roleId, 'dark');
  }
  function isRoleDirty(roleId) { return isChanged(roleId) || isT1Changed(roleId); }

  /* Diff every lever in both modes — returns
     [{mode, lever, fromStep, toStep}, ...]. Used to populate the
     per-role badge tooltip and the per-role count. */
  function summarizeRoleChanges(roleId) {
    var diffs = [];
    ['light','dark'].forEach(function (mode) {
      var t = State.t1[mode][roleId];
      var b = (State.t1Baseline && State.t1Baseline[mode] && State.t1Baseline[mode][roleId])
           || defaultT1ForRole(roleId, mode);
      ['fill','content','container'].forEach(function (lever) {
        if (t[lever] !== b[lever]) diffs.push({ mode: mode, lever: lever, fromStep: b[lever], toStep: t[lever] });
      });
      // Optional levers: only count as a diff if they DIFFER from
      // the baseline. The previous version counted any set value as
      // a change, which was harmless when these were always null at
      // boot but broke once hydrators (seedT1FromConfig /
      // seedT1FromSemanticCSS) started pinning them from the
      // published file \u2014 producing 8 phantom diffs per role
      // (4 levers x 2 modes) that disagreed with the topbar.
      [['borderStep','border'], ['separatorStep','separator'],
       ['cmBorderStep','cmBorder'], ['cmSeparatorStep','cmSeparator'],
       ['onComponent','onComponent'], ['onContainerStep','onContainer'],
       ['contentSubtleStep','contentSubtle'], ['contentStrongStep','contentStrong'],
       ['fillHoverStep','fillHover'], ['fillPressedStep','fillPressed'],
       ['cmBorderHoverStep','cmBorderHover'], ['cmBorderPressedStep','cmBorderPressed']
      ].forEach(function (pair) {
        var key = pair[0], label = pair[1];
        var tv = t[key] || null;
        var bv = b[key] || null;
        if (tv !== bv) {
          diffs.push({ mode: mode, lever: label,
                       fromStep: bv || 'auto',
                       toStep:   tv || 'auto' });
        }
      });
    });
    return diffs;
  }
  function badgeTipFor(roleId) {
    var diffs = summarizeRoleChanges(roleId);
    if (!diffs.length) return '';
    var labels = {
      fill:'Fill', content:'Content', container:'Container',
      border:'Container border', separator:'Container separator',
      cmBorder:'Component outline', cmSeparator:'Component separator',
      onComponent:'On-component', onContainer:'On-container',
      contentSubtle:'Content subtle', contentStrong:'Content strong',
      fillHover:'Fill hover', fillPressed:'Fill pressed',
      cmBorderHover:'Outline hover', cmBorderPressed:'Outline pressed'
    };
    return diffs.map(function (d) {
      var modeLabel = d.mode === 'dark' ? 'Dark' : 'Light';
      return modeLabel + ' · ' + labels[d.lever] + ': step ' + d.fromStep + ' → step ' + d.toStep;
    }).join('   •   ');
  }
  function totalChanges() {
    var n = ROLES.reduce(function (acc, r) { return acc + (isRoleDirty(r.id) ? 1 : 0); }, 0);
    n += totalT2Changes();
    /* Typography is a separate section — count it once if the user
       has drifted from the project's published baseline. */
    if (typeof tierTtChangeCount === 'function') n += tierTtChangeCount();
    if (State.anchor !== State.baselineAnchor) n += 1;
    return n;
  }

  function stepsFor(roleId) {
    var key = State.proposed[roleId] + '|' + State.anchor;
    if (State.cachedSteps[roleId] && State.cachedSteps[roleId].__key === key) {
      return State.cachedSteps[roleId];
    }
    var palette = window.PaletteEngine.generatePalette(State.proposed[roleId], { anchor: State.anchor });
    palette.steps.__key = key;
    State.cachedSteps[roleId] = palette.steps;
    return palette.steps;
  }
  function baselineStepsFor(roleId) {
    return window.PaletteEngine.generatePalette(State.baseline[roleId], { anchor: State.anchor }).steps;
  }

  function stepHexByName(roleId, name) {
    var steps = stepsFor(roleId);
    for (var i = 0; i < steps.length; i++) if (steps[i].name === name) return steps[i].hex;
    return null;
  }

  /* ── WCAG contrast helpers ───────────────────────────── */
  /* All math lives in DTFSolver (./solver.js). These thin shims
     keep the existing call sites readable and let us swap the
     engine without touching every callsite. */
  function contrastRatio(a, b)              { return DTFSolver.contrastRatio(a, b); }
  function wcagJudge(ratio, isLargeText)    { return DTFSolver.wcagJudge(ratio, isLargeText); }
  function surfaceBgFor(mode)               { return DTFSolver.surfaceBgFor(mode); }

  /* Build the role's ladder (name → hex map) for the solver. */
  function ladderFor(roleId) {
    return DTFSolver.ladderFromSteps(stepsFor(roleId));
  }

  // Auto-pair: pick black or white text for a filled component fill,
  // whichever has higher WCAG contrast against the WORST of the
  // three fill states (default + hover + pressed). Hover/pressed
  // share the same on-component value (one foreground token, no
  // flicker), so the colour must be readable on all of them \u2014
  // testing default alone produces white-on-light-pressed or
  // black-on-dark-pressed failures (Pearl brand caught this).
  // User override = `t.onComponent` wins. Allowed values:
  //   'white' / 'black' \u2014 fixed canonical picks (always offered).
  //   any ALL_STEPS name \u2014 a palette step. Only palette steps that
  //   AA-pass against ALL three fill states show up in the picker
  //   (see onComponentAllowedSteps), so an override here is always
  //   meaningful even if not strictly white/black.
  function onComponentColor(roleId, mode) {
    if (!roleId) return '#FFFFFF';
    var t = State.t1[mode || State.editingMode][roleId];
    if (t.onComponent) {
      var ovHex = onComponentHexFor(roleId, t.onComponent);
      if (ovHex) return ovHex;
    }
    var fillStep = t.fill;
    // Fills derived the same way semanticVarsFor() does — respect
    // overrides so the AA test sees exactly the values that ship.
    var hoverStep   = t.fillHoverStep   || stepRel(fillStep, 1);
    var pressedStep = t.fillPressedStep || stepRel(fillStep, 2);
    var fills = [
      stepHexByName(roleId, fillStep),
      stepHexByName(roleId, hoverStep),
      stepHexByName(roleId, pressedStep)
    ].filter(Boolean);
    if (!fills.length) fills = ['#000'];
    return DTFSolver.deriveOnComponent(fills);
  }

  /* Hex for an on-component step name. 'white' and 'black' are
     the FIXED canonical picks (#FFFFFF + #0A0A0A, warmer than
     pure black for OLED) \u2014 they intentionally do NOT come from
     the role palette so that pinning "white" stays white when
     the user swaps brand colours. Other step names resolve from
     the role's own ladder so a designer can pick e.g. brand-50
     as a tinted on-component if it AA-passes. */
  function onComponentHexFor(roleId, step) {
    if (step === 'white') return '#FFFFFF';
    if (step === 'black') return '#0A0A0A';
    return stepHexByName(roleId, step) || null;
  }

  /* Build the set of step names allowed in the on-component picker
     for this role + mode. Always returns 'white' + 'black' first
     (familiar canonical picks), then any palette step (25..900)
     whose WORST-CASE contrast against [default, hover, pressed]
     fills passes AA 4.5:1. Extra picks are sorted by worst-state
     ratio descending so the safest tinted options surface first.
     Why filter rather than show everything: a palette step that
     fails AA on hover/pressed would silently ship inaccessible
     text. The picker is the safety rail \u2014 if a step isn't here,
     it isn't a valid on-component choice for this role's fills. */
  function onComponentAllowedSteps(roleId, mode) {
    var base = ['white', 'black'];
    var t = State.t1[mode][roleId];
    if (!t) return base;
    var hoverStep   = t.fillHoverStep   || stepRel(t.fill, 1);
    var pressedStep = t.fillPressedStep || stepRel(t.fill, 2);
    var fills = [
      stepHexByName(roleId, t.fill),
      stepHexByName(roleId, hoverStep),
      stepHexByName(roleId, pressedStep)
    ].filter(Boolean);
    if (!fills.length) return base;
    var ladder = ladderFor(roleId);
    var extra = [];
    ALL_STEPS.forEach(function (s) {
      if (s === 'white' || s === 'black') return;
      var hex = ladder[s];
      if (!hex) return;
      var minR = Infinity;
      for (var i = 0; i < fills.length; i++) {
        var r = contrastRatio(hex, fills[i]);
        if (r < minR) minR = r;
      }
      if (minR >= 4.5) extra.push({ step: s, ratio: minR });
    });
    extra.sort(function (a, b) { return b.ratio - a.ratio; });
    return base.concat(extra.map(function (e) { return e.step; }));
  }
  // Auto-pair: pick the ladder step (closest to the user's chosen
  // content-default) that passes AA against the active container.
  // User override = `t.onContainerStep` (a step name) wins when set.
  function onContainerColor(roleId, mode) {
    mode = mode || State.editingMode;
    var t = State.t1[mode][roleId];
    var ladder = ladderFor(roleId);
    if (t.onContainerStep && ALL_STEPS.indexOf(t.onContainerStep) >= 0) {
      return ladder[t.onContainerStep] || ladder[t.content] || '#000';
    }
    var containerHex = ladder[t.container] || surfaceBgFor(mode);
    return DTFSolver.deriveOnContainer(ladder, t.content, containerHex).hex;
  }
  // Step name that on-container currently resolves to (for the
  // Property Card's "current step" badge and the ladder's data-current).
  function onContainerStepName(roleId, mode) {
    mode = mode || State.editingMode;
    var t = State.t1[mode][roleId];
    if (t.onContainerStep && ALL_STEPS.indexOf(t.onContainerStep) >= 0) return t.onContainerStep;
    var ladder = ladderFor(roleId);
    var containerHex = ladder[t.container] || surfaceBgFor(mode);
    return DTFSolver.deriveOnContainer(ladder, t.content, containerHex).step;
  }

  /* Aggregate contrast for the 3 currently-picked levers of a role */
  function computeRoleContrast(roleId, mode) {
    mode = mode || State.editingMode;
    var t = State.t1[mode][roleId];
    var ev = DTFSolver.evaluateBySteps(ladderFor(roleId), t, mode);
    return { checks: ev.checks, onComp: ev.onComp, onCont: ev.onCont };
  }

  /* Walk each lever to the nearest AA-passing step (minimum disturbance).
     Mutates State.t1 in place so existing callers' side-effects stay. */
  function autoFixT1ToAA(roleId) {
    var mode = State.editingMode;
    var t = State.t1[mode][roleId];
    var ladder = ladderFor(roleId);
    t.fill      = DTFSolver.snapStepToAA(ladder, 'fill',      t.fill,      t, mode);
    t.content   = DTFSolver.snapStepToAA(ladder, 'content',   t.content,   t, mode);
    // Container's AA depends on the (now-snapped) content step.
    t.container = DTFSolver.snapStepToAA(ladder, 'container', t.container, t, mode);
  }

  /* Apply auto-AA fix across every role × mode where the picks fail.
     Used at boot and after Discard/Reset to guarantee every cleared
     role still ships AA defaults regardless of which project's
     primitives.css ladder is loaded. */
  function ensureAllRolesPassAA() {
    var savedMode = State.editingMode;
    ['light','dark'].forEach(function (mode) {
      State.editingMode = mode;
      ROLES.forEach(function (r) {
        var wcag = computeRoleContrast(r.id, mode);
        if (wcag.checks.some(function (c) { return !c.pass; })) autoFixT1ToAA(r.id);
      });
    });
    State.editingMode = savedMode;
  }
  function semanticVarsFor(roleId, mode) {
    var t = State.t1[mode][roleId];
    var fillStep      = t.fill;
    var contentStep   = t.content;
    var containerStep = t.container;
    var get = function (name) { return stepHexByName(roleId, name); };
    var p = roleId; // semantic prefix matches role id (brand, danger, ...)
    var lines = [];
    // Component fill family — respect overrides
    var fillHoverStep   = t1DerivedStep(roleId, 'fillHover', mode);
    var fillPressedStep = t1DerivedStep(roleId, 'fillPressed', mode);
    lines.push('  --' + p + '-component-bg-default: ' + get(fillStep) + ';');
    lines.push('  --' + p + '-component-bg-hover: '   + get(fillHoverStep) + ';');
    lines.push('  --' + p + '-component-bg-pressed: ' + get(fillPressedStep) + ';');
    var cmBorderStep = resolveCmBorderStep(roleId, mode);
    var cmBorderHoverStep   = t1DerivedStep(roleId, 'cmBorderHover', mode);
    var cmBorderPressedStep = t1DerivedStep(roleId, 'cmBorderPressed', mode);
    lines.push('  --' + p + '-component-outline-default: ' + get(cmBorderStep) + ';');
    lines.push('  --' + p + '-component-outline-hover: '   + get(cmBorderHoverStep) + ';');
    lines.push('  --' + p + '-component-outline-pressed: ' + get(cmBorderPressedStep) + ';');
    lines.push('  --' + p + '-on-component: ' + onComponentColor(roleId, mode) + ';');
    // Content family — respect overrides
    var contentStrongStep = t1DerivedStep(roleId, 'contentStrong', mode);
    var contentSubtleStep = t1DerivedStep(roleId, 'contentSubtle', mode);
    lines.push('  --' + p + '-content-default: ' + get(contentStep) + ';');
    lines.push('  --' + p + '-content-strong: '  + get(contentStrongStep) + ';');
    lines.push('  --' + p + '-content-subtle: '  + get(contentSubtleStep) + ';');
    lines.push('  --' + p + '-content-faint: '   + get(stepRel(contentStep, -3)) + ';');
    // Container family
    var dir = tonalDir(mode);
    lines.push('  --' + p + '-container-bg: '       + get(containerStep) + ';');
    lines.push('  --' + p + '-container-hover: '    + get(stepRel(containerStep, 1 * dir)) + ';');
    lines.push('  --' + p + '-container-pressed: '  + get(stepRel(containerStep, 2 * dir)) + ';');
    lines.push('  --' + p + '-container-outline: ' + get(resolveBorderStep(roleId, mode)) + ';');
    lines.push('  --' + p + '-container-separator: ' + get(resolveSeparatorStep(roleId, mode)) + ';');
    lines.push('  --' + p + '-component-separator: ' + get(resolveCmSeparatorStep(roleId, mode)) + ';');
    lines.push('  --' + p + '-on-container: ' + onContainerColor(roleId, mode) + ';');
    return lines;
  }

  /* Emit every --surface-<id>-<prop> as a literal hex for one mode.
     Per the "always emit full ladder" pattern: we ship ALL surfaces
     in both modes whether or not anything is detached, so the
     preview's surfaces.css gets fully shadowed by editor state.
     Guarantees the preview's WCAG eye-test matches the editor's
     WCAG math, with no drift between override and clean cells. */
  function surfaceVarsLinesForMode(mode) {
    var out = [];
    T2_SURFACES.forEach(function (s) {
      T2_PROP_DEFS.forEach(function (p) {
        out.push('  --surface-' + s.id + '-' + p.id + ': ' + t2HexFor(s.id, p.id, mode) + ';');
      });
    });
    return out;
  }

  /* The preview is "surface-aware" when the user is on T2: the body
     repaints as the surface being edited. For any other tier we fall
     back to base so the preview is the canonical default.
     V2 \u2014 a manual override dropdown in the preview header (Surface
     family) lets the designer audit any surface without changing what
     they're editing. Empty value = follow the editor (default). */
  var _previewSurfaceOverride = '';
  try { _previewSurfaceOverride = localStorage.getItem('ev2:preview-surface-override') || ''; } catch (e) {}
  function activeSurfaceForPreview() {
    if (_previewSurfaceOverride) return _previewSurfaceOverride;
    if (State.activeTier !== 't2') return 'base';
    return State.activeSurface || 'base';
  }
  function activeTierForPreview() {
    /* When overriding, force t2 so preview.html's CSS gating actually
       paints the canvas with --surface-active-* (it only repaints on
       t2). */
    if (_previewSurfaceOverride) return 't2';
    return State.activeTier;
  }
  function pushActiveSurface() {
    var win = $frame && $frame.contentWindow;
    if (!win) return;
    try {
      win.postMessage({
        type: 'ev2-active-surface',
        surface: activeSurfaceForPreview(),
        tier: activeTierForPreview()
      }, '*');
    } catch (e) {}
  }

  /* Tell the preview canvas to scroll-into-view and flash the
     specific zone painted by --surface-active-<prop>. Used by the
     WCAG popover so the designer SEES where the failing token lives
     and watches it shift when they Apply the suggested step. */
  function pushPvFlash(propId) {
    var win = $frame && $frame.contentWindow;
    if (!win || !propId) return;
    if (State.activeTier !== 't2') return;
    try {
      win.postMessage({ type: 'ev2-pv-flash', prop: propId }, '*');
    } catch (e) {}
  }

  function pushPreview() {
    // contentDocument is null on file:// sandboxed iframes — use postMessage.
    var win = $frame.contentWindow;
    if (!win) return;
    // T0 (palette anchor + ladder) is shared across modes.
    var rootLines = [':root {'];
    ROLES.forEach(function (r) {
      var steps = stepsFor(r.id);
      steps.forEach(function (s) {
        if (s.name === 'white' || s.name === 'black') return;
        rootLines.push('  --prim-' + r.prefix + '-' + s.name + ': ' + s.hex + ';');
      });
      // Light-mode semantic slots also live on :root (default scope).
      semanticVarsFor(r.id, 'light').forEach(function (l) { rootLines.push(l); });
    });
    // T2 surface vars for light mode — same scope as light semantic.
    surfaceVarsLinesForMode('light').forEach(function (l) { rootLines.push(l); });
    rootLines.push('}');
    // Dark-mode semantic + surface slots live under [data-theme="dark"].
    var darkLines = ['[data-theme="dark"] {'];
    ROLES.forEach(function (r) {
      semanticVarsFor(r.id, 'dark').forEach(function (l) { darkLines.push(l); });
    });
    surfaceVarsLinesForMode('dark').forEach(function (l) { darkLines.push(l); });
    darkLines.push('}');
    var cssBundle = rootLines.concat(darkLines).join('\n');
    win.postMessage({ type: 'ev2-overrides', css: cssBundle }, '*');

    /* Broadcast live overrides to other open demo tabs via localStorage.
       Any page running shared.js listens for this storage key change and
       injects it as a high-priority <style> overlay — so the designer
       sees live colour updates everywhere without publishing. The key is
       project-scoped to prevent cross-project bleed. */
    try {
      var livePidKey = 'ev2-live-preview-' + (getActiveProjectId() || '_');
      var prevLive = localStorage.getItem(livePidKey);
      if (prevLive !== cssBundle) localStorage.setItem(livePidKey, cssBundle);
    } catch (_e) {}

    /* Also apply the SAME override bundle to the editor's own document
       so the chrome (which derives from --surface-base-* → --prim-*)
       repaints when the user toggles exact↔normalized or tweaks a key
       color. Without this, the iframe and the editor chrome diverge:
       preview shows the proposed palette, chrome stays on the project's
       shipped values. Same css text → same cascade, both contexts. */
    try {
      var styleId = 'ev2-editor-overrides';
      var styleEl = document.getElementById(styleId);
      if (!styleEl) {
        styleEl = document.createElement('style');
        styleEl.id = styleId;
        document.head.appendChild(styleEl);
      }
      if (styleEl.textContent !== cssBundle) styleEl.textContent = cssBundle;
    } catch (e) {}
    // Tell the preview which role is currently being edited so the
    // contextual cards (Text card, Spotlight alert) reflect that role
    // instead of always showing brand.
    try {
      win.postMessage({ type: 'ev2-active-role', role: State.activeRole }, '*');
    } catch (e) {}
    // Same idea for surface: on T2, repaint preview body on the
    // surface the user is editing. On other tiers, force base.
    pushActiveSurface();
  }

  function refreshChangeBar() {
    var n = totalChanges();
    // Topbar-side counter retired — the canonical change/backup
    // readout is now the second-row #draftStatus pill. Leave the
    // guard so old markup keeps working if anyone restores it.
    if ($changeCt) $changeCt.textContent = n === 0 ? 'No changes' : (n + ' unsaved change' + (n === 1 ? '' : 's'));
    $discard.disabled = n === 0;
    $deploy.disabled  = n === 0;
    // The badge bubble retired — count is folded into the button label.
    if ($deployN) $deployN.hidden = true;
    if ($deploy) {
      var lbl = $deploy.querySelector('.ev2-deploy-label');
      if (lbl) lbl.textContent = n === 0 ? 'Publish' : ('Publish ' + n + ' change' + (n === 1 ? '' : 's'));
    }
    refreshAutosaveLabel();
    refreshSectionResetBtn();
    refreshTierEditToggle();
  }

  function sectionDirtyCount(tierId) {
    var n = 0;
    if (tierId === 't0') {
      ROLES.forEach(function (r) { if (isChanged(r.id)) n++; });
    } else if (tierId === 't1') {
      ROLES.forEach(function (r) { if (isT1Changed(r.id)) n++; });
    } else if (tierId === 't2') {
      n = totalT2Changes();
    } else if (tierId === 'tt') {
      n = tierTtChangeCount();
    }
    return n;
  }

  function refreshSectionResetBtn() {
    var btn = document.getElementById('sectionResetBtn');
    if (!btn) return;
    var tier = State.activeTier;
    // t2 supported even though the render arrives in step 4 — Reset
    // section already needs to flush the (currently empty) override
    // map once step-4 wiring writes to it. Keep t3 unsupported until
    // its own state lands.
    var supported = (tier === 't0' || tier === 't1' || tier === 't2' || tier === 'tt');
    var dirty = supported ? sectionDirtyCount(tier) : 0;
    btn.hidden = !supported;
    btn.disabled = dirty === 0;
    var label = btn.querySelector('.ev2-section-reset-label');
    if (label) {
      var meta = TIER_META[tier];
      label.textContent = 'Reset ' + (meta && meta.title ? meta.title : 'section');
    }
  }

  /* Editing Light/Dark toggle — global editor state that applies to
     both T1 (per-mode lever edits) and T2 (per-mode surface bg). It
     used to live inside each role card / surface header which buried
     a tier-level control inside a per-item context. Now persistent in
     the page header; only visible where the toggle is meaningful. */
  function refreshTierEditToggle() {
    var wrap = document.getElementById('tierEditToggle');
    if (!wrap) return;
    var showOn = (State.activeTier === 't1' || State.activeTier === 't2');
    wrap.hidden = !showOn;
    if (!showOn) return;
    var mode = State.editingMode;
    wrap.querySelectorAll('.ev2-edit-mode').forEach(function (b) {
      b.setAttribute('aria-checked', String(b.getAttribute('data-edit-mode') === mode));
    });
  }

  function refreshAutosaveLabel() {
    // Legacy hook — the topbar autosave chip was retired in favour of
    // the single #draftStatus pill in the tier rail (which already
    // says "N unsaved changes · backed up Xs ago"). Kept as a no-op
    // so old call sites don't crash; if $autosave is ever restored,
    // it will still show the same text the pill shows.
    if (!$autosave) return;
    var n = totalChanges();
    if (n === 0 || !State.lastSavedAt) { $autosave.textContent = ''; return; }
    $autosave.textContent = 'backed up ' + relTime(State.lastSavedAt);
  }

  function relTime(ts) {
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 5) return 'just now';
    if (s < 60) return s + 's ago';
    var m = Math.floor(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.floor(m / 60);
    return h + 'h ago';
  }

  /* ── Local autosave (Step 6 will add server draft branch) ─ */
  var saveTimer = null;

  /* Phase 2: read the HEAD version (the version this draft is
     'based on'). Stamped into every saved draft so on next load
     we can detect republishes that happened while a draft was open.
     Falls back to '' when no published version exists yet (fresh
     project, pre-Phase-1 cache). */
  function currentHeadVersion() {
    if (State.lastPublishedVersion) return State.lastPublishedVersion;
    try {
      var cfg = readProjectConfigSync();
      if (cfg && cfg.latestVersion && cfg.latestVersion.version) return cfg.latestVersion.version;
    } catch (_e) {}
    return '';
  }

  function scheduleAutosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      try {
        var payload = {
          v: 1,
          ts: Date.now(),
          baseVersion: currentHeadVersion(),
          anchor: State.anchor,
          editingMode: State.editingMode,
          proposed: State.proposed,
          t1: State.t1,
          t2: State.t2,
          t2SurfacePalette: State.t2SurfacePalette
        };
        localStorage.setItem(getDraftKey(), JSON.stringify(payload));
        State.lastSavedAt = payload.ts;
        refreshDraftStatus('saved');
        refreshAutosaveLabel();
      } catch (e) {
        refreshDraftStatus('error');
      }
    }, 600);
    refreshDraftStatus('saving');
  }

  function loadDraftFromStorage() {
    try {
      var key = getDraftKey();
      var raw = localStorage.getItem(key);
      // One-shot cleanup: the bare DRAFT_KEY existed before per-
      // project scoping (4839a09). It cannot be safely migrated to
      // a specific project because we no longer know which project
      // it was created for — adopting it would re-pollute whatever
      // project happens to load next. Just delete it.
      if (key !== DRAFT_KEY) {
        try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
      }
      if (!raw) return false;
      var d = JSON.parse(raw);
      if (!d || d.v !== 1 || !d.proposed) return false;
      var STEP_OK = {};
      ALL_STEPS.forEach(function (s) { STEP_OK[s] = true; });
      function adoptT1(target, src) {
        if (!src) return;
        if (STEP_OK[src.fill])      target.fill = src.fill;
        if (STEP_OK[src.content])   target.content = src.content;
        if (STEP_OK[src.container]) target.container = src.container;
      }
      ROLES.forEach(function (r) {
        if (d.proposed[r.id]) State.proposed[r.id] = d.proposed[r.id];
        if (!d.t1) return;
        if (d.t1.light || d.t1.dark) {
          adoptT1(State.t1.light[r.id], d.t1.light && d.t1.light[r.id]);
          adoptT1(State.t1.dark[r.id],  d.t1.dark  && d.t1.dark[r.id]);
        } else if (d.t1[r.id]) {
          adoptT1(State.t1.light[r.id], d.t1[r.id]);
          adoptT1(State.t1.dark[r.id],  d.t1[r.id]);
        }
      });
      // T2 adoption \u2014 schema is { mode: { surfaceId: { propId: {step?,follows?} } } }.
      // We validate each leaf against ALL_STEPS / known surface+prop
      // ids so a stale or corrupted draft can't poison the override
      // map. Unknown keys are silently dropped.
      if (d.t2 && typeof d.t2 === 'object') {
        migrateLegacyT2Keys(d.t2);  // container/over-container \u2192 card/modal (in-place)
        var PROP_OK = {};
        T2_PROP_DEFS.forEach(function (p) { PROP_OK[p.id] = true; });
        ['light','dark'].forEach(function (mode) {
          var srcMode = d.t2[mode];
          if (!srcMode || typeof srcMode !== 'object') return;
          T2_SURFACES.forEach(function (s) {
            var srcSurf = srcMode[s.id];
            if (!srcSurf || typeof srcSurf !== 'object') return;
            Object.keys(srcSurf).forEach(function (propId) {
              if (!PROP_OK[propId]) return;
              var raw = srcSurf[propId];
              if (!raw || typeof raw !== 'object') return;
              var clean = {};
              if (raw.step && STEP_OK[raw.step]) clean.step = raw.step;
              if (typeof raw.follows === 'string' && raw.follows) clean.follows = raw.follows;
              if (clean.step || clean.follows) State.t2[mode][s.id][propId] = clean;
            });
          });
        });
      }
      if (d.editingMode === 'light' || d.editingMode === 'dark') State.editingMode = d.editingMode;
      if (d.anchor === 'exact' || d.anchor === 'normalized') State.anchor = d.anchor;
      // Per-surface source palette — validated against system
      // palette ids AND discovered custom palettes (so a custom
      // pick saved in a prior session survives draft load).
      if (d.t2SurfacePalette && typeof d.t2SurfacePalette === 'object') {
        // Migrate legacy ids (container/over-container \u2192 card/modal) before validation.
        Object.keys(T2_LEGACY_RENAME).forEach(function (oldK) {
          if (Object.prototype.hasOwnProperty.call(d.t2SurfacePalette, oldK)) {
            var newK = T2_LEGACY_RENAME[oldK];
            if (!d.t2SurfacePalette[newK]) d.t2SurfacePalette[newK] = d.t2SurfacePalette[oldK];
            delete d.t2SurfacePalette[oldK];
          }
        });
        T2_SURFACES.forEach(function (s) {
          var v = d.t2SurfacePalette[s.id];
          if (typeof v === 'string' && isValidSurfacePalette(v)) {
            State.t2SurfacePalette[s.id] = v;
          }
        });
      }
      State.lastSavedAt = d.ts || null;
      // Phase 2: surface the baseVersion the draft was saved against
      // so initConflictBanner() can detect a republish.
      State.draftBaseVersion = d.baseVersion || '';
      return totalChanges() > 0;
    } catch (e) { return false; }
  }

  function clearDraftFromStorage() {
    try { localStorage.removeItem(getDraftKey()); } catch (e) {}
    // Also nuke the legacy global key so it can't resurface on the
    // next load and re-pollute another project.
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
    // Clear the live-preview broadcast so other tabs stop showing
    // unpublished overrides once the user discards or publishes.
    try {
      var lpKey = 'ev2-live-preview-' + (getActiveProjectId() || '_');
      localStorage.removeItem(lpKey);
    } catch (_e) {}
    State.lastSavedAt = null;
  }

  function refreshDraftStatus(state) {
    if (!draftStatus) return;
    draftStatus.setAttribute('data-state', state);
    var label = draftStatus.querySelector('.ev2-draft-text');
    if (!label) return;
    var n = (typeof totalChanges === 'function') ? totalChanges() : 0;
    if (state === 'saving') label.textContent = 'Saving\u2026';
    else if (state === 'saved') {
      // "7 unsaved changes · backed up 2m ago" when dirty,
      // else fall through to the clean state.
      if (n > 0) label.textContent = n + ' unsaved change' + (n === 1 ? '' : 's') + ' \u00b7 backed up ' + relTime(State.lastSavedAt);
      else if (State.lastPublishedVersion) label.textContent = 'Published ' + State.lastPublishedVersion + ' \u00b7 ' + relTime(State.lastSavedAt || Date.now());
      else label.textContent = 'No changes';
    }
    else if (state === 'error') label.textContent = 'Backup failed \u2014 changes only in this tab';
    else if (state === 'published') {
      var v = State.lastPublishedVersion;
      label.textContent = v ? ('Published ' + v + ' \u00b7 just now') : 'Published \u00b7 just now';
    }
    else {
      if (n > 0) label.textContent = n + ' unsaved change' + (n === 1 ? '' : 's');
      else if (State.lastPublishedVersion) label.textContent = 'Published ' + State.lastPublishedVersion;
      else label.textContent = 'No changes yet';
    }
    // Tooltip explains what "backed up" actually means — local draft
    // in this browser, not pushed to GitHub. Includes the exact
    // wall-clock time so the user can cross-check.
    if (n > 0 && State.lastSavedAt) {
      var d = new Date(State.lastSavedAt);
      var hh = String(d.getHours()).padStart(2,'0');
      var mm = String(d.getMinutes()).padStart(2,'0');
      var ss = String(d.getSeconds()).padStart(2,'0');
      draftStatus.setAttribute('data-tip',
        'Saved to this browser at ' + hh + ':' + mm + ':' + ss +
        '. Local draft only \u2014 not yet published to GitHub. ' +
        'Use Publish to release a version every collaborator can pull.');
    } else {
      draftStatus.removeAttribute('data-tip');
    }
  }

  // Tick the relative timestamp every 30s so it stays honest
  setInterval(function () {
    if (State.lastSavedAt) { refreshDraftStatus('saved'); refreshAutosaveLabel(); }
  }, 30000);

  /* ── Unified palette ladder ──────────────────────────────
     Single renderer for every "22-step ladder of swatches" surface
     in the editor. T0 Roles, T0 System palettes, T0 Custom palettes
     all share this so a Greyscale ladder reads visually identical to
     a Brand ladder.

     opts:
       prefix       — CSS-var prefix ('brand', 'greyscale', 'sage'…)
                      used to render `--prim-<prefix>-<step>` under
                      each swatch when "Show CSS names" is on.
       compareSteps — optional array of {name,hex} to diff against
                      (T0 Roles uses this to mark changed-from-baseline
                      tiles with the brand dot).
       includeBW    — when true, render white + black tiles too
                      (System / Custom palettes use this; T0 Roles
                      skips them since white/black are constants). */
  function paletteLadderHTML(steps, opts) {
    if (!steps || !steps.length) return '';
    opts = opts || {};
    var prefix = opts.prefix || '';
    var compare = opts.compareSteps || null;
    var filtered = opts.includeBW
      ? steps
      : steps.filter(function (s) { return s.name !== 'white' && s.name !== 'black'; });
    return filtered.map(function (s) {
      var b = compare && compare.find(function (x) { return x.name === s.name; });
      var diff = b && b.hex && b.hex.toUpperCase() !== s.hex.toUpperCase();
      var tip = diff
        ? 'Was ' + b.hex.toUpperCase() + ' \u2192 now ' + s.hex.toUpperCase()
        : s.hex.toUpperCase();
      return '<div class="ev2-step"' + (diff ? ' data-changed="true"' : '') + ' title="' + tip + '">'
        + '<div class="ev2-step-sw" style="background:' + s.hex + '"></div>'
        + '<div class="ev2-step-meta">'
          + '<div class="ev2-step-name">' + s.name + '</div>'
          + '<div class="ev2-step-hex">' + s.hex.replace('#','') + '</div>'
          + (prefix ? '<div class="ev2-step-css">--prim-' + prefix + '-' + s.name + '</div>' : '')
        + '</div>'
      + '</div>';
    }).join('');
  }

  function ladderHTML(role) {
    var roleObj = ROLES.find(function (r) { return r.id === role; });
    return paletteLadderHTML(stepsFor(role), {
      prefix: roleObj ? roleObj.prefix : role,
      compareSteps: baselineStepsFor(role)
    });
  }

  /* ── T0 view ──────────────────────────────────────────────
     Sub-tabs: [ Roles | Palettes ].
       Roles    — key-color editing for the 6 primary roles
                  (brand, danger, warning, info, success, neutral).
       Palettes — inventory + CRUD for the system + custom palettes
                  that T2 surfaces consume. This is where palettes
                  are *defined*; T2 is where they're *mapped* to
                  surfaces. */
  function renderT0() {
    // Role intent card on top, then the palette library panels
    // (system + custom) flow beneath it in one scroll — same
    // 'foundation colors' tier, no separate sub-view.
    $body.innerHTML = renderT0Roles() + renderT0Palettes();
    bindT0();
  }

  function renderT0Roles() {
    var role = ROLES.find(function (r) { return r.id === State.activeRole; });
    if (!role) return '';
    var changedThisRole = isChanged(role.id);
    var affects = AFFECTS[role.id] || [];

    return ''
      + '<div class="ev2-intent">'
        + '<div class="ev2-roles" role="tablist" aria-label="Role">'
          + ROLES.map(function (r) {
              var current = r.id === role.id;
              return '<button class="ev2-role" role="tab" data-role-tab="' + r.id + '" '
                + 'aria-current="' + current + '" data-changed="' + isChanged(r.id) + '">'
                + '<span class="ev2-role-dot" style="background:' + State.proposed[r.id] + '"></span>'
                + '<span>' + r.label + '</span>'
                + '</button>';
            }).join('')
        + '</div>'
        + '<div class="ev2-intent-body">'
          + '<div class="ev2-lever">'
            + '<label class="ev2-swatch" style="background:' + State.proposed[role.id] + '" title="Pick a color">'
              + '<input type="color" id="ev2-color" value="' + State.proposed[role.id] + '">'
            + '</label>'
            + '<div class="ev2-lever-fields">'
              + '<div class="ev2-hex-row">'
                + '<input class="ev2-hex" id="ev2-hex" type="text" spellcheck="false" '
                  + 'value="' + State.proposed[role.id].toUpperCase() + '" maxlength="7">'
                + '<button class="ev2-reset" id="ev2-reset" type="button"' + (changedThisRole ? '' : ' disabled') + '>Reset</button>'
              + '</div>'
              + '<div class="ev2-anchor" role="radiogroup" aria-label="Step 500 anchor">'
                + '<button data-anchor="exact" aria-checked="' + (State.anchor === 'exact') + '" role="radio" '
                  + 'data-tip="Step 500 = your exact hex. Neighbor steps remap around it. Best when you have a brand color you must match precisely.">'
                  + 'Exact match</button>'
                + '<button data-anchor="normalized" aria-checked="' + (State.anchor === 'normalized') + '" role="radio" '
                  + 'data-tip="Step 500 snaps to the standard L*=49 lightness curve. Best for new brands &mdash; gives the most balanced ladder across all 20 steps.">'
                  + 'Normalized</button>'
              + '</div>'
            + '</div>'
          + '</div>'
          + '<div class="ev2-disc"' + (State.disclosure['t0:steps'] ? ' data-open' : '') + ' data-disc="t0:steps">'
            + '<div class="ev2-disc-head" data-toggle="steps">'
              + '<span>20 derived steps</span>'
              + '<span class="ev2-disc-meta">' + (changedThisRole ? 'before \u2192 after' : 'auto-generated') + '</span>'
            + '</div>'
            + '<div class="ev2-disc-body">'
              + '<div class="ev2-ladder">' + ladderHTML(role.id) + '</div>'
            + '</div>'
          + '</div>'
          + '<div class="ev2-disc"' + (State.disclosure['t0:affects'] ? ' data-open' : '') + ' data-disc="t0:affects">'
            + '<div class="ev2-disc-head" data-toggle="affects">'
              + '<span>Affects components</span>'
              + '<span class="ev2-disc-meta">' + affects.length + ' shown</span>'
            + '</div>'
            + '<div class="ev2-disc-body">'
              + '<div class="ev2-affects">'
                + affects.map(function (c) { return '<span class="ev2-aff-chip">' + c + '</span>'; }).join('')
              + '</div>'
            + '</div>'
          + '</div>'
        + '</div>'
      + '</div>';
  }

  /* ── T0 Palettes sub-view ───────────────────────────────
     Two stacked panels: system palettes (greyscale + desaturated,
     read-only — chroma sliders come later) and custom palettes
     (project-discovered + session-added, with Rename / Delete +
     "Add palette" affordance). Each row renders the same ladder
     component the Roles view uses so all ladders read identical. */
  function renderT0Palettes() {
    return ''
      + renderSystemPalettesPanel()
      + renderCustomPalettesPanel();
  }

  function renderSystemPalettesPanel() {
    var rows = [
      { id:'greyscale',   label:'Greyscale',   meta:'chroma 0 \u2014 achromatic' },
      { id:'desaturated', label:'Desaturated', meta:'chroma \u22480.04 \u2014 branded gray' }
    ];
    return '<div class="ev2-sp-panel" data-sp-panel="system">'
      + '<div class="ev2-sp-head">'
        + '<div class="ev2-sp-titlewrap">'
          + '<span class="ev2-sp-title">System palettes</span>'
          + '<span class="ev2-sp-sub">Auto-derived from Brand \u2014 used for surface backgrounds</span>'
        + '</div>'
      + '</div>'
      + '<div class="ev2-sp-list">'
        + rows.map(function (r) {
            var steps = systemPaletteSteps(r.id);
            return '<div class="ev2-sp-row" data-sp-palette="' + r.id + '">'
              + '<div class="ev2-sp-rowhead">'
                + '<span class="ev2-sp-name">' + r.label + '</span>'
                + '<span class="ev2-sp-meta">' + r.meta + '</span>'
              + '</div>'
              + '<div class="ev2-ladder">' + paletteLadderHTML(steps, { prefix: r.id, includeBW: true }) + '</div>'
            + '</div>';
          }).join('')
      + '</div>'
    + '</div>';
  }

  function renderCustomPalettesPanel() {
    var customs = discoverCustomPalettes();
    /* Inline SVG icons \u2014 pencil for rename, trash for delete.
       Kept inline (no icon font) so the editor stays single-file. */
    var ICON_EDIT  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';
    var ICON_TRASH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>';
    return '<div class="ev2-sp-panel" data-sp-panel="custom">'
      + '<div class="ev2-sp-head">'
        + '<div class="ev2-sp-titlewrap">'
          + '<span class="ev2-sp-title">Custom palettes</span>'
          + '<span class="ev2-sp-sub">Project-specific palettes \u2014 available under T2 source palette</span>'
        + '</div>'
        + '<button type="button" class="ev2-sp-add" data-add-palette>'
          + '<span class="ev2-sp-add-glyph" aria-hidden="true">+</span> Add palette'
        + '</button>'
      + '</div>'
      + (customs.length
          ? '<div class="ev2-sp-list">'
              + customs.map(function (c) {
                  var steps = customPaletteSteps(c.id);
                  return '<div class="ev2-sp-row" data-sp-palette="' + c.id + '">'
                    + '<div class="ev2-sp-rowhead">'
                      + '<span class="ev2-sp-name">' + c.label + '</span>'
                      + '<span class="ev2-sp-meta">--prim-' + c.id + '-*</span>'
                      + '<span class="ev2-sp-row-actions">'
                        + '<button type="button" class="ev2-sp-action" data-rename-palette="' + c.id + '" '
                          + 'title="Rename palette" aria-label="Rename ' + c.label + ' palette">' + ICON_EDIT + '</button>'
                        + '<button type="button" class="ev2-sp-action" data-danger data-delete-palette="' + c.id + '" '
                          + 'title="Delete palette" aria-label="Delete ' + c.label + ' palette">' + ICON_TRASH + '</button>'
                      + '</span>'
                    + '</div>'
                    + '<div class="ev2-ladder">' + paletteLadderHTML(steps, { prefix: c.id, includeBW: true }) + '</div>'
                  + '</div>';
                }).join('')
            + '</div>'
          : '<div class="ev2-sp-empty">No custom palettes in this project yet. Add one to surface it under T2 source palette.</div>'
        )
    + '</div>';
  }

  function bindT0() {
    // Role intent + palette library are both always rendered now,
    // so both binding sets run on every T0 render.
    bindT0Roles();
    bindT0Palettes();
  }

  function bindT0Roles() {
    document.querySelectorAll('[data-role-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        State.activeRole = b.getAttribute('data-role-tab');
        saveUIState();
        renderT0();
      });
    });
    document.querySelectorAll('.ev2-disc-head').forEach(function (h) {
      h.addEventListener('click', function () {
        var disc = h.parentElement;
        var key = disc.getAttribute('data-disc');
        var nowOpen = !disc.hasAttribute('data-open');
        if (nowOpen) disc.setAttribute('data-open', '');
        else disc.removeAttribute('data-open');
        if (key) State.disclosure[key] = nowOpen;
        saveUIState();
      });
    });
    document.querySelectorAll('[data-anchor]').forEach(function (b) {
      b.addEventListener('click', function () {
        State.anchor = b.getAttribute('data-anchor');
        State.cachedSteps = {};
        pushPreview();
        renderT0();
        refreshChangeBar();
        scheduleAutosave();
        saveUIState();
      });
    });

    var $color = document.getElementById('ev2-color');
    var $hex   = document.getElementById('ev2-hex');
    var $reset = document.getElementById('ev2-reset');

    if ($color) $color.addEventListener('input', function () { setHex($color.value); });
    if ($hex) $hex.addEventListener('input', function () {
      var v = $hex.value.trim();
      if (!v.startsWith('#')) v = '#' + v;
      if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
        $hex.removeAttribute('aria-invalid');
        setHex(v);
      } else {
        $hex.setAttribute('aria-invalid', 'true');
      }
    });
    if ($reset) $reset.addEventListener('click', function () {
      setHex(State.baseline[State.activeRole]);
      renderT0();
    });
  }

  function bindT0Palettes() {
    var addBtn = document.querySelector('[data-add-palette]');
    if (addBtn) addBtn.addEventListener('click', function () { openAddPaletteDialog(); });

    document.querySelectorAll('[data-rename-palette]').forEach(function (b) {
      b.addEventListener('click', function () {
        openRenamePaletteDialog(b.getAttribute('data-rename-palette'));
      });
    });
    document.querySelectorAll('[data-delete-palette]').forEach(function (b) {
      b.addEventListener('click', function () {
        confirmDeletePalette(b.getAttribute('data-delete-palette'));
      });
    });
  }

  /* ── Add / Rename palette dialog ────────────────────────
     One <dialog>-style modal scaffolded in index.html
     (#ev2AddPalette). Reused for both create + rename:
       mode='add'    \u2192 name + color pickers, live ladder preview,
                       confirm injects a new custom palette.
       mode='rename' \u2192 name picker only; color + ladder hidden.
                       Confirm renames the palette's --prim-<id>-*
                       block and migrates any t2SurfacePalette refs. */
  var _addPalState = { mode: 'add', origId: null, hex: '#6B7390' };

  function openAddPaletteDialog() {
    _addPalState = { mode: 'add', origId: null, hex: '#6B7390' };
    var modal = document.getElementById('ev2AddPalette');
    if (!modal) return;
    document.getElementById('ev2AddPaletteTitle').textContent = 'Add custom palette';
    document.querySelector('#ev2AddPalConfirm').textContent = 'Add palette';
    document.getElementById('ev2AddPalName').value = '';
    document.getElementById('ev2AddPalName').removeAttribute('aria-invalid');
    document.getElementById('ev2AddPalNameHint').removeAttribute('aria-invalid');
    document.getElementById('ev2AddPalNameHint').textContent = 'Lowercase letters, numbers, dashes. Must be unique.';
    document.getElementById('ev2AddPalColor').value = _addPalState.hex.toLowerCase();
    document.getElementById('ev2AddPalHex').value = _addPalState.hex.toUpperCase();
    document.getElementById('ev2AddPalSwatch').style.background = _addPalState.hex;
    /* Show color + ladder fields (rename hides them) */
    var colorField = document.getElementById('ev2AddPalColor').closest('.ev2-addpal-field');
    var stripField = document.getElementById('ev2AddPalStrip').closest('.ev2-addpal-field');
    if (colorField) colorField.style.display = '';
    if (stripField) stripField.style.display = '';
    renderAddPalettePreview();
    showAddPaletteModal();
    setTimeout(function () { document.getElementById('ev2AddPalName').focus(); }, 30);
  }

  function openRenamePaletteDialog(id) {
    var customs = discoverCustomPalettes();
    var existing = customs.find(function (c) { return c.id === id; });
    if (!existing) return;
    _addPalState = { mode: 'rename', origId: id, hex: null };
    var modal = document.getElementById('ev2AddPalette');
    if (!modal) return;
    document.getElementById('ev2AddPaletteTitle').textContent = 'Rename palette';
    document.querySelector('#ev2AddPalConfirm').textContent = 'Rename';
    document.getElementById('ev2AddPalName').value = id;
    document.getElementById('ev2AddPalName').removeAttribute('aria-invalid');
    document.getElementById('ev2AddPalNameHint').removeAttribute('aria-invalid');
    document.getElementById('ev2AddPalNameHint').textContent = 'Lowercase letters, numbers, dashes. Must be unique.';
    /* Hide color + ladder (rename only changes the id, not the colors) */
    var colorField = document.getElementById('ev2AddPalColor').closest('.ev2-addpal-field');
    var stripField = document.getElementById('ev2AddPalStrip').closest('.ev2-addpal-field');
    if (colorField) colorField.style.display = 'none';
    if (stripField) stripField.style.display = 'none';
    validateAddPaletteForm();
    showAddPaletteModal();
    setTimeout(function () {
      var n = document.getElementById('ev2AddPalName');
      n.focus(); n.select();
    }, 30);
  }

  function showAddPaletteModal() {
    var modal = document.getElementById('ev2AddPalette');
    if (!modal) return;
    modal.hidden = false;
    document.body.classList.add('ev2-modal-open');
  }
  function hideAddPaletteModal() {
    var modal = document.getElementById('ev2AddPalette');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('ev2-modal-open');
  }

  /* Live preview re-renders the 22-step ladder strip every time
     the color picker or hex input changes, so designers SEE what
     they're about to add before they confirm. */
  function renderAddPalettePreview() {
    if (_addPalState.mode !== 'add') return;
    var strip = document.getElementById('ev2AddPalStrip');
    if (!strip || !window.PaletteEngine) return;
    try {
      var pal = window.PaletteEngine.generatePalette(_addPalState.hex, { anchor: State.anchor || 'normalized' });
      strip.innerHTML = pal.steps.map(function (s) {
        return '<span class="ev2-sp-sw" style="background:' + s.hex
          + '" title="' + s.name + ' \u2014 ' + s.hex.toUpperCase() + '"></span>';
      }).join('');
    } catch (e) {
      strip.innerHTML = '';
    }
  }

  function validateAddPaletteForm() {
    var name = (document.getElementById('ev2AddPalName').value || '').trim().toLowerCase();
    var hint = document.getElementById('ev2AddPalNameHint');
    var input = document.getElementById('ev2AddPalName');
    var confirmBtn = document.getElementById('ev2AddPalConfirm');
    var ok = true;
    var msg = 'Lowercase letters, numbers, dashes. Must be unique.';
    if (!name) {
      ok = false; msg = 'Name is required.';
    } else if (!/^[a-z][a-z0-9-]*$/.test(name)) {
      ok = false; msg = 'Lowercase letters, numbers, dashes \u2014 must start with a letter.';
    } else if (SYSTEM_PALETTE_IDS[name]) {
      ok = false; msg = '"' + name + '" is a reserved system palette id.';
    } else if (_addPalState.mode === 'add'
               && discoverCustomPalettes().some(function (c) { return c.id === name; })) {
      ok = false; msg = '"' + name + '" already exists.';
    } else if (_addPalState.mode === 'rename'
               && name !== _addPalState.origId
               && discoverCustomPalettes().some(function (c) { return c.id === name; })) {
      ok = false; msg = '"' + name + '" already exists.';
    }
    if (ok) {
      input.removeAttribute('aria-invalid');
      hint.removeAttribute('aria-invalid');
    } else {
      input.setAttribute('aria-invalid', 'true');
      hint.setAttribute('aria-invalid', 'true');
    }
    hint.textContent = msg;
    confirmBtn.disabled = !ok;
    return ok;
  }

  /* Bind the dialog's controls once on boot \u2014 markup is static
     in index.html so wiring happens once, not on each open. */
  function bindAddPaletteDialog() {
    var modal = document.getElementById('ev2AddPalette');
    if (!modal) return;
    modal.querySelectorAll('[data-addpal-dismiss]').forEach(function (el) {
      el.addEventListener('click', hideAddPaletteModal);
    });
    var name = document.getElementById('ev2AddPalName');
    var color = document.getElementById('ev2AddPalColor');
    var hex = document.getElementById('ev2AddPalHex');
    var confirmBtn = document.getElementById('ev2AddPalConfirm');
    if (name) name.addEventListener('input', validateAddPaletteForm);
    if (color) color.addEventListener('input', function () {
      _addPalState.hex = color.value.toUpperCase();
      hex.value = _addPalState.hex;
      hex.removeAttribute('aria-invalid');
      document.getElementById('ev2AddPalSwatch').style.background = _addPalState.hex;
      renderAddPalettePreview();
    });
    if (hex) hex.addEventListener('input', function () {
      var v = hex.value.trim();
      if (!v.startsWith('#')) v = '#' + v;
      if (/^#[0-9A-Fa-f]{6}$/.test(v)) {
        hex.removeAttribute('aria-invalid');
        _addPalState.hex = v.toUpperCase();
        color.value = _addPalState.hex.toLowerCase();
        document.getElementById('ev2AddPalSwatch').style.background = _addPalState.hex;
        renderAddPalettePreview();
      } else {
        hex.setAttribute('aria-invalid', 'true');
      }
    });
    if (confirmBtn) confirmBtn.addEventListener('click', function () {
      if (!validateAddPaletteForm()) return;
      var newName = document.getElementById('ev2AddPalName').value.trim().toLowerCase();
      if (_addPalState.mode === 'add') {
        injectCustomPalette(newName, _addPalState.hex);
        hideAddPaletteModal();
        window.ev2Toast && window.ev2Toast('Added custom palette \u201C' + newName + '\u201D', 'ok');
      } else if (_addPalState.mode === 'rename') {
        if (newName === _addPalState.origId) { hideAddPaletteModal(); return; }
        renameCustomPalette(_addPalState.origId, newName);
        hideAddPaletteModal();
        window.ev2Toast && window.ev2Toast('Renamed to \u201C' + newName + '\u201D', 'ok');
      }
    });
    /* Esc closes */
    modal.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); hideAddPaletteModal(); }
    });
  }

  function confirmDeletePalette(id) {
    var customs = discoverCustomPalettes();
    var c = customs.find(function (x) { return x.id === id; });
    if (!c) return;
    /* Count surfaces currently using this palette so the confirm
       message warns the user that those surfaces will fall back. */
    var refs = 0;
    if (State.t2SurfacePalette) {
      Object.keys(State.t2SurfacePalette).forEach(function (sid) {
        if (State.t2SurfacePalette[sid] === id) refs++;
      });
    }
    var msg = 'Delete custom palette \u201C' + c.label + '\u201D?';
    if (refs > 0) msg += ' ' + refs + ' surface' + (refs === 1 ? '' : 's')
                     + ' will fall back to the default palette.';
    openModal({
      title: 'Delete palette',
      body: msg,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      kind: 'danger',
      onConfirm: function () { deleteCustomPalette(id); }
    });
  }

  /* Build a 22-step ladder from a key hex and inject it as a
     --prim-<id>-* block into BOTH the editor document (so
     customPaletteSteps can read the values via getComputedStyle)
     AND the preview iframe (so the live preview can paint with the
     new palette). Cache invalidation forces discovery to re-scan. */
  function injectCustomPalette(id, keyHex) {
    var palette = window.PaletteEngine.generatePalette(keyHex, { anchor: State.anchor || 'normalized' });
    var cssLines = palette.steps.map(function (s) {
      return '  --prim-' + id + '-' + s.name + ': ' + s.hex + ';';
    });
    var css = ':root {\n' + cssLines.join('\n') + '\n}';
    /* Single shared <style id="ev2-custom-palettes"> holds every
       runtime-injected palette as concatenated :root blocks. We
       index per-id inside the style by data attributes so a future
       "rename / delete" can target one without nuking the others. */
    var styleEl = document.getElementById('ev2-custom-palettes');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'ev2-custom-palettes';
      styleEl.setAttribute('data-ev2-custom', '');
      document.head.appendChild(styleEl);
    }
    /* Append (palette ids are validated unique above). Wrap each
       palette in a marker comment so a future remove-by-id pass
       can splice it out by string search. */
    styleEl.textContent += '\n/* @ev2-custom-palette:' + id + ' */\n' + css + '\n/* @ev2-custom-palette-end:' + id + ' */\n';
    /* Mirror into the preview iframe so previews paint with the
       new palette too. */
    try {
      $frame.contentWindow.postMessage({ type: 'ev2-custom-palette', id: id, css: css }, '*');
    } catch (e) {}
    /* Force discovery + step caches to re-scan. */
    _customPalettesCache = null;
    delete _systemPaletteCache[id];
    /* Re-render T0 (so the new row appears under Custom palettes)
       and T2 if it's active (so picker shows the new option). */
    if (State.activeTier === 't0') renderT0();
    else if (State.activeTier === 't2') renderT2();
  }

  /* ── Rename a custom palette ────────────────────────────
     Splices the existing palette block out of the shared <style>
     and re-injects under the new id. Surfaces using the old id in
     State.t2SurfacePalette are migrated to the new id so the live
     preview doesn't fall back. Mirrored to the iframe via
     postMessage. */
  function renameCustomPalette(oldId, newId) {
    var styleEl = document.getElementById('ev2-custom-palettes');
    if (!styleEl) return;
    var src = styleEl.textContent;
    var start = src.indexOf('/* @ev2-custom-palette:' + oldId + ' */');
    var endMark = '/* @ev2-custom-palette-end:' + oldId + ' */';
    var endIdx = src.indexOf(endMark);
    if (start < 0 || endIdx < 0) return;
    var block = src.slice(start, endIdx + endMark.length);
    /* Swap the id in the block body */
    var newBlock = block
      .replace(new RegExp('@ev2-custom-palette:' + oldId, 'g'), '@ev2-custom-palette:' + newId)
      .replace(new RegExp('@ev2-custom-palette-end:' + oldId, 'g'), '@ev2-custom-palette-end:' + newId)
      .replace(new RegExp('--prim-' + oldId + '-', 'g'), '--prim-' + newId + '-');
    styleEl.textContent = src.slice(0, start) + newBlock + src.slice(endIdx + endMark.length);
    try {
      $frame.contentWindow.postMessage({ type: 'ev2-custom-palette-rename', oldId: oldId, newId: newId }, '*');
    } catch (e) {}
    /* Migrate surface assignments */
    if (State.t2SurfacePalette) {
      Object.keys(State.t2SurfacePalette).forEach(function (sid) {
        if (State.t2SurfacePalette[sid] === oldId) State.t2SurfacePalette[sid] = newId;
      });
    }
    _customPalettesCache = null;
    delete _systemPaletteCache[oldId];
    delete _systemPaletteCache[newId];
    scheduleAutosave();
    if (State.activeTier === 't0') renderT0();
    else if (State.activeTier === 't2') renderT2();
  }

  /* ── Delete a custom palette ────────────────────────────
     Splices the block out, drops any surface assignments pointing
     at it (those surfaces revert to their default palette), and
     tells the preview to remove the injected block. */
  function deleteCustomPalette(id) {
    var styleEl = document.getElementById('ev2-custom-palettes');
    if (styleEl) {
      var src = styleEl.textContent;
      var start = src.indexOf('/* @ev2-custom-palette:' + id + ' */');
      var endMark = '/* @ev2-custom-palette-end:' + id + ' */';
      var endIdx = src.indexOf(endMark);
      if (start >= 0 && endIdx >= 0) {
        styleEl.textContent = src.slice(0, start) + src.slice(endIdx + endMark.length);
      }
    }
    try {
      $frame.contentWindow.postMessage({ type: 'ev2-custom-palette-remove', id: id }, '*');
    } catch (e) {}
    if (State.t2SurfacePalette) {
      Object.keys(State.t2SurfacePalette).forEach(function (sid) {
        if (State.t2SurfacePalette[sid] === id) delete State.t2SurfacePalette[sid];
      });
    }
    _customPalettesCache = null;
    delete _systemPaletteCache[id];
    scheduleAutosave();
    window.ev2Toast && window.ev2Toast('Deleted palette', 'ok');
    if (State.activeTier === 't0') renderT0();
    else if (State.activeTier === 't2') renderT2();
  }

  function setHex(hex) {
    var role = State.activeRole;
    State.proposed[role] = hex.toUpperCase();
    delete State.cachedSteps[role];
    /* Brand drives the system surface palettes (greyscale +
       desaturated are seeded from brand's hue). Invalidate their
       caches so the swatches under T2 repaint against the new
       brand. Other role edits don't affect surfaces. */
    if (role === 'brand') {
      delete _systemPaletteCache.greyscale;
      delete _systemPaletteCache.desaturated;
      /* Phase 3-lite: was a hand-rolled querySelector +
         replaceChild block. Now declarative — the patcher is
         registered once below and any future mutation that affects
         the system palettes (theme change, etc.) just calls
         invalidate('brand:hue') with no repaint code locally. */
      Invalidator.invalidate('brand:hue');
    }
    pushPreview();
    refreshChangeBar();
    scheduleAutosave();

    var swatch = document.querySelector('.ev2-swatch');
    if (swatch) swatch.style.background = State.proposed[role];
    var hexInput = document.getElementById('ev2-hex');
    if (hexInput && document.activeElement !== hexInput) hexInput.value = State.proposed[role];
    var colorInput = document.getElementById('ev2-color');
    if (colorInput && document.activeElement !== colorInput) colorInput.value = State.proposed[role].toLowerCase();
    var dot = document.querySelector('[data-role-tab="' + role + '"] .ev2-role-dot');
    if (dot) dot.style.background = State.proposed[role];
    var tab = document.querySelector('[data-role-tab="' + role + '"]');
    if (tab) tab.setAttribute('data-changed', isChanged(role));
    var reset = document.getElementById('ev2-reset');
    if (reset) reset.disabled = !isChanged(role);

    // Refresh ladder
    var ladder = document.querySelector('.ev2-ladder');
    if (ladder) ladder.innerHTML = ladderHTML(role);

    // Toggle "Changed" pill
    var head = document.querySelector('.ev2-intent-head');
    if (head) {
      var pill = head.querySelector('.ev2-intent-hint');
      var resetBtn = head.querySelector('.ev2-role-reset');
      if (isChanged(role) && !pill) {
        var hint = '<span class="ev2-intent-hint">Edited from defaults</span>';
        if (resetBtn) resetBtn.insertAdjacentHTML('beforebegin', hint);
        else head.insertAdjacentHTML('beforeend', hint);
      } else if (!isChanged(role) && pill) {
        pill.remove();
      }
    }
  }

  function renderTierPlaceholder(tier) {
    var meta = TIER_META[tier];
    var letter = tier === 't1' ? 'b' : tier === 't2' ? 'c' : 'd';
    $body.innerHTML =
      '<div class="ev2-empty">'
        + '<div class="ev2-empty-icon" aria-hidden="true">\u25cc</div>'
        + '<div class="ev2-empty-title">' + meta.title + ' intent coming next</div>'
        + '<div class="ev2-empty-sub">Step 2' + letter + ' wires this tier with the same intent + live-preview pattern as Palette.</div>'
      + '</div>';
  }

  /* ── Tt Typography ────────────────────────────────────
     Phase 1 typography tier. Sits between T0 (palette) and T1
     (roles) because typography is a primitive layer, not a
     semantic one. Five presets cover the common pairings; a
     per-role override field accepts any CSS font stack.
     Persistence keys mirror demo/typography.html so the two
     surfaces share state — picking Editorial Serif here also
     paints the standalone page, and vice versa. */
  var TYPO_PRESETS = [
    { id:'neutral-system',  name:'Neutral System',  vibe:'Safe & fast \u00b7 zero web fonts',
      display:{ headline:'System UI', body:'System UI', code:'SF Mono' },
      fonts:{ headline:'-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
              body:    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
              code:    '"SF Mono", "Fira Code", "Fira Mono", "Roboto Mono", Menlo, Consolas, monospace' } },
    { id:'modern-geometric',name:'Modern Geometric',vibe:'Clean SaaS \u00b7 great for product UI',
      display:{ headline:'Inter', body:'Inter', code:'JetBrains Mono' },
      fonts:{ headline:'Inter, system-ui, -apple-system, sans-serif',
              body:    'Inter, system-ui, -apple-system, sans-serif',
              code:    '"JetBrains Mono", "SF Mono", Menlo, monospace' } },
    { id:'editorial-serif', name:'Editorial Serif', vibe:'Magazine feel \u00b7 strong personality',
      display:{ headline:'Fraunces', body:'Inter', code:'IBM Plex Mono' },
      fonts:{ headline:'Fraunces, Georgia, "Times New Roman", serif',
              body:    'Inter, system-ui, -apple-system, sans-serif',
              code:    '"IBM Plex Mono", "SF Mono", Menlo, monospace' } },
    { id:'friendly-humanist',name:'Friendly Humanist',vibe:'Warm & approachable \u00b7 rounded shapes',
      display:{ headline:'Nunito', body:'Nunito', code:'Source Code Pro' },
      fonts:{ headline:'Nunito, "Trebuchet MS", "Lucida Sans", sans-serif',
              body:    'Nunito, "Trebuchet MS", "Lucida Sans", sans-serif',
              code:    '"Source Code Pro", "SF Mono", Menlo, monospace' } },
    { id:'code-first-mono', name:'Code-first Mono', vibe:'Dev tools \u00b7 terminal vibe everywhere',
      display:{ headline:'SF Mono', body:'SF Mono', code:'SF Mono' },
      fonts:{ headline:'"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
              body:    '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
              code:    '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace' } }
  ];
  var TYPO_ROLES = ['headline', 'body', 'code'];
  var TYPO_ROLE_LABEL = { headline:'Headlines & titles', body:'Paragraphs & UI', code:'Code & numbers' };
  var TYPO_ROLE_PLACEHOLDER = { headline:'e.g. Playfair Display', body:'e.g. Inter', code:'e.g. JetBrains Mono' };

  /* Type density — three-step UI knob that scales the ENTIRE
     font-size ladder by a fixed multiplier. Compact for tight,
     data-dense surfaces (admin tables, file browsers); Base is
     the project's published ladder verbatim; Comfortable widens
     for content-heavy reading apps. Multipliers chosen so the
     base body size (13px) shifts by ~1px each step:
       compact:  13 × 0.92 ≈ 12  (tighter UI)
       base:     13 × 1.00  = 13  (no override)
       comfort:  13 × 1.08 ≈ 14  (slightly larger) */
  var TYPO_DENSITY = { compact: 0.92, base: 1, comfortable: 1.08 };
  /* Line-height pairs to density. Same direction as font-size:
     compact tightens rows so the whole UI compresses (not just
     glyph size); comfortable opens them up for reading.
     Values mirror the --line-height-{snug,normal,relaxed}
     primitives in packages/tokens/src/primitives.css — picking
     existing rungs of the LH ladder instead of inventing
     intermediate ratios. */
  var TYPO_DENSITY_LH = { compact: 1.375, base: 1.5, comfortable: 1.625 };
  var TYPO_DENSITY_LABEL = { compact: 'Compact', base: 'Base', comfortable: 'Comfortable' };
  /* Keep in sync with packages/tokens/src/primitives.css. Each
     entry is the pixel-anchor name of one --font-size-N token.
     The ladder is intentionally non-uniform (jumps at the top
     end) — emitter writes only what we list. */
  var TYPO_FONT_SIZE_LADDER = [10, 11, 12, 13, 14, 16, 18, 20, 24, 26, 28, 32, 40];

  /* System / built-in fonts (installed on every modern OS, or
     guaranteed by every modern browser as fallback). These never
     need a Figma install — what you see in the browser is what
     you see in Figma. Source: same list the mock's "Built-in
     fonts" lane describes. */
  var TYPO_SYSTEM_FAMILIES = {
    'system ui':1, 'system-ui':1, '-apple-system':1, 'blinkmacsystemfont':1,
    'segoe ui':1, 'roboto':1, 'helvetica neue':1, 'helvetica':1, 'arial':1,
    'sans-serif':1, 'serif':1, 'monospace':1,
    'sf mono':1, 'sf pro':1, 'menlo':1, 'monaco':1, 'consolas':1,
    'courier new':1, 'courier':1, 'georgia':1, 'times new roman':1, 'times':1,
    'lucida sans':1, 'lucida grande':1, 'trebuchet ms':1, 'verdana':1, 'tahoma':1
  };
  /* Classify a single font family name. Returns one of:
     'system' — installed everywhere, no Figma action needed
     'google' — on TYPO_GOOGLE_FONTS safelist, needs install in Figma
     'custom' — anything else; user owns the install + license */
  function typoLaneFor(rawFamily) {
    var name = String(rawFamily || '').trim().replace(/^["']|["']$/g, '');
    if (!name) return 'system';
    var lower = name.toLowerCase();
    if (TYPO_SYSTEM_FAMILIES[lower]) return 'system';
    /* TYPO_GOOGLE_FONTS keys are case-sensitive display names. */
    var googleHit = false;
    for (var k in TYPO_GOOGLE_FONTS) {
      if (k.toLowerCase() === lower) { googleHit = true; break; }
    }
    return googleHit ? 'google' : 'custom';
  }
  /* For a preset (or any {headline,body,code} family map), return
     the worst-case Figma-parity status across its three roles.
     'system' if all three are system; 'google' if at least one
     needs Figma install; 'custom' if any is user-owned. */
  function typoParityFor(fonts) {
    if (!fonts) return 'system';
    var ranks = { system:0, google:1, custom:2 };
    var worst = 'system';
    TYPO_ROLES.forEach(function (r) {
      /* fonts.x is a CSS stack like 'Inter, system-ui, sans-serif'
         — read only the FIRST family. That's what actually paints
         when the font is available; fallbacks are degraded states. */
      var first = String(fonts[r] || '').split(',')[0];
      var lane = typoLaneFor(first);
      if (ranks[lane] > ranks[worst]) worst = lane;
    });
    return worst;
  }
  /* Plain-English status text shown at the bottom of each preset
     tile. Tells the user exactly what they have to do (if
     anything) for the font to look the same in Figma. Kept short
     so it fits one line on narrow tiles; the title attribute (set
     in render) carries the long explanation. */
  var TYPO_PARITY_LABEL = {
    system: 'No setup needed',
    google: 'Install the font in Figma',
    custom: 'Bring your own font file'
  };
  var TYPO_PARITY_TITLE = {
    system: 'These fonts come with every computer, so Figma already has them. What you see here is exactly what your designers see.',
    google: 'This is a free Google font. The browser loads it automatically, but Figma needs it installed on each designer\u2019s computer to match.',
    custom: 'A paid or in-house font. You\u2019re responsible for hosting it on your site and installing it on your team\u2019s computers.'
  };

  function typoStorageKey() {
    var pid = (State && State.projectId) || (typeof activeProjectId === 'function' ? activeProjectId() : '');
    return pid ? ('dtf-typo-overrides-' + pid) : 'dtf-typo-overrides';
  }
  /* Baseline = the project's published typography (read from
     config.json typographyConfig.preset). The dirty count compares
     the working State.typo against this. Stored on State so the
     reset / publish flows can see it. */
  function readTypoBaseline() {
    try {
      var cfg = (typeof readProjectConfigSync === 'function') ? readProjectConfigSync() : null;
      var preset = (cfg && cfg.typographyConfig && cfg.typographyConfig.preset) || 'neutral-system';
      var density = (cfg && cfg.typographyConfig && cfg.typographyConfig.density) || 'base';
      var files = (cfg && cfg.typographyConfig && cfg.typographyConfig.customFontFiles) || {};
      return { preset: preset, density: density, overrides: { headline:'', body:'', code:'' }, custom: { headline:'', body:'', code:'' }, customFontFiles: { headline: files.headline || null, body: files.body || null, code: files.code || null } };
    } catch (_e) {
      return { preset: 'neutral-system', density: 'base', overrides: { headline:'', body:'', code:'' }, custom: { headline:'', body:'', code:'' }, customFontFiles: { headline:null, body:null, code:null } };
    }
  }
  function loadTypoState() {
    /* Seed baseline first so dirty checks have a comparator even
       when no saved overrides exist yet. */
    State.typoBaseline = readTypoBaseline();
    /* Initialise working state from baseline, then layer any
       persisted overrides. This guarantees a fresh editor open on
       pearl shows "editorial-serif" as the active preset (the
       project's actual published font), not the hardcoded
       'neutral-system' default. */
    State.typo = {
      preset:    State.typoBaseline.preset,
      density:   State.typoBaseline.density || 'base',
      overrides: { headline:'', body:'', code:'' },
      custom:    { headline:'', body:'', code:'' },
      customFontFiles: {
        headline: (State.typoBaseline.customFontFiles && State.typoBaseline.customFontFiles.headline) || null,
        body:     (State.typoBaseline.customFontFiles && State.typoBaseline.customFontFiles.body)     || null,
        code:     (State.typoBaseline.customFontFiles && State.typoBaseline.customFontFiles.code)     || null
      }
    };
    try {
      var raw = localStorage.getItem(typoStorageKey());
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.preset)    State.typo.preset    = parsed.preset;
          if (parsed.density)   State.typo.density   = parsed.density;
          if (parsed.overrides) State.typo.overrides = parsed.overrides;
          if (parsed.custom)    State.typo.custom    = parsed.custom;
          if (parsed.customFontFiles) State.typo.customFontFiles = parsed.customFontFiles;
        }
      }
    } catch (_e) {}
  }
  /* Returns 1 if any field of State.typo differs from baseline,
     else 0. We deliberately collapse multi-field changes to "1
     dirty section" because the change bar counts SECTIONS, not
     individual deltas (T2 follows the same pattern). */
  function tierTtChangeCount() {
    var b = State.typoBaseline || readTypoBaseline();
    var t = State.typo || {};
    if ((t.preset || '')  !== (b.preset || ''))  return 1;
    if ((t.density || 'base') !== (b.density || 'base')) return 1;
    var roles = ['headline','body','code'];
    for (var i = 0; i < roles.length; i++) {
      var r = roles[i];
      if (((t.overrides || {})[r] || '') !== ((b.overrides || {})[r] || '')) return 1;
      if (((t.custom    || {})[r] || '') !== ((b.custom    || {})[r] || '')) return 1;
      var tf = ((t.customFontFiles || {})[r]) || null;
      var bf = ((b.customFontFiles || {})[r]) || null;
      var tfFamily = (tf && tf.family) || '';
      var bfFamily = (bf && bf.family) || '';
      if (tfFamily !== bfFamily) return 1;
      /* Multi-weight: compare weight sets */
      var tfWeights = tf && tf.files ? tf.files.map(function(fw){return fw.weight;}).sort().join(',') : (tf && tf.dataUrl ? 'legacy' : '');
      var bfWeights = bf && bf.files ? bf.files.map(function(fw){return fw.weight;}).sort().join(',') : (bf && bf.dataUrl ? 'legacy' : '');
      if (tfWeights !== bfWeights) return 1;
    }
    return 0;
  }
  function persistTypoState() {
    /* Strip binary dataUrl bytes before persisting — font files can
       be several MB each and easily blow past the 5 MB localStorage
       quota, causing a silent failure that wipes all custom state.
       We only persist metadata (family, weight list, format) so the
       editor remembers WHICH font was chosen; the raw bytes live
       in-memory only and must be re-uploaded on a fresh session. */
    try {
      var state = JSON.parse(JSON.stringify(State.typo));
      if (state.customFontFiles) {
        Object.keys(state.customFontFiles).forEach(function (r) {
          var f = state.customFontFiles[r];
          if (!f) return;
          if (f.files) {
            /* Multi-weight format: strip dataUrl from each weight entry */
            f.files = f.files.map(function (fw) {
              return { weight: fw.weight, format: fw.format, fileName: fw.fileName };
            });
          } else {
            /* Legacy single-file format */
            delete f.dataUrl;
          }
        });
      }
      localStorage.setItem(typoStorageKey(), JSON.stringify(state));
    } catch (_e) {}
  }
  /* Curated subset of Google Fonts the Custom Fonts dialog
     suggests. Same list as the <datalist> in index.html; kept
     here so we can detect when a picked font is a Google Font
     and lazy-inject the <link rel=stylesheet>. */
  var TYPO_GOOGLE_FONTS = {
    'Inter':1, 'Roboto':1, 'Open Sans':1, 'Lato':1, 'Montserrat':1, 'Poppins':1,
    'Source Sans 3':1, 'Work Sans':1, 'Nunito':1, 'DM Sans':1, 'Manrope':1,
    'Plus Jakarta Sans':1, 'Playfair Display':1, 'Fraunces':1, 'Merriweather':1,
    'Lora':1, 'EB Garamond':1, 'Crimson Pro':1, 'JetBrains Mono':1, 'Fira Code':1,
    'IBM Plex Mono':1, 'Source Code Pro':1, 'Roboto Mono':1, 'Space Mono':1
  };

  /* Build a CSS font-family stack from a raw user-entered family.
     Adds quotes + sensible fallbacks based on whether the family is
     likely a monospaced font. */
  function typoStackFor(role, raw) {
    var name = String(raw || '').trim();
    if (!name) return null;
    var needsQuote = /\s/.test(name) && !/^"|^'/.test(name);
    var quoted = needsQuote ? '"' + name + '"' : name;
    if (role === 'code') return quoted + ', "SF Mono", Menlo, Consolas, monospace';
    return quoted + ', system-ui, -apple-system, sans-serif';
  }

  /* Resolve the effective font stack for each role considering
     preset / custom / per-role override precedence. Returns
     { headline, body, code } as CSS font-family values. */
  function typoResolvedFonts() {
    var preset = TYPO_PRESETS.find(function (p) { return p.id === State.typo.preset; });
    var files = State.typo.customFontFiles || {};
    var out = {};
    TYPO_ROLES.forEach(function (r) {
      var override = (State.typo.overrides && State.typo.overrides[r] || '').trim();
      if (override) { out[r] = override; return; }
      /* Uploaded font file wins over the text-name input for the
         same role — the file IS the source of truth (we can render
         it locally + ship it in config.json), the text name might
         be a future install the user planned. */
      var fdata = files[r];
      if (fdata && fdata.family && (
        fdata.dataUrl ||
        (fdata.files && fdata.files.length && fdata.files.some(function (fw) { return !!fw.dataUrl; }))
      )) {
        out[r] = typoStackFor(r, fdata.family);
        return;
      }
      if (State.typo.preset === 'custom') {
        var c = (State.typo.custom && State.typo.custom[r] || '').trim();
        out[r] = c ? typoStackFor(r, c) : '';
      } else if (preset) {
        out[r] = preset.fonts[r];
      } else {
        out[r] = '';
      }
    });
    return out;
  }

  /* Return per-role "is this family backed by an uploaded file?"
     boolean. Used by install dialog + lane classifier to surface
     embedded fonts as a separate, no-action-required category. */
  function typoIsEmbedded(role) {
    var f = (State.typo.customFontFiles || {})[role];
    if (!f || !f.family) return false;
    /* New multi-weight format: { family, files: [{dataUrl, weight, ...}] } */
    if (f.files && f.files.length) return f.files.some(function (fw) { return !!fw.dataUrl; });
    /* Legacy single-file format: { family, dataUrl, ... } */
    return !!(f.dataUrl);
  }

  /* Bucket the resolved fonts by install-lane (system / google /
     custom / embedded), de-duped across roles. Used by the
     sticky-footer summary AND the install dialog so both views
     agree.
     'embedded' = the user uploaded a .woff2/.woff/.ttf/.otf file
     for the role; we ship the bytes inline so Figma + the web
     preview both render it without a designer install step. */
  function typoInstallBuckets() {
    var resolved = typoResolvedFonts();
    var buckets = { system: [], google: [], custom: [], embedded: [] };
    var seen = {};
    TYPO_ROLES.forEach(function (r) {
      var stack = resolved[r] || '';
      var first = String(stack).split(',')[0].replace(/^["']|["']$/g, '').trim();
      if (!first) return;
      var key = first.toLowerCase();
      if (seen[key]) { seen[key].roles.push(r); return; }
      /* Role-level check FIRST so an uploaded file family lands in
         'embedded' even when its name happens to collide with a
         Google Font (e.g. user uploads their own subset of "Inter"). */
      var lane = typoIsEmbedded(r) ? 'embedded' : typoLaneFor(first);
      var entry = { family: first, lane: lane, roles: [r] };
      buckets[lane].push(entry);
      seen[key] = entry;
    });
    return buckets;
  }
  /* Short one-line summary for the sticky footer pill.
     - All system        → "All fonts ready — no Figma install"
     - Mixed / Google    → "N font(s) to install in Figma"
     - Any custom        → adds "+ M custom" suffix */
  function typoInstallStickyLabel(buckets) {
    var g = buckets.google.length;
    var c = buckets.custom.length;
    var e = buckets.embedded.length;
    if (g === 0 && c === 0) {
      /* All system or all embedded → no Figma install step for anyone. */
      if (e === 0) return { tone: 'ok', label: 'All fonts ready in Figma' };
      return { tone: 'ok', label: 'All fonts embedded \u2014 zero designer install' };
    }
    var parts = [];
    if (g) parts.push(g + ' to install');
    if (c) parts.push(c + ' you supply');
    if (e) parts.push(e + ' embedded');
    return { tone: 'warn', label: parts.join(' \u00b7 ') + ' \u2014 for designers' };
  }
  /* Build the inner HTML of the install dialog body. Pure
     string-return so we can swap it back into the modal each
     time it opens — picking a new preset between opens always
     shows the fresh list. */
  function renderTtInstallDialogBody() {
    var b = typoInstallBuckets();
    var needsAction = b.google.length + b.custom.length;
    var html = '';
    if (needsAction === 0 && b.embedded.length === 0) {
      html += '<div class="ev2-typo-install-ok">'
           +    '<span class="ev2-typo-install-ok-dot" aria-hidden="true"></span>'
           +    '<span><strong>Nothing to install.</strong> All fonts here come with every computer, so Figma already has them.</span>'
           +  '</div>';
      return html;
    }
    html += '<ul class="ev2-typo-install-list">';
    /* Embedded files first — they're the strongest position
       (no designer action at all) so they read as a "win" row. */
    b.embedded.forEach(function (e) {
      html += '<li class="ev2-typo-install-row" data-lane="embedded">'
            +   '<span class="ev2-typo-install-dot" aria-hidden="true"></span>'
            +   '<span class="ev2-typo-install-body">'
            +     '<span class="ev2-typo-install-family">' + e.family + '</span>'
            +     '<span class="ev2-typo-install-roles">' + e.roles.join(' \u00b7 ') + ' \u00b7 embedded file \u2014 no designer install needed</span>'
            +   '</span>'
            + '</li>';
    });
    b.google.forEach(function (e) {
      var url = 'https://fonts.google.com/specimen/' + encodeURIComponent(e.family.replace(/\s+/g, '+'));
      html += '<li class="ev2-typo-install-row" data-lane="google">'
            +   '<span class="ev2-typo-install-dot" aria-hidden="true"></span>'
            +   '<span class="ev2-typo-install-body">'
            +     '<span class="ev2-typo-install-family">' + e.family + '</span>'
            +     '<span class="ev2-typo-install-roles">' + e.roles.join(' \u00b7 ') + '</span>'
            +   '</span>'
            +   '<a class="ev2-typo-install-action" href="' + url + '" target="_blank" rel="noopener">Download \u2197</a>'
            + '</li>';
    });
    b.custom.forEach(function (e) {
      html += '<li class="ev2-typo-install-row" data-lane="custom">'
            +   '<span class="ev2-typo-install-dot" aria-hidden="true"></span>'
            +   '<span class="ev2-typo-install-body">'
            +     '<span class="ev2-typo-install-family">' + e.family + '</span>'
            +     '<span class="ev2-typo-install-roles">' + e.roles.join(' \u00b7 ') + ' \u00b7 you supply the file</span>'
            +   '</span>'
            + '</li>';
    });
    if (b.system.length) {
      html += '<li class="ev2-typo-install-row" data-lane="system">'
            +   '<span class="ev2-typo-install-dot" aria-hidden="true"></span>'
            +   '<span class="ev2-typo-install-body">'
            +     '<span class="ev2-typo-install-family">' + b.system.map(function (e) { return e.family; }).join(', ') + '</span>'
            +     '<span class="ev2-typo-install-roles">Pre-installed \u00b7 no action needed</span>'
            +   '</span>'
            + '</li>';
    }
    html += '</ul>';
    return html;
  }
  function openTtInstallModal() {
    var modal = document.getElementById('ev2TtInstall');
    if (!modal) return;
    var body = document.getElementById('ev2TtInstallBody');
    if (body) body.innerHTML = renderTtInstallDialogBody();
    modal.hidden = false;
    document.body.classList.add('ev2-modal-open');
  }
  function closeTtInstallModal() {
    var modal = document.getElementById('ev2TtInstall');
    if (!modal) return;
    modal.hidden = true;
    document.body.classList.remove('ev2-modal-open');
  }

  function typoCssBundle() {
    var fonts = typoResolvedFonts();
    var lines = [];
    /* Emit @font-face blocks FIRST so the families they declare
       resolve before any consumer (component or preset card)
       references them. Deduplicated by dataUrl so two roles sharing
       the same uploaded family don't produce duplicate blocks.
       New multi-weight format emits one block per weight with a
       specific font-weight value; legacy single-file format uses
       the variable range 100 900. */
    var files = State.typo.customFontFiles || {};
    var seenUrls = {};
    TYPO_ROLES.forEach(function (r) {
      var f = files[r];
      if (!f || !f.family) return;
      var family = '"' + String(f.family).replace(/"/g, '\\"') + '"';
      if (f.files && f.files.length) {
        /* Multi-weight format */
        f.files.forEach(function (fw) {
          if (!fw || !fw.dataUrl || seenUrls[fw.dataUrl]) return;
          seenUrls[fw.dataUrl] = true;
          var fmt = fw.format || 'woff2';
          var wt  = fw.weight || 400;
          lines.push('@font-face {');
          lines.push('  font-family: ' + family + ';');
          lines.push('  src: url("' + fw.dataUrl + '") format("' + fmt + '");');
          lines.push('  font-weight: ' + wt + ';');
          lines.push('  font-style: normal;');
          lines.push('  font-display: swap;');
          lines.push('}');
        });
      } else if (f.dataUrl && !seenUrls[f.dataUrl]) {
        /* Legacy single-file — variable weight range */
        seenUrls[f.dataUrl] = true;
        var fmt = f.format || 'woff2';
        lines.push('@font-face {');
        lines.push('  font-family: ' + family + ';');
        lines.push('  src: url("' + f.dataUrl + '") format("' + fmt + '");');
        lines.push('  font-weight: 100 900;');
        lines.push('  font-style: normal;');
        lines.push('  font-display: swap;');
        lines.push('}');
      }
    });
    lines.push(':root {');
    /* Emit the three semantic role tokens first — these are the
       names the editor's list pane and any future per-role demo
       consumes. */
    TYPO_ROLES.forEach(function (r) {
      if (fonts[r]) lines.push('  --font-family-' + r + ': ' + fonts[r] + ';');
    });
    /* Bridge to the tokens components actually consume:
         body → --font-family-sans   (used by EVERY component)
         code → --font-family-mono   (used by code-content elements)
       Without this, swapping the Tt pairing only changed the editor
       list pane but the preview iframe (real components) didn't
       move because nothing reads --font-family-body/code.        */
    if (fonts.body) lines.push('  --font-family-sans: ' + fonts.body + ';');
    if (fonts.code) lines.push('  --font-family-mono: ' + fonts.code + ';');
    /* Type density — scales the WHOLE font-size ladder by a single
       multiplier. Token NAMES stay stable (--font-size-14 keeps
       its semantic anchor), only their VALUES shift. Compact tightens
       UI for data-dense surfaces; comfortable opens it up for
       content-heavy ones. Component tokens.css files all reference
       --font-size-N primitives, so overriding them at :root re-paints
       every text node in the preview without touching component CSS. */
    var density = (State.typo && State.typo.density) || 'base';
    var mult = TYPO_DENSITY[density] || 1;
    if (mult !== 1) {
      TYPO_FONT_SIZE_LADDER.forEach(function (px) {
        /* Round to 1 decimal — pixel-perfect at common multipliers
           and avoids "13.999999..." float artifacts. Browsers handle
           sub-pixel sizes fine. */
        var v = Math.round(px * mult * 10) / 10;
        lines.push('  --font-size-' + px + ': ' + v + 'px;');
      });
    }
    /* Pair line-height to density. Components reference
       --line-height-normal as their default LH token (see button,
       input tokens.css). Compact shifts the "normal" rung to snug
       (1.375) so rows compress with the smaller glyphs; comfortable
       shifts it to relaxed (1.625) so reading breathes. Base = no
       override (1.5 stays as primitives.css ships it). */
    var lh = TYPO_DENSITY_LH[density];
    if (lh && lh !== TYPO_DENSITY_LH.base) {
      lines.push('  --line-height-normal: ' + lh + ';');
    }
    lines.push('}');
    return lines.join('\n');
  }

  /* Lazy-load Google Fonts <link> tag for any picked family that's
     in our curated list. Single link is reused; families list is
     deduped. Safe to call repeatedly. */
  function ensureGoogleFontsLink() {
    var families = [];
    function add(name) {
      /* Strip wrapping quotes and any trailing fallback list
         (e.g. "Fraunces, serif" → "Fraunces"). The font-family
         stack's FIRST item is the only one we need to load — the
         others are local fallbacks the browser already has. */
      var first = String(name || '').split(',')[0];
      var n = first.replace(/^["']|["']$/g, '').trim();
      if (n && TYPO_GOOGLE_FONTS[n] && families.indexOf(n) < 0) families.push(n);
    }
    /* Always load every preset's primary font so the preset cards
       render in their own typeface. Plus any custom/override pick. */
    TYPO_PRESETS.forEach(function (p) {
      TYPO_ROLES.forEach(function (r) { add(p.fonts[r]); });
    });
    TYPO_ROLES.forEach(function (r) { add((State.typo.custom || {})[r]); add((State.typo.overrides || {})[r]); });
    if (!families.length) return;
    var href = 'https://fonts.googleapis.com/css2?' +
      families.map(function (n) { return 'family=' + encodeURIComponent(n).replace(/%20/g, '+') + ':wght@400;500;600;700'; }).join('&') +
      '&display=swap';
    var link = document.getElementById('ev2-typo-google');
    if (!link) {
      link = document.createElement('link');
      link.id = 'ev2-typo-google';
      link.rel = 'stylesheet';
      document.head.appendChild(link);
    }
    if (link.href !== href) link.href = href;

    /* Also tell the preview iframe to load the same fonts. */
    try {
      var win = $frame && $frame.contentWindow;
      if (win) win.postMessage({ type: 'ev2-typo-fonts', href: href }, '*');
    } catch (_e) {}
  }
  function applyTypoToEditor() {
    /* Editor chrome must NEVER pick up the active preset's fonts —
       it would shift the entire UI to (say) Fraunces when the user
       picks Editorial Serif, and the preset cards (which use inline
       font-family) would lose their value as visual specimens.
       So this function only ensures Google Fonts <link> is in the
       editor document — so the preset card samples can render in
       Inter/Fraunces/Nunito etc. — and removes any prior typo
       override <style> tag (from older builds that did inject one). */
    var stale = document.getElementById('ev2-typo-override');
    if (stale && stale.parentNode) stale.parentNode.removeChild(stale);
    ensureGoogleFontsLink();
    /* Inject @font-face declarations for any uploaded files into
       the editor's OWN document — without this the Custom tile
       sample and the Custom Fonts modal preview can't render the
       uploaded face, and the picked family silently falls back to
       system-ui. The CSS rule is identical to what we postMessage
       into the preview iframe (typoCssBundle's @font-face block). */
    var faces = document.getElementById('ev2-typo-faces');
    var files = (State.typo && State.typo.customFontFiles) || {};
    var blocks = [];
    var seenUrls = {};
    TYPO_ROLES.forEach(function (r) {
      var f = files[r];
      if (!f || !f.family) return;
      var family = '"' + String(f.family).replace(/"/g, '\\"') + '"';
      if (f.files && f.files.length) {
        f.files.forEach(function (fw) {
          if (!fw || !fw.dataUrl || seenUrls[fw.dataUrl]) return;
          seenUrls[fw.dataUrl] = true;
          var fmt = fw.format || 'woff2';
          blocks.push('@font-face{font-family:' + family + ';src:url("' + fw.dataUrl
                   + '") format("' + fmt + '");font-weight:' + (fw.weight || 400)
                   + ';font-style:normal;font-display:swap;}');
        });
      } else if (f.dataUrl && !seenUrls[f.dataUrl]) {
        seenUrls[f.dataUrl] = true;
        var fmt = f.format || 'woff2';
        blocks.push('@font-face{font-family:' + family + ';src:url("' + f.dataUrl
                 + '") format("' + fmt + '");font-weight:100 900;font-style:normal;font-display:swap;}');
      }
    });
    if (!blocks.length) {
      if (faces && faces.parentNode) faces.parentNode.removeChild(faces);
      return;
    }
    var css = blocks.join('\n');
    if (!faces) {
      faces = document.createElement('style');
      faces.id = 'ev2-typo-faces';
      document.head.appendChild(faces);
    }
    if (faces.textContent !== css) faces.textContent = css;
  }
  function pushTypoToPreview() {
    /* Reuse the existing ev2-overrides postMessage channel — the
       iframe listener already injects the CSS into a <style> tag,
       so font-family-* tokens land alongside color tokens with
       zero extra plumbing. */
    try {
      var win = $frame && $frame.contentWindow;
      if (!win) return;
      win.postMessage({ type: 'ev2-overrides', css: typoCssBundle(), scope: 'typo' }, '*');
    } catch (_e) {}
  }

  function renderTt() {
    /* Only (re)load from storage on first render — calling
       loadTypoState() unconditionally would wipe any in-memory
       uploaded font file bytes (which we deliberately don't
       persist to localStorage to stay within quota). */
    if (!State.typo) loadTypoState();
    var html = '<div class="ev2-typo-panel">';

    /* Single section — 5 preset cards + 1 Custom tile sharing the
       same grid so they're visually equal-weight peers. */
    html += '<div class="ev2-typo-section">';
    html +=   '<div class="ev2-typo-section-head">Font pairing</div>';
    html +=   '<div class="ev2-typo-help">Pick a preset or use your own &mdash; the right pane shows it across real components.</div>';
    html +=   '<div class="ev2-typo-presets" id="ttPresets">';
    TYPO_PRESETS.forEach(function (p) {
      var fh = p.fonts.headline.replace(/"/g, '&quot;');
      var fb = p.fonts.body.replace(/"/g, '&quot;');
      var fc = p.fonts.code.replace(/"/g, '&quot;');
      var active = (p.id === State.typo.preset) ? ' data-active' : '';
      var parity = typoParityFor(p.fonts);
      /* Sample text renders in the preset's OWN fonts — these are
         labels-as-specimens, so the user sees what each preset
         looks like. Selection only changes the right-pane preview;
         it never re-renders the preset cards in the picked font. */
      html += '<button type="button" class="ev2-typo-preset" data-preset="' + p.id + '" data-parity="' + parity + '"' + active + '>'
            +   '<div class="ev2-typo-preset-head">'
            +     '<span class="ev2-typo-preset-label">' + p.name + '</span>'
            +     '<span class="ev2-typo-preset-meta">' + p.vibe + '</span>'
            +   '</div>'
            +   '<div class="ev2-typo-preset-fonts">'
            +     '<div class="ev2-typo-font-row"><span class="role">Head</span>'
            +       '<span class="sample" style="font-family:' + fh + '">' + p.display.headline + '</span></div>'
            +     '<div class="ev2-typo-font-row body"><span class="role">Body</span>'
            +       '<span class="sample" style="font-family:' + fb + '">' + p.display.body + '</span></div>'
            +     '<div class="ev2-typo-font-row code"><span class="role">Code</span>'
            +       '<span class="sample" style="font-family:' + fc + '">' + p.display.code + '</span></div>'
            +   '</div>'
            +   '<div class="ev2-typo-preset-parity" data-parity="' + parity + '" title="' + TYPO_PARITY_TITLE[parity] + '">'
            +     '<span class="dot" aria-hidden="true"></span>'
            +     '<span class="label">' + TYPO_PARITY_LABEL[parity] + '</span>'
            +   '</div>'
            + '</button>';
    });

    /* Divider between presets and the Custom tile — spans the full
       grid width via grid-column:1/-1 so it sits on its own row. */
    html += '<div class="ev2-typo-presets-sep" role="presentation"><span>or bring your own</span></div>';

    /* Custom tile — peer of preset tiles. Empty state shows the
       "+ Add" affordance; filled state mirrors a preset card. */
    var hasCustom = State.typo.custom && (State.typo.custom.headline || State.typo.custom.body || State.typo.custom.code);
    var customActive = (State.typo.preset === 'custom') ? ' data-active' : '';
    /* Parity for the Custom tile mirrors the worst-case Figma
       install status of whatever the user has typed. Empty fields
       fall back to 'system' so an unconfigured tile reads safe. */
    var customParity = hasCustom
      ? typoParityFor({
          headline: State.typo.custom.headline || '',
          body:     State.typo.custom.body     || '',
          code:     State.typo.custom.code     || ''
        })
      : 'custom';
    html +=     '<button type="button" class="ev2-typo-preset ev2-typo-preset-custom" id="ttCustomOpen" data-parity="' + customParity + '"' + customActive + '>';
    if (hasCustom) {
      var ch = (State.typo.custom.headline || '').trim();
      var cb = (State.typo.custom.body || '').trim();
      var cc = (State.typo.custom.code || '').trim();
      html +=    '<div class="ev2-typo-preset-head">'
            +      '<span class="ev2-typo-preset-label">Your fonts</span>'
            +      '<span class="ev2-typo-preset-meta">Edit \u2192</span>'
            +    '</div>'
            +    '<div class="ev2-typo-preset-fonts">'
            +      '<div class="ev2-typo-font-row"><span class="role">Head</span>'
            +        '<span class="sample"' + (ch ? ' style="font-family:&quot;' + ch.replace(/"/g, '&quot;') + '&quot;,system-ui,sans-serif"' : '') + '>' + (ch || '\u2014') + '</span></div>'
            +      '<div class="ev2-typo-font-row body"><span class="role">Body</span>'
            +        '<span class="sample"' + (cb ? ' style="font-family:&quot;' + cb.replace(/"/g, '&quot;') + '&quot;,system-ui,sans-serif"' : '') + '>' + (cb || '\u2014') + '</span></div>'
            +      '<div class="ev2-typo-font-row code"><span class="role">Code</span>'
            +        '<span class="sample"' + (cc ? ' style="font-family:&quot;' + cc.replace(/"/g, '&quot;') + '&quot;,monospace"' : '') + '>' + (cc || '\u2014') + '</span></div>'
            +    '</div>'
            +    '<div class="ev2-typo-preset-parity" data-parity="' + customParity + '" title="' + TYPO_PARITY_TITLE[customParity] + '">'
            +      '<span class="dot" aria-hidden="true"></span>'
            +      '<span class="label">' + TYPO_PARITY_LABEL[customParity] + '</span>'
            +    '</div>';
    } else {
      html +=    '<div class="ev2-typo-preset-head">'
            +      '<span class="ev2-typo-preset-label">Custom</span>'
            +      '<span class="ev2-typo-preset-meta">Your fonts</span>'
            +    '</div>'
            +    '<div class="ev2-typo-preset-add">'
            +      '<div class="ev2-typo-preset-add-row">'
            +        '<span class="ev2-typo-preset-add-icon" aria-hidden="true">+</span>'
            +        '<span class="ev2-typo-preset-add-text">'
            +          '<strong>Add fonts</strong>'
            +          '<em>Google or system</em>'
            +        '</span>'
            +      '</div>'
            +    '</div>'
            +    '<div class="ev2-typo-preset-parity" data-parity="custom" title="' + TYPO_PARITY_TITLE.custom + '">'
            +      '<span class="dot" aria-hidden="true"></span>'
            +      '<span class="label">' + TYPO_PARITY_LABEL.custom + '</span>'
            +    '</div>';
    }
    html +=     '</button>';

    html +=   '</div>'; // /presets
    html += '</div>';   // /section

    /* ── Type density ───────────────────────────────────────
       Three-way control that scales the whole size ladder.
       Lives in its own section so it reads as a distinct knob
       — not a property of the pairing above. The body sample
       below the segment shows the current 13px (=Base) shift
       in real px so users see the impact before clicking. */
    var curDensity = (State.typo && State.typo.density) || 'base';
    var bodyPxBase = 13;
    var bodyPxNow  = Math.round(bodyPxBase * (TYPO_DENSITY[curDensity] || 1) * 10) / 10;
    html += '<div class="ev2-typo-section">';
    html +=   '<div class="ev2-typo-section-head">Type density</div>';
    html +=   '<div class="ev2-typo-help">How tightly text packs. Same fonts, different size and line-height &mdash; pick what feels right for your product.</div>';
    html +=   '<div class="ev2-typo-density" role="radiogroup" aria-label="Type density">';
    ['compact','base','comfortable'].forEach(function (d) {
      var active = (d === curDensity) ? ' data-active' : '';
      var px = Math.round(bodyPxBase * TYPO_DENSITY[d] * 10) / 10;
      var lh = TYPO_DENSITY_LH[d];
      var sub = (d === 'base') ? 'Default' : (d === 'compact' ? 'Tighter UI' : 'Easier reading');
      /* Show body px AND line-height per option so users see both
         dimensions of the change before clicking — coupling LH to
         density is invisible without this label. */
      html += '<button type="button" class="ev2-typo-density-opt" data-density="' + d + '"' + active + ' role="radio" aria-checked="' + (d === curDensity ? 'true' : 'false') + '">'
            +   '<span class="ev2-typo-density-label">' + TYPO_DENSITY_LABEL[d] + '</span>'
            +   '<span class="ev2-typo-density-sample" style="font-size:' + px + 'px;line-height:' + lh + '">Aa ' + px + '</span>'
            +   '<span class="ev2-typo-density-sub">' + sub + ' &middot; ' + px + 'px / ' + lh + ' lh</span>'
            + '</button>';
    });
    html +=   '</div>';
    html += '</div>'; // /density section

    /* ── Designer install — sticky footer ───────────────────
       Compact one-line summary, rendered into the sibling
       #ttStickyMount node (NOT into $body). A sticky child of the
       scroll container would pin ON TOP of the last section's
       content (the Aa density cards) because position:sticky;
       bottom:0 anchors to the scroll-port, regardless of how the
       content below it lays out. Mounting outside the scroll
       container as a flex-sibling sidesteps the overlap entirely.
       Click → opens the full dialog. */
    var buckets = typoInstallBuckets();
    var sticky = typoInstallStickyLabel(buckets);
    var stickyHtml = '<div class="ev2-typo-install-sticky" data-tone="' + sticky.tone + '">'
          +   '<button type="button" class="ev2-typo-install-stickybtn" id="ttInstallOpen">'
          +     '<span class="ev2-typo-install-stickydot" aria-hidden="true"></span>'
          +     '<span class="ev2-typo-install-stickytxt">' + sticky.label + '</span>'
          +     '<span class="ev2-typo-install-stickymore">View \u2192</span>'
          +   '</button>'
          + '</div>';

    html += '</div>';
    $body.innerHTML = html;

    var $stickyMount = document.getElementById('ttStickyMount');
    if ($stickyMount) {
      $stickyMount.innerHTML = stickyHtml;
      $stickyMount.hidden = false;
    }

    /* Bind preset clicks (preset cards only; the Custom card opens the dialog) */
    $body.querySelectorAll('.ev2-typo-preset:not(.ev2-typo-preset-custom)').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-preset');
        if (id === State.typo.preset) return;
        State.typo.preset = id;
        persistTypoState();
        applyTypoToEditor();
        pushTypoToPreview();
        renderTt();
        /* Update unsaved-changes pill + Publish button enablement
           after each pick. Without this the topbar lags behind. */
        if (typeof refreshChangeBar === 'function') refreshChangeBar();
      });
    });

    /* Bind Custom card → open dialog */
    var customBtn = document.getElementById('ttCustomOpen');
    if (customBtn) customBtn.addEventListener('click', openTtCustomModal);

    /* Bind density seg-control */
    $body.querySelectorAll('.ev2-typo-density-opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var d = btn.getAttribute('data-density');
        if (!d || d === State.typo.density) return;
        State.typo.density = d;
        persistTypoState();
        pushTypoToPreview();
        renderTt();
        if (typeof refreshChangeBar === 'function') refreshChangeBar();
      });
    });

    applyTypoToEditor();
    pushTypoToPreview();
  }

  /* ── Custom fonts modal ──────────────────────────────── */
  /* Max accepted file size in bytes. 1 MB is a generous cap for
     a single .woff2 (the format is heavily compressed); rejecting
     larger files keeps config.json and localStorage well under
     their practical limits even with three roles populated. */
  var TYPO_MAX_FONT_BYTES = 1024 * 1024;

  /* ── Font-family weight detection helpers ────────────── */
  /* Order matters: ExtraBold (800) must precede Bold (700)
     so "Roboto-ExtraBold" doesn't match "bold" at weight 700. */
  var FONT_WEIGHT_MAP = [
    { re: /black|950/i,                                              w: 900 },
    { re: /extrabold|extra[-_\s]?bold|800/i,                         w: 800 },
    { re: /\bbold\b|[-_]bold[-_]|[-_]bold\.|bold$/i,                 w: 700 },
    { re: /semibold|semi[-_\s]?bold|demibold|demi[-_\s]?bold|600/i,  w: 600 },
    { re: /\bmedium\b|[-_]medium[-_\.]|medium$|500/i,                w: 500 },
    { re: /regular|roman|400/i,                                      w: 400 },
    { re: /extralight|extra[-_\s]?light|200/i,                       w: 200 },
    { re: /\blight\b|[-_]light[-_\.]|light$|300/i,                   w: 300 },
    { re: /\bthin\b|[-_]thin[-_\.]|thin$|100/i,                      w: 100 }
  ];

  function detectWeightFromFileName(name) {
    var base = String(name || '').replace(/\.(woff2?|ttf|otf)$/i, '');
    for (var i = 0; i < FONT_WEIGHT_MAP.length; i++) {
      if (FONT_WEIGHT_MAP[i].re.test(base)) return FONT_WEIGHT_MAP[i].w;
    }
    return 400; /* default: Regular */
  }

  function weightLabel(w) {
    return ({ 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 400: 'Regular',
              500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold',
              900: 'Black' })[w] || ('W' + w);
  }

  /* Headline → prefer heaviest; Body/Code → prefer 400, then nearest above. */
  function pickWeightForRole(role, weights) {
    if (!weights || !weights.length) return null;
    var sorted = weights.slice().sort(function (a, b) { return a - b; });
    if (role === 'headline') return sorted[sorted.length - 1];
    for (var i = 0; i < sorted.length; i++) { if (sorted[i] >= 400) return sorted[i]; }
    return sorted[0];
  }

  /* Strip weight keywords + trailing separators from a filename
     to infer the shared family name.
     "Inter-SemiBold.woff2" → "Inter", "Roboto_Bold.ttf" → "Roboto" */
  function deriveFamilyFromFile(fileName) {
    var base = String(fileName || '').replace(/\.(woff2?|ttf|otf)$/i, '');
    base = base.replace(
      /[-_\s]*(black|extrabold|extra[-_]?bold|bold|semibold|semi[-_]?bold|demibold|medium|regular|roman|light|extralight|extra[-_]?light|thin|italic|oblique|\d{3})(\b|[-_]|$)/gi,
      '');
    return base.replace(/[-_\s]+$/, '').replace(/^[-_\s]+/, '').trim() || base;
  }
  /* Working draft of the modal — files picked here do NOT touch
     State.typo until Apply. Cancel discards the entire draft so
     uploads can be tried + abandoned without polluting persisted
     state. Resets on each open. */
  var ttModalDraft = { headline: null, body: null, code: null };

  function ttModalSetHint(msg, tone) {
    var hint = document.getElementById('ttCustomHint');
    if (!hint) return;
    if (!msg) { hint.hidden = true; hint.removeAttribute('data-tone'); hint.textContent = ''; return; }
    hint.hidden = false;
    hint.textContent = msg;
    if (tone) hint.setAttribute('data-tone', tone); else hint.removeAttribute('data-tone');
  }

  /* Derive a sensible family name from the uploaded filename when
     the user has not typed anything yet. "PlayfairDisplay-Bold.woff2"
     → "PlayfairDisplay-Bold". The text input is the source of truth
     for the family name shipped in @font-face; this is just a
     pre-fill so users aren't forced to retype after dropping a file. */
  function ttModalDeriveFamily(fileName) {
    return String(fileName || '').replace(/\.(woff2?|ttf|otf)$/i, '').trim();
  }
  function ttModalFormatFor(fileName) {
    var ext = String(fileName || '').toLowerCase().match(/\.(woff2|woff|ttf|otf)$/);
    if (!ext) return 'woff2';
    if (ext[1] === 'ttf') return 'truetype';
    if (ext[1] === 'otf') return 'opentype';
    return ext[1];
  }

  /* Update the modal row chrome to reflect whether a role has a
     draft file attached. */
  function ttModalRenderRoleFile(role) {
    var modal = document.getElementById('ev2TtCustom');
    if (!modal) return;
    var draft = ttModalDraft[role];
    var ops    = modal.querySelector('.ev2-tt-modal-fileops[data-role="' + role + '"]');
    var nameEl = modal.querySelector('.ev2-tt-modal-file-name[data-role="' + role + '"]');
    var clear  = modal.querySelector('.ev2-tt-modal-file-clear[data-role="' + role + '"]');
    if (!ops || !nameEl || !clear) return;
    var hasFiles = draft && (
      (draft.files && draft.files.length && draft.files.some(function (fw) { return !!fw.dataUrl; })) ||
      draft.dataUrl
    );
    if (hasFiles) {
      ops.setAttribute('data-embedded', '');
      nameEl.hidden = false;
      if (draft.files && draft.files.length) {
        /* Multi-weight: show deduplicated weight labels */
        var seen = {};
        var wLabels = draft.files
          .filter(function (fw) { return !!fw.dataUrl; })
          .map(function (fw) { return weightLabel(fw.weight || 400); })
          .filter(function (l) { return seen[l] ? false : (seen[l] = true); });
        nameEl.textContent = (draft.family || '') + ' \u00b7 ' + wLabels.join(', ');
      } else {
        nameEl.textContent = draft.fileName || draft.family || 'font file';
      }
      clear.hidden = false;
    } else {
      ops.removeAttribute('data-embedded');
      nameEl.hidden = true;
      nameEl.textContent = '';
      clear.hidden = true;
    }
  }

  function openTtCustomModal() {
    var modal = document.getElementById('ev2TtCustom');
    if (!modal) return;
    /* Seed text inputs from saved custom picks AND seed the file
       draft from any previously-uploaded files — so re-opening
       the modal shows current state, and Cancel preserves it
       (since Apply is what writes back to State). */
    TYPO_ROLES.forEach(function (r) {
      var inp = modal.querySelector('input[data-role="' + r + '"][type="text"]');
      var saved = (State.typo.customFontFiles && State.typo.customFontFiles[r]) || null;
      if (inp) {
        /* Prefer the saved file's family name when it exists —
           that's the name baked into @font-face. Falls back to
           the free-text custom pick so an unembedded role retains
           its planned font name. */
        inp.value = (saved && saved.family) || (State.typo.custom && State.typo.custom[r]) || '';
      }
      ttModalDraft[r] = saved ? Object.assign({}, saved) : null;
      ttModalRenderRoleFile(r);
      updateTtCustomSample(r);
    });
    ttModalSetHint(null);
    /* Seed or reset the family-upload summary strip */
    var summary = document.getElementById('ttFamilySummary');
    var fclear  = document.getElementById('ttFamilyClear');
    var sharedFamily = ttModalDraft.headline
      && ttModalDraft.headline.files
      && ttModalDraft.body   && ttModalDraft.body.files
      && ttModalDraft.code   && ttModalDraft.code.files
      && ttModalDraft.headline.family === ttModalDraft.body.family
      && ttModalDraft.headline.family === ttModalDraft.code.family;
    if (sharedFamily && summary) {
      var seen = {};
      var wLabels = ttModalDraft.headline.files
        .map(function (fw) { return weightLabel(fw.weight || 400); })
        .filter(function (l) { return seen[l] ? false : (seen[l] = true); });
      summary.textContent = ttModalDraft.headline.family + ' \u00b7 ' + wLabels.join(', ');
      summary.hidden = false;
      if (fclear) fclear.hidden = false;
    } else {
      if (summary) { summary.hidden = true; summary.textContent = ''; }
      if (fclear)  fclear.hidden = true;
    }
    modal.hidden = false;
    setTimeout(function () { var f = modal.querySelector('input[type="text"]'); if (f) f.focus(); }, 0);
  }
  function closeTtCustomModal() {
    var modal = document.getElementById('ev2TtCustom');
    if (modal) modal.hidden = true;
    /* Drop the draft so the next open re-seeds from State. */
    ttModalDraft = { headline: null, body: null, code: null };
    ttModalSetHint(null);
    var summary = document.getElementById('ttFamilySummary');
    var fclear  = document.getElementById('ttFamilyClear');
    if (summary) { summary.hidden = true; summary.textContent = ''; }
    if (fclear)  fclear.hidden = true;
  }
  function updateTtCustomSample(role) {
    var modal = document.getElementById('ev2TtCustom');
    if (!modal) return;
    var inp = modal.querySelector('input[data-role="' + role + '"][type="text"]');
    var sample = modal.querySelector('.ev2-tt-modal-sample[data-role="' + role + '"]');
    if (!inp || !sample) return;
    var draft = ttModalDraft[role];
    var fam = (draft && draft.family) || inp.value.trim();
    sample.style.fontFamily = fam ? ('"' + fam.replace(/"/g, '\\"') + '", system-ui, sans-serif') : '';
    /* Render the sample in the role's preferred weight so Headline
       actually looks bold when a bold file is attached. */
    var wt = 400;
    if (draft && draft.files && draft.files.length) {
      var available = draft.files.map(function (fw) { return fw.weight || 400; });
      wt = pickWeightForRole(role, available) || 400;
    }
    sample.style.fontWeight = String(wt);
  }

  /* Read a File as a base64 data URL. Resolves to { dataUrl,
     family, format, fileName, sizeBytes } or rejects with a
     human-readable message. */
  function ttModalReadFontFile(file, role, currentName) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error('No file selected.'));
      var name = file.name || '';
      if (!/\.(woff2|woff|ttf|otf)$/i.test(name)) {
        return reject(new Error('Only .woff2, .woff, .ttf, or .otf font files are supported.'));
      }
      if (file.size > TYPO_MAX_FONT_BYTES) {
        var kb = Math.round(file.size / 1024);
        return reject(new Error('Font file is ' + kb + ' KB; the limit is 1024 KB. Try a subset .woff2.'));
      }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Could not read the file.')); };
      reader.onload  = function () {
        var dataUrl = String(reader.result || '');
        if (!dataUrl) return reject(new Error('Empty file.'));
        resolve({
          family:    String(currentName || '').trim() || ttModalDeriveFamily(name),
          dataUrl:   dataUrl,
          format:    ttModalFormatFor(name),
          fileName:  name,
          sizeBytes: file.size
        });
      };
      reader.readAsDataURL(file);
    });
  }

  function applyTtCustomFromModal() {
    var modal = document.getElementById('ev2TtCustom');
    if (!modal) return;
    /* Commit text inputs to custom-name picks. */
    TYPO_ROLES.forEach(function (r) {
      var inp = modal.querySelector('input[data-role="' + r + '"][type="text"]');
      State.typo.custom[r] = inp ? inp.value.trim() : '';
      /* Commit the file draft. If the user typed a family name in
         the text input after picking a file, the typed name wins —
         the file is stored under the user's chosen identifier. */
      var draft = ttModalDraft[r];
      var hasDraft = draft && (
        (draft.files && draft.files.length && draft.files.some(function (fw) { return !!fw.dataUrl; })) ||
        draft.dataUrl
      );
      if (hasDraft) {
        var typed = inp ? inp.value.trim() : '';
        if (typed) draft.family = typed;
        State.typo.customFontFiles[r] = draft;
      } else {
        State.typo.customFontFiles[r] = null;
      }
    });
    /* If user filled at least one role (typed family OR uploaded
       file), switch active to 'custom'. */
    var any = State.typo.custom.headline || State.typo.custom.body || State.typo.custom.code
           || State.typo.customFontFiles.headline || State.typo.customFontFiles.body || State.typo.customFontFiles.code;
    if (any) State.typo.preset = 'custom';
    persistTypoState();
    closeTtCustomModal();
    if (State.activeTier === 'tt') renderTt();
    applyTypoToEditor();
    pushTypoToPreview();
    if (typeof refreshChangeBar === 'function') refreshChangeBar();
  }

  /* Wire modal once on first reference. */
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-tt-dismiss]')) { closeTtCustomModal(); return; }
    if (e.target && e.target.id === 'ttCustomApply') { applyTtCustomFromModal(); return; }
    if (e.target.closest('[data-tt-install-dismiss]')) { closeTtInstallModal(); return; }
    if (e.target.closest('#ttInstallOpen')) { openTtInstallModal(); return; }
    /* "Clear font family" button — wipes all three role drafts. */
    if (e.target.closest('#ttFamilyClear')) {
      TYPO_ROLES.forEach(function (r) {
        ttModalDraft[r] = null;
        ttModalRenderRoleFile(r);
        updateTtCustomSample(r);
        var modal = document.getElementById('ev2TtCustom');
        if (modal) {
          var inp = modal.querySelector('input[data-role="' + r + '"][type="text"]');
          if (inp) inp.value = '';
        }
      });
      var sum = document.getElementById('ttFamilySummary');
      var fclear = document.getElementById('ttFamilyClear');
      if (sum)    { sum.hidden = true; sum.textContent = ''; }
      if (fclear) fclear.hidden = true;
      ttModalSetHint(null);
      return;
    }
    /* Per-role "remove uploaded file" buttons inside the Custom
       modal — drop the draft, repaint the row, refresh the sample
       so it falls back to the typed family name (if any). */
    var clearBtn = e.target.closest('.ev2-tt-modal-file-clear');
    if (clearBtn) {
      var role = clearBtn.getAttribute('data-role');
      if (role) {
        ttModalDraft[role] = null;
        ttModalRenderRoleFile(role);
        updateTtCustomSample(role);
        ttModalSetHint(null);
      }
      return;
    }
  });
  document.addEventListener('input', function (e) {
    var inp = e.target.closest('.ev2-tt-modal input[data-role][type="text"]');
    if (!inp) return;
    /* As the user retypes the family name, keep the draft's
       family in sync — Apply will commit it. */
    var role = inp.getAttribute('data-role');
    var d = ttModalDraft[role];
    if (d) {
      /* Keep family in sync whether it's the legacy single-file
         format (.dataUrl) or the new multi-weight format (.files). */
      d.family = inp.value.trim() || d.family;
    }
    updateTtCustomSample(role);
  });
  document.addEventListener('change', function (e) {
    /* ── Font-family upload (multiple files at once) ─────── */
    var familyInput = e.target.closest('#ttCustomFamilyFiles');
    if (familyInput) {
      var allFiles = Array.prototype.slice.call(familyInput.files || []);
      if (!allFiles.length) return;
      for (var vi = 0; vi < allFiles.length; vi++) {
        var vf = allFiles[vi];
        if (!/\.(woff2|woff|ttf|otf)$/i.test(vf.name)) {
          ttModalSetHint('Only .woff2, .woff, .ttf, or .otf files are supported.');
          familyInput.value = '';
          return;
        }
        if (vf.size > TYPO_MAX_FONT_BYTES) {
          ttModalSetHint(vf.name + ' is ' + Math.round(vf.size / 1024) + ' KB; limit is 1024 KB. Use a subset .woff2.');
          familyInput.value = '';
          return;
        }
      }
      ttModalSetHint('Reading ' + allFiles.length + ' file' + (allFiles.length !== 1 ? 's' : '') + '\u2026', 'ok');
      Promise.all(allFiles.map(function (f) {
        return ttModalReadFontFile(f, null, '').then(function (payload) {
          payload.weight = detectWeightFromFileName(f.name);
          return payload;
        });
      })).then(function (payloads) {
        var familyName = deriveFamilyFromFile(payloads[0].fileName || payloads[0].family || '');
        payloads.forEach(function (p) { p.family = familyName; });
        /* Inject @font-face blocks immediately so samples render */
        var faceBlocks = payloads.map(function (p) {
          return '@font-face{font-family:"' + familyName.replace(/"/g, '\\"')
               + '";src:url("' + p.dataUrl + '") format("' + p.format + '");font-weight:'
               + p.weight + ';font-style:normal;font-display:swap;}';
        });
        var faces = document.getElementById('ev2-typo-faces');
        if (!faces) {
          faces = document.createElement('style');
          faces.id = 'ev2-typo-faces';
          document.head.appendChild(faces);
        }
        faces.textContent = faceBlocks.join('\n');
        /* Auto-map all weights to every role */
        var modal = document.getElementById('ev2TtCustom');
        TYPO_ROLES.forEach(function (r) {
          ttModalDraft[r] = { family: familyName, files: payloads };
          if (modal) {
            var inp = modal.querySelector('input[data-role="' + r + '"][type="text"]');
            if (inp) inp.value = familyName;
          }
          ttModalRenderRoleFile(r);
          updateTtCustomSample(r);
        });
        var wLabels = payloads.map(function (p) { return weightLabel(p.weight); });
        var summary = document.getElementById('ttFamilySummary');
        var fclear  = document.getElementById('ttFamilyClear');
        if (summary) { summary.textContent = familyName + ' \u00b7 ' + wLabels.join(', '); summary.hidden = false; }
        if (fclear)  fclear.hidden = false;
        ttModalSetHint(familyName + ' embedded \u2014 '
          + payloads.length + ' weight' + (payloads.length !== 1 ? 's' : '')
          + ' detected (' + wLabels.join(', ') + '). Mapped to all roles.', 'ok');
      }).catch(function (err) {
        ttModalSetHint(err && err.message ? err.message : 'Could not read font files.');
      });
      familyInput.value = '';
      return;
    }
    /* ── Per-role single-file upload (existing behaviour) ── */
    var fileInput = e.target.closest('.ev2-tt-modal-file-input');
    if (!fileInput) return;
    var role = fileInput.getAttribute('data-role');
    var file = (fileInput.files && fileInput.files[0]) || null;
    if (!file || !role) return;
    var modal = document.getElementById('ev2TtCustom');
    var textInput = modal && modal.querySelector('input[data-role="' + role + '"][type="text"]');
    var currentName = textInput ? textInput.value.trim() : '';
    ttModalSetHint('Reading ' + file.name + '\u2026', 'ok');
    ttModalReadFontFile(file, role, currentName).then(function (payload) {
      payload.weight = detectWeightFromFileName(file.name);
      /* Upgrade to multi-weight format for consistent rendering */
      ttModalDraft[role] = { family: payload.family, files: [payload] };
      if (textInput && !textInput.value.trim()) {
        textInput.value = payload.family;
      }
      var faces = document.getElementById('ev2-typo-faces');
      if (!faces) {
        faces = document.createElement('style');
        faces.id = 'ev2-typo-faces';
        document.head.appendChild(faces);
      }
      var draftBlock = '@font-face{font-family:"' + String(payload.family).replace(/"/g, '\\"')
                    + '";src:url("' + payload.dataUrl + '") format("' + payload.format
                    + '");font-weight:' + payload.weight + ';font-style:normal;font-display:swap;}';
      if (faces.textContent.indexOf(payload.dataUrl) < 0) {
        faces.textContent = faces.textContent + '\n' + draftBlock;
      }
      ttModalRenderRoleFile(role);
      updateTtCustomSample(role);
      ttModalSetHint('Embedded \u2014 designers won\u2019t need to install ' + payload.family + '.', 'ok');
    }).catch(function (err) {
      ttModalSetHint(err && err.message ? err.message : 'Could not read that file.');
    });
    fileInput.value = '';
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var modal = document.getElementById('ev2TtCustom');
    if (modal && !modal.hidden) { closeTtCustomModal(); return; }
    var install = document.getElementById('ev2TtInstall');
    if (install && !install.hidden) closeTtInstallModal();
  });

  /* ── T2 Surfaces ──────────────────────────────────────
     Build step 4 (per docs §11): render the surface picker + family
     groups using the frozen Property Card from §4. Reads the state
     model shipped in step 3 (resolveT2Step / isT2Changed) and writes
     overrides back via setT2Step / clearT2Override below.

     Out of scope for this commit:
     - "follows" pointer (no T1 cascade until step 5).
     - Bulk ops (step 5).
     - Live preview push (step 6 \u2014 needs preview composition update).
     - T1 migration to the same primitive (separate commit). */

  /* WCAG sentinel per docs \u00a77 \u2014 baseline + threshold per property
     family. Returns { baseline:'<token-css-name>', baselineHex, ratio,
     judge, large } so the Property Card can render the standardized
     "X.XX:1 vs <token> [grade]" string. */
  function t2Sentinel(surfaceId, propId, mode) {
    var prop = T2_PROP_DEFS.find(function (p) { return p.id === propId; });
    if (!prop) return null;
    var cellHex = t2HexFor(surfaceId, propId, mode);
    var baselineProp, large = false, intent = 'text';
    // intent is 'text' (WCAG 1.4.3) or 'edge' (1.4.11). 'edge' is
    // informational: 3:1 is only mandatory when the border alone
    // identifies the region; shadow/spacing can substitute.
    if (prop.family === 'content') {
      baselineProp = 'bg';
      large = (propId === 'ct-subtle' || propId === 'ct-faint');
      intent = 'text';
    } else if (propId === 'cm-outline' || propId === 'cm-outline-hover' || propId === 'cm-outline-pressed') {
      baselineProp = 'cm-bg';
      large = true;
      intent = 'edge';
    } else if (propId === 'outline') {
      baselineProp = 'bg';
      large = true;
      intent = 'edge';
    } else {
      // subtle, strong, separator, cm-separator, bg, cm-bg trio --
      // no sentinel. Tints + dividers are informational; cm-bg trio
      // encodes elevation/state, not page-region contrast (paired
      // with shadow in practice). The old check that pitted cm-bg
      // against page bg @ 3:1 was a category error.
      return null;
    }
    var baselineHex = t2HexFor(surfaceId, baselineProp, mode);
    var ratio = contrastRatio(cellHex, baselineHex);
    var judge = wcagJudge(ratio, large);
    return {
      baseline: '--surface-' + surfaceId + '-' + baselineProp,
      baselineHex: baselineHex,
      ratio: ratio,
      judge: judge,
      large: large,
      intent: intent
    };
  }

  /* Walks the surface's palette ladder from the current step in the
     direction that increases contrast against the baseline, returns
     the FIRST step that crosses the threshold (3 for large/edge,
     4.5 for normal text). Null if the current step already passes
     or no step in the ladder reaches threshold. Used by the WCAG
     popover to render a one-click "Apply" suggestion. */
  function t2SuggestStep(surfaceId, propId, mode) {
    var sent = t2Sentinel(surfaceId, propId, mode);
    if (!sent || sent.judge.pass) return null;
    var threshold = sent.large ? 3 : 4.5;
    var surface = T2_SURFACES.find(function (s) { return s.id === surfaceId; });
    if (!surface) return null;
    var ladder = t2LadderFor(surfaceId);
    var current = resolveT2Step(surfaceId, propId, mode);
    var curIdx = -1;
    for (var i = 0; i < ladder.length; i++) {
      if (ladder[i].name === current) { curIdx = i; break; }
    }
    if (curIdx < 0) return null;
    // Which way pushes us further from baseline? Whichever side of
    // the baseline we're already on, push further. If we're sitting
    // ON the baseline, default to darker (works in light mode; in
    // dark mode users will see it as "toward white" once tonalDir
    // mirrors). The ladder order is white -> ... -> black (idx 0..21)
    // so "darker" = +1 in idx.
    var cellHex = ladder[curIdx].hex;
    // Try both directions; prefer the closer step that crosses
    // threshold. Skips having to luminance-compare upfront.
    function walk(dir) {
      for (var d = 1; d < ladder.length; d++) {
        var j = curIdx + dir * d;
        if (j < 0 || j >= ladder.length) return null;
        var r = contrastRatio(ladder[j].hex, sent.baselineHex);
        if (r >= threshold) {
          return { idx: j, dist: d, hex: ladder[j].hex, name: ladder[j].name, ratio: r };
        }
      }
      return null;
    }
    var darker = walk(+1);
    var lighter = walk(-1);
    var pick = null;
    if (darker && lighter) pick = (darker.dist <= lighter.dist) ? darker : lighter;
    else pick = darker || lighter;
    if (!pick) return null;
    return {
      step: pick.name,
      hex: pick.hex,
      ratio: pick.ratio,
      judge: wcagJudge(pick.ratio, sent.large),
      threshold: threshold,
      baselineHex: sent.baselineHex,
      baselineToken: sent.baseline,
      intent: sent.intent,
      large: sent.large,
      currentStep: current,
      currentHex: cellHex,
      currentRatio: sent.ratio
    };
  }

  /* Human-readable WCAG tip for the sentinel chip.

     Design goal: ONE sentence the user can act on, in plain
     language. The deep technical "why" (which token, which threshold
     number, which WCAG section) belongs in the popover's secondary
     blocks, not the lead paragraph. This text appears next to a
     ratio chip that already shows the number, so we don't repeat it.

     Cognitive-load rules:
       1. Lead with the user's WORLD ("Text is easy to read")
          not the spec's world ("4.5:1 contrast achieved").
       2. Failure copy is prescriptive, not diagnostic. Skip the
          threshold value; the chip shows it.
       3. Never mention CSS variable names in the lead.
       4. Edge case (border, identifies-region) keeps its own
          plain-language reframing. */
  function wcagTipText(sent, tokenName) {
    var role = wcagRoleFromToken(tokenName);
    // Edge intent (outline / cm-outline trio): 3:1 is ONLY required
    // when the border identifies the region by itself. Most designs
    // pair a faint border with shadow or spacing, so a sub-3:1 ratio
    // is perfectly fine \u2014 reframe instead of crying "FAIL".
    if (sent.intent === 'edge') {
      if (sent.judge.pass) {
        return 'Strong enough that this border can identify the region on its own.';
      }
      return 'Soft border. Fine if paired with a shadow or spacing, otherwise step it ' + role.direction + '.';
    }
    // Text intent (content / on-component / on-container).
    if (sent.judge.pass) {
      return role.whatShort + ' is easy to read here.';
    }
    return role.whatShort + ' is hard to read on this background.';
  }
  /* Per-prop short copy used inside wcagTipText. Returns:
       what       \u2014 sentence-case subject for diagnostic text
                     (e.g. "This outline")
       whatShort  \u2014 friendly noun for action-first copy
                     (e.g. "Text", "Border")
       usage      \u2014 WCAG context (used in deeper "why" blocks only)
       direction  \u2014 step direction hint */
  function wcagRoleFromToken(tokenName) {
    var prop = (tokenName || '').replace(/^--surface-[^-]+-/, '');
    if (prop === 'outline')
      return { what:'This outline', whatShort:'Border', usage:'UI borders (WCAG 1.4.11)', direction:'darker' };
    if (prop === 'ct-default' || prop === 'ct-strong')
      return { what:'This body text', whatShort:'Text', usage:'body copy (WCAG 1.4.3)', direction:'darker' };
    if (prop === 'ct-subtle' || prop === 'ct-faint')
      return { what:'This support text', whatShort:'Support text', usage:'large/secondary text', direction:'darker' };
    if (prop === 'cm-outline' || prop === 'cm-outline-hover' || prop === 'cm-outline-pressed')
      return { what:'This component border', whatShort:'Border', usage:'UI borders (WCAG 1.4.11)', direction:'darker' };
    return { what:'This color', whatShort:'Text', usage:'UI elements', direction:'further away from the baseline' };
  }

  function setT2Step(surfaceId, propId, mode, newStep) {
    if (ALL_STEPS.indexOf(newStep) < 0) return;
    var def = defaultT2Step(surfaceId, propId, mode);
    if (!State.t2[mode][surfaceId]) State.t2[mode][surfaceId] = {};
    if (newStep === def) {
      // Step matches the default again \u2014 drop the override so the
      // card reverts to its "follows default" rendering. Keeps the
      // override map minimal and lets cascade math stay clean.
      delete State.t2[mode][surfaceId][propId];
    } else {
      State.t2[mode][surfaceId][propId] = { step: newStep };
    }
    scheduleAutosave();
    refreshChangeBar();
    renderT2();
    pushPreview();
  }
  function clearT2Override(surfaceId, propId, mode) {
    if (State.t2[mode] && State.t2[mode][surfaceId]) {
      delete State.t2[mode][surfaceId][propId];
    }
    scheduleAutosave();
    refreshChangeBar();
    renderT2();
    pushPreview();
  }

  /* ── T1 lever write path ─────────────────────────────
     Mirrors setT2Step / clearT2Override so the Property Card
     primitive's stepper / reset / ladder-pick handlers can dispatch
     by tier. T1 state shape is { mode: { roleId: { fill, content,
     container } } } — there's no separate override map (unlike T2),
     so "detached" just means "different from default". */
  function setT1Lever(roleId, leverId, mode, newStep) {
    if (ALL_STEPS.indexOf(newStep) < 0) return;
    var t = t1For(roleId, mode);
    if (!t || t[leverId] === newStep) return;
    t[leverId] = newStep;
    scheduleAutosave();
    refreshChangeBar();
    renderT1();
    pushPreview();
  }
  function clearT1Lever(roleId, leverId, mode) {
    var def = defaultT1ForRole(roleId, mode);
    var t = t1For(roleId, mode);
    if (!t || !def || t[leverId] === def[leverId]) return;
    t[leverId] = def[leverId];
    scheduleAutosave();
    refreshChangeBar();
    renderT1();
    pushPreview();
  }
  function t1LeverIsDetached(roleId, leverId, mode) {
    var t = t1For(roleId, mode);
    var d = defaultT1ForRole(roleId, mode);
    return !!(t && d && t[leverId] !== d[leverId]);
  }

  /* Write/restore an override for a derived T1 value. onComponent
     stores the picked step name verbatim ('white' | 'black');
     everything else stores a step from ALL_STEPS. Clearing falls
     back to the auto-derivation. */
  function setT1Derived(roleId, derivedId, mode, newStep) {
    var t = t1For(roleId, mode);
    if (!t) return;
    if (derivedId === 'onComponent') {
      // Accept white/black (always offered) OR any palette step
      // that AA-passes worst-state against the role's fills (the
      // filtered set shown in the picker). Reject anything else
      // so a stale state entry can't ship an inaccessible value.
      var allowed = onComponentAllowedSteps(roleId, mode);
      if (allowed.indexOf(newStep) < 0) return;
      if (t.onComponent === newStep) return;
      t.onComponent = newStep;
    } else if (derivedId === 'border') {
      if (ALL_STEPS.indexOf(newStep) < 0) return;
      if (t.borderStep === newStep) return;
      t.borderStep = newStep;
    } else if (derivedId === 'separator') {
      if (ALL_STEPS.indexOf(newStep) < 0) return;
      if (t.separatorStep === newStep) return;
      t.separatorStep = newStep;
    } else if (derivedId === 'cmBorder') {
      if (ALL_STEPS.indexOf(newStep) < 0) return;
      if (t.cmBorderStep === newStep) return;
      t.cmBorderStep = newStep;
    } else if (derivedId === 'cmSeparator') {
      if (ALL_STEPS.indexOf(newStep) < 0) return;
      if (t.cmSeparatorStep === newStep) return;
      t.cmSeparatorStep = newStep;
    } else if (derivedId === 'onContainer') {
      if (ALL_STEPS.indexOf(newStep) < 0) return;
      if (t.onContainerStep === newStep) return;
      t.onContainerStep = newStep;
    } else if (derivedId === 'contentSubtle') {
      if (ALL_STEPS.indexOf(newStep) < 0) return;
      if (t.contentSubtleStep === newStep) return;
      t.contentSubtleStep = newStep;
    } else if (derivedId === 'contentStrong') {
      if (ALL_STEPS.indexOf(newStep) < 0) return;
      if (t.contentStrongStep === newStep) return;
      t.contentStrongStep = newStep;
    } else if (derivedId === 'fillHover') {
      if (ALL_STEPS.indexOf(newStep) < 0) return;
      if (t.fillHoverStep === newStep) return;
      t.fillHoverStep = newStep;
    } else if (derivedId === 'fillPressed') {
      if (ALL_STEPS.indexOf(newStep) < 0) return;
      if (t.fillPressedStep === newStep) return;
      t.fillPressedStep = newStep;
    } else if (derivedId === 'cmBorderHover') {
      if (ALL_STEPS.indexOf(newStep) < 0) return;
      if (t.cmBorderHoverStep === newStep) return;
      t.cmBorderHoverStep = newStep;
    } else if (derivedId === 'cmBorderPressed') {
      if (ALL_STEPS.indexOf(newStep) < 0) return;
      if (t.cmBorderPressedStep === newStep) return;
      t.cmBorderPressedStep = newStep;
    } else { return; }
    scheduleAutosave();
    refreshChangeBar();
    renderT1();
    pushPreview();
  }
  function clearT1Derived(roleId, derivedId, mode) {
    var t = t1For(roleId, mode);
    if (!t) return;
    var changed = false;
    if (derivedId === 'border' && t.borderStep) { delete t.borderStep; changed = true; }
    else if (derivedId === 'separator' && t.separatorStep) { delete t.separatorStep; changed = true; }
    else if (derivedId === 'cmBorder' && t.cmBorderStep) { delete t.cmBorderStep; changed = true; }
    else if (derivedId === 'cmSeparator' && t.cmSeparatorStep) { delete t.cmSeparatorStep; changed = true; }
    else if (derivedId === 'onComponent' && t.onComponent) { delete t.onComponent; changed = true; }
    else if (derivedId === 'onContainer' && t.onContainerStep) { delete t.onContainerStep; changed = true; }
    else if (derivedId === 'contentSubtle' && t.contentSubtleStep) { delete t.contentSubtleStep; changed = true; }
    else if (derivedId === 'contentStrong' && t.contentStrongStep) { delete t.contentStrongStep; changed = true; }
    else if (derivedId === 'fillHover' && t.fillHoverStep) { delete t.fillHoverStep; changed = true; }
    else if (derivedId === 'fillPressed' && t.fillPressedStep) { delete t.fillPressedStep; changed = true; }
    else if (derivedId === 'cmBorderHover' && t.cmBorderHoverStep) { delete t.cmBorderHoverStep; changed = true; }
    else if (derivedId === 'cmBorderPressed' && t.cmBorderPressedStep) { delete t.cmBorderPressedStep; changed = true; }
    if (!changed) return;
    scheduleAutosave();
    refreshChangeBar();
    renderT1();
    pushPreview();
  }

  /* T1 equivalents of t2Sentinel / t2SuggestStep — let the WCAG
     popover open from a T1 lever chip exactly like a T2 prop chip.
     Per-lever baseline mirrors the solver's judgeStepForLever:
       fill      → "on-component" auto-derived from the fill hex
                   (white or black, whichever wins ≥4.5:1)
       content   → surface base bg for the current mode
       container → deriveOnContainer against the container itself
     intent flags steer the popover preview: 'fill' renders a filled
     pill; 'text' renders the role's purpose copy. */
  function t1Sentinel(roleId, leverId, mode) {
    var ladder = ladderFor(roleId);
    var picks  = t1For(roleId, mode);
    if (!ladder || !picks) return null;
    var step = picks[leverId];
    var hex  = ladder[step];
    if (!hex) return null;
    var j = DTFSolver.judgeStepForLever(ladder, leverId, step, picks, mode);
    var role = ROLES.find(function (r) { return r.id === roleId; });
    var prefix = role ? role.prefix : roleId;
    var sent;
    if (leverId === 'fill') {
      var rW = contrastRatio(hex, '#FFFFFF'), rB = contrastRatio(hex, '#0A0A0A');
      var onComp = rW >= rB ? '#FFFFFF' : '#0A0A0A';
      sent = {
        intent: 'fill', large: false,
        baselineHex: onComp,
        baseline: '--' + prefix + '-on-component',
        ratio: j.ratio, judge: { pass: j.pass, grade: j.grade },
        fillHex: hex
      };
    } else if (leverId === 'content') {
      var pageBg = surfaceBgFor(mode);
      sent = {
        intent: 'text', large: false,
        baselineHex: pageBg,
        baseline: '--surface-base-bg',
        ratio: j.ratio, judge: { pass: j.pass, grade: j.grade }
      };
    } else { // container
      // judge already gave us deriveOnContainer's ratio; surface the
      // computed on-container hex so the popover can render the
      // legible pairing the solver actually scores.
      var info = DTFSolver.deriveOnContainer(ladder, picks.content, hex);
      sent = {
        intent: 'container', large: false,
        baselineHex: hex,                 // container bg
        baseline: '--' + prefix + '-container-bg',
        ratio: j.ratio, judge: { pass: j.pass, grade: j.grade },
        onContainerHex: info.hex
      };
    }
    return sent;
  }
  function t1SuggestStep(roleId, leverId, mode) {
    var sent = t1Sentinel(roleId, leverId, mode);
    if (!sent || sent.judge.pass) return null;
    var ladder = ladderFor(roleId);
    var picks  = t1For(roleId, mode);
    var current = picks[leverId];
    var step = DTFSolver.snapStepToAA(ladder, leverId, current, picks, mode);
    if (!step || step === current) return null;
    var hex = ladder[step];
    var j = DTFSolver.judgeStepForLever(ladder, leverId, step, picks, mode);
    if (!j.pass) return null;
    return {
      step: step,
      hex: hex,
      ratio: j.ratio,
      judge: { pass: j.pass, grade: j.grade },
      baselineHex: sent.baselineHex
    };
  }
  function t1HexFor(roleId, leverId, mode) {
    var ladder = ladderFor(roleId);
    var picks  = t1For(roleId, mode);
    if (!ladder || !picks) return '#000';
    return ladder[picks[leverId]] || '#000';
  }
  function t1TokenName(roleId, leverId) {
    var role = ROLES.find(function (r) { return r.id === roleId; });
    var prefix = role ? role.prefix : roleId;
    if (leverId === 'fill')      return '--' + prefix + '-component-bg-default';
    if (leverId === 'content')   return '--' + prefix + '-content-default';
    if (leverId === 'container') return '--' + prefix + '-container-bg';
    return '--' + prefix + '-' + leverId;
  }

  /* ── T2 bulk ops ─────────────────────────────────────
     Three high-frequency designer shortcuts wired into a per-row
     overflow menu. All write through the same setT2Step path so
     the auto-default-drop logic still keeps the override map clean
     (e.g. applying step that equals the dark-mode default for that
     surface won't pollute State.t2.dark). */

  /* (removed) bulkApplyToOtherMode + bulkApplyToAllSurfaces.
     The per-row chips that drove these were rejected: both shipped
     silently with no per-target preview and no undo, so they
     created more cleanup work than they saved. If we bring them
     back they need a snapshot-undo toast first — see session
     notes on rejected bulk-apply chips. */

  /* Clear THIS prop's override + every descendant prop's override
     in the current surface + mode. Lets the user roll back an
     entire branch (e.g. all ct-* once ct-default was tweaked) in
     one click instead of clicking Reset four times. */
  function descendantPropIds(rootPropId) {
    var out = [];
    function walk(parentId) {
      T2_PROP_DEFS.forEach(function (p) {
        if (p.parent === parentId) {
          out.push(p.id);
          walk(p.id);
        }
      });
    }
    walk(rootPropId);
    return out;
  }
  function bulkResetFamily(surfaceId, propId, mode) {
    if (!State.t2[mode] || !State.t2[mode][surfaceId]) return;
    var bag = State.t2[mode][surfaceId];
    delete bag[propId];
    descendantPropIds(propId).forEach(function (d) { delete bag[d]; });
    scheduleAutosave();
    refreshChangeBar();
    renderT2();
    pushPreview();
  }

  /* Property Card primitive (docs \u00a74). Same DOM will be used by T1
     migration + T3 \u2014 keep it portable; no T2-specific assumptions
     except what the caller passes in. */

  // In-memory only \u2014 NEVER persisted to draft. Holds 'surfaceId/propId'
  // of the currently expanded card (one at a time across the whole
  // T2 view), or null. Cleared on surface tab switch.
  var __expandedT2 = null;

  /* Build the 20-step ladder strip for the inline picker. Walks the
     surface's source palette (brand for accent, neutral otherwise),
     marks the current pick, and tags every step with surface/prop
     so the picker click handler can resolve them. */
  function pcLadderHTML(surfaceId, propId, mode) {
    var surface = T2_SURFACES.find(function (s) { return s.id === surfaceId; });
    if (!surface) return '';
    var ladder = t2LadderFor(surfaceId);
    var current = resolveT2Step(surfaceId, propId, mode);
    var def     = defaultT2Step(surfaceId, propId, mode);
    return '<div class="ev2-pc-ladder" data-pc-ladder-surface="' + surfaceId + '" data-pc-ladder-prop="' + propId + '">'
      + ladder.map(function (s) {
          var isCur = s.name === current;
          var isDef = s.name === def;
          var tip = 'step ' + s.name + ' \u2022 ' + s.hex.toUpperCase()
                  + (isDef ? ' \u2022 default' : '')
                  + (isCur ? ' \u2022 selected' : '');
          return '<button type="button" class="ev2-pc-ladder-step"'
            + ' data-pc-ladder-pick="' + s.name + '"'
            + ' data-current="' + isCur + '"'
            + ' data-default="' + isDef + '"'
            + ' data-tip="' + tip + '"'
            + ' aria-label="' + tip + '"'
            + ' style="background:' + s.hex + '">'
          + '</button>';
        }).join('')
    + '</div>';
  }

  /* T1 ladder variant — same DOM shape as pcLadderHTML so the
     primitive's click handler (`[data-pc-ladder-pick]`) routes us
     here via the data-pc-tier branch. Extras over T2:
       - `data-pass` on each step (true/false) so failing steps can
         be visually dimmed; T1 is THE contrast-tuning surface, so
         seeing the pass/fail of every step inline is core info.
       - Uses the role's own palette ladder + lever-aware judge.
       - data-pc-ladder-role / -lever so the click handler can
         dispatch even though renderT1 only knows about one role.
  */
  function t1LeverLadderHTML(roleId, leverId, mode) {
    var ladderHex = ladderFor(roleId);
    var t = t1For(roleId, mode);
    var current = t[leverId];
    var def     = (defaultT1ForRole(roleId, mode) || {})[leverId];
    return '<div class="ev2-pc-ladder" data-pc-ladder-role="' + roleId + '" data-pc-ladder-lever="' + leverId + '">'
      + ALL_STEPS.map(function (step) {
          var hex   = ladderHex[step] || '#000';
          var isCur = step === current;
          var isDef = step === def;
          var j     = DTFSolver.judgeStepForLever(ladderHex, leverId, step, t, mode);
          var pass  = j.pass ? 'true' : 'false';
          var tip   = 'step ' + step + ' \u2022 ' + hex.toUpperCase()
                    + ' \u00b7 ' + j.ratio.toFixed(2) + ':1 (' + (j.pass ? j.grade : 'Fail') + ')'
                    + (isDef ? ' \u2022 default' : '')
                    + (isCur ? ' \u2022 selected' : '');
          return '<button type="button" class="ev2-pc-ladder-step"'
            + ' data-pc-ladder-pick="' + step + '"'
            + ' data-current="' + isCur + '"'
            + ' data-default="' + isDef + '"'
            + ' data-pass="' + pass + '"'
            + ' data-tip="' + tip + '"'
            + ' aria-label="' + tip + '"'
            + ' style="background:' + hex + '">'
          + '</button>';
        }).join('')
    + '</div>';
  }

  /* ── T1 derived (border / separator / on-component / on-container) ──
     Each derived card has its own:
       • current() — what is being rendered today (override or default)
       • defaultStep() — what the auto-derivation would pick
       • baselineHex() — what its step is judged AGAINST (for WCAG)
       • intent — 'edge' or 'text' (drives the sentinel chip + popover)
       • setStep(step) / clearStep() — write/restore the override
     This lets the existing Property Card primitive, the WCAG popover,
     the stepper, and the reset chip all dispatch through one shape. */

  // Step name currently rendered for a given derived id.
  // onComponent override now accepts white/black OR any palette
  // step that AA-passes worst-case (see onComponentAllowedSteps).
  // Default is computed against the worst of the 3 fill states to
  // stay in lockstep with the solver + sync server.
  function t1DerivedStep(roleId, derivedId, mode) {
    var t = State.t1[mode][roleId];
    if (derivedId === 'border')      return t.borderStep ? t.borderStep : stepRelToward(t.container, 6, mode);
    if (derivedId === 'separator')   return t.separatorStep ? t.separatorStep : stepRelToward(t.container, 2, mode);
    if (derivedId === 'cmBorder')    return resolveCmBorderStep(roleId, mode);
    if (derivedId === 'cmSeparator') return resolveCmSeparatorStep(roleId, mode);
    if (derivedId === 'onComponent') {
      var allowed = onComponentAllowedSteps(roleId, mode);
      if (t.onComponent && allowed.indexOf(t.onComponent) >= 0) return t.onComponent;
      var fills = [
        stepHexByName(roleId, t.fill),
        stepHexByName(roleId, stepRel(t.fill, 1)),
        stepHexByName(roleId, stepRel(t.fill, 2))
      ].filter(Boolean);
      if (!fills.length) fills = ['#000'];
      return DTFSolver.deriveOnComponent(fills) === '#FFFFFF' ? 'white' : 'black';
    }
    if (derivedId === 'onContainer') return onContainerStepName(roleId, mode);
    if (derivedId === 'contentSubtle') {
      if (t.contentSubtleStep && ALL_STEPS.indexOf(t.contentSubtleStep) >= 0) return t.contentSubtleStep;
      return stepRel(t.content, -2);
    }
    if (derivedId === 'contentStrong') {
      if (t.contentStrongStep && ALL_STEPS.indexOf(t.contentStrongStep) >= 0) return t.contentStrongStep;
      return stepRel(t.content, 1);
    }
    if (derivedId === 'fillHover') {
      if (t.fillHoverStep && ALL_STEPS.indexOf(t.fillHoverStep) >= 0) return t.fillHoverStep;
      return stepRel(t.fill, 1);
    }
    if (derivedId === 'fillPressed') {
      if (t.fillPressedStep && ALL_STEPS.indexOf(t.fillPressedStep) >= 0) return t.fillPressedStep;
      return stepRel(t.fill, 2);
    }
    if (derivedId === 'cmBorderHover') {
      var cmB = resolveCmBorderStep(roleId, mode);
      if (t.cmBorderHoverStep && ALL_STEPS.indexOf(t.cmBorderHoverStep) >= 0) return t.cmBorderHoverStep;
      return cmB; // default: same as outline-default
    }
    if (derivedId === 'cmBorderPressed') {
      var cmB2 = resolveCmBorderStep(roleId, mode);
      if (t.cmBorderPressedStep && ALL_STEPS.indexOf(t.cmBorderPressedStep) >= 0) return t.cmBorderPressedStep;
      return stepRel(cmB2, 1);
    }
    return null;
  }
  // What the derivation would pick if no override were set.
  function t1DerivedDefault(roleId, derivedId, mode) {
    var t = State.t1[mode][roleId];
    if (derivedId === 'border')    return stepRelToward(t.container, 6, mode);
    if (derivedId === 'separator') return stepRelToward(t.container, 2, mode);
    if (derivedId === 'cmBorder')    return stepRel(t.fill, -2);
    if (derivedId === 'cmSeparator') return stepRel(t.fill, -4);
    if (derivedId === 'onComponent') {
      var fills = [
        stepHexByName(roleId, t.fill),
        stepHexByName(roleId, stepRel(t.fill, 1)),
        stepHexByName(roleId, stepRel(t.fill, 2))
      ].filter(Boolean);
      if (!fills.length) fills = ['#000'];
      return DTFSolver.deriveOnComponent(fills) === '#FFFFFF' ? 'white' : 'black';
    }
    if (derivedId === 'onContainer') {
      var ladder = ladderFor(roleId);
      var containerHex = ladder[t.container] || surfaceBgFor(mode);
      return DTFSolver.deriveOnContainer(ladder, t.content, containerHex).step;
    }
    if (derivedId === 'contentSubtle')    return stepRel(t.content, -2);
    if (derivedId === 'contentStrong')    return stepRel(t.content, 1);
    if (derivedId === 'fillHover')        return stepRel(t.fill, 1);
    if (derivedId === 'fillPressed')      return stepRel(t.fill, 2);
    if (derivedId === 'cmBorderHover')    return resolveCmBorderStep(roleId, mode);
    if (derivedId === 'cmBorderPressed')  return stepRel(resolveCmBorderStep(roleId, mode), 1);
    return null;
  }
  // True when user has overridden this derived value.
  // onComponent detached iff t.onComponent is set AND is still in
  // the allowed-set for the current fills (a fill-step change can
  // make a previously-valid palette pick no longer AA-safe; we
  // treat that as not-detached so the auto-derivation takes over
  // and the unsafe value is dropped on next save).
  function t1DerivedIsDetached(roleId, derivedId, mode) {
    /* 'detached' means 'differs from the baseline (last published)',
       same definition the lever check uses. The previous logic
       returned true whenever an override existed \u2014 but after a
       publish that override IS the baseline, so the EDITED chip
       stayed on forever even with zero unsaved diffs. */
    var t = State.t1[mode][roleId] || {};
    var baseEntry = (State.t1Baseline && State.t1Baseline[mode] && State.t1Baseline[mode][roleId])
                    || defaultT1ForRole(roleId, mode) || {};
    function neq(a, b){
      return (a == null ? null : a) !== (b == null ? null : b);
    }
    if (derivedId === 'border')      return neq(t.borderStep,      baseEntry.borderStep);
    if (derivedId === 'separator')   return neq(t.separatorStep,   baseEntry.separatorStep);
    if (derivedId === 'cmBorder')    return neq(t.cmBorderStep,    baseEntry.cmBorderStep);
    if (derivedId === 'cmSeparator') return neq(t.cmSeparatorStep, baseEntry.cmSeparatorStep);
    if (derivedId === 'onComponent') return neq(t.onComponent,     baseEntry.onComponent);
    if (derivedId === 'onContainer') return neq(t.onContainerStep, baseEntry.onContainerStep);
    if (derivedId === 'contentSubtle')    return neq(t.contentSubtleStep,    baseEntry.contentSubtleStep);
    if (derivedId === 'contentStrong')    return neq(t.contentStrongStep,    baseEntry.contentStrongStep);
    if (derivedId === 'fillHover')        return neq(t.fillHoverStep,        baseEntry.fillHoverStep);
    if (derivedId === 'fillPressed')      return neq(t.fillPressedStep,      baseEntry.fillPressedStep);
    if (derivedId === 'cmBorderHover')    return neq(t.cmBorderHoverStep,    baseEntry.cmBorderHoverStep);
    if (derivedId === 'cmBorderPressed')  return neq(t.cmBorderPressedStep,  baseEntry.cmBorderPressedStep);
    return false;
  }
  // Hex currently painted by a derived id.
  function t1DerivedHex(roleId, derivedId, mode) {
    var step = t1DerivedStep(roleId, derivedId, mode);
    if (derivedId === 'onComponent') return onComponentHexFor(roleId, step) || '#000';
    var ladder = ladderFor(roleId);
    return ladder[step] || '#000';
  }
  // Baseline hex (what the derived's contrast is judged against)
  // + intent + token name. Used by Property Card sentinel chip + popover.
  function t1DerivedBaseline(roleId, derivedId, mode) {
    var ladder = ladderFor(roleId);
    var t = State.t1[mode][roleId];
    var role = ROLES.find(function (r) { return r.id === roleId; });
    var prefix = role ? role.prefix : roleId;
    if (derivedId === 'border' || derivedId === 'separator') {
      var contHex = ladder[t.container] || surfaceBgFor(mode);
      return {
        hex: contHex,
        token: '--' + prefix + '-container-bg',
        intent: 'edge',
        large: true
      };
    }
    if (derivedId === 'cmBorder' || derivedId === 'cmSeparator') {
      var fillHexB = ladder[t.fill] || stepHexByName(roleId, t.fill) || '#000';
      return {
        hex: fillHexB,
        token: '--' + prefix + '-component-bg-default',
        intent: 'edge',
        large: true
      };
    }
    if (derivedId === 'onComponent') {
      var fillHex = stepHexByName(roleId, t.fill) || '#000';
      return {
        hex: fillHex,
        token: '--' + prefix + '-component-bg-default',
        intent: 'text',
        large: false
      };
    }
    if (derivedId === 'contentSubtle' || derivedId === 'contentStrong') {
      var pageBgCS = surfaceBgFor(mode);
      return {
        hex: pageBgCS,
        token: '--surface-base-bg',
        intent: 'text',
        large: false
      };
    }
    if (derivedId === 'fillHover' || derivedId === 'fillPressed') {
      // Judged as text-on-fill (on-component readability)
      var onCompHex = onComponentColor(roleId, mode) || '#FFF';
      return {
        hex: onCompHex,
        token: '--' + prefix + '-on-component',
        intent: 'text',
        large: false
      };
    }
    if (derivedId === 'cmBorderHover' || derivedId === 'cmBorderPressed') {
      var fillHexOL = ladder[t.fill] || stepHexByName(roleId, t.fill) || '#000';
      return {
        hex: fillHexOL,
        token: '--' + prefix + '-component-bg-default',
        intent: 'edge',
        large: true
      };
    }
    // onContainer
    var contHex2 = ladder[t.container] || surfaceBgFor(mode);
    return {
      hex: contHex2,
      token: '--' + prefix + '-container-bg',
      intent: 'text',
      large: false
    };
  }
  function t1DerivedTokenName(roleId, derivedId) {
    var role = ROLES.find(function (r) { return r.id === roleId; });
    var prefix = role ? role.prefix : roleId;
    if (derivedId === 'border')      return '--' + prefix + '-container-outline';
    if (derivedId === 'separator')   return '--' + prefix + '-container-separator';
    if (derivedId === 'cmBorder')    return '--' + prefix + '-component-outline-default';
    if (derivedId === 'cmSeparator') return '--' + prefix + '-component-separator';
    if (derivedId === 'onComponent') return '--' + prefix + '-on-component';
    if (derivedId === 'onContainer') return '--' + prefix + '-on-container';
    if (derivedId === 'contentSubtle')    return '--' + prefix + '-content-subtle';
    if (derivedId === 'contentStrong')    return '--' + prefix + '-content-strong';
    if (derivedId === 'fillHover')        return '--' + prefix + '-component-bg-hover';
    if (derivedId === 'fillPressed')      return '--' + prefix + '-component-bg-pressed';
    if (derivedId === 'cmBorderHover')    return '--' + prefix + '-component-outline-hover';
    if (derivedId === 'cmBorderPressed')  return '--' + prefix + '-component-outline-pressed';
    return '--' + prefix + '-' + derivedId;
  }
  // Per-step pass mark for the ladder, mirroring t1LeverLadderHTML.
  // onComponent is special: the chosen white/black serves all 3
  // fill states (default + hover + pressed), so its WCAG verdict
  // must reflect the WORST of those three contrasts — otherwise
  // the picker shows a green "pass" mark for a colour that fails
  // on hover/pressed (the bug that motivated the worst-case
  // solver change).
  function t1DerivedJudgeStep(roleId, derivedId, mode, step) {
    var base = t1DerivedBaseline(roleId, derivedId, mode);
    var hex;
    if (derivedId === 'onComponent') {
      hex = onComponentHexFor(roleId, step) || '#000';
      var t = State.t1[mode][roleId];
      var hStep = t.fillHoverStep   || stepRel(t.fill, 1);
      var pStep = t.fillPressedStep || stepRel(t.fill, 2);
      var fills = [
        stepHexByName(roleId, t.fill),
        stepHexByName(roleId, hStep),
        stepHexByName(roleId, pStep)
      ].filter(Boolean);
      if (!fills.length) fills = [base.hex];
      var minR = Infinity;
      for (var i = 0; i < fills.length; i++) {
        var rr = contrastRatio(hex, fills[i]);
        if (rr < minR) minR = rr;
      }
      return { ratio: minR, judge: wcagJudge(minR, base.large) };
    }
    hex = ladderFor(roleId)[step] || '#000';
    var r = contrastRatio(hex, base.hex);
    return { ratio: r, judge: wcagJudge(r, base.large) };
  }
  /* Ladder HTML for a derived card. onComponent gets a filtered
     picker (always white + black; plus any palette step that
     AA-passes worst-state). Everything else uses the standard
     22-step palette. */
  function t1DerivedLadderHTML(roleId, derivedId, mode) {
    var steps = (derivedId === 'onComponent')
      ? onComponentAllowedSteps(roleId, mode)
      : ALL_STEPS;
    var ladderHex = ladderFor(roleId);
    var current = t1DerivedStep(roleId, derivedId, mode);
    var def     = t1DerivedDefault(roleId, derivedId, mode);
    // For onComponent, when neither white nor black passes AA,
    // mark the BETTER worst-state of the two as "soft" (amber)
    // instead of red. Tinted palette steps in the picker are by
    // definition AA-passing (filter guarantees it), so they
    // always render as a normal "true" pass \u2014 no soft mark.
    var softStep = null;
    if (derivedId === 'onComponent') {
      var jW = t1DerivedJudgeStep(roleId, derivedId, mode, 'white');
      var jB = t1DerivedJudgeStep(roleId, derivedId, mode, 'black');
      if (!jW.judge.pass && !jB.judge.pass) {
        softStep = jW.ratio >= jB.ratio ? 'white' : 'black';
      }
    }
    return '<div class="ev2-pc-ladder" data-pc-ladder-role="' + roleId + '"'
      + ' data-pc-ladder-derived="' + derivedId + '"'
      + (derivedId === 'onComponent' ? ' data-pc-ladder-compact="true"' : '')
      + '>'
      + steps.map(function (step) {
          var hex   = (derivedId === 'onComponent')
            ? (onComponentHexFor(roleId, step) || '#000')
            : (ladderHex[step] || '#000');
          var isCur = step === current;
          var isDef = step === def;
          var jr    = t1DerivedJudgeStep(roleId, derivedId, mode, step);
          var pass  = jr.judge.pass ? 'true' : (step === softStep ? 'soft' : 'false');
          // For onComponent the ratio is worst-of-3-fills; flag it
          // explicitly so the user understands why a colour can show
          // a lower ratio than they'd expect by eyeballing default.
          var tip;
          if (derivedId === 'onComponent') {
            var verdict = jr.judge.pass ? 'readable' : (step === softStep ? 'closest we can get' : 'hard to read');
            var stepLabel = (step === 'white' || step === 'black') ? step : ('step ' + step);
            tip = stepLabel + ' \u2022 ' + hex.toUpperCase()
                + ' \u00b7 worst state ' + jr.ratio.toFixed(2) + ':1 \u2022 '
                + verdict
                + (isDef ? ' \u2022 auto pick' : '')
                + (isCur ? ' \u2022 selected' : '');
          } else {
            tip = 'step ' + step + ' \u2022 ' + hex.toUpperCase()
                + ' \u00b7 ' + jr.ratio.toFixed(2) + ':1 ('
                + (jr.judge.pass ? jr.judge.grade : 'Fail') + ')'
                + (isDef ? ' \u2022 default' : '')
                + (isCur ? ' \u2022 selected' : '');
          }
          return '<button type="button" class="ev2-pc-ladder-step"'
            + ' data-pc-ladder-pick="' + step + '"'
            + ' data-current="' + isCur + '"'
            + ' data-default="' + isDef + '"'
            + ' data-pass="' + pass + '"'
            + ' data-tip="' + tip + '"'
            + ' aria-label="' + tip + '"'
            + ' style="background:' + hex + '">'
          + '</button>';
        }).join('')
    + '</div>';
  }

  function propertyCardHTML(opts) {
    // opts: { tokenName, swatchHex, step, isDetached, sentinel?,
    //         dataAttrs?, expanded?, level?, parentLabel?, deltaSigned? }
    var swSt = 'background:' + opts.swatchHex + ';' +
               'border-style:' + (opts.isDetached ? 'solid' : 'dashed') + ';';
    var sent = opts.sentinel;
    var sentHTML = '';
    if (sent) {
      // Edge-intent below threshold = "fine if paired with shadow"
      // soft note (amber, ⓘ), NOT a hard red fail. Edge-intent ≥
      // threshold = green pass. Text-intent uses the canonical
      // pass / aa / aaa / fail grades.
      var grade, sym;
      if (sent.intent === 'edge') {
        if (sent.judge.pass) { grade = 'aa-large'; sym = '\u2713'; }
        else                  { grade = 'edge-soft'; sym = '\u24D8'; }
      } else {
        grade = sent.judge.pass ? (sent.judge.grade === 'AAA' ? 'aaa' : (sent.large ? 'aa-large' : 'aa')) : 'fail';
        sym   = sent.judge.pass ? '\u2713' : '\u26A0';
      }
      sentHTML = '<button type="button" class="ev2-pc-wcag" data-grade="' + grade + '"'
        + ' data-pc-wcag-open'
        + ' aria-label="Contrast ' + sent.ratio.toFixed(2) + ' to 1, click for details and fix">'
        + sym + ' ' + sent.ratio.toFixed(2) + ':1'
      + '</button>';
    }
    var attrs = '';
    if (opts.dataAttrs) Object.keys(opts.dataAttrs).forEach(function (k) {
      attrs += ' data-' + k + '="' + String(opts.dataAttrs[k]).replace(/"/g,'&quot;') + '"';
    });
    var tier = opts.tier || 't2';
    attrs += ' data-pc-tier="' + tier + '"';
    var alwaysExpanded = !!opts.alwaysExpanded;
    var expanded = alwaysExpanded || !!opts.expanded;
    var ladderHTML = '';
    var actionsHTML = '';
    if (opts.ladderHTML) {
      // Caller supplied a precomputed ladder (T1 uses this — per-step
      // WCAG marks need a judge callback we don't want to thread through
      // the primitive). Render it iff the card is expanded.
      if (expanded) ladderHTML = opts.ladderHTML;
    } else if (expanded && opts.dataAttrs && opts.dataAttrs['pc-surface'] && opts.dataAttrs['pc-prop']) {
      var _surfaceId = opts.dataAttrs['pc-surface'];
      var _propId    = opts.dataAttrs['pc-prop'];
      ladderHTML = pcLadderHTML(_surfaceId, _propId, State.editingMode);
    }
    if (opts.dataAttrs && opts.dataAttrs['pc-surface'] && opts.dataAttrs['pc-prop']) {
      // Horizontal action bar — only renders chips that are useful
      // for the row's current state. Apply-* chips need a detached
      // step to bulk-apply; Reset family needs dirty descendants.
      // When neither applies we render no bar at all (no empty rail).
      actionsHTML = pcActionsHTML(opts.dataAttrs['pc-surface'], opts.dataAttrs['pc-prop'], State.editingMode, !!opts.isDetached, !!opts.hasDirtyDescendants);
    }
    // Build meta strip. For child rows we show "step N · +d from parent"
    // when linked, and "step N · custom" when the user has pinned it.
    var metaBits = '<span class="ev2-pc-step">step ' + opts.step + '</span>';
    if (opts.isDetached) {
      metaBits += '<span class="ev2-pc-chip">edited</span>';
    } else if (opts.parentLabel && typeof opts.deltaSigned === 'number') {
      var sign = opts.deltaSigned > 0 ? '+' : '';
      metaBits += '<span class="ev2-pc-chip ev2-pc-chip-link" data-tip="Linked to ' + opts.parentLabel + ' — step changes follow">'
        + sign + opts.deltaSigned + ' from ' + opts.parentLabel
      + '</span>';
    } else if (!opts.suppressBaseChip) {
      metaBits += '<span class="ev2-pc-chip ev2-pc-chip-muted">base</span>';
    }
    if (opts.metaExtra) metaBits += opts.metaExtra;
    var lvl = opts.level || 0;
    // T1 ladder is always-open by design (small surface, 3 levers per
    // role); the swatch + disclose toggle don't apply there. Hide
    // the disclose chevron and make the swatch non-interactive
    // when alwaysExpanded is true.
    var swExtra = alwaysExpanded
      ? ' tabindex="-1" aria-hidden="true" data-pc-noninteractive="true"'
      : ' data-pc-toggle aria-expanded="' + (expanded ? 'true' : 'false') + '" data-tip="' + (expanded ? 'Hide steps' : 'Pick a step') + '" aria-label="' + (expanded ? 'Hide steps' : 'Pick a step') + ' — swatch (also opens picker)"';
    var discloseHTML = alwaysExpanded ? ''
      : '<button type="button" class="ev2-pc-disclose" data-pc-toggle aria-expanded="' + (expanded ? 'true' : 'false') + '" data-tip="' + (expanded ? 'Hide steps' : 'Pick a step') + '" aria-label="' + (expanded ? 'Hide steps' : 'Pick a step') + '"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 3.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    var subHTML = opts.subtitle ? '<div class="ev2-pc-sub">' + opts.subtitle + '</div>' : '';
    return '<div class="ev2-pc" data-detached="' + (opts.isDetached ? 'true' : 'false') + '" data-expanded="' + (expanded ? 'true' : 'false') + '" data-level="' + lvl + '"' + attrs + '>'
      + '<button type="button" class="ev2-pc-sw" style="' + swSt + '"' + swExtra + '></button>'
      + '<div class="ev2-pc-main">'
        + '<div class="ev2-pc-name">' + opts.tokenName + '</div>'
        + subHTML
        + '<div class="ev2-pc-meta">' + metaBits + '</div>'
      + '</div>'
      + sentHTML
      + '<div class="ev2-pc-controls">'
        + '<button type="button" class="ev2-pc-step-btn" data-pc-step="-1" data-tip="Step lighter" aria-label="Step lighter">\u2212</button>'
        + '<button type="button" class="ev2-pc-step-btn" data-pc-step="+1" data-tip="Step darker" aria-label="Step darker">+</button>'
        + discloseHTML
        + (function(){
            // Row-level reset tooltip names the role AND clarifies
            // 'default' = the last published version (i.e. the
            // baseline State.baseline that's promoted on every
            // successful Publish). Without naming the source,
            // users ask 'default of what?' — the project file?
            // the brand color? the seed palette? It's none of
            // those: it's the last shipped state.
            var safeName = String(opts.tokenName || '')
              .replace(/&/g,'&amp;').replace(/</g,'&lt;')
              .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
            var ver = (typeof State !== 'undefined' && State.lastPublishedVersion) ? State.lastPublishedVersion : '';
            var dest = ver ? ('last published (' + ver + ')') : 'last published version';
            var tip = safeName ? ('Reset ' + safeName + ' to ' + dest) : ('Reset to ' + dest);
            return '<button type="button" class="ev2-pc-reset" data-pc-reset' + (opts.isDetached ? '' : ' disabled') + ' data-tip="' + tip + '" aria-label="' + tip + '">\u21BA</button>';
          })()
      + '</div>'
      + ladderHTML
      + actionsHTML
    + '</div>';
  }

  /* ── Inline action bar (T2 row, expanded) ─────────────
     Lives inside the expanded Property Card, below the step
     ladder. We rejected the cross-mode / cross-surface "Apply"
     chips because both ship silently with no per-target preview
     and no undo path — at 8 surfaces × 16 props they create more
     cleanup work than they save. Only Reset family survives: it's
     a pure undo (clears overrides; designer can always re-step
     individual rows back), and the (N) count gives a preview of
     scope. If apply-style ops come back, they need snapshot-undo
     toast + a per-target diff preview first. */
  function pcActionsHTML(surfaceId, propId, mode, isDetached, hasDirtyDescendants) {
    if (!hasDirtyDescendants) return '';
    var bag = (State.t2[mode] && State.t2[mode][surfaceId]) || {};
    var descCount = descendantPropIds(propId).filter(function (d) { return bag[d] && bag[d].step; }).length;
    var total = descCount + (isDetached ? 1 : 0);
    var chip = {
      key:    'reset-family',
      danger: true,
      lbl:    'Reset family (' + total + ')',
      tip:    'Clear this row + ' + descCount + ' descendant override' + (descCount === 1 ? '' : 's') + ' in ' + mode + ' mode.'
    };
    return '<div class="ev2-pc-actions" role="group" aria-label="Bulk actions for this row">'
      + '<button type="button" class="ev2-pc-action"'
        + ' data-pc-bulk="' + chip.key + '"'
        + ' data-surface="' + surfaceId + '" data-prop="' + propId + '"'
        + ' data-danger="true"'
        + ' data-tip="' + chip.tip.replace(/"/g, '&quot;') + '">'
        + '<span class="ev2-pc-action-lbl">' + chip.lbl + '</span>'
      + '</button>'
    + '</div>';
  }

  function surfacePickerHTML() {
    // Compact horizontal rail: swatch + name only. Description lives
    // in the surface-pane header, so we don't pay vertical cost twice.
    return '<div class="ev2-surfaces" role="tablist" aria-label="Surfaces">'
      + T2_SURFACES.map(function (s) {
          var current = s.id === State.activeSurface;
          var bgHex   = t2HexFor(s.id, 'bg', State.editingMode);
          var changed = isT2Changed(s.id);
          return '<button class="ev2-surface" role="tab" data-surface-tab="' + s.id + '"'
            + ' aria-current="' + current + '" data-changed="' + changed + '"'
            + ' data-tip="' + s.desc.replace(/"/g, '&quot;') + '">'
            + '<span class="ev2-surface-sw" style="background:' + bgHex + '"></span>'
            + '<span class="ev2-surface-name">' + s.label + '</span>'
            + (changed ? '<span class="ev2-surface-dot" aria-label="Has overrides"></span>' : '')
          + '</button>';
        }).join('')
    + '</div>';
  }

  function surfaceFamilyHTML(surface, family, mode) {
    var props = T2_PROP_DEFS.filter(function (p) { return p.family === family.id; });
    var cards = props.map(function (prop) {
      var resolvedStep = resolveT2Step(surface.id, prop.id, mode);
      var defaultStep  = defaultT2Step(surface.id, prop.id, mode);
      var swatchHex    = t2HexFor(surface.id, prop.id, mode);
      var ov = State.t2[mode][surface.id] && State.t2[mode][surface.id][prop.id];
      var isDetached   = !!(ov && ov.step);
      var sentinel = t2Sentinel(surface.id, prop.id, mode);
      var expanded = __expandedT2 === (surface.id + '/' + prop.id);
      // For child rows, compute effective delta from parent (in
      // mode-correct units) so meta strip can show "+1 from bg" etc.
      var parentLabel = null;
      var deltaSigned = null;
      if (prop.parent) {
        parentLabel = prop.parent;
        var pStep = resolveT2Step(surface.id, prop.parent, mode);
        var pIdx  = ALL_STEPS.indexOf(pStep);
        var cIdx  = ALL_STEPS.indexOf(resolvedStep);
        if (pIdx >= 0 && cIdx >= 0) {
          deltaSigned = (cIdx - pIdx) * tonalDir(mode);
        }
      }
      // Overflow menu visibility: this row is detached (has a step
      // override to bulk-apply or reset) OR has any descendant in
      // the same mode with an override (so "Reset family" is useful).
      var bag = (State.t2[mode] && State.t2[mode][surface.id]) || {};
      var hasDirtyDescendants = descendantPropIds(prop.id).some(function (d) {
        return bag[d] && bag[d].step;
      });
      return propertyCardHTML({
        tokenName: '--surface-' + surface.id + '-' + prop.id,
        swatchHex: swatchHex,
        step: resolvedStep,
        isDetached: isDetached,
        expanded: expanded,
        sentinel: sentinel,
        level: prop.level,
        parentLabel: parentLabel,
        deltaSigned: deltaSigned,
        hasDirtyDescendants: hasDirtyDescendants,
        dataAttrs: {
          'pc-surface': surface.id,
          'pc-prop':    prop.id,
          'pc-default': defaultStep
        }
      });
    }).join('');
    // Optional anchor reference chip — shows the family's external
    // anchor (e.g. Edges/Content/Component all anchor on bg). Lets
    // the user see "what am I deriving from" without leaving the card.
    var anchorChip = '';
    if (family.anchorRef) {
      var aStep = resolveT2Step(surface.id, family.anchorRef, mode);
      var aHex  = t2HexFor(surface.id, family.anchorRef, mode);
      anchorChip = '<div class="ev2-pc-group-anchor" data-tip="Family is derived from --surface-' + surface.id + '-' + family.anchorRef + ' (step ' + aStep + ')">'
        + '<span class="ev2-pc-group-anchor-sw" style="background:' + aHex + '"></span>'
        + '<span class="ev2-pc-group-anchor-lbl">follows <code>' + family.anchorRef + '</code> · step ' + aStep + '</span>'
      + '</div>';
    }
    return '<section class="ev2-pc-group" data-family="' + family.id + '">'
      + '<header class="ev2-pc-group-head">'
        + '<h3 class="ev2-pc-group-title">' + family.label + '</h3>'
        + anchorChip
      + '</header>'
      + '<div class="ev2-pc-list">' + cards + '</div>'
    + '</section>';
  }

  function renderT2() {
    var surface = T2_SURFACES.find(function (s) { return s.id === State.activeSurface; })
               || T2_SURFACES[0];
    State.activeSurface = surface.id;
    var mode = State.editingMode;
    var bgHex = t2HexFor(surface.id, 'bg', mode);
    var activePalette = surfacePaletteFor(surface.id);
    var paletteCustom = isSurfacePaletteCustom(surface.id);

    /* Source-palette picker. Custom popover (not a native <select>)
       so we can show grouped sections with labels + a "Custom
       palettes" empty state. The trigger button shows the current
       pick + a CUSTOM pill / Reset button when the surface is on
       a non-default palette. The popover singleton lives at body
       level (see initSurfacePalettePopover() below). */
    var activeOpt = paletteOptionFor(activePalette) || { id:activePalette, label:activePalette };
    var paletteCtl =
      '<div class="ev2-surface-head-palette" data-custom="' + paletteCustom + '">'
        + '<span class="ev2-surface-head-palette-label">Source palette</span>'
        + '<button type="button" class="ev2-surface-head-palette-trigger"'
          + ' data-surface-palette-open="' + surface.id + '"'
          + ' aria-haspopup="listbox" aria-expanded="false"'
          + ' aria-label="Source palette for ' + surface.label + ' \u2014 currently ' + activeOpt.label + '">'
          + '<span class="ev2-surface-head-palette-trigger-val">' + activeOpt.label + '</span>'
          + '<svg class="ev2-surface-head-palette-trigger-caret" width="10" height="6" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" stroke="currentColor" stroke-width="1.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>'
        + '</button>'
        + (paletteCustom
            ? '<span class="ev2-surface-head-palette-pill" data-tip="Default for this surface is ' + surface.palette + '. Click reset to restore.">Edited</span>'
              + '<button type="button" class="ev2-surface-head-palette-reset" data-surface-palette-reset="' + surface.id + '" aria-label="Reset source palette to ' + surface.palette + '">Reset</button>'
            : '')
      + '</div>';

    $body.innerHTML =
      surfacePickerHTML()
      + '<div class="ev2-surface-pane">'
        + '<header class="ev2-surface-head">'
          + '<div class="ev2-surface-head-l">'
            + '<span class="ev2-surface-head-sw" style="background:' + bgHex + '"></span>'
            + '<div class="ev2-surface-head-txt">'
              + '<h2 class="ev2-surface-head-name">' + surface.label + '</h2>'
              + '<p class="ev2-surface-head-sub">' + surface.desc + '</p>'
            + '</div>'
          + '</div>'
          + '<div class="ev2-surface-head-r">'
            + paletteCtl
          + '</div>'
        + '</header>'
        + T2_FAMILIES.map(function (f) { return surfaceFamilyHTML(surface, f, mode); }).join('')
      + '</div>';
  }

  /* ── T1 Roles ────────────────────────────────────────── */
  /* (removed) renderWcagPairsHTML — the auto-derived border /
     separator / on-component / on-container swatches it produced
     are now first-class Property Cards rendered by t1DerivedCard. */

  function renderT1() {
    var prevScroll = $body ? $body.scrollTop : 0;
    var role = ROLES.find(function (r) { return r.id === State.activeRole; });
    if (!role) return;
    var mode = State.editingMode;
    var t1 = t1For(role.id);
    var changed = isT1Changed(role.id) || isChanged(role.id);
    var affects = AFFECTS[role.id] || [];
    var pageBg = surfaceBgFor(mode);
    var ladder = ladderFor(role.id);

    /* Per-lever Property Card. Same primitive as T2; T1-specific
       behaviour comes from `tier: 't1'` (which the click handlers
       branch on) + `alwaysExpanded: true` (no disclose toggle, the
       ladder is the primary control) + a precomputed
       `ladderHTML` that decorates each step with its WCAG pass/fail
       against the lever's role (T1 is THE contrast-tuning surface). */
    function leverCardHTML(lever) {
      var current = t1[lever.id];
      var curHex  = ladder[current] || '#000';
      /* EDITED chip must match what every other 'is this dirty?'
         check uses: current vs BASELINE (last published), not
         current vs computed AA-default. If baseline holds a non-
         default step (which it usually does after the first publish),
         comparing against the default makes the chip fire forever
         even when there are zero unsaved changes — contradicting
         the 'No changes yet' label in the topbar. */
      var baseEntry = (State.t1Baseline && State.t1Baseline[mode] && State.t1Baseline[mode][role.id])
                      || defaultT1ForRole(role.id, mode);
      var baseLever = baseEntry && baseEntry[lever.id];
      if (baseLever == null) baseLever = (defaultT1ForRole(role.id, mode) || {})[lever.id];
      var detached = current !== baseLever;
      var hJudge = DTFSolver.judgeStepForLever(ladder, lever.id, current, t1, mode);
      var sentinel = {
        ratio: hJudge.ratio,
        large: false,
        intent: 'text',
        judge: { pass: hJudge.pass, grade: hJudge.grade }
      };
      return propertyCardHTML({
        tier: 't1',
        alwaysExpanded: true,
        tokenName: lever.label,
        subtitle: lever.sub,
        swatchHex: curHex,
        step: current,
        isDetached: detached,
        sentinel: sentinel,
        suppressBaseChip: true,
        ladderHTML: t1LeverLadderHTML(role.id, lever.id, mode),
        dataAttrs: {
          'pc-role':  role.id,
          'pc-lever': lever.id,
          'lever':    lever.id
        }
      });
    }
    function derivedCardHTML(d) {
      var curStep   = t1DerivedStep(role.id, d.id, mode);
      var detached  = t1DerivedIsDetached(role.id, d.id, mode);
      var curHex    = t1DerivedHex(role.id, d.id, mode);
      var base      = t1DerivedBaseline(role.id, d.id, mode);
      var jr        = t1DerivedJudgeStep(role.id, d.id, mode, curStep);
      var sentinel  = {
        ratio: jr.ratio,
        large: base.large,
        intent: base.intent,
        judge: jr.judge
      };
      return propertyCardHTML({
        tier: 't1',
        alwaysExpanded: true,
        tokenName: d.label,
        subtitle: d.sub,
        swatchHex: curHex,
        step: curStep,
        isDetached: detached,
        sentinel: sentinel,
        suppressBaseChip: true,
        ladderHTML: t1DerivedLadderHTML(role.id, d.id, mode),
        dataAttrs: {
          'pc-role':    role.id,
          'pc-derived': d.id
        }
      });
    }
    var leverById   = {}; T1_LEVERS.forEach(function (l) { leverById[l.id] = l; });
    var derivedById = {}; T1_DERIVED.forEach(function (d) { derivedById[d.id] = d; });
    /* Display order pairs fills with their on-text and containers
       with their on-text + outlines for visual scanability. Content
       (direct text token in the role's hue) trails after the pairs
       since it is the least frequently tuned lever. */
    // Grouped as Content → Component → Container so designers read
    // top-down from "what the text/icon looks like" to "what the
    // filled surface looks like" to "what the soft tinted surface
    // looks like" — matching the Resulting-slots panel grouping.
    var T1_DISPLAY_ORDER = [
      { kind:'lever',   id:'content' },
      { kind:'derived', id:'contentStrong' },
      { kind:'derived', id:'contentSubtle' },
      { kind:'lever',   id:'fill' },
      { kind:'derived', id:'fillHover' },
      { kind:'derived', id:'fillPressed' },
      { kind:'derived', id:'onComponent' },
      { kind:'derived', id:'cmBorder' },
      { kind:'derived', id:'cmBorderHover' },
      { kind:'derived', id:'cmBorderPressed' },
      { kind:'derived', id:'cmSeparator' },
      { kind:'lever',   id:'container' },
      { kind:'derived', id:'onContainer' },
      { kind:'derived', id:'border' },
      { kind:'derived', id:'separator' }
    ];
    var leversHTML = T1_DISPLAY_ORDER.map(function (item) {
      if (item.kind === 'lever' && leverById[item.id])   return leverCardHTML(leverById[item.id]);
      if (item.kind === 'derived' && derivedById[item.id]) return derivedCardHTML(derivedById[item.id]);
      return '';
    }).join('');
    var derivedHTML = '';

    $body.innerHTML =
      '<div class="ev2-intent">'
        + '<div class="ev2-roles" role="tablist" aria-label="Role">'

        + ROLES.map(function (r) {
            var current = r.id === role.id;
            var diffs = summarizeRoleChanges(r.id);
            var badge = diffs.length
              ? '<span class="ev2-role-badge" data-tip="' + badgeTipFor(r.id).replace(/"/g,'&quot;')
                + '" aria-label="' + diffs.length + ' lever' + (diffs.length === 1 ? '' : 's') + ' changed">'
                + diffs.length + '</span>'
              : '';
            return '<button class="ev2-role" role="tab" data-role-tab="' + r.id + '" '
              + 'aria-selected="' + current + '" data-changed="' + isRoleDirty(r.id) + '">'
              + '<span class="ev2-role-dot" style="background:' + State.proposed[r.id] + '"></span>'
              + '<span>' + r.label + '</span>'
              + badge
              + '</button>';
          }).join('')
      + '</div>'
        + '<div class="ev2-intent-head">'
          + '<div class="ev2-edit-toggle" role="radiogroup" aria-label="Editing mode" data-tip="Switches which mode\u2019s tokens you are editing AND the editor UI to match. Light and dark each have their own picks \u2014 changing one does not touch the other.">'
            + '<button type="button" class="ev2-edit-mode" data-edit-mode="light" role="radio" aria-checked="' + (mode === 'light') + '" aria-label="Edit light mode tokens">'
              + '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="3"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.3 3.3l1.1 1.1M11.6 11.6l1.1 1.1M3.3 12.7l1.1-1.1M11.6 4.4l1.1-1.1"/></svg>'
              + '<span>Light</span>'
            + '</button>'
            + '<button type="button" class="ev2-edit-mode" data-edit-mode="dark" role="radio" aria-checked="' + (mode === 'dark') + '" aria-label="Edit dark mode tokens">'
              + '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 9.5A5.5 5.5 0 1 1 6.5 3a4.5 4.5 0 0 0 6.5 6.5z"/></svg>'
              + '<span>Dark</span>'
            + '</button>'
          + '</div>'
          + (changed ? '<span class="ev2-intent-hint">Edited from defaults</span>' : '')
          + '<button type="button" class="ev2-role-reset" data-role-reset="' + role.id + '"'
            + (changed ? '' : ' disabled')
            + ' data-tip="Reset ' + role.label + ' to project defaults. Other roles are untouched.">'
            + '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><polyline points="3 4 3 10 9 10"/></svg>'
            + '<span>Reset</span>'
          + '</button>'
        + '</div>'
        + '<div class="ev2-intent-body">'
          + '<div class="ev2-levers">' + leversHTML + '</div>'
          + '<div class="ev2-disc"' + (State.disclosure['t1:slots'] ? ' data-open' : '') + ' data-disc="t1:slots">'
            + '<div class="ev2-disc-head">'
              + '<span>Resulting slots</span>'
              + '<span class="ev2-disc-meta">' + (changed ? 'updated' : 'defaults') + '</span>'
            + '</div>'
            + '<div class="ev2-disc-body">'
              + slotsTableHTML(role.id)
            + '</div>'
          + '</div>'
          + '<div class="ev2-disc"' + (State.disclosure['t1:affects'] ? ' data-open' : '') + ' data-disc="t1:affects">'
            + '<div class="ev2-disc-head">'
              + '<span>Affects components</span>'
              + '<span class="ev2-disc-meta">' + affects.length + ' shown</span>'
            + '</div>'
            + '<div class="ev2-disc-body">'
              + '<div class="ev2-affects">'
                + affects.map(function (c) { return '<span class="ev2-aff-chip">' + c + '</span>'; }).join('')
              + '</div>'
            + '</div>'
          + '</div>'
        + '</div>'
      + '</div>';

    bindT1();
    if ($body && prevScroll) $body.scrollTop = prevScroll;
  }

  function slotsTableHTML(roleId) {
    var t = t1For(roleId);
    var mode = State.editingMode;
    var fillStep      = t.fill;
    var contentStep   = t.content;
    var containerStep = t.container;
    var dir = tonalDir(mode);
    /* Mirrors semanticVarsFor() so the "Resulting slots" table is
       a 1:1 read-out of what gets published to the project file.
       Grouped into Content / Component / Container at the user's
       request \u2014 each group corresponds to one of the three T1
       levers, with the derived cards (outline/separator/on-*)
       folded into the group whose surface they sit on top of. */
    var onCompStep = t1DerivedStep(roleId, 'onComponent', mode);
    var onCompHex  = onComponentHexFor(roleId, onCompStep) || onComponentColor(roleId, mode) || '#000';
    var onContStep = t1DerivedStep(roleId, 'onContainer', mode);
    var groups = [
      { label: 'Content', rows: [
        { slot: 'content-default', step: contentStep },
        { slot: 'content-strong',  step: t1DerivedStep(roleId, 'contentStrong', mode) },
        { slot: 'content-subtle',  step: t1DerivedStep(roleId, 'contentSubtle', mode) },
        { slot: 'content-faint',   step: stepRel(contentStep, -3) }
      ]},
      { label: 'Component', rows: [
        { slot: 'component-bg-default',      step: fillStep },
        { slot: 'component-bg-hover',        step: t1DerivedStep(roleId, 'fillHover', mode) },
        { slot: 'component-bg-pressed',      step: t1DerivedStep(roleId, 'fillPressed', mode) },
        { slot: 'component-outline-default', step: resolveCmBorderStep(roleId, mode) },
        { slot: 'component-outline-hover',   step: t1DerivedStep(roleId, 'cmBorderHover', mode) },
        { slot: 'component-outline-pressed', step: t1DerivedStep(roleId, 'cmBorderPressed', mode) },
        { slot: 'component-separator',       step: resolveCmSeparatorStep(roleId, mode) },
        { slot: 'on-component',              step: onCompStep, hex: onCompHex, stepLabel: (onCompStep === 'white' || onCompStep === 'black') ? onCompStep : ('step ' + onCompStep) }
      ]},
      { label: 'Container', rows: [
        { slot: 'container-bg',        step: containerStep },
        { slot: 'container-hover',     step: stepRel(containerStep, 1 * dir) },
        { slot: 'container-pressed',   step: stepRel(containerStep, 2 * dir) },
        { slot: 'container-outline',   step: resolveBorderStep(roleId, mode) },
        { slot: 'container-separator', step: resolveSeparatorStep(roleId, mode) },
        { slot: 'on-container',        step: onContStep }
      ]}
    ];
    function rowHTML(r) {
      var hex = r.hex || stepHexByName(roleId, r.step) || '#000';
      var stepLabel = r.stepLabel || ('step ' + r.step);
      return '<div class="ev2-slot-row">'
        + '<div class="ev2-slot-sw" style="background:' + hex + '"></div>'
        + '<div class="ev2-slot-name">--' + roleId + '-' + r.slot + '</div>'
        + '<div class="ev2-slot-step">' + stepLabel + '</div>'
        + '<div class="ev2-slot-hex">' + hex.toUpperCase().replace('#','') + '</div>'
      + '</div>';
    }
    return '<div class="ev2-slots">'
      + groups.map(function (g) {
          return '<div class="ev2-slot-group-head">' + g.label + '</div>'
               + g.rows.map(rowHTML).join('');
        }).join('')
      + '</div>';
  }

  function bindT1() {
    document.querySelectorAll('[data-role-tab]').forEach(function (b) {
      b.addEventListener('click', function () {
        State.activeRole = b.getAttribute('data-role-tab');
        saveUIState();
        renderT1();
        // Tell the preview spotlight which role to feature.
        try { $frame.contentWindow.postMessage({ type: 'ev2-active-role', role: State.activeRole }, '*'); } catch (e) {}
      });
    });
    document.querySelectorAll('.ev2-disc-head').forEach(function (h) {
      h.addEventListener('click', function () {
        var disc = h.parentElement;
        var key = disc.getAttribute('data-disc');
        var nowOpen = !disc.hasAttribute('data-open');
        if (nowOpen) disc.setAttribute('data-open', '');
        else disc.removeAttribute('data-open');
        if (key) State.disclosure[key] = nowOpen;
        saveUIState();
      });
    });
    document.querySelectorAll('.ev2-pc[data-pc-tier="t1"]').forEach(function (block) {
      block.addEventListener('mouseenter', function () {
        var lever = block.getAttribute('data-lever');
        State.focusedLever = lever;
        focusPreview(lever);
      });
      block.addEventListener('mouseleave', function () {
        State.focusedLever = null;
        focusPreview(null);
      });
    });
    /* (removed) per-swatch [data-t1-lever] binding — the T1 ladder
       is now a Property Card ladder so picks are dispatched through
       the shared [data-pc-ladder-pick] handler with a t1 branch. */
  }

  /* (removed) [data-step-walk] / [data-step-reset] delegated
     click handler — those attributes are no longer emitted anywhere
     (border / separator are full Property Cards routed through the
     [data-pc-step] + [data-pc-reset] dispatcher). */

  function leverSlotHint(leverId) {
    if (leverId === 'fill') return 'component-bg-default';
    if (leverId === 'content') return 'content-default';
    return 'container-bg';
  }
  function renderLeverPreview(leverId, hex) {
    if (leverId === 'fill') {
      return '<span class="ev2-pv-fill" style="background:' + hex + '"></span>';
    }
    if (leverId === 'content') {
      return '<span class="ev2-pv-content" style="color:' + hex + '">Aa</span>';
    }
    return '<span class="ev2-pv-container" style="background:' + hex + ';border-color:' + hex + '"></span>';
  }
  function focusPreview(leverId, scroll) {
    try {
      $frame.contentWindow.postMessage({ type: 'ev2-focus', lever: leverId, scroll: !!scroll }, '*');
    } catch (e) {}
  }

  function renderActiveTier() {
    var meta = TIER_META[State.activeTier];
    $listTitle.textContent = meta.title;
    $listSub.textContent = meta.sub;
    /* Clear the sibling sticky-mount before each tier render. Only
       Tt populates it; without this it would persist across tier
       switches and overlap unrelated tier UI. */
    var $stickyMount = document.getElementById('ttStickyMount');
    if ($stickyMount && State.activeTier !== 'tt') {
      $stickyMount.innerHTML = '';
      $stickyMount.hidden = true;
    }
    if (State.activeTier === 't0') renderT0();
    else if (State.activeTier === 'tt') renderTt();
    else if (State.activeTier === 't1') renderT1();
    else if (State.activeTier === 't2') renderT2();
    else renderTierPlaceholder(State.activeTier);
  }

  // Tier rail
  document.querySelectorAll('.ev2-tier').forEach(function (btn) {
    btn.addEventListener('click', function () {
      document.querySelectorAll('.ev2-tier').forEach(function (b) { b.removeAttribute('aria-current'); });
      btn.setAttribute('aria-current', 'true');
      State.activeTier = btn.getAttribute('data-tier');
      saveUIState();
      renderActiveTier();
      // Switching INTO or OUT of T2 changes which surface the preview
      // should paint with. Push the active-surface signal so the
      // preview repaints; the heavy CSS payload doesn't need to move.
      pushActiveSurface();
    });
  });

  // In-panel "Editing" toggle (lives inside each role card head).
  // Single source of truth: switches BOTH the editor's UI theme
  // (data-theme on <html>, persisted in 'dtf-theme') AND which
  // mode's T1 tokens you are editing. Per-mode T1 state means
  // changes apply to that mode only.
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('.ev2-edit-mode');
    if (!btn) return;
    var mode = btn.getAttribute('data-edit-mode');
    if (mode !== 'light' && mode !== 'dark') return;
    if (State.editingMode === mode) return;
    State.editingMode = mode;
    document.documentElement.setAttribute('data-theme', mode);
    try { localStorage.setItem('dtf-theme', mode); } catch (err) {}
    try { $frame.contentWindow.postMessage({ type: 'ev2-theme', mode: mode }, '*'); } catch (err) {}
    saveUIState();
    if (State.activeTier === 't1') renderT1();
    else if (State.activeTier === 't2') renderT2();
  });

  /* Surface source-palette picker open-trigger (T2 header). Native
     <select> can't render grouped sections with separators + an
     empty-state slot, so the picker is a custom popover singleton
     (see initSurfacePalettePicker below). This handler just opens
     the popover for the clicked trigger button; the popover renders
     the groups and handles option clicks. */
  document.addEventListener('click', function (e) {
    var openBtn = e.target && e.target.closest && e.target.closest('[data-surface-palette-open]');
    if (!openBtn) return;
    e.preventDefault();
    e.stopPropagation();
    if (window.__ev2OpenPalettePicker) window.__ev2OpenPalettePicker(openBtn);
  });

  /* CSS-name toggle \u2014 button hosts the visual state (aria-pressed)
     and toggles the hidden checkbox so persistence + any legacy
     readers keep working. */
  (function wireCssNamesToggle(){
    var btn = document.getElementById('showCssNamesBtn');
    var cb  = document.getElementById('showCssNames');
    if (!btn || !cb) return;
    function apply(checked){
      cb.checked = !!checked;
      btn.setAttribute('aria-pressed', checked ? 'true' : 'false');
      document.body.classList.toggle('ev2-show-css', !!checked);
    }
    btn.addEventListener('click', function(){
      apply(!cb.checked);
      saveUIState();
    });
    /* Initial paint: respect whatever the checkbox was hydrated to. */
    apply(cb.checked);
  })();

  $discard.addEventListener('click', function () {
    ROLES.forEach(function (r) {
      State.proposed[r.id] = State.baseline[r.id];
      // Restore to the AA-clean t1 baseline snapshotted at boot, not
      // raw T1_DEFAULT (which may not pass AA against the loaded
      // ladder for some hue/seed combinations).
      State.t1.light[r.id] = Object.assign({}, State.t1Baseline.light[r.id]);
      State.t1.dark[r.id]  = Object.assign({}, State.t1Baseline.dark[r.id]);
    });
    // T2 has no "AA-clean baseline" notion yet — every cell defaults
    // to a deterministic offset from T2_BASE_STEPS, so Discard simply
    // drops all overrides back to empty.
    State.t2 = makeEmptyT2();
    State.t2SurfacePalette = {};
    State.anchor = State.baselineAnchor;
    State.cachedSteps = {};
    _systemPaletteCache = {};
    clearDraftFromStorage();
    pushPreview();
    renderActiveTier();
    refreshChangeBar();
    refreshDraftStatus('idle');
    if (window.ev2Toast) window.ev2Toast('Discarded all unsaved changes', 'ok');
  });

  /* ── Section + per-role resets ─────────────────────────
     Section reset = clear only the active tier (T0 or T1).
     Role reset    = clear one role's T0 anchor + T1 picks.
     Both go through autoFixT1ToAA so the cleared roles still
     ship AA defaults against the loaded ladder. */
  function _t1BaselineFor(mode, roleId) {
    /* MUST mirror isT1ChangedInMode's baseline lookup, or reset
       will not actually mark the role clean. If the per-role
       entry is missing in State.t1Baseline (first load, fresh
       project, etc.), fall back to the computed default — same
       object shape the diff check uses. Without this fallback,
       resetRole wrote `{}` into State.t1, and the diff then
       compared `{}` against the rich default → all fields
       differed → the role stayed marked dirty forever and the
       section reset button never disabled. */
    var b = State.t1Baseline && State.t1Baseline[mode] && State.t1Baseline[mode][roleId];
    if (b) return Object.assign({}, b);
    return Object.assign({}, defaultT1ForRole(roleId, mode));
  }
  function resetRole(roleId) {
    State.proposed[roleId] = State.baseline[roleId];
    State.t1.light[roleId] = _t1BaselineFor('light', roleId);
    State.t1.dark[roleId]  = _t1BaselineFor('dark',  roleId);
    delete State.cachedSteps[roleId];
    scheduleAutosave();
    pushPreview();
    renderActiveTier();
    refreshChangeBar();
  }
  function resetSection(tierId) {
    if (tierId === 't0') {
      ROLES.forEach(function (r) { State.proposed[r.id] = State.baseline[r.id]; });
      State.cachedSteps = {};
    } else if (tierId === 't1') {
      ROLES.forEach(function (r) {
        State.t1.light[r.id] = _t1BaselineFor('light', r.id);
        State.t1.dark[r.id]  = _t1BaselineFor('dark',  r.id);
      });
    } else if (tierId === 't2') {
      State.t2 = makeEmptyT2();
      State.t2SurfacePalette = {};
    } else if (tierId === 'tt') {
      /* Reset Type — clear all typography overrides back to the
         project's published baseline (read from config.json). */
      var b = State.typoBaseline || readTypoBaseline();
      State.typo = {
        preset:    b.preset,
        density:   b.density || 'base',
        overrides: { headline: '', body: '', code: '' },
        custom:    { headline: '', body: '', code: '' }
      };
      persistTypoState();
      pushTypoToPreview();
    }
    scheduleAutosave();
    pushPreview();
    renderActiveTier();
    refreshChangeBar();
  }

  // Section reset button (in list header)
  var $sectionReset = document.getElementById('sectionResetBtn');
  if ($sectionReset) {
    $sectionReset.addEventListener('click', function () {
      resetSection(State.activeTier);
      var label = TIER_META[State.activeTier] && TIER_META[State.activeTier].title;
      if (window.ev2Toast) window.ev2Toast('Reset ' + (label || 'section') + ' to defaults', 'ok');
    });
  }

  // Per-role reset (event-delegated since cards re-render)
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-role-reset]');
    if (!btn) return;
    var roleId = btn.getAttribute('data-role-reset');
    var role = ROLES.find(function (r) { return r.id === roleId; });
    resetRole(roleId);
    if (window.ev2Toast) window.ev2Toast('Reset ' + (role ? role.label : roleId) + ' to defaults', 'ok');
  });

  /* ── T2 event delegation ───────────────────────────────
     Surface picker, Property Card stepper, Property Card reset. All
     delegated since renderT2() rebuilds the body each time. */
  document.addEventListener('click', function (e) {
    var surfBtn = e.target.closest && e.target.closest('[data-surface-tab]');
    if (surfBtn) {
      var sid = surfBtn.getAttribute('data-surface-tab');
      if (sid && sid !== State.activeSurface) {
        State.activeSurface = sid;
        // Different surface = different cards. Close any expanded
        // ladder picker so the user lands with the new family list
        // visible and uncluttered.
        __expandedT2 = null;
        saveUIState();
        renderT2();
        // Switching surfaces in T2 = the preview should repaint on
        // that surface. Active-surface signal is enough; the CSS
        // payload doesn't change.
        pushActiveSurface();
      }
      return;
    }
    // Reset source-palette override (back to surface's declared default).
    var palResetBtn = e.target.closest && e.target.closest('[data-surface-palette-reset]');
    if (palResetBtn) {
      var rsid = palResetBtn.getAttribute('data-surface-palette-reset');
      if (rsid && State.t2SurfacePalette && State.t2SurfacePalette[rsid]) {
        delete State.t2SurfacePalette[rsid];
        scheduleAutosave();
        pushPreview();
        renderT2();
        refreshChangeBar();
      }
      return;
    }
    // Property Card expand/collapse toggle (the swatch is the affordance).
    // T1 cards are always-expanded so toggle is a no-op there.
    var toggleBtn = e.target.closest && e.target.closest('[data-pc-toggle]');
    if (toggleBtn) {
      var tcard = toggleBtn.closest('.ev2-pc');
      if (!tcard) return;
      if (tcard.getAttribute('data-pc-tier') === 't1') return;
      var key = tcard.getAttribute('data-pc-surface') + '/' + tcard.getAttribute('data-pc-prop');
      __expandedT2 = (__expandedT2 === key) ? null : key;
      renderT2();
      return;
    }
    // Picked a step from the inline ladder — same write path as the
    // ± stepper. T1 + T2 share the DOM hook; dispatch by tier.
    var pickBtn = e.target.closest && e.target.closest('[data-pc-ladder-pick]');
    if (pickBtn) {
      var pcard = pickBtn.closest('.ev2-pc');
      if (!pcard) return;
      var picked = pickBtn.getAttribute('data-pc-ladder-pick');
      if (pcard.getAttribute('data-pc-tier') === 't1') {
        var pcDerived = pcard.getAttribute('data-pc-derived');
        if (pcDerived) {
          setT1Derived(pcard.getAttribute('data-pc-role'), pcDerived, State.editingMode, picked);
        } else {
          setT1Lever(
            pcard.getAttribute('data-pc-role'),
            pcard.getAttribute('data-pc-lever'),
            State.editingMode,
            picked
          );
        }
      } else {
        setT2Step(
          pcard.getAttribute('data-pc-surface'),
          pcard.getAttribute('data-pc-prop'),
          State.editingMode,
          picked
        );
      }
      return;
    }
    var stepBtn = e.target.closest && e.target.closest('[data-pc-step]');
    if (stepBtn) {
      var card = stepBtn.closest('.ev2-pc');
      if (!card) return;
      var delta = parseInt(stepBtn.getAttribute('data-pc-step'), 10) || 0;
      if (card.getAttribute('data-pc-tier') === 't1') {
        // T1 stepper: walk in the perceived-tonal direction so "+"
        // always goes darker on-screen, regardless of mode.
        var roleId  = card.getAttribute('data-pc-role');
        var derivedId = card.getAttribute('data-pc-derived');
        if (derivedId) {
          // onComponent: step through the filtered allowed-set
          // (white + black + AA-passing palette steps). Stepper
          // walks the list in order so '+' moves toward darker
          // visual tone where possible; falls back to the next
          // index when no palette neighbour qualifies.
          if (derivedId === 'onComponent') {
            var allowedOC = onComponentAllowedSteps(roleId, State.editingMode);
            if (allowedOC.length <= 1) return;
            var curOC = t1DerivedStep(roleId, derivedId, State.editingMode);
            var idxOC = allowedOC.indexOf(curOC);
            if (idxOC < 0) idxOC = 0;
            var nextIdx = idxOC + (delta > 0 ? 1 : -1);
            if (nextIdx < 0) nextIdx = allowedOC.length - 1;
            if (nextIdx >= allowedOC.length) nextIdx = 0;
            setT1Derived(roleId, derivedId, State.editingMode, allowedOC[nextIdx]);
            return;
          }
          var curD = t1DerivedStep(roleId, derivedId, State.editingMode);
          var nxD  = stepRel(curD, delta * tonalDir(State.editingMode));
          if (nxD !== curD) setT1Derived(roleId, derivedId, State.editingMode, nxD);
          return;
        }
        var leverId = card.getAttribute('data-pc-lever');
        if (!roleId || !leverId) return;
        var t1cur = t1For(roleId, State.editingMode)[leverId];
        var t1nx  = stepRel(t1cur, delta * tonalDir(State.editingMode));
        if (t1nx !== t1cur) setT1Lever(roleId, leverId, State.editingMode, t1nx);
        return;
      }
      var surfaceId = card.getAttribute('data-pc-surface');
      var propId    = card.getAttribute('data-pc-prop');
      if (!surfaceId || !propId) return;
      // Walk in the tonal direction the user perceives: clicking "+"
      // (darker) in light mode goes UP the ladder; in dark mode the
      // visible darker direction is the opposite so we mirror via
      // tonalDir(). Keeps the stepper intuitive across modes.
      var current = resolveT2Step(surfaceId, propId, State.editingMode);
      var next    = stepRel(current, delta * tonalDir(State.editingMode));
      if (next !== current) setT2Step(surfaceId, propId, State.editingMode, next);
      return;
    }
    var resetBtn = e.target.closest && e.target.closest('[data-pc-reset]');
    if (resetBtn && !resetBtn.disabled) {
      var card2 = resetBtn.closest('.ev2-pc');
      if (!card2) return;
      if (card2.getAttribute('data-pc-tier') === 't1') {
        var derivedR = card2.getAttribute('data-pc-derived');
        if (derivedR) {
          clearT1Derived(card2.getAttribute('data-pc-role'), derivedR, State.editingMode);
          return;
        }
        clearT1Lever(
          card2.getAttribute('data-pc-role'),
          card2.getAttribute('data-pc-lever'),
          State.editingMode
        );
        return;
      }
      clearT2Override(
        card2.getAttribute('data-pc-surface'),
        card2.getAttribute('data-pc-prop'),
        State.editingMode
      );
      return;
    }
    var bulkBtn = e.target.closest && e.target.closest('[data-pc-bulk]');
    if (bulkBtn) {
      handleT2RowBulk(bulkBtn);
      return;
    }
  });

  /* ── Save/Deploy summary dialog ────────────────────────
     One dialog, two modes:
       - 'save'   → Save as project default. Lists EVERY emitted
                    token (full hierarchy snapshot), collects name/
                    description/semver, writes to the repo so the
                    new mapping becomes the project's loaded default.
       - 'deploy' → Push to Figma (existing flow). Lists only the
                    deltas vs. the project default, since Figma
                    already has the rest.
     Both share the same shell so the user gets one mental model:
     "review → confirm". The mode only affects: title/sub copy, the
     metadata form's visibility, the summary scope, and what the
     confirm button does. */

  function buildDeploySummary(scope) {
    // scope: 'delta' (default — only changes) or 'full' (everything that will be persisted)
    scope = scope || 'delta';
    var full = (scope === 'full');
    var sections = [];
    var totalChanges = 0;

    // T0 — palette anchor changes
    var t0Changes = [];
    ROLES.forEach(function (r) {
      var changed = isChanged(r.id);
      if (!full && !changed) return;
      t0Changes.push({
        role: r,
        from: (State.baseline[r.id] || '').toUpperCase(),
        to:   (State.proposed[r.id] || '').toUpperCase(),
        changed: changed
      });
    });
    if (t0Changes.length) {
      if (!full) totalChanges += t0Changes.filter(function(c){return c.changed;}).length;
      sections.push({
        tier: 'T0',
        title: full ? 'Palette anchors' : 'Palette anchors',
        sub: full ? 'Foundation seed colors for every role. The full ladder is regenerated from these.' : 'Foundation colors. Cascades to roles, surfaces, and components.',
        rows: t0Changes.map(function (c) {
          var diffHTML = c.changed
            ? '<code class="ev2-deploy-from">' + c.from + '</code>'
                + '<span class="ev2-deploy-arrow">\u2192</span>'
                + '<code class="ev2-deploy-to" style="background:' + c.to + ';color:' + textOnHex(c.to) + '">' + c.to + '</code>'
            : '<code class="ev2-deploy-to" style="background:' + c.to + ';color:' + textOnHex(c.to) + '">' + c.to + '</code>';
          return '<div class="ev2-deploy-row">'
            + '<span class="ev2-deploy-row-dot" style="background:' + c.to + '"></span>'
            + '<span class="ev2-deploy-row-label">' + c.role.label + ' anchor</span>'
            + '<span class="ev2-deploy-row-diff">' + diffHTML + '</span>'
          + '</div>';
        }).join('')
      });
    }

    // T0.5 — custom palettes (project-level, e.g. "neutral"). Show in
    // full-mode only; deltas aren't tracked because custom palettes
    // come from primitives.css we don't currently edit at runtime.
    if (full) {
      var customs = (typeof discoverCustomPalettes === 'function') ? discoverCustomPalettes() : [];
      if (customs.length) {
        sections.push({
          tier: 'T0',
          title: 'Custom palettes',
          sub: 'Project-specific palettes loaded from primitives.css. Persisted as-is.',
          rows: customs.map(function (c) {
            var ladder = (typeof customPaletteSteps === 'function') ? customPaletteSteps(c.id) : null;
            var seed = ladder ? (ladder.find(function(s){return s.name==='500';}) || {}).hex : '';
            var swatch = seed || '#888';
            return '<div class="ev2-deploy-row">'
              + '<span class="ev2-deploy-row-dot" style="background:' + swatch + '"></span>'
              + '<span class="ev2-deploy-row-label">' + c.label + '</span>'
              + '<span class="ev2-deploy-row-diff"><code class="ev2-deploy-to" style="background:' + swatch + ';color:' + textOnHex(swatch) + '">' + (seed || '\u2014').toUpperCase() + '</code>'
                + '<em>22-step ladder</em></span>'
            + '</div>';
          }).join('')
        });
      }
    }

    // T1 — per-role per-mode step changes
    ['light','dark'].forEach(function (mode) {
      var rows = [];
      ROLES.forEach(function (r) {
        var changed = isT1ChangedInMode(r.id, mode);
        if (!full && !changed) return;
        var t = State.t1[mode][r.id];
        var def = defaultT1ForRole(r.id, mode);
        var swatchHex = stepHexByName(r.id, t.fill) || State.proposed[r.id];
        if (full) {
          // Show the current picks plainly (no diff arrows when unchanged)
          var pickHTML = 'Fill <em>' + t.fill + '</em> \u00b7 Content <em>' + t.content + '</em> \u00b7 Container <em>' + t.container + '</em>';
          if (changed) {
            var deltas = [];
            if (t.fill !== def.fill)           deltas.push('Fill <em>'      + def.fill      + '</em> \u2192 <em>' + t.fill      + '</em>');
            if (t.content !== def.content)     deltas.push('Content <em>'   + def.content   + '</em> \u2192 <em>' + t.content   + '</em>');
            if (t.container !== def.container) deltas.push('Container <em>' + def.container + '</em> \u2192 <em>' + t.container + '</em>');
            if (deltas.length) pickHTML = deltas.join(' \u00b7 ');
          }
          rows.push('<div class="ev2-deploy-row">'
            + '<span class="ev2-deploy-row-dot" style="background:' + swatchHex + '"></span>'
            + '<span class="ev2-deploy-row-label">' + r.label + (changed ? ' \u2022 edited' : '') + '</span>'
            + '<span class="ev2-deploy-row-diff">' + pickHTML + '</span>'
          + '</div>');
        } else {
          var deltas2 = [];
          if (t.fill !== def.fill)           deltas2.push('Fill step <em>'      + def.fill      + '</em> \u2192 <em>' + t.fill      + '</em>');
          if (t.content !== def.content)     deltas2.push('Content step <em>'   + def.content   + '</em> \u2192 <em>' + t.content   + '</em>');
          if (t.container !== def.container) deltas2.push('Container step <em>' + def.container + '</em> \u2192 <em>' + t.container + '</em>');
          if (!deltas2.length) return;
          rows.push('<div class="ev2-deploy-row">'
            + '<span class="ev2-deploy-row-dot" style="background:' + swatchHex + '"></span>'
            + '<span class="ev2-deploy-row-label">' + r.label + '</span>'
            + '<span class="ev2-deploy-row-diff">' + deltas2.join(' \u00b7 ') + '</span>'
          + '</div>');
          totalChanges += 1;
        }
      });
      if (rows.length) {
        sections.push({
          tier: 'T1',
          title: 'Roles \u2014 ' + (mode === 'light' ? 'Light mode' : 'Dark mode'),
          sub: 'Per-role step picks for fill, content, and container.',
          rows: rows.join('')
        });
      }
    });

    // T2 — per-surface palette + per-prop step picks. In full mode,
    // emit one row per surface summarising "palette + N custom props".
    // In delta mode, only surfaces with changes appear.
    ['light','dark'].forEach(function (mode) {
      var rows = [];
      T2_SURFACES.forEach(function (s) {
        var changed = isT2Changed(s.id);
        if (!full && !changed) return;
        var pal = surfacePaletteFor(s.id);
        var bg  = t2HexFor(s.id, 'bg', mode);
        var customCount = 0;
        var bag = State.t2 && State.t2[mode] && State.t2[mode][s.id];
        if (bag) {
          Object.keys(bag).forEach(function (pid) {
            var ov = bag[pid];
            if (ov && (ov.step || ov.follows)) customCount++;
          });
        }
        if (full) {
          var pieces = ['palette <em>' + pal + '</em>'];
          if (customCount) pieces.push(customCount + ' custom prop' + (customCount === 1 ? '' : 's'));
          else pieces.push('all defaults');
          rows.push('<div class="ev2-deploy-row">'
            + '<span class="ev2-deploy-row-dot" style="background:' + bg + '"></span>'
            + '<span class="ev2-deploy-row-label">' + s.label + (changed ? ' \u2022 edited' : '') + '</span>'
            + '<span class="ev2-deploy-row-diff">' + pieces.join(' \u00b7 ') + '</span>'
          + '</div>');
        } else {
          if (!customCount && !isSurfacePaletteCustom(s.id)) return;
          var deltaPieces = [];
          if (isSurfacePaletteCustom(s.id)) deltaPieces.push('palette \u2192 <em>' + pal + '</em>');
          if (customCount) deltaPieces.push(customCount + ' prop' + (customCount === 1 ? '' : 's') + ' overridden');
          rows.push('<div class="ev2-deploy-row">'
            + '<span class="ev2-deploy-row-dot" style="background:' + bg + '"></span>'
            + '<span class="ev2-deploy-row-label">' + s.label + '</span>'
            + '<span class="ev2-deploy-row-diff">' + deltaPieces.join(' \u00b7 ') + '</span>'
          + '</div>');
          totalChanges += 1;
        }
      });
      if (rows.length) {
        sections.push({
          tier: 'T2',
          title: 'Surfaces \u2014 ' + (mode === 'light' ? 'Light mode' : 'Dark mode'),
          sub: 'Surface-level palette assignments and per-prop overrides.',
          rows: rows.join('')
        });
      }
    });

    return { sections: sections, total: totalChanges };
  }

  // Quick contrast picker for the diff swatch label
  function textOnHex(hex) {
    return contrastRatio(hex, '#FFFFFF') >= contrastRatio(hex, '#000000') ? '#FFFFFF' : '#000000';
  }

  /* ── CSS emitters (full snapshot for save-as-default) ──
     pushPreview() already builds the overrides CSS string for the
     iframe; these emitters split that logic so each file the writer
     publishes (primitives.css, semantic.css, surfaces.css) can be
     generated independently and committed to the project folder.
     The serialised content matches what the iframe sees at runtime,
     so a reload of the project will replay the editor state byte-
     identically. */
  function buildPrimitivesCSS(meta) {
    var lines = [];
    lines.push('/* Generated by Design Token Forge editor v2 \u2014 do not edit by hand. */');
    if (meta) {
      lines.push('/* version: ' + meta.version + ' \u2014 ' + (meta.name || '') + ' */');
      lines.push('/* saved:   ' + meta.savedAt + (meta.savedBy ? ' by ' + meta.savedBy : '') + ' */');
    }
    lines.push(':root {');
    ROLES.forEach(function (r) {
      var steps = stepsFor(r.id);
      steps.forEach(function (s) {
        if (s.name === 'white' || s.name === 'black') return;
        lines.push('  --prim-' + r.prefix + '-' + s.name + ': ' + s.hex + ';');
      });
    });
    // Re-emit any custom palettes (e.g. writer-handhelds 'neutral')
    // exactly as the editor sees them today \u2014 these come from the
    // project's loaded primitives.css and need to survive the round-
    // trip even though the editor doesn't currently rewrite them.
    var customs = (typeof discoverCustomPalettes === 'function') ? discoverCustomPalettes() : [];
    customs.forEach(function (c) {
      var ladder = customPaletteSteps(c.id);
      if (!ladder) return;
      ladder.forEach(function (s) {
        if (s.name === 'white' || s.name === 'black' || !s.hex) return;
        lines.push('  --prim-' + c.id + '-' + s.name + ': ' + s.hex.toUpperCase() + ';');
      });
    });
    lines.push('}');
    return lines.join('\n') + '\n';
  }
  function buildSemanticCSS(meta) {
    var lines = [];
    lines.push('/* Generated by Design Token Forge editor v2 \u2014 do not edit by hand. */');
    if (meta) lines.push('/* version: ' + meta.version + ' */');
    lines.push(':root {');
    ROLES.forEach(function (r) {
      semanticVarsFor(r.id, 'light').forEach(function (l) { lines.push(l); });
    });
    lines.push('}');
    lines.push('[data-theme="dark"] {');
    ROLES.forEach(function (r) {
      semanticVarsFor(r.id, 'dark').forEach(function (l) { lines.push(l); });
    });
    lines.push('}');
    return lines.join('\n') + '\n';
  }
  function buildSurfacesCSS(meta) {
    var lines = [];
    lines.push('/* Generated by Design Token Forge editor v2 \u2014 do not edit by hand. */');
    if (meta) lines.push('/* version: ' + meta.version + ' */');
    lines.push(':root {');
    surfaceVarsLinesForMode('light').forEach(function (l) { lines.push(l); });
    lines.push('}');
    lines.push('[data-theme="dark"] {');
    surfaceVarsLinesForMode('dark').forEach(function (l) { lines.push(l); });
    lines.push('}');
    // Back-compat aliases: old names container/over-container map to card/modal.
    // Kept until v2 cutover so any legacy consumer keeps resolving.
    var ALIAS_MAP = { container: 'card', 'over-container': 'modal' };
    var PROPS_FOR_ALIAS = T2_PROP_DEFS.map(function (p) { return p.id; });
    lines.push('');
    lines.push('/* Back-compat aliases (deprecated) \u2014 container/over-container \u2192 card/modal */');
    lines.push(':root {');
    Object.keys(ALIAS_MAP).forEach(function (oldN) {
      var newN = ALIAS_MAP[oldN];
      PROPS_FOR_ALIAS.forEach(function (prop) {
        lines.push('  --surface-' + oldN + '-' + prop + ': var(--surface-' + newN + '-' + prop + ');');
      });
    });
    lines.push('}');
    return lines.join('\n') + '\n';
  }
  function buildConfigJSON(prevCfg, meta) {
    // Merge into existing config rather than replace \u2014 keeps any
    // future keys (paletteKeys, etc.) untouched.
    var cfg = prevCfg ? JSON.parse(JSON.stringify(prevCfg)) : {};
    cfg.schemaVersion = Math.max(cfg.schemaVersion || 2, 2);
    cfg.surfacePaletteSrc = {};
    T2_SURFACES.forEach(function (s) {
      cfg.surfacePaletteSrc[s.id] = surfacePaletteFor(s.id);
    });
    // Sync paletteKeys to the just-published key colors so consumers
    // that read config.json (project hub swatches, onboard preset
    // detection, future tooling) agree with primitives.css. Without
    // this, the hub keeps painting cards from a stale brand hex
    // even though the published palette is something different.
    var prevKeys = (prevCfg && prevCfg.paletteKeys) || {};
    var paletteKeys = JSON.parse(JSON.stringify(prevKeys));
    ROLES.forEach(function (r) {
      var hex = State.proposed && State.proposed[r.id];
      if (hex) paletteKeys[r.id] = String(hex).toUpperCase();
    });
    cfg.paletteKeys = paletteKeys;
    // Mirror customRoles so future loads keep them as first-class T1.
    var builtins = { brand:1, danger:1, success:1, warning:1, info:1 };
    var customRoles = ROLES.filter(function (r) { return !builtins[r.id]; }).map(function (r) {
      return { id: r.id, label: r.label, keyHex: (State.proposed[r.id] || '').toUpperCase() };
    });
    if (customRoles.length) cfg.customRoles = customRoles;

    /* Persist per-role T1 lever picks so the next editor boot can
       hydrate State.t1 from disk. Without this, semantic.css gets
       written correctly but the editor re-seeds from in-code
       T1_DEFAULT_STEPS on next load \u2014 producing a silent drift
       where the file says container=50 but the row shows step 75
       (the default), and the topbar reads 'No changes yet' because
       baseline matches the freshly-seeded default. See
       seedT1FromConfig() for the symmetric reader. */
    var t1Picks = { light: {}, dark: {} };
    ['light','dark'].forEach(function (mode) {
      ROLES.forEach(function (r) {
        var t = State.t1[mode][r.id];
        if (!t) return;
        var pick = {};
        if (t.fill)             pick.fill             = t.fill;
        if (t.content)          pick.content          = t.content;
        if (t.container)        pick.container        = t.container;
        if (t.borderStep)       pick.borderStep       = t.borderStep;
        if (t.separatorStep)    pick.separatorStep    = t.separatorStep;
        if (t.cmBorderStep)     pick.cmBorderStep     = t.cmBorderStep;
        if (t.cmSeparatorStep)  pick.cmSeparatorStep  = t.cmSeparatorStep;
        if (t.onComponent)      pick.onComponent      = t.onComponent;
        if (t.onContainerStep)  pick.onContainerStep  = t.onContainerStep;
        if (t.contentSubtleStep)    pick.contentSubtleStep    = t.contentSubtleStep;
        if (t.contentStrongStep)    pick.contentStrongStep    = t.contentStrongStep;
        if (t.fillHoverStep)        pick.fillHoverStep        = t.fillHoverStep;
        if (t.fillPressedStep)      pick.fillPressedStep      = t.fillPressedStep;
        if (t.cmBorderHoverStep)    pick.cmBorderHoverStep    = t.cmBorderHoverStep;
        if (t.cmBorderPressedStep)  pick.cmBorderPressedStep  = t.cmBorderPressedStep;
        if (Object.keys(pick).length) t1Picks[mode][r.id] = pick;
      });
    });
    cfg.t1Picks = t1Picks;

    /* Persist Tt (typography) so the next editor boot reads the
       published preset + any custom-font picks back as the
       baseline. Reset Type compares against this; the project hub
       can show the active typeface; future Figma sync can publish
       FONT_FAMILY variables off the same payload. Only writes
       non-empty fields so legacy projects stay slim. */
    if (State.typo) {
      var typoOut = { preset: State.typo.preset || 'neutral-system' };
      /* Only persist density when it differs from base. Keeps
         pre-density projects' config.json untouched on republish. */
      if (State.typo.density && State.typo.density !== 'base') {
        typoOut.density = State.typo.density;
      }
      var ov = State.typo.overrides || {};
      var cu = State.typo.custom    || {};
      var cf = State.typo.customFontFiles || {};
      var ovKept = {}, cuKept = {}, cfKept = {};
      ['headline','body','code'].forEach(function (r) {
        if (ov[r]) ovKept[r] = ov[r];
        if (cu[r]) cuKept[r] = cu[r];
        /* Only persist file payloads that actually have bytes —
           a stray { family: '...' } without dataUrl is meaningless
           and would also bloat config.json with empty rows. */
        if (cf[r] && cf[r].dataUrl && cf[r].family) {
          cfKept[r] = {
            family:   cf[r].family,
            format:   cf[r].format || 'woff2',
            fileName: cf[r].fileName || '',
            dataUrl:  cf[r].dataUrl
          };
        }
      });
      if (Object.keys(ovKept).length) typoOut.overrides = ovKept;
      if (Object.keys(cuKept).length) typoOut.custom    = cuKept;
      if (Object.keys(cfKept).length) typoOut.customFontFiles = cfKept;
      cfg.typographyConfig = typoOut;
    }

    cfg.latestVersion = {
      version: meta.version,
      name:    meta.name || '',
      description: meta.description || '',
      savedAt: meta.savedAt,
      savedBy: meta.savedBy || ''
    };
    return JSON.stringify(cfg, null, 2) + '\n';
  }

  /* ── Semver helpers ─────────────────────────────────── */
  function parseSemver(v) {
    var m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '').trim());
    if (!m) return { major: 1, minor: 0, patch: 0 };
    return { major: +m[1], minor: +m[2], patch: +m[3] };
  }
  function formatSemver(s) { return 'v' + s.major + '.' + s.minor + '.' + s.patch; }
  function bumpSemver(current, bump) {
    var s = parseSemver(current);
    if (bump === 'major') return formatSemver({ major: s.major + 1, minor: 0, patch: 0 });
    if (bump === 'minor') return formatSemver({ major: s.major, minor: s.minor + 1, patch: 0 });
    return formatSemver({ major: s.major, minor: s.minor, patch: s.patch + 1 });
  }
  function getProjectCurrentVersion() {
    // In-session publishes are authoritative — the on-disk
    // config.json under file:// doesn't refresh after a commit,
    // so without this check a second Publish in the same session
    // would bump from the stale baseline and produce a colliding
    // older version (e.g. v0.0.5 \u2192 v1.0.0, then \u2192 v0.1.0).
    if (State.lastPublishedVersion) return State.lastPublishedVersion;
    var cfg = readProjectConfigSync();
    return (cfg && cfg.latestVersion && cfg.latestVersion.version) || 'v0.0.0';
  }

  /* ── Wizard helpers ───────────────────────────────────
     The publish flow is a two-step wizard:
       1. Save snapshot  → commits to GitHub
       2. Push to Figma  → tells the user how to refresh the plugin
     Either step can be entered first (topbar "Save as default"
     opens at step 1; topbar "Deploy to Figma" opens at step 2).
     After a successful save we auto-advance to step 2, but the
     user can also Cancel from anywhere. */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function defaultSnapshotName(d) {
    d = d || new Date();
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + d.getDate() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function setWizardStep(step) {
    // Legacy wizard stepper retired in favor of single-screen
    // Publish dialog + inline timeline. Kept as a no-op so older
    // call sites don't blow up while the JS reload propagates.
    void step;
  }

  /* ── Unified open/close ──────────────────────────────── */
  /* Publish dialog \u2014 single screen, two modes:
       'form'      \u2192 metadata form + change summary
       'progress'  \u2192 inline timeline (Saving \u2192 Notifying Figma \u2192 Done)
     Success/error are sub-states of 'progress' driven by data-tl-state. */
  function openDialog(_mode, _opts) {
    var dlg = document.getElementById('ev2DeployDialog');
    if (!dlg) return;
    // Cancel any in-flight publish state from a prior open.
    dlg.setAttribute('data-mode', 'form');
    dlg._publishing = false;
    dlg._lastPublished = null;

    var projId    = getActiveProjectId() || '';
    var projLabel = projId ? projectName(projId) : 'No project (defaults)';
    // Use delta mode \u2014 dialog shows only what's actually changing.
    // Always report the topbar/savebar count for consistency
    // (summary counts per-mode; topbar counts per-role/surface).
    var summary   = buildDeploySummary('delta');
    var n         = totalChanges();

    var title      = document.getElementById('ev2DeployTitle');
    var sub        = document.getElementById('ev2DeploySub');
    var meta       = document.getElementById('ev2DeployMeta');
    var body       = document.getElementById('ev2DeployBody');
    var hint       = document.getElementById('ev2DeployHint');
    var confirmBtn = document.getElementById('ev2DeployConfirm');
    var cancelBtn  = document.getElementById('ev2WizardCancel');
    var saveForm   = document.getElementById('ev2SaveForm');
    var timeline   = document.getElementById('ev2PublishTimeline');

    if (saveForm) saveForm.hidden = false;
    if (timeline) timeline.hidden = true;
    if (cancelBtn) { cancelBtn.hidden = false; cancelBtn.textContent = 'Cancel'; }

    var cur = getProjectCurrentVersion();
    var nextVer = bumpSemver(cur, 'patch');
    title.textContent = 'Publish to ' + projLabel;
    sub.textContent = 'Save your changes as the new default for "' + projLabel + '". Figma refreshes automatically within \u00b71 minute.';
    confirmBtn.textContent = n ? ('Publish ' + nextVer) : 'Publish';
    confirmBtn.disabled = false;
    hint.innerHTML = _isCatalystHost()
      ? 'Tokens are saved to Catalyst and synced to Figma automatically.'
      : 'Writes to your GitHub fork. A Personal Access Token with <code>repo</code> scope is required.';

    // Wire metadata form defaults
    var prevEl = document.getElementById('ev2SaveVerPrev');
    var nextEl = document.getElementById('ev2SaveVerNext');
    if (prevEl) prevEl.textContent = cur;
    if (nextEl) nextEl.textContent = nextVer;
    saveForm.querySelectorAll('[data-ver-bump]').forEach(function (btn) {
      btn.setAttribute('aria-checked', btn.getAttribute('data-ver-bump') === 'patch' ? 'true' : 'false');
    });
    var nameInput = document.getElementById('ev2SaveName');
    var descInput = document.getElementById('ev2SaveDesc');
    if (!nameInput.value || nameInput.dataset.autofilled === '1') {
      nameInput.value = defaultSnapshotName();
      nameInput.dataset.autofilled = '1';
    }
    if (!nameInput._wiredAutofill) {
      nameInput.addEventListener('input', function () { nameInput.dataset.autofilled = '0'; });
      nameInput._wiredAutofill = true;
    }
    descInput.value = descInput.value || '';
    nameInput.removeAttribute('aria-invalid');

    meta.innerHTML =
        '<span class="ev2-deploy-meta-row"><span class="ev2-deploy-meta-k">Project</span><span class="ev2-deploy-meta-v">' + projLabel + '</span></span>'
      + '<span class="ev2-deploy-meta-row"><span class="ev2-deploy-meta-k">Changes</span><span class="ev2-deploy-meta-v ev2-deploy-meta-total">' + n + '</span></span>';

    body.innerHTML = summary.sections.length
      ? summary.sections.map(renderSummarySection).join('')
      : '<div class="ev2-deploy-section-empty">No changes since the last release.</div>';

    dlg.hidden = false;
    document.body.classList.add('ev2-modal-open');
    // Legacy flags kept for any stragglers; new flow ignores them.
    dlg._wizard = false;
    dlg._deployDone = false;
  }
  function renderSummarySection(s) {
    return '<section class="ev2-deploy-section">'
      + '<header class="ev2-deploy-section-head">'
        + '<span class="ev2-deploy-section-tag">' + s.tier + '</span>'
        + '<div><div class="ev2-deploy-section-title">' + s.title + '</div>'
        + '<div class="ev2-deploy-section-sub">' + s.sub + '</div></div>'
      + '</header>'
      + '<div class="ev2-deploy-rows">' + s.rows + '</div>'
    + '</section>';
  }
  function openPublishDialog() { openDialog(); }
  function closeDeployDialog() {
    var dlg = document.getElementById('ev2DeployDialog');
    if (!dlg) return;
    if (dlg._publishing) return; // don't allow closing while in flight
    dlg.hidden = true;
    dlg._wizard = false;
    dlg._deployDone = false;
    dlg._lastPublished = null;
    dlg._publishing = false;
    document.body.classList.remove('ev2-modal-open');
  }

  /* ── Version history dialog ──────────────────────────
     Read-only listing of every published version for the
     active project. Each row offers a Restore action that
     republishes the chosen snapshot as a new patch version
     (never rewrites history — the older versions stay).
     Snapshots written before commit 87e07de only contain
     metadata (files: [...]) so their Restore is disabled.
  */
  function openHistoryDialog() {
    var dlg  = document.getElementById('ev2HistoryDialog');
    var body = document.getElementById('ev2HistoryBody');
    if (!dlg || !body) return;
    var projId = getActiveProjectId();
    if (!projId) {
      if (window.ev2Toast) window.ev2Toast('No active project \u2014 open one first', 'warn');
      return;
    }
    dlg.hidden = false;
    document.body.classList.add('ev2-modal-open');
    body.innerHTML = '<div class="ev2-history-empty">Loading version history\u2026</div>';

    /* ── Catalyst path — no GitHub PAT required ─────────────────── */
    if (_isCatalystHost()) {
      var _uid0 = (window.DTF_USER && window.DTF_USER.userId) || '';
      fetch(CATALYST_FN_BASE + '/getProjectVersions?project=' + encodeURIComponent(projId) + '&user_id=' + encodeURIComponent(_uid0), {})
        .then(function (r) { return r.json(); })
        .then(function (resp) {
          if (!resp || resp.status !== 'success') throw new Error((resp && resp.error) || 'Failed to load versions');
          var versions = (resp.data && resp.data.versions) || [];
          if (!versions.length) {
            body.innerHTML = '<div class="ev2-history-empty">No published versions yet. Use <strong>Publish</strong> to create your first release.</div>';
            return;
          }
          // Convert Catalyst version entries to the same snapshot shape
          // that renderHistoryList already knows how to render.
          var snapshots = versions.map(function (v) {
            return {
              name:   v.version + '.json',
              fileId: v.fileId,
              json:   {
                meta: {
                  version:     v.version,
                  name:        v.name,
                  savedAt:     v.savedAt,
                  savedBy:     v.savedBy,
                  description: v.description
                },
                files: { _catalyst: true }   // sentinel: restore uses Catalyst API
              }
            };
          });
          renderHistoryList(null, snapshots);
        })
        .catch(function (err) {
          body.innerHTML = '<div class="ev2-history-empty">Couldn\u2019t load version history.<br><small>' + escapeHTML(String(err && err.message || err)) + '</small></div>';
        });
      return;
    }

    // GitHub path — requires a PAT.
    ensureGhCredentials().then(function (cred) {
      var path = 'projects/' + projId + '/versions';
      return ghFetch('/repos/' + cred.user + '/' + GH_REPO_NAME + '/contents/' + path)
        .then(function (entries) { return { user: cred.user, entries: entries || [] }; })
        .catch(function (err) {
          if (err && err.status === 404) return { user: cred.user, entries: [] };
          throw err;
        });
    }).then(function (res) {
      var jsonFiles = (res.entries || []).filter(function (e) {
        return e && e.type === 'file' && /\.json$/i.test(e.name);
      });
      if (!jsonFiles.length) {
        body.innerHTML = '<div class="ev2-history-empty">No published versions yet. Use <strong>Publish</strong> to create your first release.</div>';
        return;
      }
      // Fetch all snapshot bodies in parallel (each is tiny).
      return Promise.all(jsonFiles.map(function (e) {
        return fetch(e.download_url).then(function (r) { return r.json(); })
          .then(function (json) { return { name: e.name, json: json }; })
          .catch(function () { return { name: e.name, json: null }; });
      })).then(function (snapshots) { renderHistoryList(res.user, snapshots); });
    }).catch(function (err) {
      body.innerHTML = '<div class="ev2-history-empty">Couldn\u2019t load version history.<br><small>' + escapeHTML(String(err && err.message || err)) + '</small></div>';
    });
  }

  function closeHistoryDialog() {
    var dlg = document.getElementById('ev2HistoryDialog');
    if (!dlg) return;
    if (dlg._restoring) return;
    dlg.hidden = true;
    document.body.classList.remove('ev2-modal-open');
    historyStatus('');
  }

  function renderHistoryList(ghUser, snapshots) {
    var body = document.getElementById('ev2HistoryBody');
    if (!body) return;
    // "Live" = the most recently saved snapshot (by savedAt). That
    // matches what config.latestVersion points at on GitHub after
    // any sequence of publishes/restores. Semver-max is wrong here
    // because Restore re-publishes lower numbers and a later
    // major-bump can leave a higher number that's no longer Live.
    function tsOf(s) {
      var t = s && s.json && s.json.meta && s.json.meta.savedAt;
      return t ? Date.parse(t) || 0 : 0;
    }
    // Sort newest first by savedAt; fall back to semver if times tie.
    snapshots.sort(function (a, b) {
      var ta = tsOf(a), tb = tsOf(b);
      if (ta !== tb) return tb - ta;
      var av = (a.json && a.json.meta && a.json.meta.version) || a.name;
      var bv = (b.json && b.json.meta && b.json.meta.version) || b.name;
      return cmpSemver(bv, av);
    });
    var liveName = snapshots.length ? snapshots[0].name : null;
    var rows = snapshots.map(function (s) {
      var meta = (s.json && s.json.meta) || {};
      var ver  = meta.version || s.name.replace(/\.json$/, '');
      var name = meta.name || '\u2014';
      var when = meta.savedAt ? timeAgo(meta.savedAt) : '';
      var who  = meta.savedBy || '';
      var desc = meta.description || '';
      var isCurrent = (s.name === liveName);
      // Restorable for ANY published snapshot: we either read inline
      // files from the snapshot JSON, or recover them from the git
      // commit that created the snapshot file. Only the Live row
      // is intentionally inert.
      var btnAttrs, btnLabel, btnDisabledAttr;
      if (isCurrent) {
        btnAttrs = ''; btnLabel = 'Live'; btnDisabledAttr = 'disabled';
      } else {
        btnAttrs = 'data-restore="' + escapeAttr(ver) + '"';
        btnLabel = 'Restore'; btnDisabledAttr = '';
      }
      var rowState = isCurrent ? 'live' : 'restorable';
      var metaBits = [];
      if (when) metaBits.push(escapeHTML(when));
      if (who)  metaBits.push(escapeHTML('@' + who));
      var metaLine = metaBits.join(' <span class="ev2-history-meta-sep">\u00b7</span> ');
      return '<div class="ev2-history-row" data-current="' + (isCurrent ? 'true' : 'false') + '" data-state="' + rowState + '">'
        + '<div class="ev2-history-ver">'
          + escapeHTML(ver)
          + (isCurrent ? '<span class="ev2-history-live">Live</span>' : '')
        + '</div>'
        + '<div class="ev2-history-info">'
          + '<div class="ev2-history-name">' + escapeHTML(name) + '</div>'
          + (metaLine ? '<div class="ev2-history-meta">' + metaLine + '</div>' : '')
          + (desc ? '<div class="ev2-history-desc">' + escapeHTML(desc) + '</div>' : '')
        + '</div>'
        + '<button class="ev2-history-restore" type="button" ' + btnAttrs + ' ' + btnDisabledAttr + '>'
          + escapeHTML(btnLabel)
        + '</button>'
      + '</div>';
    }).join('');
    body.innerHTML = '<div class="ev2-history-list">' + rows + '</div>';
    body._ghUser = ghUser;
    body._snapshots = snapshots;
  }

  // Restore = republish the snapshot's files as a new patch version.
  // Same files API as Publish; same Pages rebuild. Old version JSONs
  // are untouched \u2014 history only grows.
  //
  // Two paths to get the file contents:
  //   1. Inline (snapshot.files is an object \u2192 take as-is)
  //   2. Git history (snapshot.files is missing or array \u2192 find
  //      the commit that wrote versions/<ver>.json and read each
  //      file at that SHA). This makes EVERY published snapshot
  //      restorable, including ones from older builds that only
  //      saved metadata in the version JSON.
  function restoreVersion(ver) {
    var projId = getActiveProjectId();
    if (!projId) return;
    var body = document.getElementById('ev2HistoryBody');
    var snap = (body && body._snapshots || []).find(function (s) {
      return (s.json && s.json.meta && s.json.meta.version) === ver;
    });
    if (!snap || !snap.json) {
      historyStatus('Couldn\u2019t find snapshot for ' + ver, 'err');
      return;
    }
    var curVer  = getProjectCurrentVersion();
    var nextVer = bumpSemver(curVer, 'patch');
    var origName = (snap.json.meta && snap.json.meta.name) || ver;
    var ok = window.confirm(
      'Restore ' + ver + ' \u2014 "' + origName + '"\n\n'
      + 'This publishes a new version (' + nextVer + ') with the contents of ' + ver + '.\n'
      + 'Older versions stay in history. Figma refreshes after the commit.\n\nContinue?'
    );
    if (!ok) return;

    historyStatus('Restoring ' + ver + ' as ' + nextVer + '…', 'info');
    var btn = body.querySelector('[data-restore="' + cssEscape(ver) + '"]');
    if (btn) { btn.setAttribute('data-restoring','true'); btn.disabled = true; btn.textContent = 'Restoring\u2026'; }
    var dlg = document.getElementById('ev2HistoryDialog');
    if (dlg) dlg._restoring = true;

    /* ── Catalyst path — fetch snapshot from File Store, re-save as new version ── */
    if (_isCatalystHost()) {
      var fileId = snap.fileId;
      if (!fileId) {
        historyStatus('No snapshot file found for ' + ver + ' \u2014 cannot restore.', 'err');
        if (btn) { btn.removeAttribute('data-restoring'); btn.disabled = false; btn.textContent = 'Restore'; }
        if (dlg) dlg._restoring = false;
        return;
      }
      var restoreProjId = projId; // captured for inner closures
      var _uid1 = (window.DTF_USER && window.DTF_USER.userId) || '';
      fetch(CATALYST_FN_BASE + '/getProjectTokens?project=' + encodeURIComponent(restoreProjId)
          + '&file_id=' + encodeURIComponent(fileId) + '&user_id=' + encodeURIComponent(_uid1), {})
        .then(function (r) { return r.json(); })
        .then(function (snapshot) {
          var restoreMeta = {
            version:     nextVer,
            name:        'Restore of ' + ver,
            description: 'Restored from ' + ver + (origName && origName !== ver ? ' \u2014 \u201c' + origName + '\u201d' : ''),
            savedAt:     new Date().toISOString(),
            savedBy:     (window.DTF_USER && (window.DTF_USER.firstName + ' ' + window.DTF_USER.lastName).trim()) || ''
          };
          // Patch config.json so latestVersion reflects the restored version number.
          var newCfgText = snapshot['config.json'] || '';
          try {
            var cfg = JSON.parse(newCfgText);
            cfg.latestVersion = {
              version:     restoreMeta.version,
              name:        restoreMeta.name,
              description: restoreMeta.description,
              savedAt:     restoreMeta.savedAt,
              savedBy:     restoreMeta.savedBy
            };
            newCfgText = JSON.stringify(cfg, null, 2) + '\n';
          } catch (_) { /* leave as-is */ }

          var tokensPayload = {
            'primitives.css': snapshot['primitives.css'] || '',
            'semantic.css':   snapshot['semantic.css']   || '',
            'surfaces.css':   snapshot['surfaces.css']   || '',
            'config.json':    newCfgText,
            '_meta':          restoreMeta
          };
          if (btn) btn.textContent = 'Saving\u2026';
          var _uid2 = (window.DTF_USER && window.DTF_USER.userId) || '';
          return fetch(CATALYST_FN_BASE + '/saveTokens?user_id=' + encodeURIComponent(_uid2), {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify({ project_id: restoreProjId, tokens: tokensPayload })
          })
            .then(function (r) { return r.json(); })
            .then(function (resp) {
              if (!resp || resp.status !== 'success') throw new Error((resp && resp.error) || 'Save failed');
              // Mirror to localStorage (same as normal Publish + Restore GitHub paths).
              try {
                var primCss  = tokensPayload['primitives.css'];
                var semCss   = tokensPayload['semantic.css'];
                var surfCss  = tokensPayload['surfaces.css'];
                localStorage.setItem('dtf-project-primitives-' + restoreProjId, primCss);
                localStorage.setItem('dtf-project-semantic-'   + restoreProjId, semCss);
                localStorage.setItem('dtf-project-surfaces-'   + restoreProjId, surfCss);
                localStorage.setItem('dtf-project-config-'     + restoreProjId, newCfgText);
                localStorage.setItem('dtf-saved-tokens-'       + restoreProjId, primCss + '\n' + semCss + '\n' + surfCss);
                localStorage.removeItem('dtf-editor-v2-draft-v2--' + restoreProjId);
                localStorage.removeItem('ev2-live-preview-' + restoreProjId);
              } catch (_lsErr) { /* non-fatal */ }
              // Set restore-overlay sentinel before reload.
              try {
                sessionStorage.setItem('dtf-restoring-overlay', JSON.stringify({
                  pid: restoreProjId, from: ver, to: nextVer
                }));
              } catch (_ssErr) {}
              historyStatus('Restored ' + ver + ' as ' + nextVer + '. Reloading\u2026', 'ok', 8000);
              window.__ev2BypassUnloadGuard = true;
              requestAnimationFrame(function () {
                requestAnimationFrame(function () { window.location.reload(); });
              });
            });
        })
        .catch(function (err) {
          var emsg = (err && err.message) || String(err);
          historyStatus('Restore failed: ' + emsg, 'err');
          if (window.ev2Toast) window.ev2Toast('Restore failed: ' + emsg, 'err');
          if (btn) { btn.removeAttribute('data-restoring'); btn.disabled = false; btn.textContent = 'Restore'; }
          if (dlg) dlg._restoring = false;
          console.error('[restore/catalyst]', err);
        });
      return; /* skip GitHub path */
    }

    var creds; // captured for the recover step
    var restoredFiles; // captured for the stash-mirror step (the
                      // .then below this chain can't see the
                      // inner .then's `files` param — without
                      // this, the stash write throws TypeError on
                      // `files['primitives.css']`, gets swallowed
                      // by the catch, and the reload reads stale
                      // localStorage → user sees the OLD version
                      // for ~1s before the Phase-1 version-tag
                      // check nukes the stash and snaps to HEAD.
    var patchedCfgText; // PATCHED config.json (with latestVersion =
                      // nextVer) — captured for the stash-mirror
                      // step. Was previously a var-scoped local
                      // inside the inner .then, so the outer
                      // mirror step wrote `"undefined"` into the
                      // stash → ensureCfg() failed to parse on
                      // reload → editor fell back to fetching the
                      // PREVIOUS version's config from GitHub
                      // Contents API → editor booted painting the
                      // OLD palette for the few seconds until the
                      // next pass corrected it. THIS is the bug
                      // every prior fix attempt missed.
    ensureGhCredentials().then(function (cred) {
      creds = cred;
      var hasInline = snap.json.files && !Array.isArray(snap.json.files) && typeof snap.json.files === 'object';
      if (hasInline) return snap.json.files;
      // Recover from git history. Older snapshots (array of names
      // or no files key) are still in the repo \u2014 we just need
      // to read them at the commit that introduced them.
      if (btn) btn.textContent = 'Recovering\u2026';
      return recoverFilesFromGit(cred.user, projId, ver);
    }).then(function (files) {
      restoredFiles = files; // hoist for the stash-mirror .then below
      var meta = {
        version:     nextVer,
        name:        'Restore of ' + ver,
        description: 'Restored from ' + ver + (origName && origName !== ver ? ' \u2014 "' + origName + '"' : ''),
        savedAt:     new Date().toISOString(),
        savedBy:     creds.user
      };
      if (btn) btn.textContent = 'Restoring\u2026';
      // Patch the snapshot's config.json so latestVersion reflects
      // the NEW version, not the restored one. Without this, the
      // editor would re-open thinking ver is the live version.
      var newCfgText = files['config.json'] || '';
      try {
        var cfg = JSON.parse(newCfgText);
        cfg.latestVersion = {
          version: nextVer,
          name: meta.name,
          description: meta.description,
          savedAt: meta.savedAt,
          savedBy: meta.savedBy
        };
        newCfgText = JSON.stringify(cfg, null, 2) + '\n';
      } catch (_) { /* leave as-is */ }
      // Hoist to outer scope so the stash-mirror .then can read it.
      // var-in-callback scoping bug = root cause of the lingering
      // restore flash. See comment on patchedCfgText declaration.
      patchedCfgText = newCfgText;

      // New version JSON re-embeds the same files so the restored
      // version is itself restorable.
      var versionSnapshot = JSON.stringify({
        meta: meta,
        savedFrom: 'editor-v2-restore',
        restoredFrom: ver,
        files: {
          'primitives.css': files['primitives.css'] || '',
          'semantic.css':   files['semantic.css']   || '',
          'surfaces.css':   files['surfaces.css']   || '',
          'config.json':    newCfgText
        }
      }, null, 2) + '\n';

      var base = 'projects/' + projId;
      var toCommit = [
        { path: base + '/primitives.css', content: files['primitives.css'] || '' },
        { path: base + '/semantic.css',   content: files['semantic.css']   || '' },
        { path: base + '/surfaces.css',   content: files['surfaces.css']   || '' },
        { path: base + '/config.json',    content: newCfgText },
        { path: base + '/versions/' + nextVer + '.json', content: versionSnapshot }
      ];
      var msg = 'project(' + projId + '): restore ' + ver + ' as ' + nextVer;
      return ghMultiCommit(creds.user, toCommit, msg).then(function () { return meta; });
    }).then(function (meta) {
      // Mirror restored files into localStorage stash so the reload
      // below picks them up immediately (workspace copy / Pages will
      // lag by ~1 min). The freshly-bumped config.json must also go
      // in so the Phase-1 version-tag check sees stash.version ===
      // HEAD.version and doesn't nuke + reload to defaults.
      try {
        var primCss = (restoredFiles && restoredFiles['primitives.css']) || '';
        var semCss  = (restoredFiles && restoredFiles['semantic.css'])   || '';
        var surfCss = (restoredFiles && restoredFiles['surfaces.css'])   || '';
        localStorage.setItem('dtf-project-primitives-' + projId, primCss);
        localStorage.setItem('dtf-project-semantic-' + projId,   semCss);
        localStorage.setItem('dtf-project-surfaces-' + projId,   surfCss);
        localStorage.setItem('dtf-project-config-' + projId,     patchedCfgText || '');
        // ALSO update the merged CSS bundle — boot Step 3 in
        // index.html paints from `dtf-saved-tokens-<pid>` (a
        // concat of primitives+semantic+surfaces) BEFORE the
        // version-tag check runs. Without this, the bundle stays
        // stale → first paint = OLD version → background fetch()
        // eventually catches up after ~1s, producing the "old
        // colours flash then snap to new" symptom even though the
        // per-file stashes and config were already fresh.
        localStorage.setItem('dtf-saved-tokens-' + projId, primCss + '\n' + semCss + '\n' + surfCss);
        // Drop any in-flight draft for this project — restoring is
        // an explicit "discard my edits and go to vX" action, and
        // the Phase-2 conflict banner would otherwise fire on reload
        // with draft.baseVersion === oldVer vs HEAD.version === nextVer.
        localStorage.removeItem('dtf-editor-v2-draft-v2--' + projId);
        // Clear live-preview broadcast so other tabs revert to published values.
        localStorage.removeItem('ev2-live-preview-' + projId);
      } catch (e) { /* non-fatal */ }
      // Fire Pages rebuild — best-effort like normal Publish.
      triggerPagesRebuild().catch(function () {});
      // Set the post-restore overlay sentinel BEFORE reload. The
      // inline script at the top of index.html reads this on next
      // boot and paints a full-viewport opaque mask BEFORE any
      // token CSS loads — that mask hides every intermediate paint
      // (maintainer pearl defaults from packages/tokens/*.css <link>,
      // stale Pages fetch, any State init overpaint) until the
      // editor's boot() finishes its first full render with the
      // new tokens and removes the mask.
      // This is the only deterministic flash-killer because it does
      // not depend on stash/Pages/draft race ordering — the mask is
      // in the DOM before <body> parses.
      try {
        sessionStorage.setItem('dtf-restoring-overlay', JSON.stringify({
          pid: projId,
          from: ver,
          to: meta.version
        }));
      } catch (_oe) {}
      // Keep the dialog visibly OPEN through the reload (modal
      // backdrop is the second layer covering any in-memory paint
      // before reload fires).
      historyStatus('Restored ' + ver + ' as ' + meta.version + '. Reloading\u2026', 'ok', 8000);
      // Reload on the next animation frame so the status banner
      // gets one paint, then we navigate. The overlay sentinel is
      // already written to sessionStorage so the new page boots
      // with the mask up.
      window.__ev2BypassUnloadGuard = true;
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { window.location.reload(); });
      });
    }).catch(function (err) {
      var emsg = (err && err.message) || String(err);
      // "Update is not a fast forward" survives 10 retries only
      // when something is hammering the branch (Pages workflow
      // bursting, another tab publishing in parallel). Spell that
      // out so the user knows it's a transient race — not data loss
      // — and what to do next.
      var hint = '';
      if (/fast.?forward/i.test(emsg)) {
        hint = ' — the repo branch moved while we were committing (likely the deploy workflow still running from your last Publish). Wait ~30s and Restore again.';
      }
      historyStatus('Restore failed: ' + emsg + hint, 'err');
      if (window.ev2Toast) window.ev2Toast('Restore failed: ' + emsg, 'err');
      if (btn) { btn.removeAttribute('data-restoring'); btn.disabled = false; btn.textContent = 'Restore'; }
      if (dlg) dlg._restoring = false;
      // eslint-disable-next-line no-console
      console.error('[restore]', err);
    });
  }

  /* Recover project files at the commit that introduced
     versions/<ver>.json. Used when the snapshot itself doesn't
     embed file contents (older builds). Returns a Promise of
     { 'primitives.css': string, ... } same shape as inline. */
  function recoverFilesFromGit(owner, projId, ver) {
    var base = 'projects/' + projId;
    var versionPath = base + '/versions/' + ver + '.json';
    // Step 1: find the publish commit (first/only commit that
    // wrote that specific version file).
    return ghFetch('/repos/' + owner + '/' + GH_REPO_NAME + '/commits?path='
        + encodeURIComponent(versionPath) + '&per_page=1')
      .then(function (commits) {
        if (!commits || !commits.length) {
          throw new Error('No commit found for ' + ver);
        }
        var sha = commits[0].sha;
        // Step 2: fetch each project file at that SHA.
        var names = ['primitives.css','semantic.css','surfaces.css','config.json'];
        return Promise.all(names.map(function (name) {
          return ghFetch('/repos/' + owner + '/' + GH_REPO_NAME
              + '/contents/' + encodeURIComponent(base + '/' + name)
              + '?ref=' + encodeURIComponent(sha))
            .then(function (resp) {
              // resp.content is base64 with newlines; decode as UTF-8.
              var b64 = (resp && resp.content) ? resp.content.replace(/\n/g, '') : '';
              var bytes = atob(b64);
              try {
                return { name: name, text: decodeURIComponent(escape(bytes)) };
              } catch (_) {
                return { name: name, text: bytes };
              }
            })
            .catch(function () { return { name: name, text: '' }; });
        }));
      })
      .then(function (parts) {
        var out = {};
        parts.forEach(function (p) { out[p.name] = p.text; });
        if (!out['primitives.css']) {
          throw new Error('Couldn\u2019t read primitives.css at that commit');
        }
        return out;
      });
  }

  /* Semver compare. Returns -1 / 0 / 1. */
  function cmpSemver(a, b) {
    var sa = parseSemver(a), sb = parseSemver(b);
    if (sa.major !== sb.major) return sa.major < sb.major ? -1 : 1;
    if (sa.minor !== sb.minor) return sa.minor < sb.minor ? -1 : 1;
    if (sa.patch !== sb.patch) return sa.patch < sb.patch ? -1 : 1;
    return 0;
  }
  /* Friendly "2 hours ago" / "3 days ago". */
  function timeAgo(iso) {
    var t = Date.parse(iso); if (!t) return '';
    var diff = (Date.now() - t) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
    if (diff < 86400 * 30) return Math.floor(diff / 86400 / 7) + 'w ago';
    return new Date(t).toISOString().slice(0, 10);
  }
  function escapeHTML(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHTML(s); }
  function cssEscape(s) {
    return (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  /* ── Inline publish timeline ─────────────────────────── */
  /* Single-screen timeline that replaces the form during publish.
     Steps are 'save' \u2192 'figma' \u2192 'done', each tracked by
     data-state ('pending' | 'running' | 'ok' | 'fail' | 'warn'). */
  function setTimelineStep(step, state, sub) {
    var li = document.querySelector('#ev2TlSteps li[data-step="' + step + '"]');
    if (!li) return;
    li.setAttribute('data-state', state);
    if (typeof sub === 'string') {
      var subEl = li.querySelector('[data-tl-sub]');
      if (subEl) subEl.textContent = sub;
    }
  }
  function showTimeline() {
    var saveForm = document.getElementById('ev2SaveForm');
    var body     = document.getElementById('ev2DeployBody');
    var timeline = document.getElementById('ev2PublishTimeline');
    var dlg      = document.getElementById('ev2DeployDialog');
    if (saveForm) saveForm.hidden = true;
    if (body)     body.hidden = true;
    if (timeline) timeline.hidden = false;
    if (dlg) dlg.setAttribute('data-mode', 'progress');
    ['save','figma','done'].forEach(function (s) { setTimelineStep(s, 'pending'); });
  }
  function finishTimeline(kind, summary) {
    // kind: 'ok' | 'partial' | 'error'
    var dlg = document.getElementById('ev2DeployDialog');
    var hint = document.getElementById('ev2DeployHint');
    var confirmBtn = document.getElementById('ev2DeployConfirm');
    var cancelBtn  = document.getElementById('ev2WizardCancel');
    var summaryEl  = document.getElementById('ev2TlSummary');
    if (dlg) {
      dlg.setAttribute('data-mode', kind === 'error' ? 'error' : (kind === 'partial' ? 'partial' : 'success'));
      dlg._publishing = false;
    }
    if (summaryEl && summary) {
      summaryEl.hidden = false;
      summaryEl.innerHTML = summary;
    }
    if (hint) hint.innerHTML = '';
    if (kind === 'error') {
      confirmBtn.textContent = 'Try again';
      confirmBtn.disabled = false;
      if (cancelBtn) { cancelBtn.hidden = false; cancelBtn.textContent = 'Cancel'; }
    } else {
      confirmBtn.textContent = 'Done';
      confirmBtn.disabled = false;
      if (cancelBtn) cancelBtn.hidden = true;
    }
  }

  /* ── GitHub writer for save-as-default ───────────────── */
  var GH_API = 'https://api.github.com';
  var GH_REPO_NAME = 'Design-Token-Forge';
  /* Direct serverless function URL — Slate static host cannot proxy /server/ */
  var CATALYST_FN_BASE = 'https://project-rainfall-60080440486.development.catalystserverless.in/server';
  function _isCatalystHost() {
    return window.location.hostname.indexOf('onslate.in') !== -1
        || window.location.hostname.indexOf('catalystappsecure') !== -1;
  }
  function getGhPat() { return localStorage.getItem('dtf-gh-pat') || ''; }
  function getGhUser() { return localStorage.getItem('dtf-gh-user') || ''; }
  function ghFetch(endpoint, opts) {
    opts = opts || {};
    var url = endpoint.startsWith('http') ? endpoint : GH_API + endpoint;
    return fetch(url, {
      method: opts.method || 'GET',
      headers: { 'Authorization': 'Bearer ' + getGhPat(), 'Accept': 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      // GitHub endpoints often return 202/204 with an empty body
      // (workflow_dispatch, delete ref, etc.). Parse JSON only when
      // there's actually content — otherwise return a synthetic ok
      // marker so callers can keep chaining .then().
      return r.text().then(function (txt) {
        var data = null;
        if (txt && txt.trim()) {
          try { data = JSON.parse(txt); } catch (_) { data = { message: txt }; }
        }
        if (!r.ok) {
          var msg = (data && data.message) ? data.message : (r.status + ' ' + r.statusText);
          var err = new Error(msg);
          err.status = r.status;
          err.body = data;
          throw err;
        }
        return data || { ok: true, status: r.status };
      });
    });
  }
  function ghEncode(str) { return btoa(unescape(encodeURIComponent(str))); }

  /* Multi-file commit via the git-tree API \u2014 atomic vs. N
     separate file PUTs. Mirrors the legacy editor's flow.
     Each entry in `files` is either { path, content } (add/update)
     or { path, delete: true } (remove from tree by emitting a
     null-sha tree entry). */
  function ghMultiCommit(owner, files, message, branch, _retry) {
    branch = branch || 'main';
    _retry = _retry || 0;
    return ghFetch('/repos/' + owner + '/' + GH_REPO_NAME + '/git/ref/heads/' + branch)
      .then(function (ref) {
        var commitSha = ref.object.sha;
        return ghFetch('/repos/' + owner + '/' + GH_REPO_NAME + '/git/commits/' + commitSha)
          .then(function (commit) {
            // Only create blobs for non-delete entries.
            var writeFiles = files.filter(function (f) { return !f.delete; });
            return Promise.all(writeFiles.map(function (f) {
              return ghFetch('/repos/' + owner + '/' + GH_REPO_NAME + '/git/blobs', {
                method: 'POST', body: { content: ghEncode(f.content), encoding: 'base64' }
              }).then(function (blob) { return { path: f.path, sha: blob.sha }; });
            })).then(function (blobs) {
              var bySha = {};
              blobs.forEach(function (b) { bySha[b.path] = b.sha; });
              var tree = files.map(function (f) {
                if (f.delete) {
                  return { path: f.path, mode: '100644', type: 'blob', sha: null };
                }
                return { path: f.path, mode: '100644', type: 'blob', sha: bySha[f.path] };
              });
              return ghFetch('/repos/' + owner + '/' + GH_REPO_NAME + '/git/trees', {
                method: 'POST', body: { base_tree: commit.tree.sha, tree: tree }
              });
            }).then(function (newTree) {
              return ghFetch('/repos/' + owner + '/' + GH_REPO_NAME + '/git/commits', {
                method: 'POST', body: { message: message, tree: newTree.sha, parents: [commitSha] }
              });
            }).then(function (newCommit) {
              return ghFetch('/repos/' + owner + '/' + GH_REPO_NAME + '/git/refs/heads/' + branch, {
                method: 'PATCH', body: { sha: newCommit.sha, force: false }
              });
            });
          });
      })
      .catch(function (err) {
        // Race: someone (Pages bot, another tab, parallel commit)
        // moved the branch between our read and our PATCH. Re-read
        // and rebuild from the new tip. Up to 10 attempts — the
        // deploy-tokens.yml workflow can push 2-3 times in quick
        // succession after every publish, and a Restore on the
        // heels of a Publish often lands in the middle of that
        // burst. Total worst-case wait: ~22s before surfacing the
        // failure, which is still fast enough that the user knows
        // it didn't silently succeed.
        var raceable = err && err.message && /fast.?forward|sha.*does not match|reference does not exist/i.test(err.message);
        if (raceable && _retry < 10) {
          // Backoff with jitter: ramps from 250ms to 4s.
          var delays = [250, 500, 750, 1500, 2500, 3500, 3500, 4000, 4000, 4000];
          var delay = delays[_retry] + Math.floor(Math.random() * 250);
          return new Promise(function (resolve) { setTimeout(resolve, delay); })
            .then(function () { return ghMultiCommit(owner, files, message, branch, _retry + 1); });
        }
        throw err;
      });
  }

  /* Trigger the deploy-tokens.yml workflow via workflow_dispatch so
     the Pages site (and therefore the Figma plugin's tokens.json
     endpoint) rebuilds with the freshly-committed snapshot ASAP.
     Best-effort: 404 / 403 (e.g. PAT missing `workflow` scope) is
     non-fatal — the commit itself already triggers Pages on push. */
  function triggerPagesRebuild() {
    var user = getGhUser();
    if (!user || !getGhPat()) return Promise.reject(new Error('Not authenticated'));
    return ghFetch('/repos/' + user + '/' + GH_REPO_NAME + '/actions/workflows/deploy-tokens.yml/dispatches', {
      method: 'POST', body: { ref: 'main' }
    });
  }

  function ensureGhCredentials() {
    var pat = getGhPat();
    var user = getGhUser();
    if (pat && user) return Promise.resolve({ pat: pat, user: user });
    var entered = prompt('GitHub Personal Access Token (with "repo" scope):\n\nThis token writes to your fork of ' + GH_REPO_NAME + '. Stored locally only.');
    if (!entered) return Promise.reject(new Error('Cancelled'));
    localStorage.setItem('dtf-gh-pat', entered.trim());
    // Verify + capture username
    return ghFetch('/user').then(function (u) {
      if (!u || !u.login) throw new Error('Token rejected by GitHub');
      localStorage.setItem('dtf-gh-user', u.login);
      return { pat: entered.trim(), user: u.login };
    }).catch(function (err) {
      localStorage.removeItem('dtf-gh-pat');
      throw err;
    });
  }

  function saveAsDefault() {
    var projId = getActiveProjectId();
    if (!projId) {
      if (window.ev2Toast) window.ev2Toast('No active project \u2014 open one first', 'warn');
      return;
    }
    var nameInput = document.getElementById('ev2SaveName');
    var descInput = document.getElementById('ev2SaveDesc');
    var name = (nameInput.value || '').trim();
    if (!name) {
      // Fall back to a timestamp instead of blocking — the name is
      // metadata, not a unique key, so an autogenerated label is fine.
      name = defaultSnapshotName();
      nameInput.value = name;
    }
    nameInput.removeAttribute('aria-invalid');
    var description = (descInput.value || '').trim();
    var bumpEl = document.querySelector('#ev2SaveForm [data-ver-bump][aria-checked="true"]');
    var bump = bumpEl ? bumpEl.getAttribute('data-ver-bump') : 'patch';
    var curVer = getProjectCurrentVersion();
    var nextVer = bumpSemver(curVer, bump);

    var meta = {
      version:     nextVer,
      name:        name,
      description: description,
      savedAt:     new Date().toISOString(),
      savedBy:     getGhUser() || ''
    };

    var confirmBtn = document.getElementById('ev2DeployConfirm');
    var cancelBtn  = document.getElementById('ev2WizardCancel');
    var dlg = document.getElementById('ev2DeployDialog');
    if (dlg) dlg._publishing = true;
    if (cancelBtn) cancelBtn.hidden = true;
    confirmBtn.disabled = true;
    confirmBtn.textContent = 'Publishing\u2026';

    // Swap form → timeline. Step 1 starts immediately.
    showTimeline();
    var _saveLabel = document.getElementById('ev2TlSaveLabel');
    if (_saveLabel) _saveLabel.textContent = _isCatalystHost() ? 'Save to Catalyst' : 'Save to GitHub';

    /* ── Catalyst path — no GitHub PAT required ────────────── */
    if (_isCatalystHost()) {
      setTimelineStep('save', 'running', 'Saving to Catalyst\u2026');
      var prevCfgC = readProjectConfigSync();
      var primCSSC = buildPrimitivesCSS(meta);
      var semCSSC  = buildSemanticCSS(meta);
      var surfCSSC = buildSurfacesCSS(meta);
      /* Wait for DTF_USER_READY in case auth resolves after page load */
      var _userReadyP = (window.DTF_USER_READY && typeof window.DTF_USER_READY.then === 'function')
        ? window.DTF_USER_READY : Promise.resolve(window.DTF_USER || null);
      _userReadyP.then(function(_readyUser) {
        var _u = _readyUser || window.DTF_USER || null;
        meta.savedBy = (_u && (_u.firstName + ' ' + _u.lastName).trim()) || (_u && _u.email) || '';
        var cfgJSONC = buildConfigJSON(prevCfgC, meta);
        var tokensPayload = {
          'primitives.css': primCSSC,
          'semantic.css':   semCSSC,
          'surfaces.css':   surfCSSC,
          'config.json':    cfgJSONC,
          '_meta': meta
        };
        var _uid3 = (_u && _u.userId) || '';
        return fetch(CATALYST_FN_BASE + '/saveTokens?user_id=' + encodeURIComponent(_uid3), {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({ project_id: projId, tokens: tokensPayload })
        })
        .then(function(r) {
          return r.json().then(function(body) {
            if (!r.ok || body.status !== 'success') throw new Error(body.error || ('HTTP ' + r.status));
            return body.data;
          });
        });
      })
      .then(function(saved) {
        setTimelineStep('save', 'ok', 'Saved ' + nextVer + ' to ' + projId);
        try {
          State.baseline   = JSON.parse(JSON.stringify(State.proposed));
          State.baselineAnchor = State.anchor;
          State.t1Baseline = JSON.parse(JSON.stringify(State.t1));
          State.t2Baseline = JSON.parse(JSON.stringify(State.t2));
          State.t2SurfacePaletteBaseline = JSON.parse(JSON.stringify(State.t2SurfacePalette));
          if (State.typo) {
            State.typoBaseline = {
              preset:    State.typo.preset || 'neutral-system',
              density:   State.typo.density || 'base',
              overrides: JSON.parse(JSON.stringify(State.typo.overrides || {})),
              custom:    JSON.parse(JSON.stringify(State.typo.custom    || {}))
            };
          }
          State.lastPublishedVersion = nextVer;
          clearDraftFromStorage();
          if (typeof saveUIState === 'function') saveUIState();
          if (typeof refreshChangeBar === 'function') refreshChangeBar();
          refreshDraftStatus('published');
          if (typeof renderActiveTier === 'function') renderActiveTier();
          /* Mirror to localStorage for immediate next-load hydration */
          try {
            localStorage.setItem('dtf-project-primitives-' + projId, primCSSC);
            localStorage.setItem('dtf-project-semantic-'   + projId, semCSSC);
            localStorage.setItem('dtf-project-surfaces-'   + projId, surfCSSC);
            localStorage.setItem('dtf-project-config-'     + projId, cfgJSONC);
            localStorage.setItem('dtf-saved-tokens-' + projId, primCSSC + '\n' + semCSSC + '\n' + surfCSSC);
          } catch(_e) {}
        } catch (_e) {}
        setTimelineStep('figma', 'ok', 'Figma will pick up changes on next sync');
        setTimelineStep('done', 'ok', 'All set');
        finishTimeline('ok',
          '<strong>Saved ' + nextVer + ' to ' + projId + '.</strong> '
          + 'Tokens are stored in Catalyst. The Figma plugin will sync on its next poll.'
        );
      })
      .catch(function(err) {
        var msg = (err && err.message) ? err.message : String(err);
        setTimelineStep('save', 'fail', msg);
        setTimelineStep('figma', 'pending', 'Skipped');
        setTimelineStep('done', 'pending', '');
        finishTimeline('error',
          '<strong>Couldn\u2019t save.</strong> ' + msg + '. Your draft is still intact \u2014 try again.'
        );
        console.error('[publish/catalyst]', err);
      });
      return;   /* skip GitHub path below */
    }

    setTimelineStep('save', 'running', 'Connecting to GitHub\u2026');

    // Captured across .then() boundaries so the post-publish step
    // can sync localStorage stash (read by injectProjectPrimitivesSync
    // on next page load).
    var publishedPrimCSS = '';
    var publishedSemCSS  = '';
    var publishedSurfCSS = '';
    var publishedCfgJSON = '';

    ensureGhCredentials().then(function (cred) {
      meta.savedBy = cred.user;
      setTimelineStep('save', 'running', 'Committing ' + nextVer + ' to ' + projId + '\u2026');

      var prevCfg = readProjectConfigSync();
      var primCSS = buildPrimitivesCSS(meta);
      var semCSS  = buildSemanticCSS(meta);
      var surfCSS = buildSurfacesCSS(meta);
      var cfgJSON = buildConfigJSON(prevCfg, meta);
      publishedPrimCSS = primCSS;
      publishedSemCSS  = semCSS;
      publishedSurfCSS = surfCSS;
      publishedCfgJSON = cfgJSON;
      var versionSnapshot = JSON.stringify({
        meta: meta,
        savedFrom: 'editor-v2',
        // Snapshot the full file contents inline so future "Restore"
        // can rebuild this exact release without trawling git history.
        // Older snapshots that only have ['filename', ...] are still
        // listed in History but their Restore is disabled.
        files: {
          'primitives.css': primCSS,
          'semantic.css':   semCSS,
          'surfaces.css':   surfCSS,
          'config.json':    cfgJSON
        }
      }, null, 2) + '\n';

      var base = 'projects/' + projId;
      var files = [
        { path: base + '/primitives.css', content: primCSS },
        { path: base + '/semantic.css',   content: semCSS },
        { path: base + '/surfaces.css',   content: surfCSS },
        { path: base + '/config.json',    content: cfgJSON },
        { path: base + '/versions/' + nextVer + '.json', content: versionSnapshot }
      ];

      var msg = 'project(' + projId + '): publish ' + nextVer + ' \u2014 ' + name;
      return ghMultiCommit(cred.user, files, msg);
    }).then(function () {
      // ── Step 1 done: snapshot is on GitHub.
      setTimelineStep('save', 'ok', 'Committed ' + nextVer + ' to ' + projId);
      // Promote EVERYTHING we just committed to be the new baseline.
      try {
        State.baseline   = JSON.parse(JSON.stringify(State.proposed));
        State.baselineAnchor = State.anchor;
        State.t1Baseline = JSON.parse(JSON.stringify(State.t1));
        State.t2Baseline = JSON.parse(JSON.stringify(State.t2));
        State.t2SurfacePaletteBaseline = JSON.parse(JSON.stringify(State.t2SurfacePalette));
        /* Tt baseline = whatever we just published. After this,
           tierTtChangeCount returns 0 until the user changes a
           preset / override / custom font again. */
        if (State.typo) {
          State.typoBaseline = {
            preset:    State.typo.preset || 'neutral-system',
            density:   State.typo.density || 'base',
            overrides: JSON.parse(JSON.stringify(State.typo.overrides || {})),
            custom:    JSON.parse(JSON.stringify(State.typo.custom    || {}))
          };
        }
        State.lastPublishedVersion = nextVer;
        clearDraftFromStorage();
        if (typeof saveUIState === 'function') saveUIState();
        if (typeof refreshChangeBar === 'function') refreshChangeBar();
        refreshDraftStatus('published');
        if (typeof renderActiveTier === 'function') renderActiveTier();
      } catch (e) { /* baseline reset is best-effort */ }
      // Mirror the just-published files into localStorage so the next
      // page load reflects them immediately. On file:// the workspace
      // copy of projects/<id>/primitives.css is stale (only the
      // GitHub fork was updated), and on Pages it takes ~1min for the
      // deploy to roll over. Without this, the editor reopens showing
      // the OLD key color even though publish succeeded.
      try {
        if (publishedPrimCSS) localStorage.setItem('dtf-project-primitives-' + projId, publishedPrimCSS);
        if (publishedSemCSS)  localStorage.setItem('dtf-project-semantic-' + projId, publishedSemCSS);
        if (publishedSurfCSS) localStorage.setItem('dtf-project-surfaces-' + projId, publishedSurfCSS);
        if (publishedCfgJSON) localStorage.setItem('dtf-project-config-' + projId, publishedCfgJSON);
        // Merged CSS bundle that index.html boot Step 3 reads for
        // first paint. Without this, reopening the editor after a
        // Publish flashes the OLD palette for ~1s while the
        // background fetch() catches up.
        if (publishedPrimCSS || publishedSemCSS || publishedSurfCSS) {
          localStorage.setItem('dtf-saved-tokens-' + projId,
            (publishedPrimCSS || '') + '\n' + (publishedSemCSS || '') + '\n' + (publishedSurfCSS || ''));
        }
      } catch (e) { /* quota or disabled storage — non-fatal */ }
      // ── Step 2: notify Figma (best-effort).
      setTimelineStep('figma', 'running', 'Triggering Pages rebuild\u2026');
      return triggerPagesRebuild().then(function () {
        setTimelineStep('figma', 'ok', 'Figma will refresh within \u00b71 minute');
        setTimelineStep('done', 'ok', 'All set');
        finishTimeline('ok',
          '<strong>Published ' + nextVer + ' to ' + projId + '.</strong> '
          + 'Designers will see the new tokens after the next plugin sync (up to a minute).'
        );
      }).catch(function (err) {
        // Snapshot saved, but Pages dispatch failed (usually a
        // missing `workflow` scope on the PAT). Pages rebuilds on
        // push anyway — just slower (~2 min). Surface as a warning,
        // not an error, since the publish itself succeeded.
        setTimelineStep('figma', 'warn', 'Couldn\u2019t auto-trigger \u2014 Figma will still refresh on its own (~2 min)');
        setTimelineStep('done', 'ok', 'Saved');
        finishTimeline('partial',
          '<strong>Saved ' + nextVer + ' to ' + projId + '.</strong> '
          + 'Couldn\u2019t notify Figma directly (<code>' + (err.message || 'permission denied') + '</code>) '
          + '\u2014 the plugin will still pick it up on its next sync (~2 min).'
        );
      });
    }).catch(function (err) {
      // Step 1 failed \u2014 nothing committed to GitHub.
      var msg = (err && err.message) ? err.message : String(err);
      var isAuthErr = /token|401|403|not accessible|credential|auth/i.test(msg);
      if (isAuthErr) {
        // Clear stale token so "Try again" will re-prompt for a new one.
        localStorage.removeItem('dtf-gh-pat');
        localStorage.removeItem('dtf-gh-user');
      }
      setTimelineStep('save', 'fail', msg);
      setTimelineStep('figma', 'pending', 'Skipped because the save failed');
      setTimelineStep('done', 'pending', '');
      finishTimeline('error',
        '<strong>Couldn\u2019t publish.</strong> ' + msg + '. '
        + 'Your draft is still intact \u2014 try again or check your GitHub token.'
      );
      // eslint-disable-next-line no-console
      console.error('[publish]', err);
    });
  }

  // Top-bar Publish button \u2014 opens the unified Publish dialog.
  if ($deploy) {
    $deploy.addEventListener('click', function () {
      if ($deploy.disabled) return;
      openPublishDialog();
    });
  }
  // Backdrop, close button, cancel button \u2014 all carry data-deploy-dismiss.
  document.querySelectorAll('[data-deploy-dismiss]').forEach(function (el) {
    el.addEventListener('click', closeDeployDialog);
  });

  // Top-bar History button \u2014 opens the version-history dialog.
  var $history = document.getElementById('historyBtn');
  if ($history) {
    $history.addEventListener('click', openHistoryDialog);
  }
  document.querySelectorAll('[data-history-dismiss]').forEach(function (el) {
    el.addEventListener('click', closeHistoryDialog);
  });
  // Restore-action delegation (rows are rendered async).
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-restore]');
    if (!btn) return;
    var ver = btn.getAttribute('data-restore');
    if (ver) restoreVersion(ver);
  });
  // Confirm button is contextual:
  //   form mode     \u2192 trigger publish (saveAsDefault swaps in the timeline)
  //   success/partial \u2192 Done (close)
  //   error mode    \u2192 Try again (re-opens the form, ready to retry)
  var deployConfirmBtn = document.getElementById('ev2DeployConfirm');
  if (deployConfirmBtn) {
    deployConfirmBtn.addEventListener('click', function () {
      var dlg = document.getElementById('ev2DeployDialog');
      var mode = dlg ? (dlg.getAttribute('data-mode') || 'form') : 'form';
      if (mode === 'form') {
        saveAsDefault();
      } else if (mode === 'error') {
        // Auth error: clear stale token, prompt for new one, then retry publish directly.
        localStorage.removeItem('dtf-gh-pat');
        localStorage.removeItem('dtf-gh-user');
        ensureGhCredentials().then(function () {
          // Credentials accepted — retry publish immediately (form data is still filled).
          saveAsDefault();
        }).catch(function () {
          // User cancelled the prompt — go back to form.
          openPublishDialog();
        });
      } else {
        // success / partial \u2014 just close.
        if (dlg) dlg._publishing = false;
        closeDeployDialog();
      }
    });
  }
  // Version-bump pills (delegated for tolerance to re-renders)
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('#ev2SaveForm [data-ver-bump]');
    if (!btn) return;
    var group = btn.parentElement;
    group.querySelectorAll('[data-ver-bump]').forEach(function (b) { b.setAttribute('aria-checked', b === btn ? 'true' : 'false'); });
    var cur = getProjectCurrentVersion();
    var next = bumpSemver(cur, btn.getAttribute('data-ver-bump'));
    var nextEl = document.getElementById('ev2SaveVerNext');
    if (nextEl) nextEl.textContent = next;
    // Reflect on the primary button label too.
    var primary = document.getElementById('ev2DeployConfirm');
    var dlg = document.getElementById('ev2DeployDialog');
    var inForm = !dlg || dlg.getAttribute('data-mode') === 'form';
    if (primary && inForm) primary.textContent = 'Publish ' + next;
  });

  $reload.addEventListener('click', function () {
    $frame.contentWindow.location.reload();
  });

  /* Preview surface override dropdown \u2014 lets the designer audit
     each surface family without changing what they're editing.
     Empty value = follow editor (default). Any other value forces
     the preview canvas into t2 + the chosen surface. Persisted to
     localStorage so reloads keep the chosen audit view. */
  var $previewSurface = document.getElementById('previewSurfaceSelect');
  if ($previewSurface) {
    if (_previewSurfaceOverride) {
      $previewSurface.value = _previewSurfaceOverride;
      $previewSurface.setAttribute('data-override', '1');
    }
    $previewSurface.addEventListener('change', function () {
      _previewSurfaceOverride = $previewSurface.value || '';
      try {
        if (_previewSurfaceOverride) {
          localStorage.setItem('ev2:preview-surface-override', _previewSurfaceOverride);
          $previewSurface.setAttribute('data-override', '1');
        } else {
          localStorage.removeItem('ev2:preview-surface-override');
          $previewSurface.removeAttribute('data-override');
        }
      } catch (e) {}
      pushActiveSurface();
    });
  }

  function _onFrameLoad() {
    // Mark body so the stage reveals the checkerboard and the iframe
    // fades in. Class is permanent once set (no flicker on re-pushes).
    document.body.classList.add('ev2-frame-loaded');
    var mode = document.documentElement.getAttribute('data-theme') || 'light';
    try { $frame.contentWindow.postMessage({ type: 'ev2-theme', mode: mode }, '*'); } catch (e) {}
    try { $frame.contentWindow.postMessage({ type: 'ev2-active-role', role: State.activeRole }, '*'); } catch (e) {}
    pushPreview();
    /* Also push the saved Tt typography overrides on iframe load so
       the user's font choices survive a preview reload even when
       they're not on the Tt tier. Without this, the preview boots
       with the project's primitives.css fonts and only updates
       when the user enters Tt. */
    try { loadTypoState(); pushTypoToPreview(); } catch (_e) {}
  }
  $frame.addEventListener('load', _onFrameLoad);
  /* Race-condition guard: the inline-script in index.html sets
     $frame.src the moment the parser hits the <iframe> element,
     which is hundreds of ms before this deferred script runs.
     On a warm cache preview.html can load in <100ms, so the
     iframe's 'load' event fires BEFORE this listener is attached.
     Detect that case and push overrides immediately. */
  try {
    if ($frame.contentDocument && $frame.contentDocument.readyState === 'complete' && ($frame.src || $frame.srcdoc)) {
      _onFrameLoad();
    }
  } catch (_re) {}

  var draftStatus = document.getElementById('draftStatus');

  var toastEl = document.getElementById('ev2Toast');
  var toastTimer = null;
  /* ev2Toast(msg, kind, ttlMs)
     kind: 'ok' | 'warn' | 'err'  (also accepts 'success' / 'error'
           as legacy aliases so call sites in publish/restore that
           predate the rename still light up the right colour bar)
     ttlMs: optional override of the default auto-hide. Ignored for
            'err' — errors stick until the user dismisses them. */
  window.ev2Toast = function (msg, kind, ttlMs) {
    kind = kind || 'ok';
    // Backwards-compat aliases. Without this, error toasts came
    // through as data-kind="error" which matches no CSS rule, so
    // the accent dot stayed neutral grey instead of red — the user
    // had no visual cue that the message was a failure.
    if (kind === 'success') kind = 'ok';
    else if (kind === 'error') kind = 'err';
    else if (kind === 'warning') kind = 'warn';
    // Error toasts get a dismiss button and stay until the user
    // closes them — they often contain GitHub API messages the user
    // needs to read in full ("Resource not accessible by integration"
    // is too long for 2.4s).
    var isErr = (kind === 'err');
    toastEl.innerHTML = '';
    var msgSpan = document.createElement('span');
    msgSpan.className = 'ev2-toast-msg';
    msgSpan.textContent = msg;
    toastEl.appendChild(msgSpan);
    if (isErr) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ev2-toast-dismiss';
      btn.setAttribute('aria-label', 'Dismiss');
      btn.textContent = '×';
      btn.addEventListener('click', function () { toastEl.removeAttribute('data-show'); });
      toastEl.appendChild(btn);
    }
    toastEl.setAttribute('data-kind', kind);
    toastEl.setAttribute('data-show', '');
    clearTimeout(toastTimer);
    if (!isErr) {
      // Default: 2.4s for ok, 4s for warn. Callers can override via
      // ttlMs — used by long messages like "Restored vX as vY.
      // Reloading editor…" that need extra time to read before the
      // page navigates away.
      var ttl = ttlMs != null ? ttlMs : (kind === 'warn' ? 4000 : 2400);
      toastTimer = setTimeout(function () { toastEl.removeAttribute('data-show'); }, ttl);
    }
  };

  /* In-dialog status line for the Version history dialog.
     Restore is invoked from inside a modal dialog — painting status
     in a floating top-right toast forces the user's eyes off the
     dialog and (until r728c0df) was buried under the .ev2-busy
     overlay. Render the status right under the dialog header so it
     sits next to the row that triggered it.
     msg: text. kind: 'ok'|'err'|'warn'|'info'. ttlMs: optional, 0/
          null = stick until manually cleared. */
  function historyStatus(msg, kind, ttlMs) {
    var el = document.getElementById('ev2HistoryStatus');
    if (!el) return;
    if (!msg) { el.hidden = true; el.textContent = ''; return; }
    kind = kind || 'info';
    if (kind === 'success') kind = 'ok';
    else if (kind === 'error') kind = 'err';
    else if (kind === 'warning') kind = 'warn';
    el.textContent = msg;
    el.setAttribute('data-kind', kind);
    el.hidden = false;
    clearTimeout(historyStatus._t);
    if (ttlMs && kind !== 'err') {
      historyStatus._t = setTimeout(function () {
        el.hidden = true; el.textContent = '';
      }, ttlMs);
    }
  }

  function boot() {
    if (!window.PaletteEngine) { setTimeout(boot, 30); return; }

    // Named-route entry: support ?project=<id> from the project hub.
    // If present, persist as active project and strip the param so
    // reloads stay clean (and ?project= can be deep-linked safely).
    // Also support #history hash from external deep-links (e.g. the
    // Figma plugin "Version history" menu item) so we auto-open the
    // dialog after boot completes. The hash is consumed (stripped)
    // so a manual refresh doesn't re-trigger.
    var deepLinkOpenHistory = false;
    try {
      var url = new URL(window.location.href);
      var qp  = (url.searchParams.get('project') || '').trim();
      if (qp && /^[a-z0-9][a-z0-9-]*$/i.test(qp)) {
        if (localStorage.getItem('dtf-active-project') !== qp) {
          localStorage.setItem('dtf-active-project', qp);
        }
        url.searchParams.delete('project');
        history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash);
      }
      if (url.hash === '#history') {
        deepLinkOpenHistory = true;
        history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
      }
    } catch (e) { /* ignore — older browsers, file:// quirks */ }
    /* Deep-link auto-open: defer to next tick so the rest of boot
       has wired the editor frame. openHistoryDialog() internally
       calls ensureGhCredentials() which gates on PAT, so external
       callers (the Figma plugin's "Version history" menu item)
       don't need to handle auth — they just hand off the URL. */
    if (deepLinkOpenHistory) {
      setTimeout(function () {
        try {
          var fn = window.openHistoryDialog || openHistoryDialog;
          fn();
        } catch (e) { /* dialog wires up after boot — retry once */
          setTimeout(function () { try { openHistoryDialog(); } catch (e2) {} }, 400);
        }
      }, 200);
    }

    /* Promote project's config.customRoles to first-class T1 roles.
       The 5 baseline roles (brand, danger, success, warning, info)
       are hardcoded. Projects may add roles via config.customRoles —
       writer-handhelds ships "neutral". Without this step they'd
       appear only as custom palettes (T0) but not as editable T1
       roles. We fetch the config synchronously so ROLES + State.t1
       are extended BEFORE the AA-fix loop iterates them. */
    injectProjectPrimitivesSync();
    promoteCustomRoles();
    seedSurfacePaletteFromConfig();
    /* readBaseline MUST run before the T1 seeds. It populates
       State.proposed[role] = current --prim-<role>-500 hex, which
       ladderFor() needs to compute each role's hex ladder. Without
       it, ladderFor returns garbage (generatePalette(undefined))
       and seedT1FromSemanticCSS finds zero hex matches — every
       lever silently stays on the in-code default. */
    readBaseline();
    /* Hydrate T1 picks from the published config BEFORE the AA-fix
       loop and BEFORE t1Baseline is snapshotted. Without this,
       State.t1 always starts at the in-code defaults and the editor
       silently disagrees with the on-disk semantic.css. */
    seedT1FromConfig();
    /* Last-resort: read the published semantic.css directly and
       reverse-match its hex values to ladder steps. This makes the
       file the source of truth, so editor and production stay in
       lockstep even when config.t1Picks is missing or stale. */
    seedT1FromSemanticCSS();

    bindAddPaletteDialog();
    // Default: show CSS names ON. Overridden below if UI state has been saved.
    document.body.classList.add('ev2-show-css');

    // Run boot-time auto-AA-fix BEFORE loading the draft so we can
    // snapshot the AA-clean values as the t1 baseline. Then the draft
    // (if any) overrides State.t1 with user picks, and Discard knows
    // exactly what to revert to.
    var savedMode_pre = State.editingMode;
    ['light','dark'].forEach(function (mode) {
      State.editingMode = mode;
      ROLES.forEach(function (r) {
        var wcag = computeRoleContrast(r.id, mode);
        if (wcag.checks.some(function (c) { return !c.pass; })) autoFixT1ToAA(r.id);
      });
    });
    State.editingMode = savedMode_pre;
    // Snapshot the AA-clean settled state as the baseline used by
    // change-detection and Discard.
    ROLES.forEach(function (r) {
      State.t1Baseline.light[r.id] = Object.assign({}, State.t1.light[r.id]);
      State.t1Baseline.dark[r.id]  = Object.assign({}, State.t1.dark[r.id]);
    });

    var hadDraft = loadDraftFromStorage();
    var ui = loadUIState();
    // Boot UI theme from the shared 'dtf-theme' key (matches the
    // rest of the demo pages). If the saved editing-mode in ui
    // disagrees, the editing-mode wins below — a single source of
    // truth means UI theme = editing mode after first interaction.
    try {
      var savedUiTheme = localStorage.getItem('dtf-theme');
      if (savedUiTheme === 'dark' || savedUiTheme === 'light') {
        document.documentElement.setAttribute('data-theme', savedUiTheme);
        try { $frame.contentWindow.postMessage({ type: 'ev2-theme', mode: savedUiTheme }, '*'); } catch (e) {}
      }
    } catch (e) {}
    if (ui) {
      if (ui.activeTier) State.activeTier = ui.activeTier;
      if (ui.activeRole) State.activeRole = ui.activeRole;
      if (ui.activeT0 === 'roles' || ui.activeT0 === 'palettes') State.activeT0 = ui.activeT0;
      if (ui.activeSurface && T2_SURFACES.some(function (s) { return s.id === ui.activeSurface; })) {
        State.activeSurface = ui.activeSurface;
      }
      if (ui.anchor === 'exact' || ui.anchor === 'normalized') State.anchor = ui.anchor;
      if (ui.baselineAnchor === 'exact' || ui.baselineAnchor === 'normalized') {
        State.baselineAnchor = ui.baselineAnchor;
      }
      if (ui.disclosure && typeof ui.disclosure === 'object') {
        Object.keys(ui.disclosure).forEach(function (k) { State.disclosure[k] = !!ui.disclosure[k]; });
        // 't0:steps' is the 20-step ladder — the primary T0 surface.
        // Even if the user collapsed it in a past session, we always
        // reopen on load so it is visible by default every time.
        State.disclosure['t0:steps'] = true;
      }
      if (ui.mode === 'light' || ui.mode === 'dark') {
        State.editingMode = ui.mode;
        // Editing mode IS the UI theme — keep them in sync on boot.
        document.documentElement.setAttribute('data-theme', ui.mode);
        try { localStorage.setItem('dtf-theme', ui.mode); } catch (e) {}
        try { $frame.contentWindow.postMessage({ type: 'ev2-theme', mode: ui.mode }, '*'); } catch (e) {}
      }
      if (typeof ui.showCss === 'boolean') {
        document.body.classList.toggle('ev2-show-css', ui.showCss);
        var cb = document.getElementById('showCssNames');
        if (cb) cb.checked = !!ui.showCss;
        var btn = document.getElementById('showCssNamesBtn');
        if (btn) btn.setAttribute('aria-pressed', ui.showCss ? 'true' : 'false');
      } else {
        // No saved preference yet — keep the HTML default (checked).
        document.body.classList.add('ev2-show-css');
      }
      // Reflect activeTier in the rail aria-current
      document.querySelectorAll('.ev2-tier').forEach(function (b) {
        if (b.getAttribute('data-tier') === State.activeTier) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      });
    }

    // $frame.src was already set at boot start (above) so the iframe
    // loaded in parallel with this initialisation sequence.
    // Re-validate after draft load: if any saved t1 picks fail AA
    // against the CURRENT ladder (e.g. seed changed since last
    // session, or solver thresholds tightened), silently snap them
    // and re-snapshot the baseline so the user doesn't see stale
    // fail badges on a draft they didn't intentionally make fail.
    var snappedAny = false;
    var savedMode_post = State.editingMode;
    ['light','dark'].forEach(function (mode) {
      State.editingMode = mode;
      ROLES.forEach(function (r) {
        var wcag = computeRoleContrast(r.id, mode);
        if (wcag.checks.some(function (c) { return !c.pass; })) {
          autoFixT1ToAA(r.id);
          snappedAny = true;
        }
      });
    });
    State.editingMode = savedMode_post;
    if (snappedAny) {
      // Roll the baseline forward so the now-passing picks count as
      // the new "no changes" state.
      ROLES.forEach(function (r) {
        State.t1Baseline.light[r.id] = Object.assign({}, State.t1.light[r.id]);
        State.t1Baseline.dark[r.id]  = Object.assign({}, State.t1.dark[r.id]);
      });
    }
    renderActiveTier();
    refreshChangeBar();
    initProjectWidget();
    initMigrationBanner();
    initConflictBanner();
    if (hadDraft) {
      // Refresh the backup timestamp so the status pill reads
      // "backed up just now" instead of the original draft's age.
      // Justification: at this point the in-memory state IS the draft
      // on disk (we just hydrated from it). Showing "5m ago" implies
      // 5 minutes of work could be lost — but there's nothing to lose,
      // the on-disk draft already matches what the user sees. Do a
      // single immediate write to make UI label honest, then normal
      // scheduleAutosave() takes over on next edit.
      try {
        var payload = {
          v: 1,
          ts: Date.now(),
          baseVersion: State.draftBaseVersion || currentHeadVersion(),
          anchor: State.anchor,
          editingMode: State.editingMode,
          proposed: State.proposed,
          t1: State.t1,
          t2: State.t2,
          t2SurfacePalette: State.t2SurfacePalette
        };
        localStorage.setItem(getDraftKey(), JSON.stringify(payload));
        State.lastSavedAt = payload.ts;
      } catch (_e) {}
      refreshDraftStatus('saved');
      if (window.ev2Toast) {
        window.ev2Toast(
          snappedAny
            ? 'Restored from local draft — auto-snapped to AA'
            : 'Restored from local draft',
          'ok'
        );
      }
    } else {
      refreshDraftStatus('idle');
    }
    initPaneResizer();
    // Dismiss the post-restore overlay (if any). Set by
    // restoreVersion() before reload — see index.html head. We wait
    // for the preview iframe to be ready before fading the mask, so
    // the user never sees the iframe paint with maintainer-default
    // pearl tokens between page-load and first ev2-overrides push.
    // The preview self-marks ready by setting data-ev2-ready on its
    // <html> when it receives the first ev2-overrides message — see
    // preview.html. We poll for that flag (cheap: same-origin DOM
    // read) up to 3s, then fade regardless so the editor isn't
    // permanently masked if the iframe never loads.
    try {
      var mask = document.getElementById('ev2-restore-mask');
      if (mask && !mask.hasAttribute('data-dismiss')) {
        var maskStart = Date.now();
        var dismissMask = function () {
          mask.setAttribute('data-dismiss', '1');
          setTimeout(function () {
            if (mask.parentNode) mask.parentNode.removeChild(mask);
          }, 250);
        };
        var checkPreview = function () {
          // 3s safety cap so we never lock the user on the mask.
          if (Date.now() - maskStart > 3000) { dismissMask(); return; }
          try {
            var fdoc = $frame && $frame.contentDocument;
            if (fdoc && fdoc.documentElement && fdoc.documentElement.hasAttribute('data-ev2-ready')) {
              requestAnimationFrame(function () {
                requestAnimationFrame(dismissMask);
              });
              return;
            }
          } catch (_pe) { /* cross-origin or not loaded yet */ }
          requestAnimationFrame(checkPreview);
        };
        requestAnimationFrame(checkPreview);
      }
    } catch (_me) {}
    // initBeforeUnloadGuard intentionally not called — the editor
    // auto-backs up every change to localStorage (`backed up Xm ago`
    // status), so a "changes may not be saved" prompt is misleading:
    // reopening the tab restores the same draft state and the
    // Publish-N-change button is still active. Keeping the guard
    // function defined for reference but unused.

    // Push the fully-initialised token state to the preview iframe.
    // _onFrameLoad() fires at line ~6727 (before boot()) so the
    // preview may already have loaded with empty State — the push
    // there races against readBaseline(). This call is the
    // authoritative push: State is fully populated by now (baseline
    // read, T1/T2 seeded, draft restored). If the iframe is still
    // loading the push is a no-op; _onFrameLoad() will push again
    // when it fires and State will be correct by then.
    try { pushPreview(); } catch (_e) {}
    try { loadTypoState(); pushTypoToPreview(); } catch (_e) {}
  }
  // Boot runs at the very bottom, after all helpers are defined.

  /* ══════════════════════════════════════════════════════
     beforeunload guard — warn if the user closes the tab or
     navigates away with unsaved changes. Modern browsers
     ignore the custom string and show their own generic
     prompt, but returning ANY truthy value triggers it.
     We skip the prompt when totalChanges() === 0 so the
     editor doesn't nag on clean closes.
     ══════════════════════════════════════════════════════ */
  function initBeforeUnloadGuard() {
    window.addEventListener('beforeunload', function (e) {
      try {
        // Our own navigations (project switch confirm, post-publish
        // reload, onboard redirect) set this flag right before they
        // hand off — the user has already gone through an in-app
        // confirm or just clicked Publish, so the native
        // "Changes you made may not be saved" prompt is redundant
        // (and reads as broken because they already said yes).
        if (window.__ev2BypassUnloadGuard) return;
        if (typeof totalChanges === 'function' && totalChanges() > 0) {
          var msg = 'You have unsaved changes. Leave anyway?';
          e.preventDefault();
          e.returnValue = msg;
          return msg;
        }
      } catch (_e) {}
    });
  }

  /* ══════════════════════════════════════════════════════
     Pane resizer (drag divider between list and preview)
     ══════════════════════════════════════════════════════ */
  function initPaneResizer() {
    var resizer  = document.getElementById('paneResizer');
    var workspace = document.querySelector('.ev2-panes');
    if (!resizer || !workspace) return;

    var RESIZER_W = 6;         // matches CSS resizer track
    var MIN_LIST = 320;
    var MIN_PREVIEW = 380;
    var STORAGE_KEY = 'ev2-list-width';

    function applyWidth(px) {
      var totalAvail = workspace.clientWidth - RESIZER_W;
      if (totalAvail <= MIN_LIST + MIN_PREVIEW) return; // viewport too narrow
      var maxList = totalAvail - MIN_PREVIEW;
      var clamped = Math.max(MIN_LIST, Math.min(maxList, px));
      workspace.style.setProperty('--ev2-list-w', clamped + 'px');
    }

    // Restore saved width
    var saved = parseInt(localStorage.getItem(STORAGE_KEY) || '0', 10);
    if (saved > 0) applyWidth(saved);

    var dragging = false;
    function onPointerDown(e) {
      dragging = true;
      resizer.setAttribute('data-dragging', 'true');
      document.body.setAttribute('data-pane-dragging', 'true');
      try { resizer.setPointerCapture(e.pointerId); } catch (_) {}
      e.preventDefault();
    }
    function onPointerMove(e) {
      if (!dragging) return;
      var rect = workspace.getBoundingClientRect();
      var newListW = e.clientX - rect.left - (RESIZER_W / 2);
      applyWidth(newListW);
    }
    function onPointerUp(e) {
      if (!dragging) return;
      dragging = false;
      resizer.removeAttribute('data-dragging');
      document.body.removeAttribute('data-pane-dragging');
      try { resizer.releasePointerCapture(e.pointerId); } catch (_) {}
      // Persist current width
      var cs = workspace.style.getPropertyValue('--ev2-list-w').trim();
      var px = parseInt(cs, 10);
      if (px > 0) localStorage.setItem(STORAGE_KEY, String(px));
    }
    resizer.addEventListener('pointerdown', onPointerDown);
    resizer.addEventListener('pointermove', onPointerMove);
    resizer.addEventListener('pointerup', onPointerUp);
    resizer.addEventListener('pointercancel', onPointerUp);
    // Double-click to reset
    resizer.addEventListener('dblclick', function () {
      workspace.style.removeProperty('--ev2-list-w');
      localStorage.removeItem(STORAGE_KEY);
    });
    // Keyboard a11y: arrow keys nudge by 16px
    resizer.addEventListener('keydown', function (e) {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      var current = parseInt(getComputedStyle(workspace).gridTemplateColumns.split(' ')[0], 10) || 480;
      var delta = e.key === 'ArrowLeft' ? -16 : 16;
      applyWidth(current + delta);
      var cs = workspace.style.getPropertyValue('--ev2-list-w').trim();
      var px = parseInt(cs, 10);
      if (px > 0) localStorage.setItem(STORAGE_KEY, String(px));
      e.preventDefault();
    });
  }

  /* ══════════════════════════════════════════════════════
     Project widget + switch guard
     ══════════════════════════════════════════════════════ */
  var $projBtn   = document.getElementById('projBtn');
  var $projName  = document.getElementById('projName');
  var $projPanel = document.getElementById('projPanel');
  var $projRenameBtn = document.getElementById('projRenameBtn');
  var $projDeleteBtn = document.getElementById('projDeleteBtn');

  function getActiveProjectId() {
    return localStorage.getItem('dtf-active-project') || '';
  }

  /* Read project config.json synchronously (file:// — sync XHR is
     fine, blocks boot for ~1ms). Returns parsed object or null.
     Used by promoteCustomRoles() before State init runs. */
  function readProjectConfigSync() {
    var id = getActiveProjectId();
    if (!id) return null;
    // Prefer localStorage stash for the same reason as
    // injectProjectPrimitivesSync — publish writes here atomically
    // so the editor reflects the latest published config without
    // waiting on the workspace file (file://) or Pages deploy.
    try {
      var cached = localStorage.getItem('dtf-project-config-' + id);
      if (cached) return JSON.parse(cached);
    } catch (e) { /* corrupt cache, fall through */ }
    var depth = (location.pathname.indexOf('/demo/') !== -1) ? '../..' : '.';
    var url = depth + '/projects/' + encodeURIComponent(id) + '/config.json';
    try {
      var xhr = new XMLHttpRequest();
      xhr.open('GET', url, /* async */ false);
      xhr.send(null);
      if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
        var parsed = JSON.parse(xhr.responseText);
        /* Seed the stash so the next sync read hits the fast path
           and downstream consumers (injectProjectPrimitivesSync)
           don't re-fetch. */
        try { localStorage.setItem('dtf-project-config-' + id, JSON.stringify(parsed)); } catch (_se) {}
        return parsed;
      }
    } catch (e) { /* missing file, parse error, CORS — fall through */ }
    /* Cross-origin fallback: deep-link to /editor-v2/?project=<id>
       on the maintainer's Pages, where same-origin XHR can't reach
       the colleague's fork. Use the signed-in PAT + GitHub Contents
       API to fetch config.json from THEIR fork. Sync XHR so the
       editor's synchronous boot keeps working — adds ~200ms on the
       first visit per project per browser, then cached. */
    try {
      var pat   = localStorage.getItem('dtf-gh-pat')   || '';
      var owner = localStorage.getItem('dtf-gh-owner') || localStorage.getItem('dtf-gh-user') || '';
      if (pat && owner) {
        var apiUrl = 'https://api.github.com/repos/' + owner + '/Design-Token-Forge/contents/projects/' + encodeURIComponent(id) + '/config.json?ref=main';
        var x2 = new XMLHttpRequest();
        x2.open('GET', apiUrl, /* async */ false);
        x2.setRequestHeader('Authorization', 'Bearer ' + pat);
        x2.setRequestHeader('Accept', 'application/vnd.github+json');
        x2.send(null);
        if (x2.status >= 200 && x2.status < 300) {
          var file = JSON.parse(x2.responseText);
          if (file && file.content) {
            var decoded = atob(file.content.replace(/\n/g, ''));
            var cfgObj = JSON.parse(decoded);
            try { localStorage.setItem('dtf-project-config-' + id, JSON.stringify(cfgObj)); } catch (_se) {}
            return cfgObj;
          }
        }
      }
    } catch (e) { /* API blocked, no PAT, parse error — fall through */ }
    return null;
  }

  /* Inject the project's primitives.css into <head> so the editor
     sees its FULL --prim-* ladder — not just the package default.
     This is what lets discoverCustomPalettes() pick up project-
     specific palettes (e.g. writer-handhelds ships "neutral")
     and what makes T2 surface mappings like "src: neutral"
     resolve to a valid palette instead of being silently dropped
     by isValidSurfacePalette().
     Idempotent: replaces any previously-injected block. Bust the
     custom-palette cache afterwards so discoverCustomPalettes()
     re-reads stylesheets on next call. */
  function injectProjectPrimitivesSync() {
    var id = getActiveProjectId();
    if (!id) return;
    var cssText = null;
    // Prefer the localStorage stash: it's updated atomically on
    // every successful publish (and seeded by onboarding) so it's
    // always at least as fresh as the on-disk file. On file:// the
    // workspace copy lags GitHub; on Pages it lags by ~1 min after
    // a deploy. Stash-first guarantees the editor reopens showing
    // exactly what was last published from this browser.
    try { cssText = localStorage.getItem('dtf-project-primitives-' + id) || null; }
    catch (e) { /* ignore */ }
    // Fall back to the deployed file (HTTP on Pages, workspace copy
    // on file://) only when the stash is empty — e.g. a different
    // browser, or a project published from somewhere else.
    if (!cssText) {
      var depth = (location.pathname.indexOf('/demo/') !== -1) ? '../..' : '.';
      var url = depth + '/projects/' + encodeURIComponent(id) + '/primitives.css';
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, /* async */ false);
        xhr.send(null);
        if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
          cssText = xhr.responseText;
        }
      } catch (e) { /* fall through */ }
    }
    // Last-ditch synth: if the project has paletteKeys but no
    // primitives.css (older onboards that didn't stash the
    // generated CSS), build it now from PaletteEngine.
    if (!cssText && window.PaletteEngine) {
      var cfg = readProjectConfigSync();
      if (cfg && cfg.paletteKeys) {
        var parts = [];
        Object.keys(cfg.paletteKeys).forEach(function (roleId) {
          var keyHex = cfg.paletteKeys[roleId];
          if (!keyHex) return;
          try {
            var pal = window.PaletteEngine.generatePalette(keyHex, { anchor: 'exact' });
            parts.push(window.PaletteEngine.toCss(roleId, pal));
          } catch (e) { /* skip bad role */ }
        });
        if (parts.length) cssText = parts.join('\n');
      }
    }
    if (!cssText) return;
    var existing = document.getElementById('ev2-project-primitives');
    var node = existing || document.createElement('style');
    node.id = 'ev2-project-primitives';
    node.textContent = cssText;
    if (!existing) document.head.appendChild(node);
    _customPalettesCache = null;
  }

  /* Seed State.t1 from config.t1Picks so a fresh boot reflects
     what was actually published, not the in-code defaults. This is
     the symmetric reader for the t1Picks writer in buildConfigJSON.

     Without this, the editor was silently drifting: the publish path
     wrote container=50 to semantic.css, but the next boot re-seeded
     State.t1.container from T1_DEFAULT_STEPS (=75), and baseline was
     snapshotted from that. Topbar read 'No changes yet' even though
     the row label and the on-disk file disagreed by 25 steps.

     Must run BEFORE the AA-fix loop and BEFORE t1Baseline is
     snapshotted, so the snapshot captures the loaded values (post
     AA-fix), not the seed defaults. */
  function seedT1FromConfig() {
    var cfg = readProjectConfigSync();
    if (!cfg || !cfg.t1Picks) return;
    var STEP_OK = {};
    ALL_STEPS.forEach(function (s) { STEP_OK[s] = true; });
    ['light','dark'].forEach(function (mode) {
      var src = cfg.t1Picks[mode];
      if (!src) return;
      ROLES.forEach(function (r) {
        var pick = src[r.id];
        if (!pick) return;
        var dest = State.t1[mode][r.id];
        if (!dest) return;
        if (pick.fill            && STEP_OK[pick.fill])            dest.fill            = pick.fill;
        if (pick.content         && STEP_OK[pick.content])         dest.content         = pick.content;
        if (pick.container       && STEP_OK[pick.container])       dest.container       = pick.container;
        if (pick.borderStep      && STEP_OK[pick.borderStep])      dest.borderStep      = pick.borderStep;
        if (pick.separatorStep   && STEP_OK[pick.separatorStep])   dest.separatorStep   = pick.separatorStep;
        if (pick.cmBorderStep    && STEP_OK[pick.cmBorderStep])    dest.cmBorderStep    = pick.cmBorderStep;
        if (pick.cmSeparatorStep && STEP_OK[pick.cmSeparatorStep]) dest.cmSeparatorStep = pick.cmSeparatorStep;
        if (pick.onComponent)                                       dest.onComponent     = pick.onComponent;
        if (pick.onContainerStep && STEP_OK[pick.onContainerStep]) dest.onContainerStep = pick.onContainerStep;
        if (pick.contentSubtleStep    && STEP_OK[pick.contentSubtleStep])    dest.contentSubtleStep    = pick.contentSubtleStep;
        if (pick.contentStrongStep    && STEP_OK[pick.contentStrongStep])    dest.contentStrongStep    = pick.contentStrongStep;
        if (pick.fillHoverStep        && STEP_OK[pick.fillHoverStep])        dest.fillHoverStep        = pick.fillHoverStep;
        if (pick.fillPressedStep      && STEP_OK[pick.fillPressedStep])      dest.fillPressedStep      = pick.fillPressedStep;
        if (pick.cmBorderHoverStep    && STEP_OK[pick.cmBorderHoverStep])    dest.cmBorderHoverStep    = pick.cmBorderHoverStep;
        if (pick.cmBorderPressedStep  && STEP_OK[pick.cmBorderPressedStep])  dest.cmBorderPressedStep  = pick.cmBorderPressedStep;
      });
    });
  }

  /* Last-resort hydrator: parse the published semantic.css and
     reverse-engineer T1 lever picks by matching its hex values back
     against each role's ladder. This is the "self-healing" path \u2014
     it makes the published file the source of truth, so the editor
     can never disagree with what users actually see in production,
     even when config.t1Picks is missing (older projects pre-dating
     the writer in buildConfigJSON) or the config.json has been
     deleted / hand-edited.

     Runs AFTER seedT1FromConfig, so config picks (when present) win
     \u2014 config can express things the file can't, like "user
     explicitly chose default" for border/separator. Only fills in
     gaps the config didn't cover.

     Reads:
       --<role>-component-bg-default   -> t1.fill
       --<role>-content-default        -> t1.content
       --<role>-container-bg           -> t1.container
       --<role>-component-outline-default -> t1.borderStep (only if
           it differs from the auto-derived value, else left null)
       --<role>-component-separator    -> t1.separatorStep (same
           auto-derived guard as borderStep)
       --<role>-on-component           -> t1.onComponent
           (#FFFFFF -> 'white', #0A0A0A -> 'black', else step match)
       --<role>-on-container           -> t1.onContainerStep
   */
  function seedT1FromSemanticCSS() {
    var id = getActiveProjectId();
    if (!id) return;
    var cssText = null;
    try { cssText = localStorage.getItem('dtf-project-semantic-' + id) || null; }
    catch (e) { /* ignore */ }
    if (!cssText) {
      // The previous relative-path approach ('../..'/'.' + '/projects/...')
      // breaks on certain Pages deploys where the editor URL has
      // extra path segments (saw a 404 at
      // /Design-Token-Forge/pearl/projects/pearl/semantic.css on
      // first reload). Robust fix: find the project's already-loaded
      // primitives.css <link> in the document and swap the filename.
      // That link's href is whatever Pages resolved, so we're
      // guaranteed to hit the same directory.
      var url = null;
      var links = document.querySelectorAll('link[rel="stylesheet"][href]');
      for (var i = 0; i < links.length; i++) {
        var h = links[i].getAttribute('href') || '';
        if (/\/projects\/[^/]+\/primitives\.css(\?|$)/.test(h)) {
          url = h.replace(/primitives\.css(\?.*)?$/, 'semantic.css$1');
          break;
        }
      }
      // No project <link> (primitives may have been injected as a
      // <style> block from the localStorage stash). Try a series of
      // candidate URLs and use the first that 200s.
      if (!url) {
        var candidates = [];
        // 1. Absolute via Pages convention: <origin>/<repo>/projects/<id>/semantic.css
        if (typeof GH_REPO_NAME === 'string' && GH_REPO_NAME) {
          candidates.push(location.origin + '/' + GH_REPO_NAME + '/projects/' + encodeURIComponent(id) + '/semantic.css');
        }
        // 2. Walk back from location.pathname to find a /projects/<id>/ segment.
        var m = location.pathname.match(/^(.*?)\/projects\/[^/]+\//);
        if (m) candidates.push(location.origin + m[1] + '/projects/' + encodeURIComponent(id) + '/semantic.css');
        // 3. Old relative-path heuristics (work on file:// and the
        //    canonical /demo/editor-v2/ Pages path).
        var depth = (location.pathname.indexOf('/demo/') !== -1) ? '../..' : '.';
        candidates.push(depth + '/projects/' + encodeURIComponent(id) + '/semantic.css');
        for (var c = 0; c < candidates.length; c++) {
          try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', candidates[c], /* async */ false);
            xhr.send(null);
            if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
              cssText = xhr.responseText;
              break;
            }
          } catch (e) { /* try next */ }
        }
      } else {
        try {
          var xhr2 = new XMLHttpRequest();
          xhr2.open('GET', url, /* async */ false);
          xhr2.send(null);
          if (xhr2.status === 0 || (xhr2.status >= 200 && xhr2.status < 300)) {
            cssText = xhr2.responseText;
          }
        } catch (e) { /* swallow */ }
      }
    }
    if (!cssText) return;

    // Split into mode blocks. :root is light; [data-theme="dark"] is dark.
    // semantic.css is editor-generated so the structure is stable.
    var lightBlock = '';
    var darkBlock  = '';
    var rootMatch = cssText.match(/:root\s*\{([\s\S]*?)\}/);
    if (rootMatch) lightBlock = rootMatch[1];
    var darkMatch = cssText.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/);
    if (darkMatch) darkBlock = darkMatch[1];

    function parseBlock(block) {
      var out = {};
      if (!block) return out;
      var rx = /--([a-z0-9-]+):\s*(#[0-9A-Fa-f]{3,8})\s*;/g;
      var m;
      while ((m = rx.exec(block))) {
        out['--' + m[1]] = m[2].toUpperCase();
      }
      return out;
    }
    var blocks = { light: parseBlock(lightBlock), dark: parseBlock(darkBlock) };

    // Build a quick reverse-lookup: hex -> step, per role+mode.
    // Hex collisions inside a single ladder are extremely rare
    // (ladders are tonal sweeps) but if one happens, first match wins
    // \u2014 which is fine because both steps paint identically.
    //
    // Use the LIVE computed --prim-<prefix>-<step> values rather than
    // regenerating via PaletteEngine. The published primitives.css
    // is the source of truth for hex \u2014 a fresh generatePalette()
    // call can drift by 1 channel due to engine version differences
    // or rounding, and then NOTHING in the file matches. Reading
    // from getComputedStyle guarantees the lookup uses the exact
    // same hex values that semantic.css was built against.
    var cs = getComputedStyle(document.documentElement);
    var ladderCache = {};
    function buildLadder(roleId) {
      if (ladderCache[roleId]) return ladderCache[roleId];
      var roleObj = null;
      for (var i = 0; i < ROLES.length; i++) {
        if (ROLES[i].id === roleId) { roleObj = ROLES[i]; break; }
      }
      var prefix = (roleObj && roleObj.prefix) || roleId;
      var ladder = {};
      ALL_STEPS.forEach(function (step) {
        var hex = cs.getPropertyValue('--prim-' + prefix + '-' + step).trim().toUpperCase();
        if (hex) ladder[step] = hex;
      });
      ladderCache[roleId] = ladder;
      return ladder;
    }
    function findStep(roleId, mode, hex) {
      if (!hex) return null;
      var ladder = buildLadder(roleId);
      var H = String(hex).toUpperCase();
      var names = Object.keys(ladder);
      for (var i = 0; i < names.length; i++) {
        if (ladder[names[i]] === H) return names[i];
      }
      return null;
    }

    ['light','dark'].forEach(function (mode) {
      var vars = blocks[mode];
      if (!vars || !Object.keys(vars).length) return;
      var savedMode = State.editingMode;
      State.editingMode = mode; // ladderFor/resolveBorderStep read this
      ROLES.forEach(function (r) {
        var dest = State.t1[mode][r.id];
        if (!dest) return;
        var pref = '--' + r.id + '-';
        var fillHex   = vars[pref + 'component-bg-default'];
        var contentHex= vars[pref + 'content-default'];
        var contHex   = vars[pref + 'container-bg'];
        var cmBorderHex = vars[pref + 'component-outline-default'];
        var cmSepHex    = vars[pref + 'component-separator'];
        var borderHex   = vars[pref + 'container-outline'];
        var sepHex      = vars[pref + 'container-separator'];
        var onCompHex = vars[pref + 'on-component'];
        var onContHex = vars[pref + 'on-container'];

        // Only fill values the config didn't already supply. A pick
        // counts as "supplied" if it differs from the in-code default
        // OR if it matches the published file (so both agree).
        // Simplest approach: always overwrite from the file when a
        // hex match exists. Config ran first, so for projects WITH
        // cfg.t1Picks the values agree; this overwrite is a no-op.
        // For projects WITHOUT cfg.t1Picks the file wins, which is
        // exactly what we want.
        var fillStep = findStep(r.id, mode, fillHex);
        if (fillStep) dest.fill = fillStep;
        var contentStep = findStep(r.id, mode, contentHex);
        if (contentStep) dest.content = contentStep;
        var contStep = findStep(r.id, mode, contHex);
        if (contStep) dest.container = contStep;

        // on-component: canonical 'white'/'black' shortcuts first,
        // else fall through to a ladder step match.
        if (onCompHex === '#FFFFFF') dest.onComponent = 'white';
        else if (onCompHex === '#0A0A0A') dest.onComponent = 'black';
        else {
          var ocStep = findStep(r.id, mode, onCompHex);
          if (ocStep) dest.onComponent = ocStep;
        }

        var ocnStep = findStep(r.id, mode, onContHex);
        if (ocnStep) dest.onContainerStep = ocnStep;

        // borderStep / separatorStep: if the published value equals
        // what resolveBorder/Separator would auto-derive from the
        // (now updated) container, leave the override null so future
        // container changes still cascade. Only pin when the file
        // really diverges from the auto value.
        var autoBorder = stepRelToward(dest.container, 6, mode);
        var borderStep = findStep(r.id, mode, borderHex);
        if (borderStep && borderStep !== autoBorder) dest.borderStep = borderStep;
        var autoSep = stepRelToward(dest.container, 2, mode);
        var sepStep = findStep(r.id, mode, sepHex);
        if (sepStep && sepStep !== autoSep) dest.separatorStep = sepStep;
        // Same pattern for the component-side outline + separator
        // (auto-derived from the fill instead of the container).
        var autoCmBorder = stepRel(dest.fill, -2);
        var cmBorderStep = findStep(r.id, mode, cmBorderHex);
        if (cmBorderStep && cmBorderStep !== autoCmBorder) dest.cmBorderStep = cmBorderStep;
        var autoCmSep = stepRel(dest.fill, -4);
        var cmSepStep = findStep(r.id, mode, cmSepHex);
        if (cmSepStep && cmSepStep !== autoCmSep) dest.cmSeparatorStep = cmSepStep;

        // New derived slots: content-subtle, content-strong, fill-hover,
        // fill-pressed, outline-hover, outline-pressed. Only pin when
        // the file value differs from the auto-derived default.
        var contentSubtleHex  = vars[pref + 'content-subtle'];
        var contentStrongHex  = vars[pref + 'content-strong'];
        var fillHoverHex      = vars[pref + 'component-bg-hover'];
        var fillPressedHex    = vars[pref + 'component-bg-pressed'];
        var cmBorderHoverHex  = vars[pref + 'component-outline-hover'];
        var cmBorderPressedHex= vars[pref + 'component-outline-pressed'];

        var autoContentSubtle = stepRel(dest.content, -2);
        var csStep = findStep(r.id, mode, contentSubtleHex);
        if (csStep && csStep !== autoContentSubtle) dest.contentSubtleStep = csStep;

        var autoContentStrong = stepRel(dest.content, 1);
        var csStrStep = findStep(r.id, mode, contentStrongHex);
        if (csStrStep && csStrStep !== autoContentStrong) dest.contentStrongStep = csStrStep;

        var autoFillHover = stepRel(dest.fill, 1);
        var fhStep = findStep(r.id, mode, fillHoverHex);
        if (fhStep && fhStep !== autoFillHover) dest.fillHoverStep = fhStep;

        var autoFillPressed = stepRel(dest.fill, 2);
        var fpStep = findStep(r.id, mode, fillPressedHex);
        if (fpStep && fpStep !== autoFillPressed) dest.fillPressedStep = fpStep;

        var resolvedCmBorder = dest.cmBorderStep || stepRel(dest.fill, -2);
        var autoCmBorderHover = resolvedCmBorder; // default = same as outline-default
        var cbhStep = findStep(r.id, mode, cmBorderHoverHex);
        if (cbhStep && cbhStep !== autoCmBorderHover) dest.cmBorderHoverStep = cbhStep;

        var autoCmBorderPressed = stepRel(resolvedCmBorder, 1);
        var cbpStep = findStep(r.id, mode, cmBorderPressedHex);
        if (cbpStep && cbpStep !== autoCmBorderPressed) dest.cmBorderPressedStep = cbpStep;
      });
      State.editingMode = savedMode;
    });
  }

  /* Seed State.t2SurfacePalette from config.surfacePaletteSrc so
     a project's per-surface palette mapping (e.g. writer-handhelds
     pinning every surface to its custom "neutral" palette) is the
     visible default on first load \u2014 not the system default.
     The draft, loaded later, can still override per surface.
     Idempotent + safe even when no project is active. */
  function seedSurfacePaletteFromConfig() {
    var cfg = readProjectConfigSync();
    if (!cfg || !cfg.surfacePaletteSrc) return;
    Object.keys(cfg.surfacePaletteSrc).forEach(function (sid) {
      var pal = cfg.surfacePaletteSrc[sid];
      if (typeof pal !== 'string' || !pal) return;
      if (!isValidSurfacePalette(pal)) return;
      State.t2SurfacePalette[sid] = pal;
      // Mirror into the baseline so the loaded mapping is treated
      // as "what was last published" \u2014 not as a fresh edit on
      // top of factory defaults. Without this, every surface whose
      // project config differs from T2_SURFACES default registers
      // as dirty on first load, producing a phantom "N changes"
      // badge on every hard refresh.
      State.t2SurfacePaletteBaseline[sid] = pal;
    });
  }

  /* Extend ROLES + State.t1 dictionaries with config.customRoles
     so the new roles are first-class T1 editors instead of just
     palette entries. Idempotent — safe to call repeatedly. */
  function promoteCustomRoles() {
    var cfg = readProjectConfigSync();
    if (!cfg || !Array.isArray(cfg.customRoles) || !cfg.customRoles.length) return;
    cfg.customRoles.forEach(function (cr) {
      if (!cr || !cr.id) return;
      if (!/^[a-z][a-z0-9-]*$/i.test(cr.id)) return;
      // Skip if already present (either as built-in or previously promoted)
      if (ROLES.some(function (r) { return r.id === cr.id; })) return;
      ROLES.push({ id: cr.id, label: cr.label || cr.id, prefix: cr.id });
      // Seed default step picks. defaultT1ForRole() falls back to brand
      // when the role isn't in T1_DEFAULT_STEPS — sane starting point
      // that the boot-time AA-fix loop will tighten.
      State.t1.light[cr.id]         = defaultT1ForRole(cr.id, 'light');
      State.t1.dark[cr.id]          = defaultT1ForRole(cr.id, 'dark');
      State.t1Baseline.light[cr.id] = defaultT1ForRole(cr.id, 'light');
      State.t1Baseline.dark[cr.id]  = defaultT1ForRole(cr.id, 'dark');
      // Inform AFFECTS so the role card shows a meaningful component
      // hint instead of "undefined".
      AFFECTS[cr.id] = AFFECTS[cr.id] || ['Custom (project role)'];
    });
  }

  /* ── First-boot migration banner ───────────────────────
     Mirrors scripts/migrate-v2/audit.cjs logic in-browser.
     Surfaces unresolved migration items at the top of v2 chrome
     until the user acknowledges (writes localStorage flag) or
     dismisses for the session. Acknowledge is local-only —
     editing config.json from file:// isn't possible; the audit
     script remains the canonical source of truth.
     ──────────────────────────────────────────────────── */
  var MIGRATION_TARGET_SCHEMA = 2;
  var MIGRATION_STANDARD_ROLES = ['brand','danger','warning','info','success'];

  function migrationAckKey(projectId) {
    return 'dtf-migration-ack-' + projectId;
  }
  function migrationDismissKey(projectId) {
    return 'dtf-migration-dismiss-' + projectId;
  }

  function runMigrationAuditInBrowser() {
    var id = getActiveProjectId();
    if (!id) return null;
    var cfg = readProjectConfigSync();
    if (!cfg) return null;
    var schemaVersion = cfg.schemaVersion || 1;
    var declaredKeys  = Object.keys(cfg.paletteKeys || {});
    var customRoles   = Array.isArray(cfg.customRoles) ? cfg.customRoles : [];

    // Palette inventory drift: discover palettes from the loaded
    // primitives by scanning :root CSS variables.
    var palettesInCSS = [];
    try {
      var rootCS = getComputedStyle(document.documentElement);
      var seen = {};
      // CSSOM doesn't enumerate custom properties; scan all stylesheets.
      for (var i = 0; i < document.styleSheets.length; i++) {
        var rules;
        try { rules = document.styleSheets[i].cssRules; } catch (e) { continue; }
        if (!rules) continue;
        // Only count palettes that come from THIS project. Without
        // this scope check, we'd also pick up every palette declared
        // in the package defaults (packages/tokens/src/index.css)
        // and flag a brand-new project as "undeclared palettes
        // present" — which makes onboard always trigger the
        // migration banner.
        var sheetHref = document.styleSheets[i].href || '';
        var sheetNode = document.styleSheets[i].ownerNode;
        var isProjectSheet = (sheetNode && sheetNode.id === 'ev2-project-primitives')
          || /\/projects\/[^/]+\/primitives\.css/.test(sheetHref);
        if (!isProjectSheet) continue;
        for (var j = 0; j < rules.length; j++) {
          var rule = rules[j];
          if (!rule.style) continue;
          for (var k = 0; k < rule.style.length; k++) {
            var prop = rule.style[k];
            var m = /^--prim-([a-z][a-z0-9-]*)-\d+$/i.exec(prop);
            if (m && !seen[m[1]]) { seen[m[1]] = 1; palettesInCSS.push(m[1]); }
          }
        }
      }
    } catch (e) { /* sandboxed file:// — best effort */ }

    var undeclaredPalettes = palettesInCSS.filter(function (p) {
      return declaredKeys.indexOf(p) === -1;
    });

    var customRoleIds = customRoles.map(function (cr) { return cr && cr.id; }).filter(Boolean);

    return {
      projectId: id,
      schemaVersion: schemaVersion,
      targetSchema: MIGRATION_TARGET_SCHEMA,
      undeclaredPalettes: undeclaredPalettes,
      customRoleIds: customRoleIds,
      // customRoles get promoted at runtime — info only, not blocking.
      hasWork: (schemaVersion < MIGRATION_TARGET_SCHEMA)
            || (undeclaredPalettes.length > 0)
    };
  }

  function initMigrationBanner() {
    var $banner   = document.getElementById('migrateBanner');
    var $title    = document.getElementById('migrateBannerTitle');
    var $sub      = document.getElementById('migrateBannerSub');
    var $info     = document.getElementById('migrateBannerInfo');
    var $ack      = document.getElementById('migrateBannerAck');
    var $dismiss  = document.getElementById('migrateBannerDismiss');
    if (!$banner) return;

    var audit = runMigrationAuditInBrowser();
    if (!audit || !audit.hasWork) return;

    var ackd     = localStorage.getItem(migrationAckKey(audit.projectId)) === String(audit.targetSchema);
    var dismissd = sessionStorage.getItem(migrationDismissKey(audit.projectId)) === '1';
    if (ackd || dismissd) return;

    // Build subtitle from actionable items.
    var bits = [];
    if (audit.schemaVersion < audit.targetSchema) {
      bits.push('schema v' + audit.schemaVersion + ' → v' + audit.targetSchema);
    }
    if (audit.customRoleIds.length) {
      bits.push(audit.customRoleIds.length + ' custom role'
        + (audit.customRoleIds.length === 1 ? '' : 's')
        + ' (' + audit.customRoleIds.join(', ') + ') promoted to T1');
    }
    if (audit.undeclaredPalettes.length) {
      bits.push(audit.undeclaredPalettes.length + ' palette'
        + (audit.undeclaredPalettes.length === 1 ? '' : 's')
        + ' undeclared in config.paletteKeys');
    }
    $title.textContent = 'Project "' + audit.projectId + '" — migration available';
    $sub.textContent   = bits.join(' · ');

    $banner.hidden = false;

    $info.addEventListener('click', function () {
      // Open the audit script docs as a markdown blob in a new tab.
      // Falls back to a simple alert if the browser blocks Blob+open.
      var summary = '# Audit summary for "' + audit.projectId + '"\n\n'
        + '- schema: ' + audit.schemaVersion + ' → ' + audit.targetSchema + '\n'
        + '- custom roles promoted at runtime: ' + (audit.customRoleIds.join(', ') || 'none') + '\n'
        + '- undeclared palettes: ' + (audit.undeclaredPalettes.join(', ') || 'none') + '\n\n'
        + 'To finalize the migration on disk, run:\n\n'
        + '    pnpm audit:migration --bump\n\n'
        + 'This writes "schemaVersion": 2 to projects/' + audit.projectId + '/config.json. After that, this banner disappears for all users.';
      try {
        var blob = new Blob([summary], { type: 'text/markdown' });
        var url = URL.createObjectURL(blob);
        window.open(url, '_blank');
      } catch (e) { alert(summary); }
    });

    $ack.addEventListener('click', function () {
      localStorage.setItem(migrationAckKey(audit.projectId), String(audit.targetSchema));
      $banner.hidden = true;
    });

    $dismiss.addEventListener('click', function () {
      sessionStorage.setItem(migrationDismissKey(audit.projectId), '1');
      $banner.hidden = true;
    });
  }

  /* Phase 2: Draft-vs-HEAD conflict banner.
     Trigger: a loaded draft's stamped baseVersion differs from the
     project's current published version. That means someone (often
     "past me on another machine") republished while a draft was in
     progress. We don't auto-discard — user picks. */
  function initConflictBanner() {
    var $b       = document.getElementById('conflictBanner');
    var $sub     = document.getElementById('conflictBannerSub');
    var $keep    = document.getElementById('conflictBannerKeep');
    var $discard = document.getElementById('conflictBannerDiscard');
    if (!$b) return;

    var draftVer = State.draftBaseVersion || '';
    var headVer  = currentHeadVersion();
    // No draft, or draft predates Phase 2 (no stamp), or matches HEAD — nothing to warn about.
    if (!draftVer || !headVer || draftVer === headVer) return;

    $sub.textContent = 'Your unsaved draft is based on ' + draftVer
      + ', but this project was republished to ' + headVer
      + ' (likely from another browser or machine). Keep editing on top of ' + draftVer
      + ', or discard and load the new published baseline.';
    $b.hidden = false;

    $keep.addEventListener('click', function () {
      // Accept the new baseline implicitly on next save by re-stamping.
      State.draftBaseVersion = headVer;
      scheduleAutosave();
      $b.hidden = true;
    });

    $discard.addEventListener('click', function () {
      try { clearDraftFromStorage(); } catch (_e) {}
      // Reload to re-hydrate from disk/HEAD cleanly.
      try { window.__ev2BypassUnloadGuard = true; } catch (_e) {}
      window.location.reload();
    });
  }

  function getKnownProjects() {
    try { return JSON.parse(localStorage.getItem('dtf-known-projects') || '[]') || []; }
    catch (e) { return []; }
  }
  /* Refresh the localStorage known-projects cache from the canonical
     projects.json. When the user is GitHub-authenticated we go
     straight to the contents API (cache-busted) so a freshly-deleted
     or freshly-created project shows up the moment the commit lands,
     not after the Pages deploy + the static file's HTTP cache
     expire. Falls back to relative-path fetch on file:// when
     unauthenticated. Returns a Promise so the caller can show a
     loader and re-render on resolve. */
  function syncKnownProjectsFromIndex() {
    var user = getGhUser();
    var pat  = getGhPat();
    var ghReady = !!(user && pat);

    function applyList(list, source) {
      if (!Array.isArray(list)) return;
      try { localStorage.setItem('dtf-known-projects', JSON.stringify(list)); } catch (e) {}
      _projPanelLastSync = { at: Date.now(), source: source || 'cache' };
      if (typeof renderProjPanel === 'function' && $projPanel && !$projPanel.hasAttribute('hidden')) renderProjPanel();
      if (typeof syncProjLabel === 'function') syncProjLabel();
    }

    if (ghReady) {
      return ghFetch('/repos/' + user + '/' + GH_REPO_NAME + '/contents/projects.json?ref=main&_cb=' + Date.now())
        .then(function (idx) {
          var raw;
          try { raw = JSON.parse(decodeURIComponent(escape(atob((idx.content || '').replace(/\n/g,''))))); }
          catch (e) { throw new Error('Could not parse projects.json from fork'); }
          applyList(raw, 'github');
          return raw;
        });
    }

    // Unauthenticated fallback \u2014 try a few static paths.
    var candidates = ['../../projects.json', '/projects.json'];
    var i = 0;
    return new Promise(function (resolve, reject) {
      function tryNext() {
        if (i >= candidates.length) return reject(new Error('Couldn\u2019t reach projects.json'));
        fetch(candidates[i++] + (candidates[i-1].indexOf('?') === -1 ? '?_cb=' : '&_cb=') + Date.now(), { cache: 'no-store' })
          .then(function (r) { if (!r.ok) throw new Error('http ' + r.status); return r.json(); })
          .then(function (list) { applyList(list, 'http'); resolve(list); })
          .catch(tryNext);
      }
      tryNext();
    });
  }
  var _projPanelLastSync = { at: 0, source: 'cache' };
  var _projPanelLoading  = false;
  function projectName(id) {
    var list = getKnownProjects();
    var hit = list.find(function (p) { return p && p.id === id; });
    return (hit && (hit.name || hit.id)) || id || 'No project';
  }

  function initProjectWidget() {
    syncProjLabel();
    renderProjPanel();
    // Pull the canonical project list from projects.json so the
    // switcher matches the hub even on first visit. Async, best-
    // effort: a stale cache is fine to render against meanwhile.
    refreshProjectsList();

    // Make the entire "PROJECT" label area clickable, not just the
    // chevron pill, so the hit target matches the visual chip.
    var $projLabel = document.querySelector('.nav-project .nav-project-label');
    if ($projLabel) {
      $projLabel.style.cursor = 'pointer';
      $projLabel.addEventListener('click', function (e) {
        e.stopPropagation();
        $projBtn.click();
      });
    }

    $projBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var open = !$projPanel.hasAttribute('hidden') ? false : true;
      if (open) {
        $projPanel.removeAttribute('hidden');
        $projBtn.setAttribute('aria-expanded', 'true');
        renderProjPanel();
        // Fire a fresh fetch every time the dropdown opens so a
        // delete/create from another tab \u2014 or a manual GitHub edit \u2014
        // surfaces immediately instead of waiting on a page reload.
        refreshProjectsList();
      }
      else { $projPanel.setAttribute('hidden', ''); $projBtn.setAttribute('aria-expanded', 'false'); }
    });
    document.addEventListener('click', function (e) {
      if (!$projPanel.contains(e.target) && !$projBtn.contains(e.target)) {
        $projPanel.setAttribute('hidden', '');
        $projBtn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        $projPanel.setAttribute('hidden', '');
        $projBtn.setAttribute('aria-expanded', 'false');
      }
    });

    // Topbar icon-button actions for the active project.
    if ($projRenameBtn) {
      $projRenameBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = getActiveProjectId();
        if (!id) { if (window.ev2Toast) window.ev2Toast('No active project to rename', 'warn'); return; }
        attemptProjectRename(id);
      });
    }
    if ($projDeleteBtn) {
      $projDeleteBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = getActiveProjectId();
        if (!id) { if (window.ev2Toast) window.ev2Toast('No active project to delete', 'warn'); return; }
        attemptProjectDelete(id);
      });
    }
  }

  function syncProjLabel() {
    $projName.textContent = projectName(getActiveProjectId());
    // Mirror the active project onto outbound links so the components
    // gallery / tokens / frameworks pages keep the same project ctx.
    var pid = getActiveProjectId();
    var preview = document.getElementById('previewComponentsLink');
    if (preview && pid) {
      preview.setAttribute('href', '../components.html?project=' + encodeURIComponent(pid));
    }
  }

  function renderProjPanel() {
    var list = getKnownProjects();
    /* Filter to projects the signed-in user owns. A fork inherits
       projects.json wholesale from upstream, so without this every
       user sees Canada / Slate / writer-handhelds / Calicut / Pearl
       (the maintainer's projects) alongside their own. Same filter
       rule as the hub's fetchFromUserFork (demo/index.html): legacy
       configs with no owner are treated as belonging to whoever's
       fork they live in. */
    try {
      var ghUserLc = (getGhUser() || localStorage.getItem('dtf-gh-user') || localStorage.getItem('dtf-gh-owner') || '').toLowerCase();
      if (ghUserLc) {
        list = list.filter(function (p) {
          return !p || !p.owner || String(p.owner).toLowerCase() === ghUserLc;
        });
      }
    } catch (_e) {}
    var active = getActiveProjectId();
    if (_projPanelLoading && !list.length) {
      $projPanel.innerHTML = '<div class="ev2-proj-loading"><span class="ev2-proj-loading-spin" aria-hidden="true"></span>Loading projects\u2026</div>';
      return;
    }
    if (!list.length) {
      $projPanel.innerHTML = '<div class="ev2-proj-empty">No projects yet.<br><a href="../onboard.html" style="color:var(--brand-content-default,#286CE5)">Create your first project</a></div>';
      return;
    }
    var rowsHtml = list.map(function (p) {
      var current = p.id === active;
      // Slug (p.id) is a developer-facing identifier — useful for
      // copy/paste into URLs, CLI, file paths — but visually noisy
      // in a chooser where the user picks by name. Tucked into
      // title= so power users can still see it on hover, keyboard
      // tools, and screen readers.
      return '<div class="ev2-proj-row" role="option" aria-current="' + current + '" data-proj-id="' + p.id + '" tabindex="0" title="' + p.id + '">'
        + '<span class="ev2-proj-row-name">' + (p.name || p.id) + '</span>'
        + (current
            ? '<svg class="ev2-proj-row-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5l3.5 3.5L13 5"/></svg>'
            : '')
        + '</div>';
    }).join('');

    // Footer: live sync status + manual refresh button. Tells the
    // user WHERE the list came from (GitHub vs. cache) and lets
    // them re-fetch on demand without closing the dropdown.
    var statusText;
    if (_projPanelLoading) {
      statusText = '<span class=\"ev2-proj-loading-spin\" aria-hidden=\"true\" style=\"display:inline-block;vertical-align:-2px;margin-right:6px\"></span>Refreshing\u2026';
    } else if (_projPanelLastSync && _projPanelLastSync.at) {
      var when = relTime(_projPanelLastSync.at);
      var src  = _projPanelLastSync.source === 'github' ? 'GitHub' :
                 _projPanelLastSync.source === 'http'   ? 'projects.json' : 'cache';
      statusText = 'From ' + src + ' \u00b7 ' + when;
    } else {
      statusText = 'Showing cached list';
    }
    var footHtml = '<div class=\"ev2-proj-foot\">'
      + '<span class=\"ev2-proj-foot-status\">' + statusText + '</span>'
      + '<a class=\"ev2-proj-foot-new\" href=\"../onboard.html\" data-proj-new>+ New project</a>'
      + '<button class=\"ev2-proj-foot-refresh\" data-proj-refresh type=\"button\"' + (_projPanelLoading ? ' disabled' : '') + '>Refresh</button>'
      + '</div>';
    $projPanel.innerHTML = rowsHtml + footHtml;

    $projPanel.querySelectorAll('[data-proj-id]').forEach(function (row) {
      row.addEventListener('click', function () {
        var id = row.getAttribute('data-proj-id');
        if (id === getActiveProjectId()) {
          $projPanel.setAttribute('hidden', '');
          $projBtn.setAttribute('aria-expanded', 'false');
          return;
        }
        attemptProjectSwitch(id);
      });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
      });
    });
    var $refreshBtn = $projPanel.querySelector('[data-proj-refresh]');
    if ($refreshBtn) {
      $refreshBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        refreshProjectsList();
      });
    }
  }

  /* Fetch projects.json (GitHub-first when authed), show a spinner
     state in the panel, and re-render on resolve. Idempotent \u2014 a
     second call while one is in flight is a no-op. */
  function refreshProjectsList() {
    if (_projPanelLoading) return;
    _projPanelLoading = true;
    renderProjPanel();
    syncKnownProjectsFromIndex()
      .then(function () { _projPanelLoading = false; renderProjPanel(); })
      .catch(function () {
        _projPanelLoading = false;
        // Render anyway so the cached list reappears with the stale
        // footer message instead of an indefinite spinner.
        renderProjPanel();
        if (window.ev2Toast) window.ev2Toast('Couldn\u2019t refresh project list \u2014 showing cached', 'warn', 3000);
      });
  }

  function attemptProjectDelete(id) {
    var name = projectName(id);
    // Close the dropdown so the confirm modal isn't visually crowded.
    $projPanel.setAttribute('hidden', '');
    $projBtn.setAttribute('aria-expanded', 'false');
    var expectedUser = getGhUser();
    openModal({
      title: 'Delete \u201C' + name + '\u201D?',
      body: 'This removes the project\u2019s tokens, palette, and config from your GitHub fork and updates projects.json. '
        + 'The change is committed to your repository and cannot be undone from here.',
      confirmLabel: 'Delete project',
      cancelLabel: 'Keep project',
      kind: 'danger',
      input: {
        label: 'GitHub Personal Access Token',
        type: 'password',
        placeholder: 'ghp_\u2026',
        hint: 'Re-enter your PAT (\u201Crepo\u201D scope) to authorize this destructive change. '
          + 'Verified against your GitHub account before any files are removed.'
      },
      validate: function (pat) {
        pat = (pat || '').trim();
        if (!pat) return 'Token required to authorize delete.';
        // Temporarily swap PAT so ghFetch uses the just-entered one.
        // Restored on error so a wrong token doesn\u2019t clobber the
        // cached good one.
        var prevPat = getGhPat();
        localStorage.setItem('dtf-gh-pat', pat);
        return ghFetch('/user').then(function (u) {
          if (!u || !u.login) {
            if (prevPat) localStorage.setItem('dtf-gh-pat', prevPat); else localStorage.removeItem('dtf-gh-pat');
            throw new Error('GitHub didn\u2019t recognize that token.');
          }
          if (expectedUser && u.login !== expectedUser) {
            if (prevPat) localStorage.setItem('dtf-gh-pat', prevPat); else localStorage.removeItem('dtf-gh-pat');
            throw new Error('Token belongs to @' + u.login + ' but the project is on @' + expectedUser + '\u2019s fork.');
          }
          // PAT good \u2014 keep it cached (the user explicitly re-authorized).
          localStorage.setItem('dtf-gh-user', u.login);
        });
      },
      onConfirm: function () { performProjectDelete(id, name); }
    });
  }

  /* In-editor delete via GitHub API: enumerate every file under
     projects/<id>/ in the user\u2019s fork, mark them for removal in
     a single tree commit, and rewrite projects.json without the
     entry. After success, auto-switch to the next remaining
     project (or send the user back to the project hub when the
     fork has none left). */
  function performProjectDelete(id, name) {
    showBusy('Deleting \u201C' + name + '\u201D\u2026', 'Talking to GitHub. Don\u2019t close this tab.');
    ensureGhCredentials().then(function (cred) {
      var owner = cred.user;
      var branch = 'main';
      updateBusy(null, 'Enumerating project files\u2026');
      // 1. Get the current tree to enumerate files under projects/<id>/.
      return ghFetch('/repos/' + owner + '/' + GH_REPO_NAME + '/git/ref/heads/' + branch).then(function (ref) {
        return ghFetch('/repos/' + owner + '/' + GH_REPO_NAME + '/git/trees/' + ref.object.sha + '?recursive=1');
      }).then(function (tree) {
        var prefix = 'projects/' + id + '/';
        var doomed = (tree.tree || []).filter(function (n) {
          return n.type === 'blob' && n.path.indexOf(prefix) === 0;
        }).map(function (n) { return { path: n.path, delete: true }; });
        if (!doomed.length) throw new Error('Project folder not found in your fork \u2014 nothing to delete.');

        // 2. Fetch + rewrite projects.json (root index).
        return ghFetch('/repos/' + owner + '/' + GH_REPO_NAME + '/contents/projects.json?ref=' + branch).then(function (idx) {
          var listRaw;
          try { listRaw = JSON.parse(decodeURIComponent(escape(atob(idx.content.replace(/\n/g,''))))); }
          catch (e) { throw new Error('Could not parse projects.json from fork'); }
          var nextList = Array.isArray(listRaw) ? listRaw.filter(function (p) { return p && p.id !== id; }) : [];
          doomed.push({ path: 'projects.json', content: JSON.stringify(nextList, null, 2) + '\n' });
          updateBusy(null, 'Committing ' + doomed.length + ' file' + (doomed.length === 1 ? '' : 's') + ' to your fork\u2026');
          return ghMultiCommit(owner, doomed, 'project(' + id + '): delete via editor v2', branch).then(function () {
            // 3. Verify: re-read projects.json and confirm the
            // entry is actually gone before we switch projects.
            // The retry loop inside ghMultiCommit usually wins, but
            // if some other writer beat us we must NOT cheerfully
            // switch to a project whose folder might still exist.
            updateBusy(null, 'Verifying delete\u2026');
            return ghFetch('/repos/' + owner + '/' + GH_REPO_NAME + '/contents/projects.json?ref=' + branch + '&_cb=' + Date.now())
              .then(function (idx2) {
                var verifyList;
                try { verifyList = JSON.parse(decodeURIComponent(escape(atob(idx2.content.replace(/\n/g,''))))); }
                catch (e) { throw new Error('Delete commit landed but projects.json is unreadable.'); }
                var stillThere = Array.isArray(verifyList) && verifyList.some(function (p) { return p && p.id === id; });
                if (stillThere) throw new Error('Delete commit landed but projects.json still lists this project. Try again.');
                return verifyList;
              });
          });
        });
      }).then(function (nextList) {
        // 4. Success path — local cleanup + navigation.
        try { localStorage.setItem('dtf-known-projects', JSON.stringify(nextList)); } catch (e) {}
        try { localStorage.removeItem('ev2-draft-' + id); } catch (e) {}
        try { localStorage.removeItem(DRAFT_KEY + '--' + id); } catch (e) {}
        try { localStorage.removeItem('dtf-project-config-' + id); } catch (e) {}
        try { localStorage.removeItem('dtf-project-primitives-' + id); } catch (e) {}
        try { localStorage.removeItem('dtf-project-semantic-' + id); } catch (e) {}
        try { localStorage.removeItem('dtf-color-config-' + id); } catch (e) {}
        var wasActive = (getActiveProjectId() === id);
        updateBusy('Deleted \u201C' + name + '\u201D', wasActive ? 'Switching to next project\u2026' : 'Updating list\u2026');
        if (!nextList.length) {
          localStorage.removeItem('dtf-active-project');
          window.__ev2BypassUnloadGuard = true;
          setTimeout(function () { window.location.href = '../onboard.html'; }, 500);
          return;
        }
        if (wasActive) {
          var nextId = nextList[0].id;
          localStorage.setItem('dtf-active-project', nextId);
          // Hard reload to fully rebind state to the new project.
          setTimeout(function () { window.__ev2BypassUnloadGuard = true; window.location.href = 'index.html?project=' + encodeURIComponent(nextId); }, 500);
        } else {
          hideBusy();
          if (window.ev2Toast) window.ev2Toast('Deleted \u201C' + name + '\u201D', 'ok');
          renderProjPanel();
        }
      }).catch(function (err) {
        hideBusy();
        var msg = (err && err.message) ? err.message : String(err);
        if (window.ev2Toast) window.ev2Toast('Delete failed: ' + msg, 'err');
        // eslint-disable-next-line no-console
        console.error('[project-delete]', err);
      });
    }).catch(function () {
      hideBusy();
      if (window.ev2Toast) window.ev2Toast('GitHub authentication cancelled', 'warn');
    });
  }

  /* Rename a project's display name only (id/folder unchanged).
     Edits projects.json and projects/<id>/config.json in a single
     commit. Safe across in-flight publishes thanks to ghMultiCommit
     retry. */
  function attemptProjectRename(id) {
    var current = projectName(id);
    var next = window.prompt('Rename project\nNew name for \u201C' + current + '\u201D:', current);
    if (next == null) return; // user cancelled
    next = String(next).trim();
    if (!next) { if (window.ev2Toast) window.ev2Toast('Name cannot be empty', 'warn'); return; }
    if (next === current) return; // nothing to do
    if (next.length > 80) { if (window.ev2Toast) window.ev2Toast('Name too long (max 80 chars)', 'warn'); return; }
    performProjectRename(id, next);
  }

  function performProjectRename(id, newName) {
    showBusy('Renaming to \u201C' + newName + '\u201D\u2026', 'Talking to GitHub. Don\u2019t close this tab.');
    ensureGhCredentials().then(function (cred) {
      var owner = cred.user;
      var branch = 'main';
      // Pull both files we need to rewrite in parallel.
      return Promise.all([
        ghFetch('/repos/' + owner + '/' + GH_REPO_NAME + '/contents/projects.json?ref=' + branch),
        ghFetch('/repos/' + owner + '/' + GH_REPO_NAME + '/contents/projects/' + id + '/config.json?ref=' + branch)
          .catch(function () { return null; }) // config.json may not exist on legacy projects
      ]).then(function (results) {
        var idxRes = results[0];
        var cfgRes = results[1];
        var listRaw;
        try { listRaw = JSON.parse(decodeURIComponent(escape(atob(idxRes.content.replace(/\n/g,''))))); }
        catch (e) { throw new Error('Could not parse projects.json from fork'); }
        var nextList = Array.isArray(listRaw) ? listRaw.map(function (p) {
          if (p && p.id === id) { return Object.assign({}, p, { name: newName }); }
          return p;
        }) : [];
        var files = [
          { path: 'projects.json', content: JSON.stringify(nextList, null, 2) + '\n' }
        ];
        if (cfgRes && cfgRes.content) {
          var cfg;
          try { cfg = JSON.parse(decodeURIComponent(escape(atob(cfgRes.content.replace(/\n/g,''))))); }
          catch (e) { cfg = null; }
          if (cfg && typeof cfg === 'object') {
            cfg.name = newName;
            files.push({ path: 'projects/' + id + '/config.json', content: JSON.stringify(cfg, null, 2) + '\n' });
          }
        }
        return ghMultiCommit(owner, files, 'project(' + id + '): rename to "' + newName + '"', branch)
          .then(function () { return nextList; });
      }).then(function (nextList) {
        try { localStorage.setItem('dtf-known-projects', JSON.stringify(nextList)); } catch (e) {}
        hideBusy();
        if (window.ev2Toast) window.ev2Toast('Renamed to \u201C' + newName + '\u201D', 'ok');
        syncProjLabel();
        renderProjPanel();
      }).catch(function (err) {
        hideBusy();
        var msg = (err && err.message) ? err.message : String(err);
        if (window.ev2Toast) window.ev2Toast('Rename failed: ' + msg, 'err');
        // eslint-disable-next-line no-console
        console.error('[project-rename]', err);
      });
    }).catch(function () {
      hideBusy();
      if (window.ev2Toast) window.ev2Toast('GitHub authentication cancelled', 'warn');
    });
  }

  function attemptProjectSwitch(newId) {
    var pending = totalChanges();
    if (pending === 0) { performProjectSwitch(newId); return; }
    openModal({
      title: 'Switch project with unsaved changes?',
      body: 'You have ' + pending + ' pending change' + (pending === 1 ? '' : 's')
        + ' on ' + projectName(getActiveProjectId()) + '. Switching to '
        + projectName(newId) + ' will discard your local draft for the current project.',
      confirmLabel: 'Discard & switch',
      cancelLabel: 'Stay here',
      kind: 'danger',
      onConfirm: function () {
        clearDraftFromStorage();
        performProjectSwitch(newId);
      }
    });
  }

  function performProjectSwitch(newId) {
    localStorage.setItem('dtf-active-project', newId);
    // Reload so the new project's tokens / config can be picked up cleanly.
    // The user already confirmed via the in-app modal (if there were
    // unsaved changes) — bypass the beforeunload prompt so the native
    // "Changes may not be saved" dialog doesn't double up on top.
    window.__ev2BypassUnloadGuard = true;
    window.location.reload();
  }

  /* ══════════════════════════════════════════════════════
     Modal
     ══════════════════════════════════════════════════════ */
  var $modal = document.getElementById('ev2Modal');
  var $modalTitle = document.getElementById('ev2ModalTitle');
  var $modalBody = document.getElementById('ev2ModalBody');
  var $modalConfirm = $modal.querySelector('[data-modal-action="confirm"]');
  /* Scope to the footer button \u2014 the close-X also has
     data-modal-action="cancel", so a plain querySelector matches
     it first and openModal would replace the \u00d7 glyph with the
     cancelLabel text. Use .ev2-modal-actions to skip the close-X. */
  var $modalCancel  = $modal.querySelector('.ev2-modal-actions [data-modal-action="cancel"]');
  var $modalField    = document.getElementById('ev2ModalField');
  var $modalInput    = document.getElementById('ev2ModalInput');
  var $modalInputLbl = document.getElementById('ev2ModalInputLabel');
  var $modalInputHint = document.getElementById('ev2ModalInputHint');
  var modalOnConfirm = null;
  var modalValidate  = null; // (value) -> string err or '' / null

  function openModal(opts) {
    $modalTitle.textContent = opts.title || 'Confirm';
    $modalBody.textContent = opts.body || '';
    // Body supports \n by collapsing into <br> via white-space:pre-line
    $modalBody.style.whiteSpace = (opts.body && opts.body.indexOf('\n') !== -1) ? 'pre-line' : '';
    $modalConfirm.textContent = opts.confirmLabel || 'Confirm';
    $modalCancel.textContent = opts.cancelLabel || 'Cancel';
    $modalConfirm.classList.toggle('ev2-modal-btn-danger', opts.kind === 'danger');
    $modalConfirm.classList.toggle('ev2-modal-btn-primary', opts.kind !== 'danger');
    modalOnConfirm = opts.onConfirm || null;
    modalValidate  = opts.validate  || null;

    // Optional input field (used by destructive ops that re-prompt
    // for PAT inline instead of via window.prompt).
    if (opts.input) {
      $modalField.hidden = false;
      $modalInputLbl.textContent = opts.input.label || 'Value';
      $modalInput.type = opts.input.type || 'text';
      $modalInput.value = '';
      $modalInput.placeholder = opts.input.placeholder || '';
      $modalInput.removeAttribute('aria-invalid');
      if (opts.input.hint) {
        $modalInputHint.textContent = opts.input.hint;
        $modalInputHint.hidden = false;
        $modalInputHint.removeAttribute('aria-invalid');
      } else {
        $modalInputHint.hidden = true;
      }
    } else {
      $modalField.hidden = true;
      $modalInput.value = '';
    }

    $modal.removeAttribute('hidden');
    setTimeout(function () {
      if (opts.input) $modalInput.focus();
      else $modalConfirm.focus();
    }, 10);
  }
  function closeModal() {
    $modal.setAttribute('hidden', '');
    modalOnConfirm = null;
    modalValidate  = null;
    $modalField.hidden = true;
    $modalInput.value = '';
    $modalInput.removeAttribute('aria-invalid');
    $modalInputHint.removeAttribute('aria-invalid');
  }
  function setModalInputError(msg) {
    $modalInput.setAttribute('aria-invalid', 'true');
    $modalInputHint.textContent = msg;
    $modalInputHint.setAttribute('aria-invalid', 'true');
    $modalInputHint.hidden = false;
    $modalInput.focus();
    $modalInput.select();
  }
  function setModalBusy(busy, label) {
    $modalConfirm.disabled = !!busy;
    $modalCancel.disabled  = !!busy;
    if (busy && label) $modalConfirm.textContent = label;
  }

  /* Busy overlay — blocks all interaction (and signals "don't
     navigate") while a long-running GH op is in flight. */
  var $busy      = document.getElementById('ev2Busy');
  var $busyTitle = document.getElementById('ev2BusyTitle');
  var $busySub   = document.getElementById('ev2BusySub');
  function showBusy(title, sub) {
    if (!$busy) return;
    if ($busyTitle) $busyTitle.textContent = title || 'Working\u2026';
    if ($busySub)   $busySub.textContent   = sub   || 'Please don\u2019t close this tab.';
    $busy.removeAttribute('hidden');
  }
  function updateBusy(title, sub) {
    if (!$busy || $busy.hasAttribute('hidden')) return;
    if (title && $busyTitle) $busyTitle.textContent = title;
    if (sub   && $busySub)   $busySub.textContent   = sub;
  }
  function hideBusy() { if ($busy) $busy.setAttribute('hidden', ''); }
  $modalConfirm.addEventListener('click', function () {
    var fn = modalOnConfirm;
    var validate = modalValidate;
    var value = $modalField.hidden ? undefined : $modalInput.value;

    // No input \u2014 classic confirm flow.
    if (!validate) {
      closeModal();
      if (fn) fn(value);
      return;
    }

    // Inline validate (may return Promise). On error we keep the
    // dialog open and show a hint instead of closing+toasting.
    var result;
    try { result = validate(value); }
    catch (e) { setModalInputError((e && e.message) || String(e)); return; }

    if (result && typeof result.then === 'function') {
      setModalBusy(true, 'Verifying\u2026');
      result.then(function () {
        setModalBusy(false);
        closeModal();
        if (fn) fn(value);
      }).catch(function (err) {
        setModalBusy(false);
        setModalInputError((err && err.message) || String(err) || 'Invalid value');
      });
      return;
    }

    if (result) { setModalInputError(result); return; }
    closeModal();
    if (fn) fn(value);
  });
  // Submit-on-Enter when the input is focused (the input lives
  // outside any <form> so we wire this explicitly).
  $modalInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') { e.preventDefault(); $modalConfirm.click(); }
  });
  $modalCancel.addEventListener('click', closeModal);
  // Top-right close (×) and any other [data-modal-action="cancel"]
  // inside the modal also dismiss it. Without this, the X glyph was
  // a dead button — only the footer Cancel actually closed the dialog.
  $modal.addEventListener('click', function (e) {
    var t = e.target.closest('[data-modal-action="cancel"]');
    if (t && $modal.contains(t)) closeModal();
  });
  $modal.querySelector('.ev2-modal-backdrop').addEventListener('click', closeModal);
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !$modal.hasAttribute('hidden')) closeModal();
  });

  // Boot now — all helpers + DOM refs are in scope.
  boot();

  /* ── Portal tooltip ───────────────────────────────────
     CSS-only [data-tip] tooltips get clipped by any ancestor with
     overflow:auto/hidden (workspace scroll container, intent card, etc.).
     This portal renders into <body> with position:fixed so it always
     sits on top of every container. */
  (function initTipPortal() {
    var tip = document.createElement('div');
    tip.className = 'ev2-tip-portal';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
    document.documentElement.classList.add('ev2-tip-js');

    var current = null;
    function hide() {
      tip.removeAttribute('data-show');
      current = null;
    }
    function show(el) {
      var text = el.getAttribute('data-tip');
      if (!text) return;
      current = el;
      tip.textContent = text;
      tip.setAttribute('data-show', '1');
      // Force layout to read final size after content swap
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var r = el.getBoundingClientRect();
      var vw = window.innerWidth, vh = window.innerHeight;
      var cx = r.left + r.width / 2;
      /* Prefer below the trigger so tips never cover the swatch /
         ratio they describe. Flip above only when there isn't room. */
      var place = 'bottom';
      var top = r.bottom + 10;
      if (top + th > vh - 8) { place = 'top'; top = r.top - th - 10; }
      var left = Math.round(cx - tw / 2);
      left = Math.max(8, Math.min(vw - tw - 8, left));
      tip.style.top = Math.round(top) + 'px';
      tip.style.left = left + 'px';
      tip.setAttribute('data-place', place);
      // Position the arrow horizontally relative to the anchor
      var arrowX = Math.max(10, Math.min(tw - 10, cx - left));
      tip.style.setProperty('--ev2-tip-arrow', arrowX + 'px');
      // Override the ::after left to match arrowX
      tip.style.cssText = tip.style.cssText; // no-op; arrow position via inline style below
      tip.style.setProperty('--ev2-arrow-x', arrowX + 'px');
    }

    function findTipAncestor(node) {
      while (node && node !== document.body) {
        if (node.nodeType === 1 && node.hasAttribute && node.hasAttribute('data-tip')) return node;
        node = node.parentNode;
      }
      return null;
    }

    document.addEventListener('mouseover', function (e) {
      var el = findTipAncestor(e.target);
      if (el && el !== current) show(el);
    });
    document.addEventListener('mouseout', function (e) {
      if (!current) return;
      var to = e.relatedTarget;
      if (to && (to === current || (current.contains && current.contains(to)))) return;
      hide();
    });
    document.addEventListener('focusin', function (e) {
      var el = findTipAncestor(e.target);
      if (el) show(el);
    });
    document.addEventListener('focusout', function () { hide(); });
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
  })();

  /* ── T2 row bulk-op dispatcher ─────────────────────────
     Chips inside the expanded Property Card (pcActionsHTML) carry
     data-pc-bulk; this dispatcher routes them to the right helper.
     Replaces the earlier overflow-menu popover (which paid for one
     extra resting-state button per detached row); now the bulk ops
     are inline beneath the step ladder and only exist when the
     designer has opened the card to think about the row. */
  function handleT2RowBulk(itemBtn) {
    var key       = itemBtn.getAttribute('data-pc-bulk');
    var surfaceId = itemBtn.getAttribute('data-surface');
    var propId    = itemBtn.getAttribute('data-prop');
    var mode      = State.editingMode;
    if (key === 'reset-family') bulkResetFamily(surfaceId, propId, mode);
  }

  /* ── (removed) T2 row overflow menu ───────────────────
     The old ⋯ popover was deleted in favor of pcActionsHTML's
     inline action chips. handleT2RowBulk above is the only piece
     that survived because the inline chips reuse data-pc-bulk. */

  /* ── WCAG sentinel popover ──────────────────────────────
     Click a .ev2-pc-wcag chip on a Property Card → opens a click-
     stable popover with: mini preview of the failing pair (text-on-
     bg for content, border-on-bg for edge), the plain-language WHY
     (re-uses wcagTipText), and ONE suggested step + projected ratio
     + Apply button (writes through setT2Step). Click outside or Esc
     to close. The hover tooltip on the same chip stays as the quick
     scan; click upgrades to the full panel. */
  (function initWcagPopover() {
    var pop = document.createElement('div');
    pop.className = 'ev2-wcag-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Contrast details and suggestion');
    document.body.appendChild(pop);
    var openOn = null; // the chip currently driving the popover
    var openedAt = 0;

    function close() {
      pop.removeAttribute('data-show');
      pop.innerHTML = '';
      openOn = null;
    }

    function renderPreviewHTML(sent, sug, tokenName, propId) {
      // Contextualised previews: each prop family gets a treatment
      // that matches what the token actually paints in product UI,
      // so the designer reads the popover as "this is the thing"
      // not "this is a generic rectangle".
      //   - ct-* (text)         \u2192 the real purpose copy at the right
      //                            size/weight (heading, body, meta,
      //                            caption) painted on the baseline bg.
      //   - cm-outline trio     \u2192 a pill-shaped button outlined in
      //                            the failing color (component-like).
      //   - surface outline     \u2192 a small card with stacked inner
      //                            bars + 2px border (region-like).
      // Border thickness bumped to 2px in both edge cases so the
      // failing color is actually visible at thumbnail scale (1px
      // borders disappeared in the 42px preview boxes).
      var bg = sent.baselineHex;
      var curHex = pop.__cellHex || '#000';
      var sugHex = sug ? sug.hex : null;
      function pickFg(hex) {
        return contrastRatio('#000000', hex) >= contrastRatio('#FFFFFF', hex) ? '#000000' : '#FFFFFF';
      }
      var arrow = '<div class="ev2-wcag-pop-arrow" aria-hidden="true">\u2192</div>';

      // ---- T1 derived tokens (border / separator / on-component /
      //       on-container) \u2014 render in the actual role-tinted
      //       setting so the designer reads "this border on THIS
      //       role's container" instead of "this border on a
      //       generic surface card". Falls through to the legacy
      //       branches below for T2 and T1 levers. ----
      var t1Ctx = pop.__t1Ctx;
      if (t1Ctx && propId && propId.indexOf('t1d:') === 0) {
        var derivedKind = t1Ctx.derivedId;
        // Border on the role's container, with a real heading + body
        // line painted in on-container. 2px so the edge reads.
        if (derivedKind === 'border') {
          function borderCard(borderHex) {
            return '<div class="ev2-wcag-pop-prev-box" style="background:' + t1Ctx.roleContainerHex + ';border:2px solid ' + borderHex + ';border-radius:6px;padding:9px 11px;display:flex;flex-direction:column;gap:4px;align-items:stretch;justify-content:center;color:' + t1Ctx.onContainerHex + '">'
              + '<span style="font-size:11px;font-weight:700;line-height:1.1">Container heading</span>'
              + '<span style="font-size:10px;font-weight:500;opacity:.85;line-height:1.2">Body text inside the container.</span>'
            + '</div>';
          }
          return borderCard(curHex) + (sug ? arrow + borderCard(sugHex) : '');
        }
        // Separator: two stacked rows on the role container, divided
        // by a 1px line in the separator color.
        if (derivedKind === 'separator') {
          function sepCard(sepHex) {
            var row = '<div style="padding:5px 0;font-size:10px;font-weight:500;color:' + t1Ctx.onContainerHex + ';line-height:1.2">List item</div>';
            return '<div class="ev2-wcag-pop-prev-box" style="background:' + t1Ctx.roleContainerHex + ';border-radius:6px;padding:4px 11px;display:flex;flex-direction:column;align-items:stretch;justify-content:center">'
              + row
              + '<div style="height:1px;background:' + sepHex + '" aria-hidden="true"></div>'
              + row
              + '<div style="height:1px;background:' + sepHex + '" aria-hidden="true"></div>'
              + row
            + '</div>';
          }
          return sepCard(curHex) + (sug ? arrow + sepCard(sugHex) : '');
        }
        // On-component: a real role-tinted pill (button) carrying
        // the on-component text. The fill is the role's fill hex.
        if (derivedKind === 'onComponent') {
          function ocPill(textHex) {
            return '<div class="ev2-wcag-pop-prev-box" style="background:' + t1Ctx.roleFillHex + ';color:' + textHex + ';padding:8px 16px;border-radius:999px;min-height:0;font-size:11px;font-weight:600;justify-content:center">Button</div>';
          }
          return ocPill(curHex) + (sug ? arrow + ocPill(sugHex) : '');
        }
        // On-container: a real role-tinted card (alert) carrying a
        // small heading + body line in the on-container hex.
        if (derivedKind === 'onContainer') {
          function occBox(textHex) {
            return '<div class="ev2-wcag-pop-prev-box" style="background:' + t1Ctx.roleContainerHex + ';color:' + textHex + ';padding:8px 12px;border-radius:6px;min-height:0;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;gap:2px;text-align:left">'
              + '<span style="font-size:11px;font-weight:700;line-height:1.1">Heads up</span>'
              + '<span style="font-size:10px;font-weight:500;line-height:1.2">Body copy inside the container.</span>'
            + '</div>';
          }
          return occBox(curHex) + (sug ? arrow + occBox(sugHex) : '');
        }
      }

      // ---- Fill intent (T1 fill lever) ----
      // Role color paints the BG; on-component (white/black) is
      // the legible text the button would carry in real UI.
      if (sent.intent === 'fill') {
        function fillPill(fillHex) {
          var onC = (contrastRatio(fillHex, '#FFFFFF') >= contrastRatio(fillHex, '#0A0A0A')) ? '#FFFFFF' : '#0A0A0A';
          return '<div class="ev2-wcag-pop-prev-box" style="background:' + fillHex + ';color:' + onC + ';padding:8px 16px;border-radius:999px;min-height:0;font-size:11px;font-weight:600;justify-content:center">Button</div>';
        }
        return fillPill(curHex) + (sug ? arrow + fillPill(sugHex) : '');
      }

      // ---- Container intent (T1 container lever) ----
      // Container hex paints the BG; the auto-derived on-container
      // is what real alerts/banners use for body copy.
      if (sent.intent === 'container') {
        function containerChip(contHex) {
          var onC = (contrastRatio(contHex, '#FFFFFF') >= contrastRatio(contHex, '#0A0A0A')) ? '#FFFFFF' : '#0A0A0A';
          return '<div class="ev2-wcag-pop-prev-box" style="background:' + contHex + ';color:' + onC + ';padding:8px 12px;border-radius:6px;min-height:0;font-size:11px;font-weight:500;text-align:left;justify-content:flex-start">Container body</div>';
        }
        return containerChip(curHex) + (sug ? arrow + containerChip(sugHex) : '');
      }

      // ---- Text intent (content tokens) ----
      if (sent.intent === 'text') {
        var sample, size, weight;
        if (propId === 'ct-strong')      { sample = 'Section heading';     size = '17px'; weight = 700; }
        else if (propId === 'ct-default'){ sample = 'Body paragraph reads here.'; size = '13px'; weight = 500; }
        else if (propId === 'ct-subtle') { sample = 'Metadata \u00b7 2 min ago'; size = '12px'; weight = 500; }
        else if (propId === 'ct-faint')  { sample = 'Helper caption text'; size = '11px'; weight = 500; }
        else                              { sample = sent.large ? 'Aa' : 'Body text'; size = '13px'; weight = 500; }
        function txtBox(fg) {
          return '<div class="ev2-wcag-pop-prev-box" style="background:' + bg + ';padding:10px 12px;justify-content:flex-start;text-align:left">'
            + '<span style="color:' + fg + ';font-size:' + size + ';font-weight:' + weight + ';line-height:1.3">' + sample + '</span>'
          + '</div>';
        }
        return txtBox(curHex) + (sug ? arrow + txtBox(sugHex) : '');
      }

      // ---- Edge intent (border tokens) ----
      var isCmEdge = propId === 'cm-outline' || propId === 'cm-outline-hover' || propId === 'cm-outline-pressed';
      var innerFg = pickFg(bg);
      if (isCmEdge) {
        // Pill shape \u2014 reads as a button outline. bg here is cm-bg
        // for the matching state.
        function pill(borderHex) {
          return '<div class="ev2-wcag-pop-prev-box" style="background:' + bg + ';border:2px solid ' + borderHex + ';border-radius:999px;padding:8px 16px;min-height:0;font-size:11px;font-weight:600;color:' + innerFg + '">Button</div>';
        }
        return pill(curHex) + (sug ? arrow + pill(sugHex) : '');
      }
      // Surface outline \u2014 card with two faint inner bars so the
      // border has something to outline. 2px so it reads at scale.
      function card(borderHex) {
        return '<div class="ev2-wcag-pop-prev-box" style="background:' + bg + ';border:2px solid ' + borderHex + ';padding:8px;display:flex;flex-direction:column;gap:5px;align-items:stretch;justify-content:center">'
          + '<div style="height:5px;border-radius:2px;background:' + innerFg + ';opacity:.45;width:70%"></div>'
          + '<div style="height:5px;border-radius:2px;background:' + innerFg + ';opacity:.22;width:50%"></div>'
        + '</div>';
      }
      return card(curHex) + (sug ? arrow + card(sugHex) : '');
    }

    function open(chip) {
      var card = chip.closest('.ev2-pc');
      if (!card) return;
      var tier      = card.getAttribute('data-pc-tier') || 't2';
      var mode      = State.editingMode;
      var sent, sug, tokenName, applyAttrs, propIdHint = null, flashProp = null;
      if (tier === 't1') {
        var roleId  = card.getAttribute('data-pc-role');
        var derivedId = card.getAttribute('data-pc-derived');
        if (derivedId) {
          // Build sentinel + suggestion for a T1 derived card.
          var base = t1DerivedBaseline(roleId, derivedId, mode);
          var curStep = t1DerivedStep(roleId, derivedId, mode);
          var jr = t1DerivedJudgeStep(roleId, derivedId, mode, curStep);
          sent = {
            intent: base.intent, large: base.large,
            baselineHex: base.hex, baseline: base.token,
            ratio: jr.ratio, judge: jr.judge
          };
          // Suggestion: walk the allowed set, pick the candidate
          // with the highest worst-state contrast that PASSES AA.
          // For onComponent (binary white/black + optional palette
          // steps), fall back to the BETTER worst-state candidate
          // even when nothing passes \u2014 the popover labels it as
          // "Best available" so the user sees an improvement-without-
          // victory and the deeper fix (move the fill step) reads
          // explicitly. For non-onComponent derived levers, walk
          // the standard ladder both directions and take the first
          // passing step.
          (function () {
            if (jr.judge.pass) { sug = null; return; }
            if (derivedId === 'onComponent') {
              var allowed = onComponentAllowedSteps(roleId, mode);
              var best = null;
              for (var i = 0; i < allowed.length; i++) {
                if (allowed[i] === curStep) continue;
                var j = t1DerivedJudgeStep(roleId, derivedId, mode, allowed[i]);
                if (!best || j.ratio > best.ratio) {
                  best = { step: allowed[i], hex: onComponentHexFor(roleId, allowed[i]), ratio: j.ratio, judge: j.judge };
                }
              }
              // Only surface if the alternative actually helps
              // (\u2265 +0.3:1) \u2014 otherwise noise.
              if (best && best.ratio >= jr.ratio + 0.3) sug = best;
              else sug = null;
              return;
            }
            var steps = ALL_STEPS;
            var curIdx = steps.indexOf(curStep);
            function judgeAt(idx) { return t1DerivedJudgeStep(roleId, derivedId, mode, steps[idx]); }
            function packAt(idx, j) {
              return { step: steps[idx], hex: ladderFor(roleId)[steps[idx]], ratio: j.ratio, judge: j.judge };
            }
            var pick = null;
            for (var d = 1; d < steps.length; d++) {
              var fwd = curIdx + d, bwd = curIdx - d;
              var rF = (fwd < steps.length) ? (function () { var j = judgeAt(fwd); return j.judge.pass ? packAt(fwd, j) : null; })() : null;
              var rB = (bwd >= 0)            ? (function () { var j = judgeAt(bwd); return j.judge.pass ? packAt(bwd, j) : null; })() : null;
              if (rF || rB) { pick = (rF && rB) ? (rF.ratio >= rB.ratio ? rF : rB) : (rF || rB); break; }
            }
            sug = pick;
          })();
          tokenName = t1DerivedTokenName(roleId, derivedId);
          pop.__cellHex = t1DerivedHex(roleId, derivedId, mode);
          // Stash extra context so renderPreviewHTML can render the
          // derived token in its role-tinted setting (border on the
          // role container, on-component text on the role fill,
          // etc.) instead of falling back to abstract surface chrome.
          var roleLadder = ladderFor(roleId);
          var t1cur = State.t1[mode][roleId];
          pop.__t1Ctx = {
            derivedId: derivedId,
            roleFillHex:      roleLadder[t1cur.fill]      || '#000',
            roleContentHex:   roleLadder[t1cur.content]   || '#000',
            roleContainerHex: roleLadder[t1cur.container] || '#fff',
            onComponentHex:   onComponentColor(roleId, mode),
            onContainerHex:   onContainerColor(roleId, mode)
          };
          propIdHint = 't1d:' + derivedId;
          applyAttrs = ' data-pc-wcag-tier="t1d" data-pc-wcag-role="' + roleId + '" data-pc-wcag-derived="' + derivedId + '"';
        } else {
          var leverId = card.getAttribute('data-pc-lever');
          sent = t1Sentinel(roleId, leverId, mode);
          if (!sent) return;
          sug  = t1SuggestStep(roleId, leverId, mode);
          tokenName = t1TokenName(roleId, leverId);
          pop.__cellHex = t1HexFor(roleId, leverId, mode);
          pop.__t1Ctx = null;
          applyAttrs = ' data-pc-wcag-tier="t1" data-pc-wcag-role="' + roleId + '" data-pc-wcag-lever="' + leverId + '"';
        }
      } else {
        var surfaceId = card.getAttribute('data-pc-surface');
        var propId    = card.getAttribute('data-pc-prop');
        sent = t2Sentinel(surfaceId, propId, mode);
        if (!sent) return;
        sug  = t2SuggestStep(surfaceId, propId, mode);
        tokenName = '--surface-' + surfaceId + '-' + propId;
        pop.__cellHex = t2HexFor(surfaceId, propId, mode);
        applyAttrs = ' data-pc-wcag-tier="t2" data-surface="' + surfaceId + '" data-prop="' + propId + '"';
        propIdHint = propId;
        flashProp  = propId;
      }

      // header chip mirrors the chip style
      var grade = chip.getAttribute('data-grade') || 'fail';
      var sym = grade === 'edge-soft' ? '\u24D8' : (sent.judge.pass ? '\u2713' : '\u26A0');
      var headerChip = '<span class="ev2-wcag-pop-chip" data-grade="' + grade + '">' + sym + ' ' + sent.ratio.toFixed(2) + ':1</span>';

      var why = wcagTipText(sent, tokenName);

      var sugBlock = '';
      if (sent.judge.pass) {
        // Already passing \u2014 no fix to suggest. Don't lie with the
        // empty-fallback copy that pretends no step works.
        sugBlock = '<div class="ev2-wcag-pop-fix ev2-wcag-pop-fix-empty">Looks good. No change needed.</div>';
      } else if (sug) {
        var sugPasses = !!(sug.judge && sug.judge.pass);
        var sugGrade  = sugPasses ? (sug.judge.grade === 'AAA' ? 'aaa' : (sent.large ? 'aa-large' : 'aa')) : 'fail';
        var sugTitle  = sugPasses ? 'Try this' : 'Closest we can get';
        var sugSym    = sugPasses ? '\u2713' : '\u26A0';
        // onComponent suggestions that don't pass mean BOTH white +
        // black fail against the worst fill state \u2014 the real fix
        // is to move the fill step, not flip the on-component pick.
        // One sentence, no jargon.
        var rootCauseNote = '';
        if (!sugPasses && propIdHint === 't1d:onComponent') {
          rootCauseNote = '<div class="ev2-wcag-pop-fix-note">'
            + 'The fill itself is too intense for readable text. Soften it (lighter in Light mode, darker in Dark mode) to fix this properly.'
          + '</div>';
        }
        sugBlock =
          '<div class="ev2-wcag-pop-fix"' + (sugPasses ? '' : ' data-soft="1"') + '>'
          + '<div class="ev2-wcag-pop-fix-head">'
            + '<span class="ev2-wcag-pop-fix-title">' + sugTitle + '</span>'
            + '<span class="ev2-wcag-pop-chip" data-grade="' + sugGrade + '">' + sugSym + ' ' + sug.ratio.toFixed(2) + ':1</span>'
          + '</div>'
          + '<div class="ev2-wcag-pop-fix-body">'
            + '<span class="ev2-wcag-pop-sw" style="background:' + sug.hex + '"></span>'
            + '<span class="ev2-wcag-pop-fix-txt">Step <strong>' + sug.step + '</strong> \u00b7 ' + sug.hex.toUpperCase() + '</span>'
            + '<button type="button" class="ev2-wcag-pop-apply" data-pc-wcag-apply' + applyAttrs + ' data-step="' + sug.step + '">Apply</button>'
          + '</div>'
          + rootCauseNote
        + '</div>';
      } else if (propIdHint === 't1d:onComponent') {
        // Both white and black tested; neither improves materially.
        sugBlock = '<div class="ev2-wcag-pop-fix ev2-wcag-pop-fix-empty">'
          + 'No text color works here. The fill itself is too intense \u2014 soften it (lighter in Light mode, darker in Dark mode) to fix.'
        + '</div>';
      } else {
        sugBlock = '<div class="ev2-wcag-pop-fix ev2-wcag-pop-fix-empty">No step in this palette works. Try editing the underlying color instead.</div>';
      }

      var edgeNote = '';

      pop.innerHTML =
          '<div class="ev2-wcag-pop-head">'
            + '<div class="ev2-wcag-pop-name"><code>' + tokenName + '</code></div>'
            + headerChip
            + '<button type="button" class="ev2-wcag-pop-close" data-pc-wcag-close aria-label="Close">\u00D7</button>'
          + '</div>'
          + '<div class="ev2-wcag-pop-prev" aria-label="Preview">'
            + renderPreviewHTML(sent, sug, tokenName, propIdHint)
          + '</div>'
          + '<div class="ev2-wcag-pop-why">' + why + '</div>'
          + sugBlock
          + edgeNote;

      // Position below the chip (flip above if no room).
      pop.setAttribute('data-show', '1');
      var r = chip.getBoundingClientRect();
      var pw = pop.offsetWidth, ph = pop.offsetHeight;
      var vw = window.innerWidth, vh = window.innerHeight;
      var top = r.bottom + 8;
      if (top + ph > vh - 8) top = Math.max(8, r.top - ph - 8);
      var left = Math.round(r.left + r.width / 2 - pw / 2);
      left = Math.max(8, Math.min(vw - pw - 8, left));
      pop.style.top  = Math.round(top) + 'px';
      pop.style.left = left + 'px';
      openOn = chip;
      openedAt = Date.now();
      // Hide the hover tooltip so we don't show two overlapping
      // descriptions of the same chip.
      var tip = document.querySelector('.ev2-tip-portal');
      if (tip) tip.removeAttribute('data-show');
      // Point the preview canvas at the same prop so the designer
      // sees WHERE the failing token lives on real UI. T1 has no
      // canvas zone mapping yet, so skip the flash there.
      if (flashProp) pushPvFlash(flashProp);
    }

    document.addEventListener('click', function (e) {
      var closeBtn = e.target.closest && e.target.closest('[data-pc-wcag-close]');
      if (closeBtn) { close(); return; }
      var applyBtn = e.target.closest && e.target.closest('[data-pc-wcag-apply]');
      if (applyBtn) {
        var step    = applyBtn.getAttribute('data-step');
        var btnTier = applyBtn.getAttribute('data-pc-wcag-tier') || 't2';
        close();
        if (btnTier === 't1') {
          var rId = applyBtn.getAttribute('data-pc-wcag-role');
          var lId = applyBtn.getAttribute('data-pc-wcag-lever');
          setT1Lever(rId, lId, State.editingMode, step);
        } else if (btnTier === 't1d') {
          var rId2 = applyBtn.getAttribute('data-pc-wcag-role');
          var dId  = applyBtn.getAttribute('data-pc-wcag-derived');
          setT1Derived(rId2, dId, State.editingMode, step);
        } else {
          var sId = applyBtn.getAttribute('data-surface');
          var pId = applyBtn.getAttribute('data-prop');
          setT2Step(sId, pId, State.editingMode, step);
          // Re-flash the zone right after the new value lands so the
          // designer SEES the fix arrive.
          setTimeout(function () { pushPvFlash(pId); }, 60);
        }
        return;
      }
      var chip = e.target.closest && e.target.closest('[data-pc-wcag-open]');
      if (chip) {
        e.preventDefault();
        if (openOn === chip) { close(); return; }
        open(chip);
        return;
      }
      // outside click
      if (openOn && !pop.contains(e.target)) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && openOn) { close(); openOn && openOn.focus && openOn.focus(); }
    });
    window.addEventListener('scroll', function () {
      // Ignore the focus-induced scrollIntoView that fires right
      // after a click; only close on genuine user scrolling.
      if (openOn && Date.now() - openedAt > 250) close();
    }, true);
    window.addEventListener('resize', function () { if (openOn) close(); });
  })();

  /* ── Surface source-palette picker (custom popover) ────
     A native <select> can't render labeled group separators or an
     empty-state slot, so the picker is a singleton popover that
     renders SURFACE_PALETTE_GROUPS as labeled sections with a 1px
     separator between groups. Mirrors the WCAG popover above for
     positioning, outside-click + Esc close, and the 250ms scroll
     grace window so focus-induced scrolls don't auto-dismiss.
     Exposes window.__ev2OpenPalettePicker(triggerBtn) so the
     delegated click handler at the top of this file can drive it. */
  (function initSurfacePalettePicker() {
    var pop = document.createElement('div');
    pop.className = 'ev2-pal-pop';
    pop.setAttribute('role', 'listbox');
    pop.setAttribute('aria-label', 'Source palette');
    document.body.appendChild(pop);
    var openOn = null;
    var openedAt = 0;

    function close() {
      if (!openOn) return;
      pop.removeAttribute('data-show');
      pop.innerHTML = '';
      openOn.setAttribute('aria-expanded', 'false');
      openOn = null;
    }

    function render(surfaceId) {
      var groups = (typeof buildSurfacePaletteGroups === 'function')
        ? buildSurfacePaletteGroups()
        : [{ id:'defaults', label:'Default palettes', options: SURFACE_PALETTE_DEFAULTS.slice() }];
      var current = surfacePaletteFor(surfaceId);
      var def = T2_SURFACES.find(function (s) { return s.id === surfaceId; });
      var defaultPaletteId = def ? def.palette : null;
      var html = '';
      groups.forEach(function (g, gi) {
        if (gi > 0) html += '<div class="ev2-pal-pop-sep" role="separator"></div>';
        html += '<div class="ev2-pal-pop-group" data-group="' + g.id + '">'
          + '<div class="ev2-pal-pop-group-label">' + g.label + '</div>';
        if (g.options.length) {
          g.options.forEach(function (opt) {
            var isCurrent = opt.id === current;
            var isDefault = opt.id === defaultPaletteId;
            html += '<button type="button" class="ev2-pal-pop-opt"'
              + ' role="option" aria-selected="' + (isCurrent ? 'true' : 'false') + '"'
              + ' data-palette-pick="' + opt.id + '"'
              + (isCurrent ? ' data-current="1"' : '')
              + '>'
              + '<span class="ev2-pal-pop-opt-main">'
                + '<span class="ev2-pal-pop-opt-label">' + opt.label
                  + (isDefault ? '<span class="ev2-pal-pop-opt-default">default</span>' : '')
                + '</span>'
                + (opt.desc ? '<span class="ev2-pal-pop-opt-desc">' + opt.desc + '</span>' : '')
              + '</span>'
              + (isCurrent ? '<span class="ev2-pal-pop-opt-check" aria-hidden="true">\u2713</span>' : '')
            + '</button>';
          });
        } else if (g.emptyState) {
          html += '<div class="ev2-pal-pop-empty">' + g.emptyState + '</div>';
        }
        html += '</div>';
      });
      pop.innerHTML = html;
    }

    function position(trigger) {
      var r = trigger.getBoundingClientRect();
      var pw = pop.offsetWidth, ph = pop.offsetHeight;
      var vw = window.innerWidth, vh = window.innerHeight;
      var top = r.bottom + 6;
      if (top + ph > vh - 8) top = Math.max(8, r.top - ph - 6);
      var left = Math.round(r.left);
      // Prefer right-edge alignment if it doesn't overflow on the right.
      if (left + pw > vw - 8) left = Math.max(8, vw - pw - 8);
      pop.style.top  = Math.round(top) + 'px';
      pop.style.left = left + 'px';
    }

    function openFor(trigger) {
      var surfaceId = trigger.getAttribute('data-surface-palette-open');
      if (!surfaceId) return;
      if (openOn === trigger) { close(); return; }
      if (openOn) close();
      render(surfaceId);
      pop.setAttribute('data-surface', surfaceId);
      pop.setAttribute('data-show', '1');
      // Measure AFTER paint so offsetWidth/Height are valid.
      position(trigger);
      trigger.setAttribute('aria-expanded', 'true');
      openOn = trigger;
      openedAt = Date.now();
    }
    window.__ev2OpenPalettePicker = openFor;

    document.addEventListener('click', function (e) {
      var pickBtn = e.target && e.target.closest && e.target.closest('[data-palette-pick]');
      if (pickBtn && openOn && pop.contains(pickBtn)) {
        var picked = pickBtn.getAttribute('data-palette-pick');
        var sid = pop.getAttribute('data-surface');
        var def = T2_SURFACES.find(function (s) { return s.id === sid; });
        if (!def || !picked || !isValidSurfacePalette(picked)) { close(); return; }
        if (picked === def.palette) {
          /* Restoring the surface's declared default \u2014 drop the
             override so the surface no longer counts as dirty for
             palette reasons. CUSTOM step picks survive (only the
             palette override is cleared). */
          if (State.t2SurfacePalette[sid]) delete State.t2SurfacePalette[sid];
        } else {
          State.t2SurfacePalette[sid] = picked;
        }
        scheduleAutosave();
        pushPreview();
        close();
        if (State.activeTier === 't2') renderT2();
        refreshChangeBar();
        return;
      }
      // Outside-click close. Triggers are handled by the dedicated
      // [data-surface-palette-open] click listener at the top of
      // the file; if a different trigger is clicked while one is
      // open, openFor() handles the swap.
      if (openOn && !pop.contains(e.target) && !e.target.closest('[data-surface-palette-open]')) close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && openOn) { var t = openOn; close(); t.focus && t.focus(); }
    });
    window.addEventListener('scroll', function () {
      if (openOn && Date.now() - openedAt > 250) close();
    }, true);
    window.addEventListener('resize', function () { if (openOn) close(); });
  })();
})();
