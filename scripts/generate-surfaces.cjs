#!/usr/bin/env node
/**
 * generate-surfaces.cjs
 *
 * Generates surfaces.css deterministically from primitive palette steps.
 * Every hex value maps to an existing primitive → 100% Figma alias coverage.
 *
 * ARCHITECTURE:
 *   Neutral surfaces (bright, base, dim, deep, container, over-container, float, inverse)
 *     → use greyscale palette steps
 *   Accent surface
 *     → uses monochromatic (primary) palette steps
 *
 * SURFACE STEP MAP:
 *   Each surface property maps to a palette step name (e.g., "25", "900", "white").
 *   The generator reads the current palette values from primitives.css and outputs
 *   surfaces.css with those exact hex values.
 *
 * BENEFIT:
 *   Change primitives → re-run this script → surfaces update → Figma aliases cascade.
 *   No orphan hex values, no manual editing of surfaces.css.
 */

const fs = require('fs');
const path = require('path');

const TOKENS_DIR = path.resolve(__dirname, '../packages/tokens/src');

// ── Parse primitives.css ──────────────────────────────────────
function parsePrimitives() {
  const css = fs.readFileSync(path.join(TOKENS_DIR, 'primitives.css'), 'utf-8');
  const palettes = {};
  const re = /--prim-([a-zA-Z]+)-([a-zA-Z0-9]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(css)) !== null) {
    const [, palette, step, value] = m;
    if (!palettes[palette]) palettes[palette] = {};
    palettes[palette][step] = value.trim();
  }
  return palettes;
}

// ── Step mapping ──────────────────────────────────────────────
// Grey step names from the 21-step greyscale palette.
// Light = light-to-dark (white..black), Dark = dark-to-light (black..white)
// Each surface definition maps 16 property slots to palette step names.

// Light greyscale surfaces: brightest → deepest
// "g" prefix = greyscale palette. "m" prefix = monochromatic palette.

