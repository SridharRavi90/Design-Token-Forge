#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════






























}  }    for (const d of t.details.slice(0, 5)) console.log(`    → ${JSON.stringify(d)}`);  if (t.status !== 'PASS') {  console.log(`  ${t.status} ${t.name}: ${t.checked} checked, ${t.passed} passed`);for (const t of cert.tests) {console.log(`Overall: ${cert.overall}  (${cert.pass} pass, ${cert.warn} warn, ${cert.fail} fail)`);console.log(`\n=== TRUST CERTIFICATION ===`);const cert = certifyPalette({ steps });// Run certificationconsole.log(`Step names: ${STEP_NAMES.join(', ')}`);console.log(`\nTotal steps: ${steps.length}`);}  );    `${s.name.padEnd(6)} | ${String(s.tone).padStart(3)} | ${s.hex} | ${String(gap).padStart(4)} | ${s.contrast.toFixed(2)}${mark}`  console.log(  const mark = (s.name === '800' || s.name === '850' || s.name === '900' || s.name === 'black') ? ' ◄' : '';  const gap = i > 0 ? TONE_SCALE[i - 1] - TONE_SCALE[i] : '-';  const s = steps[i];for (let i = 0; i < steps.length; i++) {console.log('-------|-----|---------|------|------------------');console.log('Step   | L*  | Hex     | Δ L* | Contrast vs white');console.log('=== NEW DARK END (secondary #646F78) ===');const { steps } = generatePalette(hex);const hex = '#646F78'; // secondary   Design Token Forge — Sync Server

   Watches CSS token files for changes, auto-exports Figma JSON,
   and serves a live HTTP API that the Figma plugin polls.

   Usage:
     node server.js [--port 9500] [--verbose]

   Endpoints:
     GET /status   — { hash, lastChanged, pendingChanges, connected }
     GET /tokens   — full Figma-compatible JSON payload
     GET /changelog — recent change history
     POST /ack     — acknowledge a sync (resets pending counter)
   ═══════════════════════════════════════════════════════════════ */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import http from 'http';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// ── CLI args ──────────────────────────────────────────────────

const args    = process.argv.slice(2);
const PORT    = parseInt(args[args.indexOf('--port') + 1]) || 9500;
const VERBOSE = args.includes('--verbose');
const projIdx = args.indexOf('--project');
const PROJECT_ID = projIdx !== -1 ? args[projIdx + 1] : null;

// ── Paths ─────────────────────────────────────────────────────

const TOKENS_DIR  = path.resolve(__dirname, '../tokens/src');
const COMP_DIR    = path.resolve(__dirname, '../components/src');
const ROOT_DIR    = path.resolve(__dirname, '../..');
const WATCH_FILES = ['primitives.css', 'semantic.css', 'surfaces.css', 'extras.css'];

// ── Rename map (one-time migration for Figma variable renames) ─
const RENAMES_PATH = path.resolve(__dirname, 'renames.json');
function loadRenames() {
  try {
    if (fs.existsSync(RENAMES_PATH)) {
      const data = JSON.parse(fs.readFileSync(RENAMES_PATH, 'utf-8'));
      if (data.renames && Object.keys(data.renames).length > 0) return data.renames;
    }
  } catch (_) {}
  return {};
}

// ── Project config override support ──────────────────────────
let projectOverrides = {};  // { primitiveTokens, semanticTokens, surfaceTokens }
let projectConfig = null;

async function loadProjectOverrides() {
  if (!PROJECT_ID) return;
  const configPath = path.join(ROOT_DIR, 'projects', PROJECT_ID, 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error(`  ✗ Project config not found: ${configPath}`);
    return;
  }
  projectConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  try {
    const genPath = path.join(__dirname, 'generate-from-config.js');
    const { generateTokenOverrides } = await import(genPath);
    const basePrimitives = parseCSSTokens(path.join(TOKENS_DIR, 'primitives.css'));
    const overrides = generateTokenOverrides(projectConfig, basePrimitives);
    projectOverrides = {};
    if (overrides.primitiveTokens) projectOverrides.primitiveTokens = overrides.primitiveTokens;
    if (overrides.semanticTokens)  projectOverrides.semanticTokens  = overrides.semanticTokens;
    if (overrides.surfaceTokens)   projectOverrides.surfaceTokens   = overrides.surfaceTokens;
    const parts = Object.keys(projectOverrides);
    if (parts.length) console.log(`  ✓ Config overrides → ${parts.join(', ')}`);
  } catch (e) {
    console.warn(`  ⚠ Config override failed: ${e.message}`);
  }
}

// ── State ─────────────────────────────────────────────────────

let currentData    = null;   // latest exported JSON payload
let currentHash    = '';     // content hash
let lastChanged    = null;   // ISO timestamp of last change
let lastSyncedHash = '';     // hash that was last acknowledged
let changelog      = [];     // [{time, files, hash, summary}]
const MAX_LOG      = 50;
const startedAt    = new Date().toISOString();

// ── Export Logic — 4-Tier Architecture ────────────────────────
//   T0  Primitive Colors   (raw hex, 1 mode: Value)
//   T1  Color Tokens       (Light/Dark, every value aliases T0)
//   T2  Surface Context    (modes per surface, aliases T1)
//   T3  Status Context     (modes per semantic role, aliases T1)
//   +   Extras             (raw numbers, 1 mode: Value)

// Canonical surface names. Order matters — the longest-matching prefix wins
// when parsing token names, so multi-word names would go before their shorter
// counterparts (none currently, but keep the order stable).
const SURFACE_NAMES = [
  'bright', 'base', 'dim', 'deep', 'accent',
  'card', 'modal', 'float', 'inverse'
];

const SEMANTIC_ROLES = [
  'brand', 'success', 'warning', 'danger', 'info', 'neutral'
];

// ── CSS parser ────────────────────────────────────────────────

export function parseCSSTokens(filePath) {
  const css = fs.readFileSync(filePath, 'utf-8');
  const light = {}, dark = {};
  const darkIdx = css.indexOf('[data-theme="dark"]');
  const lightBlock = darkIdx >= 0 ? css.slice(0, darkIdx) : css;
  const darkBlock  = darkIdx >= 0 ? css.slice(darkIdx)    : '';
  const re = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(lightBlock)) !== null) light[m[1]] = m[2].trim();
  re.lastIndex = 0;
  while ((m = re.exec(darkBlock)) !== null)  dark[m[1]]  = m[2].trim();

  // Resolve CSS var(--name) references within each block (handles back-compat
  // aliases like --surface-container-ct-strong: var(--surface-card-ct-strong)).
  function resolveVarRefs(map) {
    const MAX_DEPTH = 8;
    for (const key of Object.keys(map)) {
      let val = map[key], depth = 0;
      while (depth < MAX_DEPTH && typeof val === 'string' && /^var\(--/.test(val)) {
        const refMatch = val.match(/^var\(--([a-zA-Z0-9_-]+)\)$/);
        if (!refMatch) break;
        const refVal = map[refMatch[1]];
        if (!refVal || refVal === val) break;
        val = refVal;
        depth++;
      }
      if (val !== map[key] && !/^var\(--/.test(val)) map[key] = val;
    }
  }
  resolveVarRefs(light);
  resolveVarRefs(dark);

  return { light, dark };
}

function detectType(name, value) {
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return 'COLOR';
  if (/^-?[\d.]+(?:px)?$/.test(value) && !value.includes(' ')) return 'FLOAT';
  if (name.startsWith('opacity-') || name.startsWith('z-')) return 'FLOAT';
  // letter-spacing in em is a number we convert to % at the Figma boundary
  // (see normalizeFigmaValue). Without this branch the em-suffixed values
  // ship as STRING and the LETTER_SPACING scope is dropped — invisible in
  // Figma's letter-spacing picker.
  if (name.startsWith('letter-spacing-') && /^-?[\d.]+em$/.test(value)) return 'FLOAT';
  return 'STRING';
}

// Convert a CSS token value to the form Figma expects for FLOAT variables.
// Most values pass through (the Figma plugin calls parseFloat). Transforms:
//  • letter-spacing em → percent  ("-0.05em" → "-5")
//  • font-family CSS stack → primary font name only
//    Figma's FONT_FAMILY variable requires a single font name ("Inter"),
//    not a CSS fallback stack ("-apple-system, BlinkMacSystemFont, ...").
//    We extract the first entry and strip surrounding quotes.
function normalizeFigmaValue(name, value) {
  if (typeof value !== 'string') return value;
  if (name.startsWith('letter-spacing-')) {
    const m = value.match(/^(-?[\d.]+)em$/);
    if (m) return String(parseFloat(m[1]) * 100);
  }
  if (name === 'font-family' || name.startsWith('font-family-')) {
    // Take the first comma-separated entry, strip CSS quotes and whitespace.
    // CSS var() references (e.g. font-family-sans = var(--font-family)) pass through
    // unchanged — Figma will show the literal string, which is acceptable.
    const primary = value.split(',')[0].trim().replace(/^["']|["']$/g, '');
    if (primary && !primary.startsWith('var(')) return primary;
  }
  return value;
}

// ── Figma variable scoping ────────────────────────────────────
// Determines where each variable appears in Figma's property panel.
// See: https://www.figma.com/plugin-docs/api/VariableScope

function scopeForSurfaceProp(prop) {
  // bg, hover, pressed → fill scopes
  if (['bg', 'subtle', 'strong'].includes(prop))
    return ['FRAME_FILL', 'SHAPE_FILL'];
  // outline, separator → stroke
  if (['outline', 'separator'].includes(prop))
    return ['STROKE_COLOR'];
  // ct-* → content (text + icons): text fill, icon fill & stroke
  if (prop.startsWith('ct-'))
    return ['TEXT_FILL', 'SHAPE_FILL', 'STROKE_COLOR'];
  // cm-bg* → component fill
  if (prop.startsWith('cm-bg'))
    return ['FRAME_FILL', 'SHAPE_FILL'];
  // cm-outline*, cm-separator → component stroke
  if (prop.startsWith('cm-outline') || prop === 'cm-separator')
    return ['STROKE_COLOR'];
  return ['ALL_FILLS'];
}

function scopeForSemanticProp(prop) {
  // content-* → text + icons (fill & stroke)
  if (prop.startsWith('content-'))
    return ['TEXT_FILL', 'SHAPE_FILL', 'STROKE_COLOR'];
  if (prop === 'on-component' || prop === 'on-container')
    return ['TEXT_FILL', 'SHAPE_FILL', 'STROKE_COLOR'];
  if (prop.startsWith('component-bg'))
    return ['FRAME_FILL', 'SHAPE_FILL'];
  if (prop.startsWith('component-outline') || prop === 'component-separator')
    return ['STROKE_COLOR'];
  if (prop.startsWith('container-bg'))
    return ['FRAME_FILL', 'SHAPE_FILL'];
  if (prop.startsWith('container-outline') || prop === 'container-separator')
    return ['STROKE_COLOR'];
  return ['ALL_FILLS'];
}

function scopeForExtras(cssName, type) {
  if (cssName.startsWith('radius-'))  return ['CORNER_RADIUS'];
  if (cssName.startsWith('spacing-')) return ['GAP'];
  if (cssName.startsWith('opacity-')) return ['OPACITY'];
  if (cssName.startsWith('z-'))       return [];  // no scope restriction
  if (cssName.startsWith('font-family-')) return ['FONT_FAMILY'];
  if (cssName.startsWith('font-size-'))    return ['FONT_SIZE'];
  if (cssName.startsWith('font-weight-'))  return ['FONT_WEIGHT'];
  // line-height ships as a unitless FLOAT (e.g. 1.5). letter-spacing ships
  // as a percent FLOAT after normalizeFigmaValue converts em → %.
  if (cssName.startsWith('line-height-')    && type === 'FLOAT') return ['LINE_HEIGHT'];
  if (cssName.startsWith('letter-spacing-') && type === 'FLOAT') return ['LETTER_SPACING'];
  return [];
}

// ── Figma path builders ───────────────────────────────────────

// Step names used by palette engine — the last segment of a prim token name
const PRIM_STEP_NAMES = new Set(
  ['white','black','25','50','75','100','150','175','200','250','300','350','400','450','500','550','600','700','750','800','850','900']
);

function primPath(cssName) {
  const p = cssName.split('-');
  if (p[0] === 'prim') {
    // Last segment is the step name, everything in between is the palette key
    // e.g. prim-secondary-25 → prim/secondary/25
    const step = p[p.length - 1];
    const palette = p.slice(1, -1).join('-');
    return `prim/${palette}/${step}`;
  }
  if (p[0] === 'spacing') return `spacing/${p.slice(1).join('-')}`;
  if (p[0] === 'font')    return `font/${p.slice(1).join('-')}`;
  return p.join('/');
}

function surfaceFigmaPath(cssName) {
  // cssName like "surface-base-bg" or "surface-over-container-ct-default"
  const rest = cssName.replace(/^surface-/, '');
  for (const sn of SURFACE_NAMES) {
    if (rest.startsWith(sn + '-')) {
      const prop = rest.slice(sn.length + 1);
      return { surfaceName: sn, prop, fullPath: `surface/${sn}/${prop}` };
    }
  }
  return { surfaceName: null, prop: rest, fullPath: `surface/${rest}` };
}

function semanticFigmaPath(cssName) {
  // cssName like "brand-content-default" or "brand-component-bg-hover"
  const parts = cssName.split('-');
  const role = parts[0];
  const prop = parts.slice(1).join('-');
  return { role, prop, fullPath: `semantic/${role}/${prop}` };
}

function extrasPath(cssName) {
  const p = cssName.split('-');
  if (p[0] === 'z') return `z-index/${p.slice(1).join('-')}`;
  return `${p[0]}/${p.slice(1).join('-')}`;
}

// ── Categorize surface properties into sub-groups ─────────────
// Matches reference: surfaces/, content/, component/

function surfacePropToT2Path(prop) {
  // Backward-compat: CSS still uses old names hover/pressed;
  // Figma variables were renamed to subtle/strong via renames.json.
  // Map old CSS names → new Figma variable names so values are not lost.
  if (prop === 'hover')   prop = 'subtle';
  if (prop === 'pressed') prop = 'strong';
  if (prop === 'elevated') prop = 'strong';
  // bg, subtle, strong, outline, separator → surfaces/*
  if (['bg', 'subtle', 'strong', 'outline', 'separator'].includes(prop))
    return `default/surfaces/${prop}`;
  // ct-* → content/*
  if (prop.startsWith('ct-'))
    return `default/content/${prop.slice(3)}`;
  // cm-* → component/*
  if (prop.startsWith('cm-'))
    return `default/component/${prop.slice(3)}`;
  return `default/${prop}`;
}

function semanticPropToT3Path(prop) {
  // content-* → content/*
  if (prop.startsWith('content-'))
    return `content/${prop.slice(8)}`;
  // on-component → oncomponent-content/default
  if (prop === 'on-component')
    return 'oncomponent-content/default';
  // on-container → oncontainer-content/default
  if (prop === 'on-container')
    return 'oncontainer-content/default';
  // component-* → component/*
  if (prop.startsWith('component-'))
    return `component/${prop.slice(10)}`;
  // container-* → container/*
  if (prop.startsWith('container-'))
    return `container/${prop.slice(10)}`;
  return prop;
}

// ── T0: Primitive Colors ──────────────────────────────────────

function buildT0(primTokens, extrasTokens) {
  const { light: primLight } = primTokens;
  const variables = [];
  for (const [name, value] of Object.entries(primLight)) {
    const type = detectType(name, value);
    if (type !== 'COLOR') continue;          // only colours in T0
    variables.push({ name: primPath(name), type, scopes: [], values: { Value: value } });
  }
  return { name: 'T0 Primitive Colors', modes: ['Value'], hiddenFromPublishing: true, variables };
}

// ── T0 extras (numbers) ──────────────────────────────────────

function buildExtras(primTokens, extrasTokens) {
  const variables = [];

  // CSS-origin font tokens that must NOT appear as Figma variables:
  //  • font-family        — full CSS fallback stack; superseded by font-family-headline/-body
  //  • font-family-sans   — CSS var() alias ("var(--font-family)"); Figma can't resolve it
  //  • font-family-mono   — duplicate of font-family-code (set by typographyConfig)
  const CSS_FONT_SKIP = new Set(['font-family', 'font-family-sans', 'font-family-mono']);

  // Non-colour primitives (spacing, font-size, etc.)
  for (const [name, value] of Object.entries(primTokens.light)) {
    const type = detectType(name, value);
    if (type === 'COLOR') continue;          // colours go to T0
    if (CSS_FONT_SKIP.has(name)) continue;   // CSS-only constructs — skip from Figma export
    if (typeof value === 'string' && value.startsWith('var(')) continue; // bare CSS var() refs
    const fValue = normalizeFigmaValue(name, value);
    variables.push({ name: primPath(name), type, scopes: scopeForExtras(name, type), values: { Value: fValue } });
  }

  // Extras (radius, shadow, motion, z-index, opacity) — skip COLOR tokens
  for (const [name, value] of Object.entries(extrasTokens.light)) {
    const type = detectType(name, value);
    if (type === 'COLOR') continue;  // utility colors go to T1 with Light/Dark modes
    const fValue = normalizeFigmaValue(name, value);
    variables.push({ name: extrasPath(name), type, scopes: scopeForExtras(name, type), values: { Value: fValue } });
  }

  return { name: 'primitives-numbers', modes: ['Value'], hiddenFromPublishing: true, variables };
}

// ── Alias map: hex → T0 variable reference ────────────────────
// Builds both a generic hex→T0 map (first-match-wins) AND a palette-specific
// map keyed by "HEX:paletteKey" for disambiguation when multiple palettes
// share the same hex values (e.g. greyscale vs desaturated).

function buildAliasMap(t0Collection) {
  const map = new Map();       // HEX → first-match alias
  const palMap = new Map();    // HEX:paletteKey → palette-specific alias
  for (const v of t0Collection.variables) {
    if (v.type !== 'COLOR') continue;
    const hex = v.values.Value;
    if (typeof hex !== 'string') continue;
    const upper = hex.toUpperCase();
    const alias = {
      type: 'VARIABLE_ALIAS',
      collection: t0Collection.name,
      name: v.name
    };
    // Generic first-match
    if (!map.has(upper)) {
      map.set(upper, alias);
    }
    // Palette-specific: extract palette key from path like "prim/desaturated/200"
    const parts = v.name.split('/');
    if (parts[0] === 'prim' && parts.length >= 3) {
      const palKey = parts[1];
      palMap.set(upper + ':' + palKey, alias);
    }
  }
  return { map, palMap };
}

// ── T1: Color Tokens (combined surfaces + semantics) ──────────
//    Modes: Light, Dark
//    Every value is an alias to T0

function buildT1(surfaceTokens, semanticTokens, aliasMap, extrasTokens) {
  const { map, palMap } = aliasMap;
  const variables = [];
  const palSrc = surfaceTokens.paletteSrc || {};
  const extras = extrasTokens || { light: {}, dark: {} };

  // Resolve alias: prefer palette-specific if paletteSrc is known
  function resolve(hex, paletteKey) {
    const upper = hex.toUpperCase();
    if (paletteKey) {
      const specific = palMap.get(upper + ':' + paletteKey);
      if (specific) return specific;
    }
    return map.get(upper) || hex;
  }

  // Surface variables → surface/{surfaceName}/{prop}
  // Use union of light+dark keys so back-compat aliases (in a :root block after
  // [data-theme="dark"]) are also included — they land in surfaceTokens.dark only.
  const _surfaceKeys = new Set([...Object.keys(surfaceTokens.light), ...Object.keys(surfaceTokens.dark)]);
  for (const name of _surfaceKeys) {
    const lVal = surfaceTokens.light[name] || surfaceTokens.dark[name];
    if (!lVal) continue;
    const { fullPath } = surfaceFigmaPath(name);
    const dVal = surfaceTokens.dark[name] || lVal;
    const type = detectType(name, lVal);
    if (type !== 'COLOR' && type !== 'FLOAT') continue; // skip unresolved var() strings
    const pk = palSrc[name] || null;
    const lAlias = resolve(lVal, pk);
    const dAlias = resolve(dVal, pk);
    variables.push({ name: fullPath, type, scopes: [], values: { Light: lAlias, Dark: dAlias } });
  }

  // Semantic variables → semantic/{role}/{prop}
  for (const [name, lVal] of Object.entries(semanticTokens.light)) {
    const { fullPath } = semanticFigmaPath(name);
    const dVal = semanticTokens.dark[name] || lVal;
    const type = detectType(name, lVal);
    const lAlias = resolve(lVal, null);
    const dAlias = resolve(dVal, null);
    variables.push({ name: fullPath, type, scopes: [], values: { Light: lAlias, Dark: dAlias } });
  }

  // Utility COLOR tokens from extras.css → utility/{name}
  for (const [name, lVal] of Object.entries(extras.light)) {
    const type = detectType(name, lVal);
    if (type !== 'COLOR') continue;  // only colour tokens; numbers stay in buildExtras
    const dVal = extras.dark[name] || lVal;
    variables.push({ name: `utility/${name.replace(/-/g, '/')}`, type, scopes: ['FRAME_FILL', 'SHAPE_FILL', 'STROKE_COLOR', 'TEXT_FILL'], values: { Light: lVal, Dark: dVal } });
  }

  return { name: 'T1 Color Tokens', modes: ['Light', 'Dark'], hiddenFromPublishing: true, variables };
}

// ── T2: Surface Context Tokens ────────────────────────────────
//    Modes: surface-base, surface-bright, surface-dim, etc.
//    Each value aliases the corresponding T1 surface variable.

function buildT2(t1Collection) {
  const T1_NAME = t1Collection.name;

  // Collect all surface properties from T1 (deduplicate by prop name)
  const propSet = new Map(); // prop → type
  for (const v of t1Collection.variables) {
    // Only surface variables
    if (!v.name.startsWith('surface/')) continue;
    for (const sn of SURFACE_NAMES) {
      const prefix = `surface/${sn}/`;
      if (v.name.startsWith(prefix)) {
        const prop = v.name.slice(prefix.length);
        if (!propSet.has(prop)) propSet.set(prop, v.type);
        break;
      }
    }
  }

  const modes = SURFACE_NAMES.map(sn => `surface-${sn}`);
  const variables = [];

  for (const [prop, type] of propSet) {
    const t2Path = surfacePropToT2Path(prop);
    const scopes = scopeForSurfaceProp(prop);
    const values = {};
    for (const sn of SURFACE_NAMES) {
      const t1VarPath = `surface/${sn}/${prop}`;
      values[`surface-${sn}`] = {
        type: 'VARIABLE_ALIAS',
        collection: T1_NAME,
        name: t1VarPath
      };
    }
    variables.push({ name: t2Path, type, scopes, values });
  }

  return { name: 'T2 Surface Context Tokens', modes, variables };
}

// ── T3: Status Context Tokens ─────────────────────────────────
//    Modes: brand, success, warning, danger, info
//    Each value aliases the corresponding T1 semantic variable.

function buildT3(t1Collection) {
  const T1_NAME = t1Collection.name;

  // Collect all semantic properties from T1 (deduplicate by prop)
  const propSet = new Map(); // prop → type
  for (const v of t1Collection.variables) {
    if (!v.name.startsWith('semantic/')) continue;
    for (const role of SEMANTIC_ROLES) {
      const prefix = `semantic/${role}/`;
      if (v.name.startsWith(prefix)) {
        const prop = v.name.slice(prefix.length);
        if (!propSet.has(prop)) propSet.set(prop, v.type);
        break;
      }
    }
  }

  const modes = SEMANTIC_ROLES;
  const variables = [];

  for (const [prop, type] of propSet) {
    const t3Path = semanticPropToT3Path(prop);
    const scopes = scopeForSemanticProp(prop);
    const values = {};
    for (const role of SEMANTIC_ROLES) {
      const t1VarPath = `semantic/${role}/${prop}`;
      values[role] = {
        type: 'VARIABLE_ALIAS',
        collection: T1_NAME,
        name: t1VarPath
      };
    }
    variables.push({ name: t3Path, type, scopes, values });
  }

  return { name: 'T3 Status Context Tokens', modes, variables };
}

// ── Typography Scale ─────────────────────────────────────────
//    One collection with a single "Value" mode.
//    Each semantic ramp has four variables:
//      type/{ramp}/size          → FONT_SIZE  alias
//      type/{ramp}/family        → FONT_FAMILY alias (headline | body | code role)
//      type/{ramp}/weight        → FONT_WEIGHT alias
//      type/{ramp}/line-height   → LINE_HEIGHT alias
//
//    Ramps are ordered large-to-small to match how designers scan:
//      display / heading-xl / heading-lg / heading / heading-sm /
//      body-lg / body / body-sm / label / caption / micro / nano
//
//    Values are VARIABLE_ALIAS references into primitives-numbers
//    so a single density change propagates here automatically.

const TYPO_RAMPS = [
  // { name, sizePx, familyRole, weight, lineHeight }
  // sizePx   → the px integer used in the --font-size-{N} key
  // familyRole → 'headline' | 'body' | 'code'
  // weight   → key in TYPOGRAPHY_LADDER.weights
  // lineHeight → key in TYPOGRAPHY_LADDER.lineHeights
  { name: 'display',     sizePx: 40, familyRole: 'headline', weight: 'bold',     lineHeight: 'tight'   },
  { name: 'heading-xl',  sizePx: 32, familyRole: 'headline', weight: 'bold',     lineHeight: 'tight'   },
  { name: 'heading-lg',  sizePx: 28, familyRole: 'headline', weight: 'semibold', lineHeight: 'tight'   },
  { name: 'heading',     sizePx: 24, familyRole: 'headline', weight: 'semibold', lineHeight: 'snug'    },
  { name: 'heading-sm',  sizePx: 20, familyRole: 'headline', weight: 'semibold', lineHeight: 'snug'    },
  { name: 'body-lg',     sizePx: 18, familyRole: 'body',     weight: 'regular',  lineHeight: 'relaxed' },
  { name: 'body',        sizePx: 16, familyRole: 'body',     weight: 'regular',  lineHeight: 'normal'  },
  { name: 'body-sm',     sizePx: 14, familyRole: 'body',     weight: 'regular',  lineHeight: 'normal'  },
  { name: 'label',       sizePx: 13, familyRole: 'body',     weight: 'medium',   lineHeight: 'snug'    },
  { name: 'caption',     sizePx: 12, familyRole: 'body',     weight: 'regular',  lineHeight: 'snug'    },
  { name: 'micro',       sizePx: 11, familyRole: 'body',     weight: 'regular',  lineHeight: 'tight'   },
  { name: 'nano',        sizePx: 10, familyRole: 'body',     weight: 'regular',  lineHeight: 'tight'   },
  { name: 'code',        sizePx: 14, familyRole: 'code',     weight: 'regular',  lineHeight: 'normal'  },
  { name: 'code-sm',     sizePx: 12, familyRole: 'code',     weight: 'regular',  lineHeight: 'normal'  },
];

const TYPO_COL_NAME = 'primitives-numbers';

/**
 * Build the Typography Scale collection.
 * Each ramp emits 4 variables that alias into primitives-numbers.
 * If a required primitive is missing the ramp property is skipped with a warning.
 *
 * @param {Object} extrasCol — the built primitives-numbers collection object
 * @returns Figma collection object
 */
function buildTypography(extrasCol) {
  const extrasVarSet = new Set(extrasCol.variables.map(v => v.name));
  const variables = [];

  for (const ramp of TYPO_RAMPS) {
    const { name, sizePx, familyRole, weight, lineHeight } = ramp;

    // ── size ──────────────────────────────────────────────────
    const sizePath = `font/size-${sizePx}`;
    if (extrasVarSet.has(sizePath)) {
      variables.push({
        name: `type/${name}/size`,
        type: 'FLOAT',
        scopes: ['FONT_SIZE'],
        values: { Value: { type: 'VARIABLE_ALIAS', collection: TYPO_COL_NAME, name: sizePath } }
      });
    } else {
      console.warn(`⚠  Typography ramp "${name}": primitive "${sizePath}" not found in primitives-numbers — size skipped`);
    }

    // ── family ────────────────────────────────────────────────
    const familyPath = `font/family-${familyRole}`;
    if (extrasVarSet.has(familyPath)) {
      variables.push({
        name: `type/${name}/family`,
        type: 'STRING',
        scopes: ['FONT_FAMILY'],
        values: { Value: { type: 'VARIABLE_ALIAS', collection: TYPO_COL_NAME, name: familyPath } }
      });
    } else {
      console.warn(`⚠  Typography ramp "${name}": primitive "${familyPath}" not found — family skipped`);
    }

    // ── weight ────────────────────────────────────────────────
    const weightPath = `font/weight-${weight}`;
    if (extrasVarSet.has(weightPath)) {
      variables.push({
        name: `type/${name}/weight`,
        type: 'FLOAT',
        scopes: ['FONT_WEIGHT'],
        values: { Value: { type: 'VARIABLE_ALIAS', collection: TYPO_COL_NAME, name: weightPath } }
      });
    } else {
      console.warn(`⚠  Typography ramp "${name}": primitive "${weightPath}" not found — weight skipped`);
    }

    // ── line-height ───────────────────────────────────────────
    // line-height tokens use path format line/height/{name} in primPath()
    const lhPath = `line/height/${lineHeight}`;
    if (extrasVarSet.has(lhPath)) {
      variables.push({
        name: `type/${name}/line-height`,
        type: 'FLOAT',
        scopes: ['LINE_HEIGHT'],
        values: { Value: { type: 'VARIABLE_ALIAS', collection: TYPO_COL_NAME, name: lhPath } }
      });
    } else {
      console.warn(`⚠  Typography ramp "${name}": primitive "${lhPath}" not found — line-height skipped`);
    }
  }

  return {
    name: 'Typography Scale',
    modes: ['Value'],
    hiddenFromPublishing: false,
    variables
  };
}

// ── Comp Size: Component-level dimension tokens ───────────────
//    Modes: micro, tiny, small, base, medium, large, big, huge, mega, ultra
//    Values alias primitives-numbers (spacing/*, radius/*, font/size-*)

const COMP_SIZE_MODES = [
  'base', 'micro', 'tiny', 'small', 'medium',
  'large', 'big', 'huge', 'mega', 'ultra'
];

const EXTRAS_COL_NAME = 'primitives-numbers';

/**
 * Parse a component .tokens.css and extract per-density dimension values.
 * Returns Map<cssVarName, rawValue> (only :root / top-level declarations).
 */
function parseComponentTokens(filePath) {
  const css = fs.readFileSync(filePath, 'utf-8');
  const tokens = {};
  const re = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    tokens[m[1]] = m[2].trim();
  }
  return tokens;
}

/**
 * Convert a CSS var() reference to a primitives-numbers Figma path.
 *   var(--spacing-36)    → spacing/36
 *   var(--radius-DEFAULT) → radius/DEFAULT
 *   var(--font-size-14)  → font/size-14
 *   var(--radius-sm-md)  → radius/sm-md
 * Returns null if not a resolvable var() reference.
 */
const EXTRAS_PREFIXES = new Set(['radius', 'shadow', 'opacity', 'z', 'duration', 'easing']);
function cssVarToExtrasPath(value) {
  const m = value.match(/^var\(--([a-zA-Z0-9_-]+)\)$/);
  if (!m) return null;
  const name = m[1]; // e.g. "spacing-36", "radius-sm-md", "font-size-14"
  const prefix = name.split('-')[0];
  // Tokens from extras.css must use extrasPath (preserves compound suffixes)
  if (EXTRAS_PREFIXES.has(prefix)) return extrasPath(name);
  return primPath(name);
}

/**
 * Parse numeric CSS values used in comp-size tokens.
 * Supports:
 *   - plain numeric values (e.g. "16px", "1em", "0.5")
 *   - calc(var(--token) * factor) where token suffix is numeric
 */
function parseCompSizeNumber(value, extrasVarSet) {
  const direct = parseFloat(value);
  if (!isNaN(direct)) return direct;

  const calcMul = value.match(/^calc\(var\(--([a-zA-Z0-9_-]+)\)\s*\*\s*(-?\d*\.?\d+)\)$/);
  if (!calcMul) return null;

  const tokenName = calcMul[1];
  const factor = parseFloat(calcMul[2]);
  if (isNaN(factor)) return null;

  const tokenPath = cssVarToExtrasPath(`var(--${tokenName})`);
  if (!tokenPath || !extrasVarSet.has(tokenPath)) return null;

  const numericSuffix = tokenPath.split('/')[1];
  const base = parseFloat(numericSuffix);
  if (isNaN(base)) return null;

  return base * factor;
}

/**
 * Determine the proper scope for a comp-size variable based on its semantic name.
 */
function scopeForCompSizeVar(varName) {
  if (varName.includes('height'))    return ['WIDTH_HEIGHT'];
  if (varName.includes('min-width')) return ['WIDTH_HEIGHT'];
  if (varName.includes('padding'))   return ['GAP'];
  if (varName.includes('gap'))       return ['GAP'];
  if (varName.includes('radius'))    return ['CORNER_RADIUS'];
  if (varName.includes('font-size')) return ['FONT_SIZE'];
  if (varName.includes('icon container') || varName.includes('icon-size'))
    return ['WIDTH_HEIGHT'];
  if (varName.includes('chevron'))   return ['WIDTH_HEIGHT'];
  return ['GAP'];  // safe default for spacing-like values
}

/**
 * Build a single component group within the comp-size collection.
 * Maps CSS per-density tokens to Figma variable aliases.
 *
 * @param {string} prefix - CSS prefix (e.g. 'btn')
 * @param {string} group  - Figma group name (e.g. 'button')
 * @param {Object} tokens - parsed CSS tokens from component file
 * @param {Object} extrasVarSet - Set of valid primitives-numbers paths
 * @param {Array<{propCSS, propFigma}>} propMap - mapping of CSS suffixes to Figma variable names
 * @returns {Array} variables array for this component
 */
function buildComponentGroup(prefix, group, tokens, extrasVarSet, propMap) {
  const variables = [];

  for (const { propCSS, propFigma } of propMap) {
    const figmaName = `${group}/${propFigma}`;
    const values = {};
    let type = 'FLOAT';
    let valid = true;
    let dropReason = '';

    for (const mode of COMP_SIZE_MODES) {
      const cssKey = `${prefix}-${propCSS}-${mode}`;
      const cssValue = tokens[cssKey];
      if (!cssValue) {
        valid = false;
        dropReason = `missing CSS token --${cssKey}`;
        break;
      }

      const extrasPath = cssVarToExtrasPath(cssValue);
      if (extrasPath) {
        if (extrasVarSet.has(extrasPath)) {
          values[mode] = {
            type: 'VARIABLE_ALIAS',
            collection: EXTRAS_COL_NAME,
            name: extrasPath
          };
        } else {
          // Alias references a nonexistent primitive (e.g. var(--spacing-7)
          // when only spacing-1..6, 8 exist). Previously this silently set
          // valid=false and the WHOLE multi-mode variable was dropped from
          // the export — designers saw no error, just a missing variable
          // in Figma. Now we warn loudly and fall back to a parsed numeric
          // value if the suffix happens to be numeric, so the variable
          // still gets exported (with a literal value for that mode only).
          const numericSuffix = extrasPath.split('/')[1];
          const fallback = parseFloat(numericSuffix);
          if (!isNaN(fallback)) {
            console.warn(`⚠  ${figmaName} mode=${mode}: alias "${extrasPath}" not in primitives — falling back to literal ${fallback} (please add the primitive or fix the CSS token --${cssKey})`);
            values[mode] = fallback;
          } else {
            valid = false;
            dropReason = `alias "${extrasPath}" not in primitives-numbers (CSS: --${cssKey} = ${cssValue})`;
            break;
          }
        }
      } else {
        // Direct numeric value (e.g. hardcoded px)
        const num = parseCompSizeNumber(cssValue, extrasVarSet);
        if (num !== null) {
          values[mode] = num;
        } else {
          valid = false;
          dropReason = `unparseable value "${cssValue}" (CSS: --${cssKey})`;
          break;
        }
      }
    }

    if (valid) {
      variables.push({
        name: figmaName,
        type,
        scopes: scopeForCompSizeVar(propFigma),
        values
      });
    } else {
      // CRITICAL: surface the drop. Past silent failures left designers
      // chasing missing variables in Figma. If a comp-size variable was
      // requested in propMap but couldn't be built, the export should
      // make that visible.
      console.warn(`❌ DROPPED comp-size variable "${figmaName}": ${dropReason}`);
    }
  }

  return variables;
}

/**
 * Build the comp-size collection (visible to designers).
 * Reads component .tokens.css files and creates multi-mode variables.
 */
function buildCompSize(extrasCollection) {
  // Build a set of valid primitives-numbers paths for alias validation
  const extrasVarSet = new Set();
  for (const v of extrasCollection.variables) {
    extrasVarSet.add(v.name);
  }

  const variables = [];

  // ── Button ────────────────────────────────────────────────
  const btnFile = path.join(COMP_DIR, 'button/button.tokens.css');
  if (fs.existsSync(btnFile)) {
    const btnTokens = parseComponentTokens(btnFile);
    const btnProps = [
      { propCSS: 'height',         propFigma: 'height' },
      { propCSS: 'padding-x-icon', propFigma: 'icon wrapper padding L' },
      { propCSS: 'icon-gap',       propFigma: 'icon wrapper padding R' },
      { propCSS: 'icon-pad',       propFigma: 'icon pad' },
      { propCSS: 'radius',         propFigma: 'radius' },
      { propCSS: 'icon-size',      propFigma: 'icon container' },
      { propCSS: 'font-size',      propFigma: 'font-size' },
      { propCSS: 'padding-x',      propFigma: 'text wrapper padding L' },
      { propCSS: 'padding-x',      propFigma: 'text wrapper padding R' },
    ];
    variables.push(...buildComponentGroup('btn', 'button', btnTokens, extrasVarSet, btnProps));

    // ── button/radius-rounded ─────────────────────────────
    // CONSTANT (non-per-density) token used by the rounded variant.
    // CSS:  --btn-radius-rounded: var(--radius-full);
    // Figma plugin's BUTTON_BLUEPRINT binds the Rounded=True variant to
    // this variable. Without it the Component Builder reports
    // "1 token binding need re-linking: button/radius-rounded".
    const roundedCSS = btnTokens['btn-radius-rounded'];
    if (roundedCSS) {
      const roundedAlias = cssVarToExtrasPath(roundedCSS);
      const values = {};
      let usable = true;
      let roundedValue = null;
      if (roundedAlias && extrasVarSet.has(roundedAlias)) {
        roundedValue = {
          type: 'VARIABLE_ALIAS',
          collection: EXTRAS_COL_NAME,
          name: roundedAlias
        };
      } else {
        const n = parseFloat(roundedCSS);
        if (!isNaN(n)) {
          roundedValue = n;
        } else {
          usable = false;
          console.warn(`❌ DROPPED button/radius-rounded: unresolved value "${roundedCSS}"`);
        }
      }
      if (usable) {
        for (const mode of COMP_SIZE_MODES) values[mode] = roundedValue;
        variables.push({
          name: 'button/radius-rounded',
          type: 'FLOAT',
          scopes: ['CORNER_RADIUS'],
          values
        });
      }
    } else {
      console.warn(`⚠  button.tokens.css missing --btn-radius-rounded — Rounded variant will report "build needed"`);
    }
  }

  // ── Split Button ──────────────────────────────────────────
  // Split-button INHERITS design tokens (height, radius, padding, font-size, icon-size)
  // from --btn-* per multi-zone-model.md (Q6). The Figma plugin binds split-button
  // variants directly to button/* comp-size vars for those properties.
  //
  // Only STRUCTURAL tokens (owned by split-button) are exposed here:
  //   - trigger/padding-x : chevron zone padding (narrower than action zone)
  //   - chevron/size      : chevron icon container (smaller than action icon)
  //
  // The divider is rendered as a 1px LEFT-edge stroke on the trigger zone
  // (using Figma's per-edge strokeLeftWeight). Color comes from an existing
  // separator color token. No dedicated thickness var is needed.
  const sbtnFile = path.join(COMP_DIR, 'split-button/split-button.tokens.css');
  if (fs.existsSync(sbtnFile)) {
    const sbtnTokens = parseComponentTokens(sbtnFile);
    const sbtnProps = [
      { propCSS: 'chevron-padding', propFigma: 'chevron/padding' },
      { propCSS: 'chevron-size',    propFigma: 'chevron/size' },
    ];
    variables.push(...buildComponentGroup('split-btn', 'split-button', sbtnTokens, extrasVarSet, sbtnProps));
  }

  // ── Icon Button ───────────────────────────────────────────
  // Square action archetype. Per-density size (width = height) and icon-size.
  // Uses icon-button.tokens.css (NOT button.tokens.css) so the icon-only
  // button gets its own correctly-proportioned scale:
  //   base: size=36px, icon=18px → 9px effective padding all sides (uniform)
  //   small: size=32px, icon=16px → 8px effective padding all sides (uniform)
  // Two variables emitted:
  //   icon-button/size           — bound to BOTH width AND height of root frame
  //   icon-button/icon container — bound to icon instance width and height
  const ibtnFile = path.join(COMP_DIR, 'icon-button/icon-button.tokens.css');
  if (fs.existsSync(ibtnFile)) {
    const ibtnTokens = parseComponentTokens(ibtnFile);
    const ibtnProps = [
      { propCSS: 'size',      propFigma: 'size' },
      { propCSS: 'icon-size', propFigma: 'icon container' },
    ];
    variables.push(...buildComponentGroup('icon-btn', 'icon-button', ibtnTokens, extrasVarSet, ibtnProps));
  } else {
    console.warn('⚠  icon-button.tokens.css not found — icon-button comp-size variables will be missing');
  }

  // ── Badge ─────────────────────────────────────────────────
  // Label-indicator archetype. Per-density height, padding-x, gap, font-size,
  // icon-size, radius. Stateless compact badge with 6 semantic roles ×
  // 3 structural variants. No motion or interactive states.
  const badgeFile = path.join(COMP_DIR, 'badge/badge.tokens.css');
  if (fs.existsSync(badgeFile)) {
    const badgeTokens = parseComponentTokens(badgeFile);
    const badgeProps = [
      { propCSS: 'height',    propFigma: 'height' },
      { propCSS: 'padding-x', propFigma: 'padding-x' },
      { propCSS: 'gap',       propFigma: 'gap' },
      { propCSS: 'font-size', propFigma: 'font-size' },
      { propCSS: 'icon-size', propFigma: 'icon-size' },
      { propCSS: 'radius',    propFigma: 'radius' },
    ];
    variables.push(...buildComponentGroup('badge', 'badge', badgeTokens, extrasVarSet, badgeProps));
  }

  // ── Menu-button ────────────────────────────────────────────
  // Action with disclosure archetype. Per-density height, padding-x, padding-y,
  // chevron-pe (padding after chevron), font-size, icon-size, radius.
  // 10-density sizing + 4 structural variants (filled/outlined/soft/ghost) +
  // 6 semantic roles (brand/info/danger/success/warning/neutral) compose orthogonally.
  const mbtnFile = path.join(COMP_DIR, 'menu-button/menu-button.tokens.css');
  if (fs.existsSync(mbtnFile)) {
    const mbtnTokens = parseComponentTokens(mbtnFile);
    const mbtnProps = [
      { propCSS: 'height',         propFigma: 'height' },
      { propCSS: 'padding-x',      propFigma: 'padding-x' },
      { propCSS: 'padding-x-icon', propFigma: 'padding-x-icon' },
      { propCSS: 'padding-y',      propFigma: 'padding-y' },
      { propCSS: 'chevron-pe',     propFigma: 'chevron-pe' },
      { propCSS: 'gap',            propFigma: 'gap' },
      { propCSS: 'font-size',      propFigma: 'font-size' },
      { propCSS: 'icon-size',      propFigma: 'icon-size' },
      { propCSS: 'chevron-size',   propFigma: 'chevron-size' },
      { propCSS: 'radius',         propFigma: 'radius' },
    ];
    variables.push(...buildComponentGroup('menu-btn', 'menu-button', mbtnTokens, extrasVarSet, mbtnProps));

    // ── menu-button/radius-rounded ─────────────────────────
    // CONSTANT (non-per-density) token used by the Rounded variant.
    // CSS:  --menu-btn-radius-rounded: var(--radius-full);
    const mbRoundedCSS = mbtnTokens['menu-btn-radius-rounded'];
    if (mbRoundedCSS) {
      const mbRoundedAlias = cssVarToExtrasPath(mbRoundedCSS);
      const mbRoundedValues = {};
      let mbRoundedValue = null;
      let mbRoundedUsable = true;
      if (mbRoundedAlias && extrasVarSet.has(mbRoundedAlias)) {
        mbRoundedValue = { type: 'VARIABLE_ALIAS', collection: EXTRAS_COL_NAME, name: mbRoundedAlias };
      } else {
        const n = parseFloat(mbRoundedCSS);
        if (!isNaN(n)) { mbRoundedValue = n; }
        else { mbRoundedUsable = false; console.warn(`❌ DROPPED menu-button/radius-rounded: unresolved value "${mbRoundedCSS}"`); }
      }
      if (mbRoundedUsable) {
        for (const mode of COMP_SIZE_MODES) mbRoundedValues[mode] = mbRoundedValue;
        variables.push({ name: 'menu-button/radius-rounded', type: 'FLOAT', scopes: ['CORNER_RADIUS'], values: mbRoundedValues });
      }
    } else {
      console.warn(`⚠  menu-button.tokens.css missing --menu-btn-radius-rounded — Rounded variant will report "build needed"`);
    }
  }

  // ── Datepicker ─────────────────────────────────────────────
  // Calendar-input archetype. Per-density day cell size, nav button size,
  // header height, and font sizes. 10-density sizing + role-less + variant-less.
  // Popover-based calendar with day grid, header (month/year + nav), footer (today button).
  const dpFile = path.join(COMP_DIR, 'datepicker/datepicker.tokens.css');
  if (fs.existsSync(dpFile)) {
    const dpTokens = parseComponentTokens(dpFile);
    const dpProps = [
      { propCSS: 'day-size',          propFigma: 'day-size' },
      { propCSS: 'nav-size',          propFigma: 'nav-size' },
      { propCSS: 'header-height',     propFigma: 'header-height' },
      { propCSS: 'header-font-size',  propFigma: 'header-font-size' },
      { propCSS: 'day-font-size',     propFigma: 'day-font-size' },
      { propCSS: 'weekday-font-size', propFigma: 'weekday-font-size' },
      { propCSS: 'nav-icon-size',     propFigma: 'nav-icon-size' },
    ];
    variables.push(...buildComponentGroup('datepicker', 'datepicker', dpTokens, extrasVarSet, dpProps));
  }

  // ── File-upload ───────────────────────────────────────────
  // File-input archetype. Per-density font-size, icon-size, padding-x, padding-y.
  // 10-density sizing + filled variant + 6 semantic roles (brand/info/danger/success/warning/neutral).
  // Drag-drop zone + upload button input. Min-tap-target enforced.
  const fuFile = path.join(COMP_DIR, 'file-upload/file-upload.tokens.css');
  if (fs.existsSync(fuFile)) {
    const fuTokens = parseComponentTokens(fuFile);
    const fuProps = [
      { propCSS: 'font-size',   propFigma: 'font-size' },
      { propCSS: 'icon-size',   propFigma: 'icon-size' },
      { propCSS: 'padding-x',   propFigma: 'padding-x' },
      { propCSS: 'padding-y',   propFigma: 'padding-y' },
    ];
    variables.push(...buildComponentGroup('file-upload', 'file-upload', fuTokens, extrasVarSet, fuProps));
  }

  // ── Avatar ────────────────────────────────────────────────
  // Identity-image archetype. Per-density size (w=h), radius, font-size
  // (for initials), icon-size, and avatar-group stacking offset. No structural
  // variants (role color is bg + text). Ring (online indicator) is non-density.
  const avatarFile = path.join(COMP_DIR, 'avatar/avatar.tokens.css');
  if (fs.existsSync(avatarFile)) {
    const avatarTokens = parseComponentTokens(avatarFile);
    const avatarProps = [
      { propCSS: 'size',         propFigma: 'size' },
      { propCSS: 'radius',       propFigma: 'radius' },
      { propCSS: 'font-size',    propFigma: 'font-size' },
      { propCSS: 'icon-size',    propFigma: 'icon-size' },
      { propCSS: 'group-offset', propFigma: 'group-offset' },
    ];
    variables.push(...buildComponentGroup('avatar', 'avatar', avatarTokens, extrasVarSet, avatarProps));
  }

  // ── Toggle (Switch) ───────────────────────────────────────
  // Form-binary archetype. Per-density dimension tokens for track + thumb.
  // CSS prefix 'switch' (component class is .switch); Figma group 'toggle'
  // so binding paths read naturally as toggle/track-w, toggle/thumb-size, etc.
  // The track radius is intentionally a single constant (--switch-track-radius
  // = radius-full → pill) and is NOT exposed per-density.
  const toggleFile = path.join(COMP_DIR, 'toggle/toggle.tokens.css');
  if (fs.existsSync(toggleFile)) {
    const toggleTokens = parseComponentTokens(toggleFile);
    const toggleProps = [
      { propCSS: 'track-w',         propFigma: 'track-w' },
      { propCSS: 'track-h',         propFigma: 'track-h' },
      { propCSS: 'thumb-size',      propFigma: 'thumb-size' },
      { propCSS: 'thumb-inset',     propFigma: 'thumb-inset' },
      { propCSS: 'thumb-x-on',      propFigma: 'thumb-x-on' },
      { propCSS: 'gap',             propFigma: 'gap' },
      { propCSS: 'label-font-size', propFigma: 'label-font-size' },
    ];
    variables.push(...buildComponentGroup('switch', 'toggle', toggleTokens, extrasVarSet, toggleProps));
  }

  // ── Checkbox ──────────────────────────────────────────────
  // Form-binary archetype. Per-density box-size + box-radius, plus label font-size
  // and the always-visible gap between box and label. Border-width is structural
  // (constant 2px) and intentionally not per-density.
  const checkboxFile = path.join(COMP_DIR, 'checkbox/checkbox.tokens.css');
  if (fs.existsSync(checkboxFile)) {
    const checkboxTokens = parseComponentTokens(checkboxFile);
    const checkboxProps = [
      { propCSS: 'box-size',         propFigma: 'box-size' },
      { propCSS: 'box-radius',       propFigma: 'box-radius' },
      { propCSS: 'gap',              propFigma: 'gap' },
      { propCSS: 'label-font-size',  propFigma: 'label-font-size' },
    ];
    variables.push(...buildComponentGroup('checkbox', 'checkbox', checkboxTokens, extrasVarSet, checkboxProps));
  }

  // ── Radio ─────────────────────────────────────────────────
  // Form-binary archetype. Per-density circle (outer) + dot (inner) +
  // label font-size + gap. Always circular so no radius axis. Border-width
  // is structural (constant 2px) and intentionally not per-density.
  const radioFile = path.join(COMP_DIR, 'radio/radio.tokens.css');
  if (fs.existsSync(radioFile)) {
    const radioTokens = parseComponentTokens(radioFile);
    const radioProps = [
      { propCSS: 'circle-size',      propFigma: 'circle-size' },
      { propCSS: 'dot-size',         propFigma: 'dot-size' },
      { propCSS: 'gap',              propFigma: 'gap' },
      { propCSS: 'label-font-size',  propFigma: 'label-font-size' },
    ];
    variables.push(...buildComponentGroup('radio', 'radio', radioTokens, extrasVarSet, radioProps));
  }

  // ── Input ─────────────────────────────────────────────────
  // Form-text archetype. Per-density height, padding-x/y, gap, min-width,
  // radius, font-size, affix-size + affix-px, and icon-side padding.
  // Border-width is structural (per-side primitives, not per-density).
  // Surface tokens are variant-keyed (outlined/filled/underline) and ship
  // via Layer 0 defaults rather than the comp-size collection.
  const inputFile = path.join(COMP_DIR, 'input/input.tokens.css');
  if (fs.existsSync(inputFile)) {
    const inputTokens = parseComponentTokens(inputFile);
    const inputProps = [
      { propCSS: 'height',          propFigma: 'height' },
      { propCSS: 'padding-x',       propFigma: 'padding-x' },
      { propCSS: 'padding-y',       propFigma: 'padding-y' },
      { propCSS: 'gap',             propFigma: 'gap' },
      { propCSS: 'min-width',       propFigma: 'min-width' },
      { propCSS: 'radius',          propFigma: 'radius' },
      { propCSS: 'font-size',       propFigma: 'font-size' },
      { propCSS: 'affix-size',      propFigma: 'affix-size' },
      { propCSS: 'affix-px',        propFigma: 'affix-px' },
      { propCSS: 'padding-x-icon',  propFigma: 'padding-x-icon' },
    ];
    variables.push(...buildComponentGroup('input', 'input', inputTokens, extrasVarSet, inputProps));
  }

  // ── Textarea ──────────────────────────────────────────────
  // Form-text archetype, multi-line peer of input. Per-density
  // padding-x/y, height (used when data-height="fixed"), radius,
  // font-size. No affix slots. Min-rows / resize are non-density.
  const textareaFile = path.join(COMP_DIR, 'textarea/textarea.tokens.css');
  if (fs.existsSync(textareaFile)) {
    const textareaTokens = parseComponentTokens(textareaFile);
    const textareaProps = [
      { propCSS: 'padding-x',  propFigma: 'padding-x' },
      { propCSS: 'padding-y',  propFigma: 'padding-y' },
      { propCSS: 'height',     propFigma: 'height' },
      { propCSS: 'radius',     propFigma: 'radius' },
      { propCSS: 'font-size',  propFigma: 'font-size' },
    ];
    variables.push(...buildComponentGroup('textarea', 'textarea', textareaTokens, extrasVarSet, textareaProps));
  }

  // ── Select ────────────────────────────────────────────────
  // Form-text archetype peer of input/textarea. Per-density
  // height, padding-x/y, radius, font-size, chevron-size.
  const selectFile = path.join(COMP_DIR, 'select/select.tokens.css');
  if (fs.existsSync(selectFile)) {
    const selectTokens = parseComponentTokens(selectFile);
    const selectProps = [
      { propCSS: 'height',        propFigma: 'height' },
      { propCSS: 'padding-x',     propFigma: 'padding-x' },
      { propCSS: 'padding-y',     propFigma: 'padding-y' },
      { propCSS: 'radius',        propFigma: 'radius' },
      { propCSS: 'font-size',     propFigma: 'font-size' },
      { propCSS: 'chevron-size',  propFigma: 'chevron-size' },
    ];
    variables.push(...buildComponentGroup('select', 'select', selectTokens, extrasVarSet, selectProps));
  }

  // ── Slider ────────────────────────────────────────────────
  // Control-range archetype. Per-density track-h (thickness),
  // thumb-w/h (handle), thumb-halo-size (hover ring),
  // tooltip-font-size.
  const sliderFile = path.join(COMP_DIR, 'slider/slider.tokens.css');
  if (fs.existsSync(sliderFile)) {
    const sliderTokens = parseComponentTokens(sliderFile);
    const sliderProps = [
      { propCSS: 'track-h',           propFigma: 'track-h' },
      { propCSS: 'thumb-w',           propFigma: 'thumb-w' },
      { propCSS: 'thumb-h',           propFigma: 'thumb-h' },
      { propCSS: 'thumb-halo-size',   propFigma: 'thumb-halo-size' },
      { propCSS: 'tooltip-font-size', propFigma: 'tooltip-font-size' },
    ];
    variables.push(...buildComponentGroup('slider', 'slider', sliderTokens, extrasVarSet, sliderProps));
  }

  // ── Progress Bar ──────────────────────────────────────────
  // Feedback-progress archetype. Per-density height (track
  // thickness), gap (track→label), label-width, font-size,
  // icon-size.
  const progressBarFile = path.join(COMP_DIR, 'progress-bar/progress-bar.tokens.css');
  if (fs.existsSync(progressBarFile)) {
    const progressBarTokens = parseComponentTokens(progressBarFile);
    const progressBarProps = [
      { propCSS: 'height',       propFigma: 'height' },
      { propCSS: 'gap',          propFigma: 'gap' },
      { propCSS: 'label-width',  propFigma: 'label-width' },
      { propCSS: 'font-size',    propFigma: 'font-size' },
      { propCSS: 'icon-size',    propFigma: 'icon-size' },
    ];
    variables.push(...buildComponentGroup('progress', 'progress-bar', progressBarTokens, extrasVarSet, progressBarProps));
  }

  // ── Progress Ring ─────────────────────────────────────────
  // Feedback-progress archetype, circular peer. Per-density
  // size (diameter), stroke (width), gap (to external label),
  // font-size (center label), icon-size.
  const progressRingFile = path.join(COMP_DIR, 'progress-ring/progress-ring.tokens.css');
  if (fs.existsSync(progressRingFile)) {
    const progressRingTokens = parseComponentTokens(progressRingFile);
    const progressRingProps = [
      { propCSS: 'size',       propFigma: 'size' },
      { propCSS: 'stroke',     propFigma: 'stroke' },
      { propCSS: 'gap',        propFigma: 'gap' },
      { propCSS: 'font-size',  propFigma: 'font-size' },
      { propCSS: 'icon-size',  propFigma: 'icon-size' },
    ];
    variables.push(...buildComponentGroup('ring', 'progress-ring', progressRingTokens, extrasVarSet, progressRingProps));
  }

  return {
    name: 'comp size',
    modes: COMP_SIZE_MODES,
    hiddenFromPublishing: false,
    variables
  };
}

// ── Master export ─────────────────────────────────────────────

export function runExport(opts = {}) {
  const t0 = Date.now();
  const dir = opts.tokensDir || TOKENS_DIR;
  const primitiveTokens = opts.primitiveTokens || parseCSSTokens(path.join(dir, 'primitives.css'));
  const semanticTokens  = opts.semanticTokens  || parseCSSTokens(path.join(dir, 'semantic.css'));
  const surfaceTokens   = opts.surfaceTokens   || parseCSSTokens(path.join(dir, 'surfaces.css'));
  const extrasTokens    = opts.extrasTokens    || parseCSSTokens(path.join(dir, 'extras.css'));

  // T0: raw palette
  const t0Col = buildT0(primitiveTokens, extrasTokens);
  const aliasMap = buildAliasMap(t0Col);

  // T1: combined surfaces + semantics + utility colors, aliased to T0
  const t1Col = buildT1(surfaceTokens, semanticTokens, aliasMap, extrasTokens);

  // T2: surface context switching → aliases T1
  const t2Col = buildT2(t1Col);

  // T3: status context switching → aliases T1
  const t3Col = buildT3(t1Col);

  // Extras: numbers (spacing, radius, motion, z-index, opacity)
  const extCol = buildExtras(primitiveTokens, extrasTokens);

  // Typography Scale: semantic ramps (display → nano) aliasing primitives-numbers
  const typoCol = buildTypography(extCol);

  // Comp size: component-level dimension tokens → aliases primitives-numbers
  const compSizeCol = buildCompSize(extCol);

  const collections = [t0Col, t1Col, t2Col, t3Col, extCol, typoCol, compSizeCol];

  let totalVars = 0;
  for (const c of collections) totalVars += c.variables.length;

  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(collections)).digest('hex').slice(0, 12);

  // ── Rename map: old Figma variable paths → new paths ──────────
  // This allows the plugin to rename existing variables in-place,
  // preserving internal IDs and component bindings.
  const renames = opts.renames || {};

  return {
    version: '1.0.0',
    source: 'Design Token Forge',
    exported: new Date().toISOString(),
    contentHash: hash,
    stats: { totalCollections: collections.length, totalVariables: totalVars, themes: ['Light', 'Dark'] },
    collections,
    renames,
    _exportMs: Date.now() - t0
  };
}

// ── Diff summary ──────────────────────────────────────────────

function computeSummary(oldData, newData) {
  if (!oldData) return { added: newData.stats.totalVariables, updated: 0, removed: 0, detail: 'Initial export' };

  const oldMap = new Map();
  for (const col of oldData.collections)
    for (const v of col.variables)
      for (const [mode, val] of Object.entries(v.values))
        oldMap.set(v.name + '::' + mode, val);

  const newMap = new Map();
  for (const col of newData.collections)
    for (const v of col.variables)
      for (const [mode, val] of Object.entries(v.values))
        newMap.set(v.name + '::' + mode, val);

  let added = 0, updated = 0, removed = 0;
  const changedVars = [];

  for (const [key, val] of newMap) {
    if (!oldMap.has(key)) { added++; }
    else if (oldMap.get(key) !== val) {
      updated++;
      if (changedVars.length < 10) {
        const name = key.split('::')[0];
        changedVars.push({ name, from: oldMap.get(key), to: val });
      }
    }
  }
  for (const key of oldMap.keys()) {
    if (!newMap.has(key)) removed++;
  }

  const parts = [];
  if (added > 0)   parts.push(added + ' added');
  if (updated > 0) parts.push(updated + ' changed');
  if (removed > 0) parts.push(removed + ' removed');

  return { added, updated, removed, detail: parts.join(', ') || 'No changes', changedVars };
}

// ── File Watcher ──────────────────────────────────────────────

function startWatching() {
  // Initial export
  rebuildTokens('startup', WATCH_FILES);

  const debounceMs = 300;
  let pending = null;
  let pendingFiles = new Set();

  for (const file of WATCH_FILES) {
    const full = path.join(TOKENS_DIR, file);
    try {
      fs.watchFile(full, { interval: 500 }, () => {
        pendingFiles.add(file);
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
          const files = [...pendingFiles];
          pendingFiles.clear();
          pending = null;
          rebuildTokens('filechange', files);
        }, debounceMs);
      });
      if (VERBOSE) console.log(`  👁  Watching: ${file}`);
    } catch (e) {
      console.error(`  ✗ Cannot watch ${file}: ${e.message}`);
    }
  }

  // Watch component CSS files too — they feed comp-size variables
  // (button, split-button, etc.) and were previously silently ignored,
  // requiring server restarts to pick up changes.
  try {
    const compEntries = fs.readdirSync(COMP_DIR, { withFileTypes: true });
    for (const ent of compEntries) {
      if (!ent.isDirectory()) continue;
      const tokenFile = path.join(COMP_DIR, ent.name, `${ent.name}.tokens.css`);
      if (!fs.existsSync(tokenFile)) continue;
      const rel = `components/${ent.name}/${ent.name}.tokens.css`;
      fs.watchFile(tokenFile, { interval: 500 }, () => {
        pendingFiles.add(rel);
        if (pending) clearTimeout(pending);
        pending = setTimeout(() => {
          const files = [...pendingFiles];
          pendingFiles.clear();
          pending = null;
          rebuildTokens('filechange', files);
        }, debounceMs);
      });
      if (VERBOSE) console.log(`  👁  Watching: ${rel}`);
    }
  } catch (e) {
    console.error(`  ✗ Cannot watch component tokens: ${e.message}`);
  }

  // Watch the active project's config.json so a fresh publish (or a
  // git pull on the local clone) flows into Figma without restarting
  // the server. Typography/T1/T2 overrides all come through this
  // path — without the watcher, publishes were invisible to Figma
  // until the next manual restart.
  if (PROJECT_ID) {
    const configPath = path.join(ROOT_DIR, 'projects', PROJECT_ID, 'config.json');
    if (fs.existsSync(configPath)) {
      try {
        fs.watchFile(configPath, { interval: 500 }, () => {
          if (pending) clearTimeout(pending);
          pending = setTimeout(async () => {
            pending = null;
            await loadProjectOverrides();
            rebuildTokens('configchange', ['projects/' + PROJECT_ID + '/config.json']);
          }, debounceMs);
        });
        if (VERBOSE) console.log(`  👁  Watching: projects/${PROJECT_ID}/config.json`);
      } catch (e) {
        console.error(`  ✗ Cannot watch config.json: ${e.message}`);
      }
    }
  }
}

