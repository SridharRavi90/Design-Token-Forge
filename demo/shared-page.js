/* ════════════════════════════════════════════════════════════
   Design Token Forge — Shared Page Module
   ────────────────────────────────────────────────────────────
   Every demo page imports this AFTER shared.js.
   Provides reusable helpers so pages only define:
     - Component factory (make{Comp})
     - Component-specific render functions
     - Token inspector map

   Usage in a page script:
     var P = window.DTFPage;          // alias
     P.wirePillBar('variantBar', 'ctrlVariant', function(v){ G.variant = v; applyGlobals(); });
     P.renderSurfacePanels('surfaceStrip', function(panel){ panel.appendChild(makeBadge(opts)); });
     P.buildInspector('heroInspector', tokenRows);
   ════════════════════════════════════════════════════════════ */

window.DTFPage = (function() {
  'use strict';

  /* ── Constants ───────────────────────────────────────── */
  var SIZES = ['micro','tiny','small','base','medium','large','big','huge','mega','ultra'];

  var SURFACE_TOKENS = [
    'bg','hover','pressed','outline','separator',
    'ct-default','ct-strong','ct-subtle','ct-faint',
    'cm-bg','cm-bg-hover','cm-bg-pressed',
    'cm-outline','cm-outline-hover','cm-outline-pressed','cm-separator'
  ];

  var ROLE_TOKENS = [
    'content-default','content-strong','content-subtle','content-faint',
    'component-bg-default','component-bg-hover','component-bg-pressed',
    'component-outline-default','component-outline-hover','component-outline-pressed',
    'component-separator',
    'container-bg','container-hover','container-pressed',
    'container-outline','container-separator',
    'on-component','on-container'
  ];

  /* ── DOM Helpers ─────────────────────────────────────── */

  /** Clear element innerHTML and return the element */
  function clr(id) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = '';
    return el;
  }

  /** Capitalize first letter */
  function cap(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  /** Create a labeled card wrapper (used in variant galleries, density strips, etc.) */
  function wrapCard(child, labelText, cssClass) {
    var d = document.createElement('div');
    d.className = cssClass || 'variant-card';
    d.appendChild(child);
    var l = document.createElement('span');
    l.className = 'variant-label';
    l.textContent = labelText;
    d.appendChild(l);
    return d;
  }

  /** Create a density-item wrapper (component + meta text below) */
  function wrapDensityItem(child, metaText) {
    var it = document.createElement('div');
    it.className = 'density-item';
    it.appendChild(child);
    var m = document.createElement('div');
    m.className = 'density-meta';
    m.textContent = metaText || '';
    it.appendChild(m);
    return it;
  }

  /* ── Pill Bar Wiring ─────────────────────────────────── */

  /**
   * Wire a pill-bar with click delegation.
   * @param {string} barId         - DOM id of the pill-bar container
   * @param {string} dataKey       - The dataset key on each pill (e.g. 'ctrlVariant' → data-ctrl-variant)
   * @param {function} onChange     - Callback receiving the selected pill's value
   */
  function wirePillBar(barId, dataKey, onChange) {
    var bar = document.getElementById(barId);
    if (!bar) return;
    bar.addEventListener('click', function(e) {
      var pill = e.target.closest('.pill');
      if (!pill) return;
      bar.querySelectorAll('.pill').forEach(function(p) {
        p.setAttribute('aria-pressed', 'false');
      });
      pill.setAttribute('aria-pressed', 'true');
      if (typeof onChange === 'function') {
        onChange(pill.dataset[dataKey]);
      }
    });
  }

  /* ── Surface Context Panels ──────────────────────────── */

  /**
   * Render 3 surface level panels (base / elevated / sunken)
   * using the shared CSS classes. Calls makeContent(panel) for each
   * so the page supplies its own component instances.
   *
   * @param {string}   containerId  - DOM id of the surface-strip container
   * @param {function} makeContent  - fn(panelEl) that appends component(s) to the panel
   */
  function renderSurfacePanels(containerId, makeContent) {
    var el = clr(containerId);
    if (!el) return;

    var levels = [
      { css: 'surface-panel--base', label: 'surface-base-bg' },
      { css: 'surface-panel--alt',  label: 'surface-base-hover' },
      { css: 'surface-panel--deep', label: 'surface-base-pressed' }
    ];

    levels.forEach(function(lvl) {
      var panel = document.createElement('div');
      panel.className = 'surface-panel ' + lvl.css;

      var lbl = document.createElement('span');
      lbl.className = 'surface-panel-label';
      lbl.textContent = lvl.label;
      panel.appendChild(lbl);

      if (typeof makeContent === 'function') {
        makeContent(panel);
      }

      el.appendChild(panel);
    });
  }

  /* ── Inspector Builder ───────────────────────────────── */

  /**
   * Build a 3-column resolved-token inspector.
   *
   * @param {string} elId      - DOM id of the inspector container
   * @param {string} titleText - Inspector heading (e.g. 'Resolved Tokens (primary / base)')
   * @param {Array}  rows      - Array of [tokenName, aliasOrDash, resolvedValue]
   */
  function buildInspector(elId, titleText, rows) {
    var ins = document.getElementById(elId);
    if (!ins) return;
    var h = '<div class="inspector-title">' + titleText + '</div>';
    rows.forEach(function(r) {
      h += '<div class="inspector-row">';
      h += '<span class="token-name">' + r[0] + '</span>';
      h += '<span class="token-val">' + r[2];
      if (r[1] && r[1] !== '—') {
        h += '<br><span style="opacity:0.5;font-size:9px">\u2192 ' + r[1] + '</span>';
      }
      h += '</span></div>';
    });
    ins.innerHTML = h;
  }

  /* ── Playground: Surface + Role Overrides ────────────── */

  /**
   * Override surface-base-* tokens on a container to simulate a different surface level.
   * Pass 'base' to reset to defaults.
   */
  function applySurface(bodyEl, surfaceId) {
    if (surfaceId === 'base') {
      SURFACE_TOKENS.forEach(function(tok) {
        bodyEl.style.removeProperty('--surface-base-' + tok);
      });
      bodyEl.style.background = 'var(--surface-base-bg)';
    } else {
      SURFACE_TOKENS.forEach(function(tok) {
        bodyEl.style.setProperty('--surface-base-' + tok, 'var(--surface-' + surfaceId + '-' + tok + ')');
      });
      bodyEl.style.background = 'var(--surface-' + surfaceId + '-bg)';
    }
  }

  /**
   * Override primary-* role tokens on a container to simulate a different role.
   * Pass 'primary' to reset to defaults.
   */
  function applyRole(bodyEl, roleId) {
    if (roleId === 'primary') {
      ROLE_TOKENS.forEach(function(tok) {
        bodyEl.style.removeProperty('--primary-' + tok);
      });
    } else {
      ROLE_TOKENS.forEach(function(tok) {
        bodyEl.style.setProperty('--primary-' + tok, 'var(--' + roleId + '-' + tok + ')');
      });
    }
  }

  /* ── State Matrix Helpers ────────────────────────────── */

  /**
   * Render a CSS-grid state matrix.
   * @param {string}   containerId - DOM id
   * @param {Array}    variants    - e.g. ['primary','secondary','ghost']
   * @param {Array}    states      - e.g. ['Default','Hover','Active','Disabled']
   * @param {function} makeCell    - fn(variant, stateLabel) → DOM element
   */
  function renderStateMatrix(containerId, variants, states, makeCell) {
    var el = clr(containerId);
    if (!el) return;

    // Set grid columns: row-label + N state columns
    el.style.display = 'grid';
    el.style.gridTemplateColumns = '100px repeat(' + states.length + ', 1fr)';
    el.style.gap = '1px';
    el.style.background = 'var(--demo-border)';

    // Corner cell
    var corner = document.createElement('div');
    corner.className = 'state-header';
    el.appendChild(corner);

    // State headers
    states.forEach(function(s) {
      var h = document.createElement('div');
      h.className = 'state-header';
      h.textContent = s;
      el.appendChild(h);
    });

    // Rows
    variants.forEach(function(v) {
      var rl = document.createElement('div');
      rl.className = 'state-row-label';
      rl.textContent = v;
      el.appendChild(rl);

      states.forEach(function(s) {
        var cell = document.createElement('div');
        cell.style.background = 'var(--demo-surface)';
        cell.style.padding = '12px 8px';
        cell.style.display = 'flex';
        cell.style.alignItems = 'center';
        cell.style.justifyContent = 'center';
        cell.appendChild(makeCell(v, s));
        el.appendChild(cell);
      });
    });
  }

  /* ── Public API ──────────────────────────────────────── */
  return {
    SIZES: SIZES,
    SURFACE_TOKENS: SURFACE_TOKENS,
    ROLE_TOKENS: ROLE_TOKENS,
    clr: clr,
    cap: cap,
    wrapCard: wrapCard,
    wrapDensityItem: wrapDensityItem,
    wirePillBar: wirePillBar,
    renderSurfacePanels: renderSurfacePanels,
    buildInspector: buildInspector,
    applySurface: applySurface,
    applyRole: applyRole,
    renderStateMatrix: renderStateMatrix
  };

})();
