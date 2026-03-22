#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Design Token Forge — Sync Server

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

// ── Paths ─────────────────────────────────────────────────────

const TOKENS_DIR  = path.resolve(__dirname, '../tokens/src');
const COMP_DIR    = path.resolve(__dirname, '../components/src');
const WATCH_FILES = ['primitives.css', 'semantic.css', 'surfaces.css', 'extras.css'];

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

const SURFACE_NAMES = [
  'bright', 'base', 'dim', 'deep', 'accent',
  'container', 'over-container', 'float', 'inverse'
];

const SEMANTIC_ROLES = [
  'primary', 'brand', 'success', 'warning', 'danger', 'info'
];

// ── CSS parser ────────────────────────────────────────────────

function parseCSSTokens(filePath) {
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
  return { light, dark };
}

function detectType(name, value) {
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return 'COLOR';
  if (/^-?[\d.]+(?:px)?$/.test(value) && !value.includes(' ')) return 'FLOAT';
  if (name.startsWith('opacity-') || name.startsWith('z-')) return 'FLOAT';
  return 'STRING';
}

// ── Figma variable scoping ────────────────────────────────────
// Determines where each variable appears in Figma's property panel.
// See: https://www.figma.com/plugin-docs/api/VariableScope

function scopeForSurfaceProp(prop) {
  // bg, hover, pressed → fill scopes
  if (['bg', 'hover', 'pressed'].includes(prop))
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
  if (cssName.startsWith('font-size-'))    return ['FONT_SIZE'];
  if (cssName.startsWith('font-weight-'))  return ['FONT_WEIGHT'];
  // LINE_HEIGHT and LETTER_SPACING are FLOAT-only scopes;
  // if the value is STRING (e.g. "1.5em") we can't use them
  if (cssName.startsWith('line-height-')  && type === 'FLOAT') return ['LINE_HEIGHT'];
  if (cssName.startsWith('letter-spacing-') && type === 'FLOAT') return ['LETTER_SPACING'];
  return [];
}

// ── Figma path builders ───────────────────────────────────────

function primPath(cssName) {
  const p = cssName.split('-');
  if (p[0] === 'prim')    return `prim/${p[1]}/${p.slice(2).join('-')}`;
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
  // cssName like "primary-content-default" or "brand-component-bg-hover"
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
  // bg, hover, pressed, outline, separator → surfaces/*
  if (['bg', 'hover', 'pressed', 'outline', 'separator'].includes(prop))
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

  // Non-colour primitives (spacing, font-size, etc.)
  for (const [name, value] of Object.entries(primTokens.light)) {
    const type = detectType(name, value);
    if (type === 'COLOR') continue;          // colours go to T0
    variables.push({ name: primPath(name), type, scopes: [], values: { Value: value } });
  }

  // Extras (radius, shadow, motion, z-index, opacity)
  for (const [name, value] of Object.entries(extrasTokens.light)) {
    const type = detectType(name, value);
    variables.push({ name: extrasPath(name), type, scopes: [], values: { Value: value } });
  }

  return { name: 'primitives-numbers', modes: ['Value'], hiddenFromPublishing: true, variables };
}

// ── Alias map: hex → T0 variable reference ────────────────────

function buildAliasMap(t0Collection) {
  const map = new Map();
  for (const v of t0Collection.variables) {
    if (v.type !== 'COLOR') continue;
    const hex = v.values.Value;
    if (typeof hex === 'string' && !map.has(hex.toUpperCase())) {
      map.set(hex.toUpperCase(), {
        type: 'VARIABLE_ALIAS',
        collection: t0Collection.name,
        name: v.name
      });
    }
  }
  return map;
}

// ── T1: Color Tokens (combined surfaces + semantics) ──────────
//    Modes: Light, Dark
//    Every value is an alias to T0

