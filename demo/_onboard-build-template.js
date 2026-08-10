#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════
   Design Token Forge — Standalone Build

   Generates static JSON files from config.json for GitHub Pages.
   The Figma plugin (shared by your team lead) polls these files.

   Usage:
     node build.js

   Output:
     dist/status.json   — lightweight hash (plugin polls this)
     dist/tokens.json   — full Figma-compatible variable payload
     dist/projects.json — project manifest
     dist/config.json   — project configuration
   ═══════════════════════════════════════════════════════════════ */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const OUT_DIR = path.resolve(__dirname, 'dist');

// ── Palette Engine (inline — no external dependencies) ────────

const STEP_NAMES = [
  'white','25','50','75','100','125','150','175','200','250','300','350',
  '400','450','500','550','600','650','700','750','800','850','900','black'
];

function hexToHSL(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  const r = parseInt(hex.slice(0,2),16)/255;
  const g = parseInt(hex.slice(2,4),16)/255;
  const b = parseInt(hex.slice(4,6),16)/255;
  const max = Math.max(r,g,b), min = Math.min(r,g,b);
  let h=0, s=0, l=(max+min)/2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d/(2-max-min) : d/(max+min);
    if (max === r) h = ((g-b)/d + (g<b?6:0))/6;
    else if (max === g) h = ((b-r)/d+2)/6;
    else h = ((r-g)/d+4)/6;
  }
  return { h: h*360, s: s*100, l: l*100 };
}

function hslToHex(h, s, l) {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(100, s)) / 100;
  l = Math.max(0, Math.min(100, l)) / 100;
  const c = (1 - Math.abs(2*l - 1)) * s;
  const x = c * (1 - Math.abs((h/60)%2 - 1));
  const m = l - c/2;
  let r=0, g=0, b=0;
  if (h < 60) { r=c; g=x; }
  else if (h < 120) { r=x; g=c; }
  else if (h < 180) { g=c; b=x; }
  else if (h < 240) { g=x; b=c; }
  else if (h < 300) { r=x; b=c; }
  else { r=c; b=x; }
  const toHex = v => Math.round((v+m)*255).toString(16).padStart(2,'0');
  return '#' + toHex(r) + toHex(g) + toHex(b);
}

function generatePalette(keyHex) {
  const { h, s } = hexToHSL(keyHex);
  // Generate 24 steps from white to black with the hue
  const lightnesses = [
    100, 97, 95, 93, 90, 87, 84, 80, 76, 68, 60, 52,
    44, 38, 34, 28, 24, 20, 17, 14, 11, 8, 5, 0
  ];
  // Saturation curve: low at extremes, full in middle
  const steps = lightnesses.map((l, i) => {
    let sat = s;
    if (l > 92) sat = s * 0.3;
    else if (l > 80) sat = s * 0.6;
    else if (l < 10) sat = s * 0.4;
    else if (l < 20) sat = s * 0.7;
    return { name: STEP_NAMES[i], hex: hslToHex(h, sat, l) };
  });
  // Fix endpoints
  steps[0].hex = '#FFFFFF';
  steps[steps.length - 1].hex = '#000000';
  return { keyHex, steps };
}

// ── Token Generation ──────────────────────────────────────────

const TOKEN_ROLES = ['brand', 'danger', 'warning', 'info', 'success'];
const ROLE_TO_PALETTE = {
  brand: 'brand', danger: 'danger',
  warning: 'warning', info: 'info', success: 'success'
};

const SURFACE_NAMES = [
  'bright', 'base', 'dim', 'deep', 'accent',
  'container', 'over-container', 'float', 'inverse'
];

