const fs = require('fs');

function parse(file) {
  const css = fs.readFileSync(file, 'utf-8');
  const light = {}, dark = {};
  const darkIdx = css.indexOf('[data-theme="dark"]');
  const lightBlock = darkIdx >= 0 ? css.slice(0, darkIdx) : css;
  const darkBlock  = darkIdx >= 0 ? css.slice(darkIdx)    : '';
  const re = /--([a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g;
  let m;
  while ((m = re.exec(lightBlock)) !== null) light[m[1]] = m[2].trim();
  re.lastIndex = 0;
  while ((m = re.exec(darkBlock)) !== null) dark[m[1]] = m[2].trim();
  return { light, dark };
}

function hexToRgb(hex) {
  hex = hex.replace('#','');
  if(hex.length===3) hex = hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2];
  return [parseInt(hex.slice(0,2),16), parseInt(hex.slice(2,4),16), parseInt(hex.slice(4,6),16)];
}

function relLum(rgb) {
  const [r,g,b] = rgb.map(c => { c /= 255; return c <= 0.03928 ? c/12.92 : Math.pow((c+0.055)/1.055, 2.4); });
  return 0.2126*r + 0.7152*g + 0.0722*b;
}

function contrast(hex1, hex2) {
  const L1 = relLum(hexToRgb(hex1));
  const L2 = relLum(hexToRgb(hex2));
  return (Math.max(L1,L2) + 0.05) / (Math.min(L1,L2) + 0.05);
}

const surfaces = parse('packages/tokens/src/surfaces.css');
const semantic = parse('packages/tokens/src/semantic.css');
const prims = parse('packages/tokens/src/primitives.css');

const hexToPrim = new Map();
for (const [name, val] of Object.entries(prims.light)) {
  if (/^#[0-9a-fA-F]{6}$/i.test(val)) hexToPrim.set(val.toUpperCase(), name);
}

console.log('=== SURFACE TOKEN AUDIT ===\n');

const surfaceNames = ['bright','base','dim','deep','accent','container','over-container','float','inverse'];

function auditSurface(tokens, theme) {
  const issues = [];
  for (const sn of surfaceNames) {
    const bg = tokens['surface-'+sn+'-bg'];
    if (!bg) continue;
    const cts = ['ct-default','ct-strong','ct-subtle','ct-faint'];
    for (const ct of cts) {
      const val = tokens['surface-'+sn+'-'+ct];
      if (!val) { issues.push({s:sn, t:ct, issue:'MISSING', theme}); continue; }
      const ratio = contrast(bg, val);
      const req = ct === 'ct-faint' ? 3.0 : 4.5;
      const label = ct === 'ct-faint' ? '3:1' : '4.5:1';
      if (ratio < req) issues.push({s:sn, t:ct, bg, fg:val, ratio:ratio.toFixed(2), req:label, theme});
    }
    for (const sep of ['separator','cm-separator']) {
      const val = tokens['surface-'+sn+'-'+sep];
      if (!val) continue;
      const ratio = contrast(bg, val);
      if (ratio < 1.5) issues.push({s:sn, t:sep, bg, fg:val, ratio:ratio.toFixed(2), req:'1.5:1', theme});
    }
    for (const ol of ['outline','cm-outline']) {
      const val = tokens['surface-'+sn+'-'+ol];
      if (!val) continue;
      const ratio = contrast(bg, val);
      if (ratio < 1.3) issues.push({s:sn, t:ol, bg, fg:val, ratio:ratio.toFixed(2), req:'1.3:1', theme});
    }
    const allProps = ['bg','hover','pressed','outline','separator','ct-default','ct-strong','ct-subtle','ct-faint','cm-bg','cm-bg-hover','cm-bg-pressed','cm-outline','cm-outline-hover','cm-outline-pressed','cm-separator'];
    for (const prop of allProps) {
      const val = tokens['surface-'+sn+'-'+prop];
      if (val && /^#[0-9a-fA-F]{6}$/i.test(val) && !hexToPrim.has(val.toUpperCase()))
        issues.push({s:sn, t:prop, value:val, issue:'NO_PRIM', theme});
    }
  }
  return issues;
}

function printIssues(issues) {
  if (!issues.length) { console.log('  No issues'); return; }
  issues.forEach(i => {
    if (i.issue === 'MISSING') console.log(`  MISSING: ${i.s} ${i.t}`);
    else if (i.issue === 'NO_PRIM') console.log(`  NO_PRIM: ${i.s} ${i.t} = ${i.value}`);
    else console.log(`  CONTRAST: ${i.s} ${i.t} = ${i.ratio}:1 (need ${i.req}) [${i.fg} on ${i.bg}]`);
  });
}

console.log('-- Light Surfaces --');
printIssues(auditSurface(surfaces.light, 'light'));
console.log('\n-- Dark Surfaces --');
printIssues(auditSurface(surfaces.dark, 'dark'));

console.log('\n=== SEMANTIC TOKEN AUDIT ===\n');

function auditSemantic(tokens, theme) {
  const issues = [];
  const roles = ['primary','brand','danger','success','warning','info'];
  for (const role of roles) {
    const baseBg = theme === 'light' ? '#FAFAFA' : '#141414';
    const cd = tokens[role+'-content-default'];
    if (cd) {
      const ratio = contrast(baseBg, cd);
      if (ratio < 4.5) issues.push({r:role, t:'content-default on base', bg:baseBg, fg:cd, ratio:ratio.toFixed(2)});
    }
    const onComp = tokens[role+'-on-component'];
    const compBg = tokens[role+'-component-bg-default'];
    if (onComp && compBg) {
      const ratio = contrast(compBg, onComp);
      if (ratio < 4.5) issues.push({r:role, t:'on-component on comp-bg', bg:compBg, fg:onComp, ratio:ratio.toFixed(2)});
    }
    const onCont = tokens[role+'-on-container'];
    const contBg = tokens[role+'-container-bg'];
    if (onCont && contBg) {
      const ratio = contrast(contBg, onCont);
      if (ratio < 4.5) issues.push({r:role, t:'on-container on cont-bg', bg:contBg, fg:onCont, ratio:ratio.toFixed(2)});
    }
    const allProps = ['content-default','content-strong','content-subtle','content-faint',
      'component-bg-default','component-bg-hover','component-bg-pressed',
      'component-outline-default','component-outline-hover','component-outline-pressed',
      'component-separator','container-bg','container-hover','container-pressed',
      'container-outline','container-separator','on-component','on-container'];
    for (const prop of allProps) {
      const val = tokens[role+'-'+prop];
      if (val && /^#[0-9a-fA-F]{6}$/i.test(val) && !hexToPrim.has(val.toUpperCase()))
        issues.push({r:role, t:prop, value:val, issue:'NO_PRIM'});
    }
  }
  return issues;
}

function printSemIssues(issues) {
  if (!issues.length) { console.log('  No issues'); return; }
  issues.forEach(i => {
    if (i.issue === 'NO_PRIM') console.log(`  NO_PRIM: ${i.r} ${i.t} = ${i.value}`);
    else console.log(`  CONTRAST: ${i.r} ${i.t} = ${i.ratio}:1 [${i.fg} on ${i.bg}]`);
  });
}

console.log('-- Light Semantic --');
printSemIssues(auditSemantic(semantic.light, 'light'));
console.log('\n-- Dark Semantic --');
printSemIssues(auditSemantic(semantic.dark, 'dark'));

console.log('\n=== SURFACE-INVERSE DEEP CHECK ===\n');
const inv = {};
for (const [k,v] of Object.entries(surfaces.light)) {
  if (k.startsWith('surface-inverse-')) inv[k.replace('surface-inverse-','')] = v;
}
const invDark = {};
for (const [k,v] of Object.entries(surfaces.dark)) {
  if (k.startsWith('surface-inverse-')) invDark[k.replace('surface-inverse-','')] = v;
}
const invBg = inv.bg;
const props = ['bg','hover','pressed','outline','separator','ct-default','ct-strong','ct-subtle','ct-faint','cm-bg','cm-bg-hover','cm-bg-pressed','cm-outline','cm-outline-hover','cm-outline-pressed','cm-separator'];
console.log('Light theme (dark surface):');
for (const p of props) {
  if (inv[p]) console.log(`  ${p.padEnd(22)} ${inv[p]}  contrast: ${contrast(invBg, inv[p]).toFixed(2)}:1`);
}
console.log('\nDark theme (light surface):');
const invDarkBg = invDark.bg;
for (const p of props) {
  if (invDark[p]) console.log(`  ${p.padEnd(22)} ${invDark[p]}  contrast: ${contrast(invDarkBg, invDark[p]).toFixed(2)}:1`);
}
console.log(`\n  Themes differ? ${inv.bg !== invDark.bg ? 'YES (correct — inverse flips)' : 'NO — BUG'}`);

console.log('\n=== NAMING CHECK ===');
const hasOldName = Object.keys(surfaces.light).some(k => k.includes('inversesurface'));
console.log(hasOldName ? '  WARNING: Old "inversesurface" naming still present' : '  OK: Using "inverse" naming');

const totalLight = auditSurface(surfaces.light,'l').length;
const totalDark = auditSurface(surfaces.dark,'d').length;
const totalSemL = auditSemantic(semantic.light,'light').length;
const totalSemD = auditSemantic(semantic.dark,'dark').length;
console.log(`\nTOTAL ISSUES: ${totalLight + totalDark + totalSemL + totalSemD}`);