function rebuildTokens(trigger, files) {
  try {
    const oldData = currentData;
    const oldHash = currentHash;
    const exportOpts = Object.assign({}, projectOverrides, { renames: loadRenames() });
    currentData = runExport(exportOpts);
    currentHash = currentData.contentHash;
    lastChanged = currentData.exported;

    if (oldHash && oldHash !== currentHash) {
      const summary = computeSummary(oldData, currentData);
      const entry = {
        time: lastChanged,
        trigger,
        files,
        oldHash: oldHash,
        newHash: currentHash,
        summary
      };
      changelog.unshift(entry);
      if (changelog.length > MAX_LOG) changelog.length = MAX_LOG;
      console.log(`  ⚡ Change detected: ${summary.detail}  (${currentHash})`);
    } else if (!oldHash) {
      console.log(`  ✓ Initial export: ${currentData.stats.totalVariables} variables  (${currentHash})`);
    } else {
      if (VERBOSE) console.log(`  · File saved, no token changes  (${currentHash})`);
    }
  } catch (e) {
    console.error(`  ✗ Export error: ${e.message}`);
  }
}

// ── HTTP Server ───────────────────────────────────────────────

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(res, data, status) {
  cors(res);
  res.writeHead(status || 200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(function (req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }

  const url = req.url.split('?')[0];

  if (url === '/status' && req.method === 'GET') {
    const pendingChanges = changelog.filter(function (c) {
      return c.newHash !== lastSyncedHash;
    }).length;

    return json(res, {
      connected: true,
      hash: currentHash,
      lastChanged: lastChanged,
      pendingChanges: pendingChanges,
      totalVariables: currentData ? currentData.stats.totalVariables : 0,
      totalCollections: currentData ? currentData.stats.totalCollections : 0,
      serverStarted: startedAt,
      lastSyncedHash: lastSyncedHash
    });
  }

  if (url === '/tokens' && req.method === 'GET') {
    if (!currentData) return json(res, { error: 'Not ready' }, 503);
    return json(res, currentData);
  }

  if (url === '/changelog' && req.method === 'GET') {
    return json(res, { entries: changelog.slice(0, 20) });
  }

  if (url === '/ack' && req.method === 'POST') {
    let body = '';
    req.on('data', function (chunk) { body += chunk; });
    req.on('end', function () {
      try {
        const data = JSON.parse(body);
        if (data.hash) lastSyncedHash = data.hash;
        return json(res, { ok: true, syncedHash: lastSyncedHash });
      } catch (e) {
        return json(res, { error: 'Bad JSON' }, 400);
      }
    });
    return;
  }

  // Health / root
  if (url === '/' || url === '/health') {
    return json(res, {
      service: 'Design Token Forge Sync Server',
      status: 'running',
      hash: currentHash,
      uptime: Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000) + 's'
    });
  }

  json(res, { error: 'Not found' }, 404);
});

// ── Start (only when run directly, not when imported) ─────────

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║  Design Token Forge — Sync Server        ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log('');
  if (PROJECT_ID) console.log(`  Project: ${PROJECT_ID}`);
  console.log(`  Port:    http://localhost:${PORT}`);
  console.log(`  Tokens:  ${TOKENS_DIR}`);
  console.log(`  Watching: ${WATCH_FILES.join(', ')}`);
  console.log('');

  loadProjectOverrides().then(() => {
    startWatching();
    server.listen(PORT, function () {
      console.log(`  ✓ Server ready — Figma plugin can connect at http://localhost:${PORT}`);
      console.log('  ─────────────────────────────────────────');
      console.log('');
    });
  });
}