const DEFAULT_SURF_L = {
  bright:           {bg:'white',outline:'150',separator:'150','ct-default':'900','ct-strong':'black','ct-subtle':'600','ct-faint':'400','cm-bg':'25','cm-bg-hover':'50','cm-bg-pressed':'75','cm-outline':'150','cm-outline-hover':'200','cm-outline-pressed':'250','cm-separator':'150'},
  base:             {bg:'25',outline:'150',separator:'175','ct-default':'900','ct-strong':'black','ct-subtle':'600','ct-faint':'400','cm-bg':'white','cm-bg-hover':'25','cm-bg-pressed':'50','cm-outline':'150','cm-outline-hover':'200','cm-outline-pressed':'250','cm-separator':'175'},
  dim:              {bg:'50',outline:'175',separator:'175','ct-default':'900','ct-strong':'black','ct-subtle':'600','ct-faint':'400','cm-bg':'25','cm-bg-hover':'50','cm-bg-pressed':'75','cm-outline':'175','cm-outline-hover':'200','cm-outline-pressed':'300','cm-separator':'175'},
  deep:             {bg:'75',outline:'175',separator:'200','ct-default':'900','ct-strong':'black','ct-subtle':'600','ct-faint':'450','cm-bg':'50','cm-bg-hover':'75','cm-bg-pressed':'100','cm-outline':'200','cm-outline-hover':'250','cm-outline-pressed':'300','cm-separator':'200'},
  container:        {bg:'white',outline:'150',separator:'150','ct-default':'900','ct-strong':'black','ct-subtle':'600','ct-faint':'400','cm-bg':'25','cm-bg-hover':'50','cm-bg-pressed':'75','cm-outline':'150','cm-outline-hover':'200','cm-outline-pressed':'250','cm-separator':'150'},
  'over-container': {bg:'white',outline:'150',separator:'175','ct-default':'900','ct-strong':'black','ct-subtle':'600','ct-faint':'400','cm-bg':'50','cm-bg-hover':'75','cm-bg-pressed':'100','cm-outline':'175','cm-outline-hover':'200','cm-outline-pressed':'250','cm-separator':'175'},
  float:            {bg:'white',outline:'150',separator:'175','ct-default':'900','ct-strong':'black','ct-subtle':'550','ct-faint':'400','cm-bg':'50','cm-bg-hover':'75','cm-bg-pressed':'100','cm-outline':'175','cm-outline-hover':'250','cm-outline-pressed':'300','cm-separator':'175'},
  inverse:          {bg:'900',outline:'700',separator:'700','ct-default':'25','ct-strong':'white','ct-subtle':'250','ct-faint':'400','cm-bg':'850','cm-bg-hover':'800','cm-bg-pressed':'750','cm-outline':'600','cm-outline-hover':'550','cm-outline-pressed':'500','cm-separator':'700'}
};

const DEFAULT_SURF_D = {
  bright:           {bg:'850',outline:'700',separator:'700','ct-default':'50','ct-strong':'white','ct-subtle':'250','ct-faint':'450','cm-bg':'800','cm-bg-hover':'750','cm-bg-pressed':'700','cm-outline':'600','cm-outline-hover':'550','cm-outline-pressed':'500','cm-separator':'700'},
  base:             {bg:'900',outline:'750',separator:'700','ct-default':'50','ct-strong':'white','ct-subtle':'250','ct-faint':'450','cm-bg':'850','cm-bg-hover':'800','cm-bg-pressed':'750','cm-outline':'600','cm-outline-hover':'550','cm-outline-pressed':'500','cm-separator':'700'},
  dim:              {bg:'900',outline:'750',separator:'750','ct-default':'75','ct-strong':'white','ct-subtle':'250','ct-faint':'450','cm-bg':'850','cm-bg-hover':'800','cm-bg-pressed':'750','cm-outline':'600','cm-outline-hover':'550','cm-outline-pressed':'500','cm-separator':'750'},
  deep:             {bg:'black',outline:'800',separator:'750','ct-default':'75','ct-strong':'white','ct-subtle':'300','ct-faint':'450','cm-bg':'900','cm-bg-hover':'850','cm-bg-pressed':'800','cm-outline':'700','cm-outline-hover':'600','cm-outline-pressed':'550','cm-separator':'750'},
  container:        {bg:'850',outline:'700',separator:'700','ct-default':'50','ct-strong':'white','ct-subtle':'250','ct-faint':'450','cm-bg':'800','cm-bg-hover':'750','cm-bg-pressed':'700','cm-outline':'600','cm-outline-hover':'550','cm-outline-pressed':'500','cm-separator':'700'},
  'over-container': {bg:'800',outline:'600',separator:'600','ct-default':'50','ct-strong':'white','ct-subtle':'200','ct-faint':'400','cm-bg':'750','cm-bg-hover':'700','cm-bg-pressed':'600','cm-outline':'550','cm-outline-hover':'500','cm-outline-pressed':'450','cm-separator':'600'},
  float:            {bg:'750',outline:'550',separator:'550','ct-default':'25','ct-strong':'white','ct-subtle':'200','ct-faint':'300','cm-bg':'700','cm-bg-hover':'600','cm-bg-pressed':'550','cm-outline':'500','cm-outline-hover':'450','cm-outline-pressed':'400','cm-separator':'550'},
  inverse:          {bg:'900',outline:'700',separator:'700','ct-default':'25','ct-strong':'white','ct-subtle':'250','ct-faint':'400','cm-bg':'850','cm-bg-hover':'800','cm-bg-pressed':'750','cm-outline':'600','cm-outline-hover':'550','cm-outline-pressed':'500','cm-separator':'700'}
};

