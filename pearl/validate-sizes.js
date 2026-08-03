#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════
   Design Token Forge — Size Naming Validator
   ────────────────────────────────────────────────────────────────
   Enforces consistent size naming across all component demo pages
   and CSS token/component files. Run as part of CI or pre-commit.

   Usage:  node demo/validate-sizes.js
   Exit:   0 = pass, 1 = violations found
   ════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

/* ── Canonical size tiers ──────────────────────────────────── */
const ALL10 = ['micro','tiny','small','base','medium','large','big','huge','mega','ultra'];
const SIZE_3 = ['small','base','large'];
const BADGE_6 = ['micro','tiny','small','base','medium','large'];

const TIERS = {
  // all10 — atomic controls
  'button':          { allowed: ALL10,   tier: 'all10' },
  'icon-button':     { allowed: ALL10,   tier: 'all10' },
  'split-button':    { allowed: ALL10,   tier: 'all10' },
  'menu-button':     { allowed: ALL10,   tier: 'all10' },
  'input':           { allowed: ALL10,   tier: 'all10' },
  'textarea':        { allowed: ALL10,   tier: 'all10' },
  'select':          { allowed: ALL10,   tier: 'all10' },
  'toggle':          { allowed: ALL10,   tier: 'all10' },
  'checkbox':        { allowed: ALL10,   tier: 'all10' },
  'radio':           { allowed: ALL10,   tier: 'all10' },
  'slider':          { allowed: ALL10,   tier: 'all10' },
  'avatar':          { allowed: ALL10,   tier: 'all10' },
  'progress-bar':    { allowed: ALL10,   tier: 'all10' },
  'progress-circle': { allowed: ALL10,   tier: 'all10' },

  // 3-size — overlay / panel
  'tooltip':         { allowed: SIZE_3,  tier: '3-size' },
  'alert':           { allowed: SIZE_3,  tier: '3-size' },
  'toast':           { allowed: SIZE_3,  tier: '3-size' },
  'datepicker':      { allowed: SIZE_3,  tier: '3-size' },
  'file-upload':     { allowed: SIZE_3,  tier: '3-size' },

  // scaled — custom
  'badge':           { allowed: BADGE_6, tier: '6-size' },
};

const DEMO_DIR = path.join(__dirname);
const COMP_DIR = path.join(__dirname, '..', 'packages', 'components', 'src');

let errors = [];

/* ── 1. Check demo HTML pill bars ─────────────────────────── */
for (const [comp, spec] of Object.entries(TIERS)) {
  const htmlPath = path.join(DEMO_DIR, `${comp}.html`);
  if (!fs.existsSync(htmlPath)) continue;

  const html = fs.readFileSync(htmlPath, 'utf8');
  const found = [...html.matchAll(/data-ctrl-size="([^"]+)"/g)].map(m => m[1]);
  const unique = [...new Set(found)];

  // Check for disallowed sizes
  for (const s of unique) {
    if (!spec.allowed.includes(s)) {
      errors.push(`[${comp}.html] pill bar has size "${s}" which is NOT in the ${spec.tier} tier (allowed: ${spec.allowed.join(', ')})`);
    }
  }

  // Check for abbreviated names (sm/md/lg instead of small/base/large)
  const ABBREV = { sm: 'small', md: 'base', lg: 'large', xs: 'micro', xl: 'big' };
  for (const s of unique) {
    if (ABBREV[s]) {
      errors.push(`[${comp}.html] pill bar uses abbreviated size "${s}" — use "${ABBREV[s]}" instead`);
    }
  }
}

/* ── 2. Check component CSS tokens for naming alignment ───── */
for (const [comp, spec] of Object.entries(TIERS)) {
  // Map component name to folder
  const folderMap = { 'progress-circle': 'progress-ring' };
  const folder = folderMap[comp] || comp;
  const tokensPath = path.join(COMP_DIR, folder, `${folder}.tokens.css`);
  if (!fs.existsSync(tokensPath)) continue;

  const css = fs.readFileSync(tokensPath, 'utf8');
  // Extract per-size token names (e.g. --toast-padding-y-sm)
  const sizeTokens = [...css.matchAll(/--[\w-]+-(\w+)\s*:/g)];
  const ABBREV = { sm: 'small', md: 'base', lg: 'large' };

  for (const m of sizeTokens) {
    const suffix = m[1];
    if (ABBREV[suffix]) {
      errors.push(`[${folder}.tokens.css] uses abbreviated size suffix "-${suffix}" in "${m[0].trim()}" — use "-${ABBREV[suffix]}" instead`);
    }
  }
}

/* ── 3. Check component CSS selectors ─────────────────────── */
for (const [comp, spec] of Object.entries(TIERS)) {
  const folderMap = { 'progress-circle': 'progress-ring' };
  const folder = folderMap[comp] || comp;
  const cssPath = path.join(COMP_DIR, folder, `${folder}.css`);
  if (!fs.existsSync(cssPath)) continue;

  const css = fs.readFileSync(cssPath, 'utf8');
  const selectors = [...css.matchAll(/data-size="([^"]+)"/g)].map(m => m[1]);
  const unique = [...new Set(selectors)];
  const ABBREV = { sm: 'small', md: 'base', lg: 'large' };

  for (const s of unique) {
    if (ABBREV[s]) {
      errors.push(`[${folder}.css] selector uses abbreviated size "${s}" — use "${ABBREV[s]}"`);
    }
  }
}

/* ── Report ───────────────────────────────────────────────── */
if (errors.length === 0) {
  console.log('✅  All component sizes are consistent.');
  process.exit(0);
} else {
  console.error(`❌  ${errors.length} size naming violation(s) found:\n`);
  errors.forEach(e => console.error(`   • ${e}`));
  console.error('\nFix the above and re-run:  node demo/validate-sizes.js');
  process.exit(1);
}