function buildT1(surfaceTokens, semanticTokens, aliasMap) {
  const variables = [];

  // Surface variables → surface/{surfaceName}/{prop}
  for (const [name, lVal] of Object.entries(surfaceTokens.light)) {
    const { fullPath } = surfaceFigmaPath(name);
    const dVal = surfaceTokens.dark[name] || lVal;
    const type = detectType(name, lVal);
    const lAlias = aliasMap.get(lVal.toUpperCase()) || lVal;
    const dAlias = aliasMap.get(dVal.toUpperCase()) || dVal;
    variables.push({ name: fullPath, type, scopes: [], values: { Light: lAlias, Dark: dAlias } });
  }

  // Semantic variables → semantic/{role}/{prop}
  for (const [name, lVal] of Object.entries(semanticTokens.light)) {
    const { fullPath } = semanticFigmaPath(name);
    const dVal = semanticTokens.dark[name] || lVal;
    const type = detectType(name, lVal);
    const lAlias = aliasMap.get(lVal.toUpperCase()) || lVal;
    const dAlias = aliasMap.get(dVal.toUpperCase()) || dVal;
    variables.push({ name: fullPath, type, scopes: [], values: { Light: lAlias, Dark: dAlias } });
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
//    Modes: primary, brand, success, warning, danger, info
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

// ── Comp Size: Component-level dimension tokens ───────────────
//    Modes: micro, tiny, small, base, medium, large, big, huge, mega, ultra
//    Values alias primitives-numbers (spacing/*, radius/*, font/size-*)

const COMP_SIZE_MODES = [
  'micro', 'tiny', 'small', 'base', 'medium',
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
 *   var(--radius-xs)     → radius/xs
 * Returns null if not a resolvable var() reference.
 */
function cssVarToExtrasPath(value) {
  const m = value.match(/^var\(--([a-zA-Z0-9_-]+)\)$/);
  if (!m) return null;
  const name = m[1]; // e.g. "spacing-36", "radius-DEFAULT", "font-size-14"
  return primPath(name);   // reuse existing primPath() / extrasPath()
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

    for (const mode of COMP_SIZE_MODES) {
      const cssKey = `${prefix}-${propCSS}-${mode}`;
      const cssValue = tokens[cssKey];
      if (!cssValue) {
        valid = false;
        break;
      }

      const extrasPath = cssVarToExtrasPath(cssValue);
      if (extrasPath && extrasVarSet.has(extrasPath)) {
        values[mode] = {
          type: 'VARIABLE_ALIAS',
          collection: EXTRAS_COL_NAME,
          name: extrasPath
        };
      } else {
        // Direct numeric value (e.g. hardcoded px)
        const num = parseFloat(cssValue);
        if (!isNaN(num)) {
          values[mode] = num;
        } else {
          valid = false;
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
      { propCSS: 'padding-x-icon', propFigma: 'icon wrapper padding R' },
      { propCSS: 'radius',         propFigma: 'radius' },
      { propCSS: 'icon-size',      propFigma: 'icon container' },
      { propCSS: 'font-size',      propFigma: 'font-size' },
      { propCSS: 'padding-x',      propFigma: 'text wrapper padding L' },
      { propCSS: 'padding-x',      propFigma: 'text wrapper padding R' },
    ];
    variables.push(...buildComponentGroup('btn', 'button', btnTokens, extrasVarSet, btnProps));
  }

  return {
    name: 'comp size',
    modes: COMP_SIZE_MODES,
    hiddenFromPublishing: false,
    variables
  };
}

// ── Master export ─────────────────────────────────────────────

export function runExport() {
  const t0 = Date.now();
  const primitiveTokens = parseCSSTokens(path.join(TOKENS_DIR, 'primitives.css'));
  const semanticTokens  = parseCSSTokens(path.join(TOKENS_DIR, 'semantic.css'));
  const surfaceTokens   = parseCSSTokens(path.join(TOKENS_DIR, 'surfaces.css'));
  const extrasTokens    = parseCSSTokens(path.join(TOKENS_DIR, 'extras.css'));

  // T0: raw palette
  const t0Col = buildT0(primitiveTokens, extrasTokens);
  const aliasMap = buildAliasMap(t0Col);

  // T1: combined surfaces + semantics, aliased to T0
  const t1Col = buildT1(surfaceTokens, semanticTokens, aliasMap);

  // T2: surface context switching → aliases T1
  const t2Col = buildT2(t1Col);

  // T3: status context switching → aliases T1
  const t3Col = buildT3(t1Col);

  // Extras: numbers (spacing, radius, motion, z-index, opacity)
  const extCol = buildExtras(primitiveTokens, extrasTokens);

  // Comp size: component-level dimension tokens → aliases primitives-numbers
  const compSizeCol = buildCompSize(extCol);

  const collections = [t0Col, t1Col, t2Col, t3Col, extCol, compSizeCol];

  let totalVars = 0;
  for (const c of collections) totalVars += c.variables.length;

  const hash = crypto.createHash('sha256')
    .update(JSON.stringify(collections)).digest('hex').slice(0, 12);

  return {
    version: '1.0.0',
    source: 'Design Token Forge',
    exported: new Date().toISOString(),
    contentHash: hash,
    stats: { totalCollections: collections.length, totalVariables: totalVars, themes: ['Light', 'Dark'] },
    collections,
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
}

function rebuildTokens(trigger, files) {
  try {
    const oldData = currentData;
    const oldHash = currentHash;
    currentData = runExport();
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
  console.log(`  Port:    http://localhost:${PORT}`);
  console.log(`  Tokens:  ${TOKENS_DIR}`);
  console.log(`  Watching: ${WATCH_FILES.join(', ')}`);
  console.log('');

  startWatching();

  server.listen(PORT, function () {
    console.log(`  ✓ Server ready — Figma plugin can connect at http://localhost:${PORT}`);
    console.log('  ─────────────────────────────────────────');
    console.log('');
  });
}