function stepLookup(palette) {
  const map = {};
  for (const step of palette.steps) map[step.name] = step.hex;
  return map;
}

function generatePrimitiveTokens(palettes) {
  const light = {};
  for (const [key, palette] of Object.entries(palettes)) {
    for (const step of palette.steps) {
      light[`prim-${key}-${step.name}`] = step.hex;
    }
  }
  return { light, dark: {} };
}

function generateSemanticTokens(config, palettes) {
  const lightMap = config.semanticMap?.light || {};
  const darkMap  = config.semanticMap?.dark || {};
  const light = {}, dark = {};

  for (const role of TOKEN_ROLES) {
    const palKey = ROLE_TO_PALETTE[role] || role;
    const palette = palettes[palKey];
    if (!palette) continue;
    const look = stepLookup(palette);
    for (const [prop, stepName] of Object.entries(lightMap)) {
      light[`${role}-${prop}`] = stepName === 'fixed-white' ? '#FFFFFF' : (look[stepName] || '#000000');
    }
    for (const [prop, stepName] of Object.entries(darkMap)) {
      dark[`${role}-${prop}`] = stepName === 'fixed-white' ? '#FFFFFF' : (look[stepName] || '#000000');
    }
  }
  return { light, dark };
}

function generateSurfaceTokens(config, palettes) {
  const surfPalSrc = config.surfacePaletteSrc || {};
  const light = {}, dark = {};

  for (const surf of SURFACE_NAMES) {
    const palKey = surfPalSrc[surf] || 'greyscale';
    const palette = palettes[palKey];
    if (!palette) continue;
    const look = stepLookup(palette);

    const lMap = DEFAULT_SURF_L[surf] || {};
    const dMap = DEFAULT_SURF_D[surf] || {};

    for (const [prop, stepName] of Object.entries(lMap)) {
      const tokenName = `surface-${surf}-${prop}`;
      light[tokenName] = stepName === 'white' ? '#FFFFFF'
        : stepName === 'black' ? '#000000'
        : (look[stepName] || '#888888');
    }
    for (const [prop, stepName] of Object.entries(dMap)) {
      const tokenName = `surface-${surf}-${prop}`;
      dark[tokenName] = stepName === 'white' ? '#FFFFFF'
        : stepName === 'black' ? '#000000'
        : (look[stepName] || '#888888');
    }
  }
  return { light, dark };
}

// ── Build Figma-compatible payload ────────────────────────────

function buildFigmaPayload(config) {
  // Generate palettes from config
  const palettes = {};
  for (const [key, hex] of Object.entries(config.paletteKeys)) {
    palettes[key] = generatePalette(hex);
  }

  const primitives = generatePrimitiveTokens(palettes);
  const semantic   = generateSemanticTokens(config, palettes);
  const surfaces   = generateSurfaceTokens(config, palettes);

  // Build collections array in Figma format
  const collections = [];

  // T0: Primitive Colors (1 mode)
  const t0Vars = [];
  for (const [name, val] of Object.entries(primitives.light)) {
    t0Vars.push({ name: name.replace(/-/g, '/'), type: 'COLOR', values: { 'Value': val } });
  }
  if (t0Vars.length) {
    collections.push({ name: 'T0 Primitive Colors', modes: ['Value'], variables: t0Vars });
  }

  // T1: Color Tokens (Light / Dark)
  const t1Vars = [];
  const allSemanticKeys = new Set([...Object.keys(semantic.light), ...Object.keys(semantic.dark)]);
  for (const name of allSemanticKeys) {
    t1Vars.push({
      name: name.replace(/-/g, '/'),
      type: 'COLOR',
      values: { Light: semantic.light[name] || '#000000', Dark: semantic.dark[name] || '#000000' }
    });
  }
  if (t1Vars.length) {
    collections.push({ name: 'T1 Color Tokens', modes: ['Light', 'Dark'], variables: t1Vars });
  }

  // T2: Surface Context Tokens (9 modes — one per surface)
  const surfProps = Object.keys(DEFAULT_SURF_L.bright || {});
  const t2LVars = [], t2DVars = [];

  // Light surfaces collection
  for (const prop of surfProps) {
    const values = {};
    for (const surf of SURFACE_NAMES) {
      const key = `surface-${surf}-${prop}`;
      values[surf] = surfaces.light[key] || '#888888';
    }
    t2LVars.push({ name: prop, type: 'COLOR', values });
  }
  if (t2LVars.length) {
    collections.push({ name: 'T2 Surface Context Tokens', modes: SURFACE_NAMES.slice(), variables: t2LVars });
  }

  // Compute content hash
  const payload = {
    collections,
    exported: new Date().toISOString(),
    project: { id: config.id, name: config.name },
    stats: {
      totalVariables: t0Vars.length + t1Vars.length + t2LVars.length,
      totalCollections: collections.length
    }
  };
  payload.contentHash = crypto.createHash('md5')
    .update(JSON.stringify(payload.collections))
    .digest('hex').slice(0, 12);

  return payload;
}