const LIGHT_SURFACE_MAP = {
  // Surface-bright: whitest surface
  bright: {
    bg:                   'white',     // #FFFFFF
    hover:                '25',        // F6
    pressed:              '50',        // F1
    outline:              '150',       // D1
    separator:            '150',       // D1
    'ct-default':         '900',       // 1B
    'ct-strong':          'black',     // 00
    'ct-subtle':          '600',       // 5E
    'ct-faint':           '400',       // 86
    'cm-bg':              '25',        // F6
    'cm-bg-hover':        '50',        // F1
    'cm-bg-pressed':      '75',        // E8
    'cm-outline':         '150',       // D1
    'cm-outline-hover':   '200',       // BB
    'cm-outline-pressed': '250',       // AB
    'cm-separator':       '150',       // D1
  },
  // Surface-base: default canvas
  base: {
    bg:                   '25',
    hover:                '50',
    pressed:              '75',
    outline:              '150',
    separator:            '175',
    'ct-default':         '900',
    'ct-strong':          'black',
    'ct-subtle':          '600',
    'ct-faint':           '400',
    'cm-bg':              'white',
    'cm-bg-hover':        '25',
    'cm-bg-pressed':      '50',
    'cm-outline':         '150',
    'cm-outline-hover':   '200',
    'cm-outline-pressed': '250',
    'cm-separator':       '175',
  },
  // Surface-dim: receding area
  dim: {
    bg:                   '50',
    hover:                '75',
    pressed:              '100',
    outline:              '175',
    separator:            '175',
    'ct-default':         '900',
    'ct-strong':          'black',
    'ct-subtle':          '600',
    'ct-faint':           '400',
    'cm-bg':              '25',
    'cm-bg-hover':        '50',
    'cm-bg-pressed':      '75',
    'cm-outline':         '175',
    'cm-outline-hover':   '200',
    'cm-outline-pressed': '300',
    'cm-separator':       '175',
  },
  // Surface-deep: deeply recessed (sidebars, wells)
  deep: {
    bg:                   '75',
    hover:                '100',
    pressed:              '150',
    outline:              '175',
    separator:            '200',
    'ct-default':         '900',
    'ct-strong':          'black',
    'ct-subtle':          '600',
    'ct-faint':           '450',
    'cm-bg':              '50',
    'cm-bg-hover':        '75',
    'cm-bg-pressed':      '100',
    'cm-outline':         '200',
    'cm-outline-hover':   '250',
    'cm-outline-pressed': '300',
    'cm-separator':       '200',
  },
  // Surface-container: cards/panels (bright fill on neutral bg)
  container: {
    bg:                   'white',
    hover:                '25',
    pressed:              '50',
    outline:              '150',
    separator:            '150',
    'ct-default':         '900',
    'ct-strong':          'black',
    'ct-subtle':          '600',
    'ct-faint':           '400',
    'cm-bg':              '25',
    'cm-bg-hover':        '50',
    'cm-bg-pressed':      '75',
    'cm-outline':         '150',
    'cm-outline-hover':   '200',
    'cm-outline-pressed': '250',
    'cm-separator':       '150',
  },
  // Surface-over-container: popover, top-level dropdown
  'over-container': {
    bg:                   'white',
    hover:                '25',
    pressed:              '50',
    outline:              '150',
    separator:            '175',
    'ct-default':         '900',
    'ct-strong':          'black',
    'ct-subtle':          '600',
    'ct-faint':           '400',
    'cm-bg':              '50',
    'cm-bg-hover':        '75',
    'cm-bg-pressed':      '100',
    'cm-outline':         '175',
    'cm-outline-hover':   '200',
    'cm-outline-pressed': '250',
    'cm-separator':       '175',
  },
  // Surface-float: tooltip, menu
  float: {
    bg:                   'white',
    hover:                '25',
    pressed:              '50',
    outline:              '150',
    separator:            '175',
    'ct-default':         '900',
    'ct-strong':          'black',
    'ct-subtle':          '550',
    'ct-faint':           '400',
    'cm-bg':              '50',
    'cm-bg-hover':        '75',
    'cm-bg-pressed':      '100',
    'cm-outline':         '175',
    'cm-outline-hover':   '250',
    'cm-outline-pressed': '300',
    'cm-separator':       '175',
  },
  // Surface-inverse: FIXED dark surface in all themes (snackbars, toasts)
  inverse: {
    bg:                   '900',
    hover:                '850',
    pressed:              '800',
    outline:              '700',
    separator:            '700',
    'ct-default':         '25',
    'ct-strong':          'white',
    'ct-subtle':          '250',
    'ct-faint':           '400',
    'cm-bg':              '850',
    'cm-bg-hover':        '800',
    'cm-bg-pressed':      '750',
    'cm-outline':         '600',
    'cm-outline-hover':   '550',
    'cm-outline-pressed': '500',
    'cm-separator':       '700',
  },
};

