/* ════════════════════════════════════════════════════════════
   <dtf-palette-ladder> — shared 22-step palette swatch strip.

   Single source of truth for the ladder UI rendered in both the
   Color Token Explorer (read-only, click=copy) and the Token Editor
   (selectable, with pass/fail badges). Same DOM, same sizing, same
   hover treatment everywhere.

   Usage (read-only, e.g. tokens page):
     <dtf-palette-ladder prefix="prim-brand"></dtf-palette-ladder>

   Optional attributes:
     prefix     — CSS-var prefix (required); resolves --{prefix}-<step>.
     steps      — comma list of step names. Default = full 22-step ladder.
     selected   — step name to mark with the brand ring (aria-checked).
     interactive — present: emits 'ladder-pick' on click; absent: click
                   triggers default copy-to-clipboard behavior.
     show-step  — present: always show step labels (default = on hover/selected).
     layout     — 'strip' (default, compact 36px row) or 'card' (T0-style
                  rich card with step + hex + CSS-var name stacked below
                  a 38px swatch — matches the editor's Palette view).

   Events:
     ladder-pick → { step, hex } — fired when interactive and a
                                   swatch is clicked or activated.
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (window.customElements && customElements.get('dtf-palette-ladder')) return;

  var DEFAULT_STEPS = ['white','25','50','75','100','150','175','200','250','300','350','400','450','500','550','600','700','750','800','850','900','black'];

  function readVar(prop) {
    var v = getComputedStyle(document.documentElement).getPropertyValue('--' + prop).trim();
    if (!v) return '';
    if (v.charAt(0) === '#') return v.toUpperCase();
    return v;
  }

  function contrastText(hex) {
    if (!hex || hex.length < 4) return '#000';
    var c = hex.replace('#', '');
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var r = parseInt(c.substr(0,2),16),
        g = parseInt(c.substr(2,2),16),
        b = parseInt(c.substr(4,2),16);
    var lum = (0.299*r + 0.587*g + 0.114*b) / 255;
    return lum > 0.55 ? '#000' : '#fff';
  }

  function PaletteLadder() { return Reflect.construct(HTMLElement, [], PaletteLadder); }
  PaletteLadder.prototype = Object.create(HTMLElement.prototype);
  PaletteLadder.prototype.constructor = PaletteLadder;
  Object.setPrototypeOf(PaletteLadder, HTMLElement);

  PaletteLadder.observedAttributes = ['prefix','steps','selected','interactive','show-step','layout'];
  Object.defineProperty(PaletteLadder, 'observedAttributes', {
    get: function () { return ['prefix','steps','selected','interactive','show-step','layout']; }
  });

  PaletteLadder.prototype.connectedCallback = function () {
    this._render();
  };

  PaletteLadder.prototype.attributeChangedCallback = function () {
    if (!this.isConnected) return;
    this._render();
  };

  /* External callers (live preview etc.) can ask the strip to re-read
     CSS vars after a token override is injected. */
  PaletteLadder.prototype.refresh = function () { this._render(); };

  PaletteLadder.prototype._render = function () {
    var prefix = this.getAttribute('prefix') || '';
    var stepsAttr = this.getAttribute('steps');
    var steps = stepsAttr ? stepsAttr.split(',').map(function (s) { return s.trim(); }) : DEFAULT_STEPS;
    var selected = this.getAttribute('selected') || '';
    var interactive = this.hasAttribute('interactive');
    var showStep = this.hasAttribute('show-step');
    var layout = (this.getAttribute('layout') || 'strip').toLowerCase();

    var self = this;
    this.classList.remove('dtf-ladder','dtf-ladder--card','dtf-ladder--show-step');
    this.classList.add(layout === 'card' ? 'dtf-ladder--card' : 'dtf-ladder');
    if (showStep) this.classList.add('dtf-ladder--show-step');

    this.setAttribute('role', interactive ? 'radiogroup' : 'group');

    var html = '';
    for (var i = 0; i < steps.length; i++) {
      var step = steps[i];
      var hex = readVar(prefix + '-' + step);
      var bg = hex || 'transparent';
      var checked = step === selected;
      var label = step + (hex ? ' · ' + hex : '');
      var txt = contrastText(hex);
      if (layout === 'card') {
        /* T0-style card — swatch on top, name + hex + CSS-var beneath.
           Mirrors .ev2-step from the editor so both pages read identical. */
        var hexShort = hex ? hex.replace('#','').toUpperCase() : '—';
        var tag = interactive ? 'button' : 'div';
        html += '<' + tag + ' class="dtf-pcard"'
          + (interactive ? ' type="button" role="radio" aria-checked="' + (checked ? 'true' : 'false') + '"' : '')
          + ' data-step="' + step + '"'
          + ' data-hex="' + (hex || '') + '"'
          + ' aria-label="' + label + '">'
          +   '<div class="dtf-pcard-sw" style="background:' + bg + '"></div>'
          +   '<div class="dtf-pcard-meta">'
          +     '<div class="dtf-pcard-name">' + step + '</div>'
          +     '<div class="dtf-pcard-hex">' + hexShort + '</div>'
          +     (prefix ? '<div class="dtf-pcard-css">--' + prefix + '-' + step + '</div>' : '')
          +   '</div>'
          + '</' + tag + '>';
      } else {
        html += '<' + (interactive ? 'button' : 'span') + ' class="dtf-ladder-sw"'
          + (interactive ? ' type="button" role="radio" aria-checked="' + (checked ? 'true' : 'false') + '"' : '')
          + ' data-step="' + step + '"'
          + ' data-hex="' + (hex || '') + '"'
          + ' style="background:' + bg + '"'
          + ' aria-label="' + label + '">'
          +   '<span class="dtf-ladder-sw-step" style="color:' + txt + '">' + step + '</span>'
          +   '<span class="dtf-ladder-sw-tip">' + step + ' · ' + (hex || '—') + '</span>'
          + '</' + (interactive ? 'button' : 'span') + '>';
      }
    }
    this.innerHTML = html;

    /* Click handling — interactive emits, read-only copies. */
    if (this._clickHandler) this.removeEventListener('click', this._clickHandler);
    this._clickHandler = function (e) {
      var sw = e.target.closest && e.target.closest('.dtf-ladder-sw, .dtf-pcard');
      if (!sw || !self.contains(sw)) return;
      var step = sw.getAttribute('data-step');
      var hex = sw.getAttribute('data-hex');
      if (interactive) {
        self.dispatchEvent(new CustomEvent('ladder-pick', {
          bubbles: true,
          detail: { step: step, hex: hex }
        }));
      } else if (hex && navigator.clipboard) {
        navigator.clipboard.writeText(hex).catch(function(){});
        sw.classList.add('dtf-pcard--copied','dtf-ladder-sw--copied');
        setTimeout(function () { sw.classList.remove('dtf-pcard--copied','dtf-ladder-sw--copied'); }, 600);
      }
    };
    this.addEventListener('click', this._clickHandler);
  };

  window.customElements.define('dtf-palette-ladder', PaletteLadder);
})();
