#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Design Token Forge → Figma Variables Exporter

   Reads DTF's CSS custom property token files and exports a JSON
   payload compatible with the DTF Figma Plugin for importing
   into Figma's native Variable system.

   Usage:
     node export-figma.js [--out <path>]

   Output: dtf-figma-tokens.json (default: ../figma-plugin/)
   ═══════════════════════════════════════════════════════════════ */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ── Configuration ─────────────────────────────────────────────

const TOKENS_DIR = path.resolve(__dirname, '../../tokens/src');
const DEFAULT_OUTPUT = path.resolve(
  __dirname, '../../figma-plugin/dtf-figma-tokens.json'
);

// Surface names ordered longest-first so "over-container" matches before "container"
const SURFACE_NAMES = [
  'over-container', 'container',
  'bright', 'base', 'dim', 'deep', 'accent', 'float', 'inverse'
];

// ── CSS Parsing ───────────────────────────────────────────────

function parseCSSTokens(filePath) {
  const css = fs.readFileSync(filePath, 'utf-8');
  const light = {};
  const dark = {};

  // Split at the dark-theme selector
  const darkIdx = css.indexOf('[data-theme="dark"]');
  const lightBlock = darkIdx >= 0 ? css.slice(0, darkIdx) : css;
  const darkBlock  = darkIdx >= 0 ? css.slice(darkIdx) : '';

  const propRe = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;

  let m;
  while ((m = propRe.exec(lightBlock)) !== null) {
    light[m[1]] = m[2].trim();
  }
  propRe.lastIndex = 0;
  while ((m = propRe.exec(darkBlock)) !== null) {
    dark[m[1]] = m[2].trim();
  }

  return { light, dark };
}

// ── Type Detection ────────────────────────────────────────────

function detectType(name, value) {
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return 'COLOR';
  if (/^-?[\d.]+(?:px)?$/.test(value) && !value.includes(' ')) return 'FLOAT';
  if (name.startsWith('opacity-')) return 'FLOAT';
  if (name.startsWith('z-')) return 'FLOAT';
  return 'STRING';
}

// ── Name Transformation ───────────────────────────────────────
// CSS:   --prim-brand-50          →  Figma: prim/brand/50
// CSS:   --primary-content-default →  Figma: primary/content-default
// CSS:   --surface-base-ct-default →  Figma: surface/base/ct-default

function toFigmaPath(name, category) {
  const parts = name.split('-');

  if (category === 'primitives') {
    if (parts[0] === 'prim') {
      return `prim/${parts[1]}/${parts.slice(2).join('-')}`;
    }
    if (parts[0] === 'color') return `color/${parts.slice(1).join('-')}`;
    if (parts[0] === 'spacing') return `spacing/${parts.slice(1).join('-')}`;
    if (parts[0] === 'font') return `font/${parts.slice(1).join('-')}`;
    return parts.join('/');
  }

  if (category === 'semantic') {
    // e.g. primary-component-bg-default → primary/component-bg-default
    const role = parts[0];
    return `${role}/${parts.slice(1).join('-')}`;
  }

  if (category === 'surfaces') {
    // e.g. surface-over-container-ct-default → surface/over-container/ct-default
    const rest = parts.slice(1).join('-'); // strip "surface"
    for (const sn of SURFACE_NAMES) {
      if (rest.startsWith(sn + '-')) {
        return `surface/${sn}/${rest.slice(sn.length + 1)}`;
      }
      if (rest === sn) return `surface/${sn}`;
    }
    return `surface/${rest}`;
  }

  if (category === 'extras') {
    if (parts[0] === 'z') return `z-index/${parts.slice(1).join('-')}`;
    return `${parts[0]}/${parts.slice(1).join('-')}`;
  }

  return name;
}

// ── Collection Builder ────────────────────────────────────────

function buildCollection(name, tokens, category) {
  const { light, dark } = tokens;
  const hasDark = Object.keys(dark).length > 0;
  const modes = hasDark ? ['Light', 'Dark'] : ['Value'];
  const variables = [];

  for (const [varName, lightValue] of Object.entries(light)) {
    const type = detectType(varName, lightValue);
    const figmaPath = toFigmaPath(varName, category);

    const values = {};
    if (hasDark) {
      values['Light'] = lightValue;
      values['Dark'] = dark[varName] || lightValue; // fallback to light if missing
    } else {
      values['Value'] = lightValue;
    }

    variables.push({ name: figmaPath, type, values });
  }

  return { name, modes, variables };
}

// ── Main ──────────────────────────────────────────────────────

function main() {
  const outIdx = process.argv.indexOf('--out');
  const outputPath = outIdx >= 0
    ? path.resolve(process.argv[outIdx + 1])
    : DEFAULT_OUTPUT;

  console.log('Design Token Forge → Figma Variables Export');
  console.log('─'.repeat(48));

  // Parse all token files
  const primitiveTokens = parseCSSTokens(path.join(TOKENS_DIR, 'primitives.css'));
  const semanticTokens  = parseCSSTokens(path.join(TOKENS_DIR, 'semantic.css'));
  const surfaceTokens   = parseCSSTokens(path.join(TOKENS_DIR, 'surfaces.css'));
  const extrasTokens    = parseCSSTokens(path.join(TOKENS_DIR, 'extras.css'));

  // Build 4 collections
  const collections = [
    buildCollection('DTF / Primitives',     primitiveTokens, 'primitives'),
    buildCollection('DTF / Semantic Roles',  semanticTokens,  'semantic'),
    buildCollection('DTF / Surfaces',        surfaceTokens,   'surfaces'),
    buildCollection('DTF / Extras',          extrasTokens,    'extras'),
  ];

  // Assemble output payload
  const output = {
    version: '1.0.0',
    source: 'Design Token Forge',
    exported: new Date().toISOString(),
    stats: {},
    collections
  };

  // Compute content hash for sync diffing
  const hashInput = JSON.stringify(collections);
  output.contentHash = crypto.createHash('sha256')
    .update(hashInput).digest('hex').slice(0, 12);

  // Compute & log stats
  let totalVars = 0;
  for (const col of collections) {
    console.log(`  ${col.name}: ${col.variables.length} variables (${col.modes.join(', ')})`);
    totalVars += col.variables.length;
  }
  output.stats = {
    totalCollections: collections.length,
    totalVariables: totalVars,
    themes: ['Light', 'Dark']
  };

  console.log('─'.repeat(48));
  console.log(`  Total: ${totalVars} variables`);

  // Write JSON
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(`\n  ✓ Exported to: ${outputPath}`);
}

main();