// Dark greyscale surfaces: reverse — darkest base, lighter text
const DARK_SURFACE_MAP = {
  bright: {
    bg:                   '850',
    hover:                '800',
    pressed:              '750',
    outline:              '700',
    separator:            '700',
    'ct-default':         '50',
    'ct-strong':          'white',
    'ct-subtle':          '250',
    'ct-faint':           '450',
    'cm-bg':              '800',
    'cm-bg-hover':        '750',
    'cm-bg-pressed':      '700',
    'cm-outline':         '600',
    'cm-outline-hover':   '550',
    'cm-outline-pressed': '500',
    'cm-separator':       '700',
  },
  base: {
    bg:                   '900',
    hover:                '850',
    pressed:              '800',
    outline:              '750',
    separator:            '700',
    'ct-default':         '50',
    'ct-strong':          'white',
    'ct-subtle':          '250',
    'ct-faint':           '450',
    'cm-bg':              '850',
    'cm-bg-hover':        '800',
    'cm-bg-pressed':      '750',
    'cm-outline':         '600',
    'cm-outline-hover':   '550',
    'cm-outline-pressed': '500',
    'cm-separator':       '700',
  },
  dim: {
    bg:                   '900',
    hover:                '850',
    pressed:              '800',
    outline:              '750',
    separator:            '750',
    'ct-default':         '75',
    'ct-strong':          'white',
    'ct-subtle':          '250',
    'ct-faint':           '450',
    'cm-bg':              '850',
    'cm-bg-hover':        '800',
    'cm-bg-pressed':      '750',
    'cm-outline':         '600',
    'cm-outline-hover':   '550',
    'cm-outline-pressed': '500',
    'cm-separator':       '750',
  },
  deep: {
    bg:                   'black',
    hover:                '900',
    pressed:              '850',
    outline:              '800',
    separator:            '750',
    'ct-default':         '75',
    'ct-strong':          'white',
    'ct-subtle':          '300',
    'ct-faint':           '450',
    'cm-bg':              '900',
    'cm-bg-hover':        '850',
    'cm-bg-pressed':      '800',
    'cm-outline':         '700',
    'cm-outline-hover':   '600',
    'cm-outline-pressed': '550',
    'cm-separator':       '750',
  },
  container: {
    bg:                   '850',
    hover:                '800',
    pressed:              '750',
    outline:              '700',
    separator:            '700',
    'ct-default':         '50',
    'ct-strong':          'white',
    'ct-subtle':          '250',
    'ct-faint':           '450',
    'cm-bg':              '800',
    'cm-bg-hover':        '750',
    'cm-bg-pressed':      '700',
    'cm-outline':         '600',
    'cm-outline-hover':   '550',
    'cm-outline-pressed': '500',
    'cm-separator':       '700',
  },
  'over-container': {
    bg:                   '800',
    hover:                '750',
    pressed:              '700',
    outline:              '600',
    separator:            '600',
    'ct-default':         '50',
    'ct-strong':          'white',
    'ct-subtle':          '200',
    'ct-faint':           '400',
    'cm-bg':              '750',
    'cm-bg-hover':        '700',
    'cm-bg-pressed':      '600',
    'cm-outline':         '550',
    'cm-outline-hover':   '500',
    'cm-outline-pressed': '450',
    'cm-separator':       '600',
  },
  float: {
    bg:                   '750',
    hover:                '700',
    pressed:              '600',
    outline:              '550',
    separator:            '550',
    'ct-default':         '25',
    'ct-strong':          'white',
    'ct-subtle':          '200',
    'ct-faint':           '300',
    'cm-bg':              '700',
    'cm-bg-hover':        '600',
    'cm-bg-pressed':      '550',
    'cm-outline':         '500',
    'cm-outline-hover':   '450',
    'cm-outline-pressed': '400',
    'cm-separator':       '550',
  },
  // Surface-inverse dark theme: FIXED dark colors (same as light — snackbars always dark)
  inverse: {
    bg:                   '900',
    hover:                '850',
    pressed:              '800',
    outline:              '700',
    separator:            '700',
    'ct-default':         '25',
    'ct-strong':          'white',
    'ct-subtle':          '250',
    'ct-faint':           '400',
    'cm-bg':              '850',
    'cm-bg-hover':        '800',
    'cm-bg-pressed':      '750',
    'cm-outline':         '600',
    'cm-outline-hover':   '550',
    'cm-outline-pressed': '500',
    'cm-separator':       '700',
  },
};

// Accent surface uses monochromatic (primary) palette
const LIGHT_ACCENT_MAP = {
  bg:                   '25',
  hover:                '50',
  pressed:              '75',
  outline:              '175',
  separator:            '175',
  'ct-default':         '800',
  'ct-strong':          '900',
  'ct-subtle':          '700',
  'ct-faint':           '500',
  'cm-bg':              'white',
  'cm-bg-hover':        '25',
  'cm-bg-pressed':      '50',
  'cm-outline':         '175',
  'cm-outline-hover':   '200',
  'cm-outline-pressed': '250',
  'cm-separator':       '175',
};

const DARK_ACCENT_MAP = {
  bg:                   '900',
  hover:                '850',
  pressed:              '800',
  outline:              '750',
  separator:            '750',
  'ct-default':         '75',
  'ct-strong':          'white',
  'ct-subtle':          '150',
  'ct-faint':           '400',
  'cm-bg':              '850',
  'cm-bg-hover':        '800',
  'cm-bg-pressed':      '750',
  'cm-outline':         '600',
  'cm-outline-hover':   '550',
  'cm-outline-pressed': '500',
  'cm-separator':       '750',
};

// ── Generator ──────────────────────────────────────────────────

function generateSurface(name, stepMap, palette, indent) {
  const lines = [];
  const PROP_ORDER = [
    'bg','hover','pressed','outline','separator',
    'ct-default','ct-strong','ct-subtle','ct-faint',
    'cm-bg','cm-bg-hover','cm-bg-pressed',
    'cm-outline','cm-outline-hover','cm-outline-pressed',
    'cm-separator'
  ];
  for (const prop of PROP_ORDER) {
    const step = stepMap[prop];
    if (!step) throw new Error(`Missing step for ${name}.${prop}`);
    const hex = palette[step];
    if (!hex) throw new Error(`No primitive value for ${name}.${prop} → palette step "${step}"`);
    lines.push(`${indent}--surface-${name}-${prop}: ${hex};`);
  }
  return lines.join('\n');
}