// ── Main build ────────────────────────────────────────────────

function main() {
  console.log('');
  console.log('  Design Token Forge — Standalone Build');
  console.log('  ─────────────────────────────────────');

  const configPath = path.resolve(__dirname, 'config.json');
  if (!fs.existsSync(configPath)) {
    console.error('  ✗ config.json not found. Create one first.');
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  console.log(`  Project: ${config.name} (${config.id})`);

  const data = buildFigmaPayload(config);

  // Ensure output dir
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // Write tokens.json
  fs.writeFileSync(path.join(OUT_DIR, 'tokens.json'), JSON.stringify(data, null, 2));
  console.log(`  ✓ tokens.json  → ${data.stats.totalVariables} variables (${data.contentHash})`);

  // Write status.json
  const status = {
    connected: true,
    hash: data.contentHash,
    lastChanged: data.exported,
    pendingChanges: 0,
    totalVariables: data.stats.totalVariables,
    totalCollections: data.stats.totalCollections,
    project: data.project
  };
  fs.writeFileSync(path.join(OUT_DIR, 'status.json'), JSON.stringify(status, null, 2));
  console.log(`  ✓ status.json  → hash ${data.contentHash}`);

  // Write projects.json (single project manifest for the plugin)
  const projectList = [{ id: config.id, name: config.name, description: config.description || '' }];
  fs.writeFileSync(path.join(OUT_DIR, 'projects.json'), JSON.stringify(projectList, null, 2));
  console.log(`  ✓ projects.json`);

  // Copy config.json to dist
  fs.copyFileSync(configPath, path.join(OUT_DIR, 'config.json'));
  console.log(`  ✓ config.json`);

  // Write index.html redirect
  const indexHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${config.name} — Design Token Forge</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 80px auto; padding: 20px; color: #333; }
  h1 { font-size: 24px; }
  code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; font-size: 13px; }
  .status { margin-top: 20px; padding: 12px 16px; background: #e6f9e6; border: 1px solid #bbf7d0; border-radius: 8px; }
  .status strong { color: #166534; }
</style>
</head>
<body>
<h1>🎨 ${config.name}</h1>
<p>Design Token Forge deployment for <strong>${config.name}</strong>.</p>
<div class="status">
  <strong>✓ Tokens deployed</strong> — ${data.stats.totalVariables} variables in ${data.stats.totalCollections} collections.
</div>
<h2>Connect from Figma</h2>
<ol>
  <li>Open the <strong>Design Token Forge</strong> plugin in Figma</li>
  <li>Expand <em>Server URL</em> at the bottom</li>
  <li>Paste this URL and hit Save:</li>
</ol>
<pre><code id="url"></code></pre>
<script>document.getElementById('url').textContent = location.origin + location.pathname.replace(/\\/index\\.html$/, '');</script>
<p>The plugin will automatically detect your tokens and offer to sync.</p>
</body>
</html>`;
  fs.writeFileSync(path.join(OUT_DIR, 'index.html'), indexHtml);
  console.log('  ✓ index.html   → landing page');

  console.log('');
  console.log('  Done! Deploy the dist/ folder to GitHub Pages.');
  console.log('');
}

main();