function generate() {
  const palettes = parsePrimitives();
  const grey = palettes.greyscale;
  const mono = palettes.monochromatic;

  if (!grey) throw new Error('Greyscale palette not found in primitives.css');
  if (!mono) throw new Error('Monochromatic palette not found in primitives.css');

  const SURFACE_ORDER = ['bright','base','dim','deep','accent','container','over-container','float','inverse'];
  const SURFACE_LABELS = {
    bright:           'SURFACE-BRIGHT (elevated / cards / modals)',
    base:             'SURFACE-BASE (default page canvas)',
    dim:              'SURFACE-DIM (muted / receded areas)',
    deep:             'SURFACE-DEEP (recessed / sidebars / wells)',
    accent:           'SURFACE-ACCENT (primary-tinted)',
    container:        'SURFACE-CONTAINER (cards, panels)',
    'over-container': 'SURFACE-OVER-CONTAINER (popovers, dropdowns, modals)',
    float:            'SURFACE-FLOAT (menus, dropdowns, popups, tooltips)',
    inverse:          'SURFACE-INVERSE (snackbars, toasts — FIXED dark in all themes)',
  };
  const DARK_SURFACE_LABELS = {
    bright:           'SURFACE-BRIGHT (elevated / cards / modals)',
    base:             'SURFACE-BASE (default dark canvas)',
    dim:              'SURFACE-DIM (muted dark areas)',
    deep:             'SURFACE-DEEP (deepest dark / sidebars)',
    accent:           'SURFACE-ACCENT (primary-tinted dark)',
    container:        'SURFACE-CONTAINER (cards, panels — dark)',
    'over-container': 'SURFACE-OVER-CONTAINER (popovers, dropdowns — dark)',
    float:            'SURFACE-FLOAT (menus, dropdowns, popups — dark)',
    inverse:          'SURFACE-INVERSE (snackbars, toasts — FIXED dark in all themes)',
  };

  let out = '';
  out += `/* ════════════════════════════════════════════════════════════════\n`;
  out += `   Design Token Forge — T2 Surface Context Tokens\n`;
  out += `   9 surfaces × 16 tokens × light/dark\n`;
  out += `   Generated from primitive palette step mappings.\n`;
  out += `   DO NOT EDIT — regenerate via: node scripts/generate-surfaces.cjs\n`;
  out += `   ════════════════════════════════════════════════════════════════ */\n\n`;

  // Light theme
  out += `/* ── Light Theme (default) ───────────────────────────────────────── */\n`;
  out += `:root {\n`;
  for (const name of SURFACE_ORDER) {
    const isAccent = name === 'accent';
    const map = isAccent ? LIGHT_ACCENT_MAP : LIGHT_SURFACE_MAP[name];
    const palette = isAccent ? mono : grey;
    out += `\n  /* ── ${SURFACE_LABELS[name]} ── */\n`;
    out += generateSurface(name, map, palette, '  ');
    out += '\n';
  }
  out += `}\n\n`;

  // Dark theme
  out += `/* ── Dark Theme ─────────────────────────────────────────────── */\n`;
  out += `[data-theme="dark"] {\n`;
  for (const name of SURFACE_ORDER) {
    const isAccent = name === 'accent';
    const map = isAccent ? DARK_ACCENT_MAP : DARK_SURFACE_MAP[name];
    const palette = isAccent ? mono : grey;
    out += `\n  /* ── ${DARK_SURFACE_LABELS[name]} ── */\n`;
    out += generateSurface(name, map, palette, '  ');
    out += '\n';
  }
  out += `}\n`;

  return out;
}

// ── Main ──────────────────────────────────────────────────────
const css = generate();
const outPath = path.join(TOKENS_DIR, 'surfaces.css');
fs.writeFileSync(outPath, css, 'utf-8');
console.log(`✅ Generated surfaces.css (${css.split('\n').length} lines)`);
console.log(`   Source: greyscale + monochromatic palette steps from primitives.css`);
console.log(`   Every hex value maps to an existing primitive → 100% alias coverage`);
