/* ════════════════════════════════════════════════════════════
   Design Token Forge — <dtf-topbar> Web Component

   Single source of truth for the page chrome that wraps every
   demo page AND the token editor. Renders:

     [Home] / [Page ▾]  [Project chip slot]  ────  [Action slot]  [+ New] [🌗]

   Usage on a demo page (auto-injected by nav.js):
     <dtf-topbar page="button.html"></dtf-topbar>

   Usage in the editor (markup is hand-authored so editor-v2.js can
   still wire its existing IDs):
     <dtf-topbar page="editor-v2/" no-theme-toggle>
       <div slot="project"> ...existing #projBtn, #projName, #projPanel markup... </div>
       <label slot="action">...show-css...</label>
       <button slot="action" id="historyBtn">History</button>
       <button slot="action" id="deployBtn">Publish</button>
     </dtf-topbar>

   The component intentionally renders into LIGHT DOM (no shadow) so
   shared.css / editor-v2.css selectors keep working, and so
   shared.js's project-chip IIFE can still find the `.nav-actions`
   container on demo pages.
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  if (window.customElements && customElements.get('dtf-topbar')) return;

  /* ── Page registry (shared with nav.js) ─────────────────── */
  var NAV_ITEMS = [
    { label: 'Token Editor',    href: 'editor/'                        },
    { label: 'Tokens',          href: 'color-tokens.html'    },
    { label: 'Typography',      href: 'typography.html'      },
    { label: 'Frameworks',      href: 'frameworks.html'      },
    { sep: true },
    { label: 'All Components',  href: 'components.html'      },
    { label: 'Button',          href: 'button.html',          hint: '246 vars'  },
    { label: 'IconButton',      href: 'icon-button.html',     hint: '120 vars'  },
    { label: 'SplitButton',     href: 'split-button.html',    hint: '154 vars'  },
    { label: 'Input',           href: 'input.html',           hint: '172 vars'  },
    { label: 'Textarea',        href: 'textarea.html',        hint: '114 vars'  },
    { label: 'Select',          href: 'select.html',          hint: '120 vars'  },
    { label: 'MenuButton',      href: 'menu-button.html',     hint: '139 vars'  },
    { label: 'Toggle',          href: 'toggle.html',          hint: '93 vars'   },
    { label: 'Checkbox',        href: 'checkbox.html',        hint: '74 vars'   },
    { label: 'Radio',           href: 'radio.html',           hint: '73 vars'   },
    { label: 'Slider',          href: 'slider.html',          hint: '120 vars'  },
    { label: 'DatePicker',      href: 'datepicker.html',      hint: '~190 vars' },
    { label: 'FileUpload',      href: 'file-upload.html',     hint: '~120 vars' },
    { label: 'Avatar',          href: 'avatar.html',          hint: '~80 vars'  },
    { label: 'Badge',           href: 'badge.html',           hint: '~90 vars'  },
    { label: 'Tooltip',         href: 'tooltip.html',         hint: '~60 vars'  },
    { label: 'Alert',           href: 'alert.html',           hint: '~80 vars'  },
    { label: 'Toast',           href: 'toast.html',           hint: '~90 vars'  },
    { label: 'Progress Bar',    href: 'progress-bar.html',    hint: '~60 vars'  },
    { label: 'Progress Circle', href: 'progress-circle.html', hint: '~50 vars'  },
    { label: 'Spinner',         href: 'spinner.html',         hint: '~85 vars'  },
    { label: 'Skeleton',         href: 'skeleton.html',        hint: '~45 vars'  },
    { label: 'KBD',              href: 'kbd.html',             hint: '~75 vars'  },
    { label: 'Card',             href: 'card.html',            hint: '~75 vars'  },
    { label: 'Divider',          href: 'divider.html',         hint: '~30 vars'  }
  ];
  window.DtfTopbarNavItems = NAV_ITEMS;

  function esc(s){ var d=document.createElement('div'); d.textContent=String(s==null?'':s); return d.innerHTML; }

  /* SVGs are inlined to keep the bar zero-dependency. */
  var ICON_HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12L12 3l9 9"/><path d="M5 10v9a1 1 0 001 1h3v-5h6v5h3a1 1 0 001-1v-9"/></svg>';
  var ICON_CARET = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';
  var ICON_SUN = '<svg class="theme-icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>';
  var ICON_MOON = '<svg class="theme-icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

  /* ── Custom element definition ──────────────────────────── */
  function DtfTopbar() { return Reflect.construct(HTMLElement, [], DtfTopbar); }
  DtfTopbar.prototype = Object.create(HTMLElement.prototype);
  DtfTopbar.prototype.constructor = DtfTopbar;
  Object.setPrototypeOf(DtfTopbar, HTMLElement);

  DtfTopbar.prototype.connectedCallback = function () {
    if (this._mounted) return;
    this._mounted = true;

    /* Preserve children authored by the page (slot="project" / slot="action").
       We rebuild the topbar shell, then re-attach these into the right place. */
    var slotted = { project: [], action: [] };
    var i, kids = Array.prototype.slice.call(this.children);
    for (i = 0; i < kids.length; i++) {
      var node = kids[i];
      var slot = node.getAttribute && node.getAttribute('slot');
      if (slot === 'project' || slot === 'action') {
        slotted[slot].push(node);
      }
      // unknown / unslotted children are dropped on purpose to keep the bar clean
    }

    var page = (this.getAttribute('page') || '').trim();
    var pageLabel = this._labelFor(page);
    var noTheme = this.hasAttribute('no-theme-toggle');
    var noNew = this.hasAttribute('no-new-project');
    var noAcct = this.hasAttribute('no-account');

    /* dropdown menu (page switcher) */
    var ddHtml = '';
    var activePid = '';
    try { activePid = localStorage.getItem('dtf-active-project') || ''; } catch (e) {}
    /* On a fresh editor-v2 load the URL has ?project=xyz but the
       editor hasn't yet written it to localStorage when the topbar
       mounts. Fall back to the URL so the switcher renders on the
       very first paint. */
    if (!activePid) {
      try {
        var _qp = new URLSearchParams(location.search).get('project');
        if (_qp) activePid = _qp;
      } catch (e) {}
    }
    /* Hub is the only page that intentionally has no project. We
       detect it by filename (index.html or trailing slash on /demo/)
       — never show the switcher there even if storage is somehow
       still set. */
    var isHub = /\/hub\.html$|\/hub$/.test(location.pathname);
    if (isHub) activePid = '';
    /* All NAV_ITEMS hrefs are written relative to /components/. If we are
       currently inside a subdir like /components/editor/, prefix '../'
       so links resolve to the right files instead of 404'ing. */
    var inSubdir = /\/components\/[^/]+\//.test(location.pathname);
    var prefix = inSubdir ? '../' : '';
    for (i = 0; i < NAV_ITEMS.length; i++) {
      var it = NAV_ITEMS[i];
      if (it.sep) { ddHtml += '<div class="dd-sep" role="separator"></div>'; continue; }
      var href = prefix + it.href;
      if (activePid && !/[?&]project=/.test(href)) {
        href += (href.indexOf('?') >= 0 ? '&' : '?') + 'project=' + encodeURIComponent(activePid);
      }
      var isCurrent = (it.href === page);
      ddHtml += '<a href="' + href + '" role="menuitem"'
        + (isCurrent ? ' aria-current="page"' : '')
        + '>' + esc(it.label)
        + (it.hint ? ' <span class="dd-hint">' + esc(it.hint) + '</span>' : '')
        + '</a>';
    }

    /* shell */
    /* Home is the project picker (hub) — it does NOT consume ?project=.
       Leaving the param on would create a stale URL once the user is on
       the hub (URL says project=X but the page shows the picker). */
    var homeHref = '/hub.html';
    var newHtml = noNew ? '' :
      '<a href="/onboard.html" class="nav-project-new" title="New Project">+ New</a>';
    var themeHtml = noTheme ? '' :
      '<button class="theme-toggle" id="themeToggle" type="button" aria-label="Toggle theme" aria-pressed="false">'
        + ICON_SUN + ICON_MOON +
      '</button>';

    /* Account menu — Catalyst/Zoho user display + Sign out.
       Reads from sessionStorage (set by auth-gate.js after Catalyst
       SDK resolves). Falls back to window.DTF_AUTH for the case where
       auth-gate resolves before this component mounts.
       Falls back to user ID if name/email are blank (some Zoho accounts
       have empty first_name). Falls back to 'Zoho User' as last resort
       so the chip ALWAYS shows when the user is authenticated. */
    var catalystName  = '';
    var catalystEmail = '';
    var catalystUid   = '';
    try {
      catalystName  = sessionStorage.getItem('dtf-catalyst-name')  || '';
      catalystEmail = sessionStorage.getItem('dtf-catalyst-email') || '';
      catalystUid   = sessionStorage.getItem('dtf-catalyst-uid')   || '';
    } catch (e) {}
    /* Also check window.DTF_AUTH (set synchronously by auth-gate) */
    if (window.DTF_AUTH && window.DTF_AUTH.user) {
      if (!catalystName)  catalystName  = window.DTF_AUTH.user.firstName || '';
      if (!catalystEmail) catalystEmail = window.DTF_AUTH.user.email     || '';
      if (!catalystUid)   catalystUid   = window.DTF_AUTH.user.userId    || '';
    }
    /* Auth is active if ANY identity field is set */
    var isAuthenticated = !!(catalystName || catalystEmail || catalystUid ||
                             sessionStorage.getItem('dtf-auth-ok'));
    var acctHtml = '';
    if (!noAcct && isAuthenticated) {
      var displayName = catalystName || catalystEmail.split('@')[0] || catalystUid || 'Zoho User';
      var initial = (displayName.charAt(0) || '?').toUpperCase();
      /* Subtitle: show email when available, otherwise "Zoho account" */
      var acctMeta = catalystEmail || 'Zoho account';
      acctHtml = ''
        + '<div class="nav-acct">'
        +   '<button class="nav-acct-btn" type="button" '
        +     'aria-haspopup="true" aria-expanded="false" '
        +     'aria-label="Account: ' + esc(displayName) + '" '
        +     'title="Signed in as ' + esc(displayName) + '">'
        +     '<span class="nav-acct-avatar" aria-hidden="true">' + esc(initial) + '</span>'
        +   '</button>'
        +   '<div class="nav-acct-menu" role="menu">'
        +     '<div class="nav-acct-head">'
        +       '<div class="nav-acct-name">' + esc(displayName) + '</div>'
        +       '<div class="nav-acct-meta">' + esc(acctMeta) + '</div>'
        +     '</div>'
        +     '<div class="dd-sep" role="separator"></div>'
        +     '<button class="nav-acct-signout" type="button" role="menuitem">'
        +       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
        +         '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>'
        +         '<polyline points="16 17 21 12 16 7"/>'
        +         '<line x1="21" y1="12" x2="9" y2="12"/>'
        +       '</svg>'
        +       'Sign out'
        +     '</button>'
        +   '</div>'
        + '</div>';
    }
    /* Page switcher is project-scoped. Component pages, the token
       editor and the framework guide all need an active project to
       render meaningful content (brand tokens, project-specific
       config). On Home — or any page reached without a project —
       hide the switcher entirely so the user can't navigate into a
       broken state. They re-enter the flow by picking a project
       card on the hub. */
    var showSwitcher = !!activePid;
    var switcherHtml = showSwitcher
      ? ('<span class="nav-sep">/</span>'
        + '<div class="nav-switcher">'
        +   '<button class="nav-switcher-btn" type="button" aria-haspopup="true" aria-expanded="false">'
        +     esc(pageLabel)
        +     ' ' + ICON_CARET
        +   '</button>'
        +   '<div class="nav-dropdown" role="menu">' + ddHtml + '</div>'
        + '</div>')
      : '';

    var html = ''
      + '<nav class="explorer-nav dtf-topbar" aria-label="Site navigation">'
      +   '<div class="nav-crumb">'
      +     '<a href="' + esc(homeHref) + '" class="nav-home" aria-label="Home" title="Home">' + ICON_HOME + '</a>'
      +     switcherHtml
      +     '<div class="dtf-topbar-project" data-slot="project"></div>'
      +   '</div>'
      +   '<div class="nav-actions">'
      +     '<div class="dtf-topbar-actions" data-slot="action"></div>'
      +     '<span class="nav-divider" aria-hidden="true"></span>'
      +     newHtml
      +     themeHtml
      +     acctHtml
      +   '</div>'
      + '</nav>';

    this.innerHTML = html;

    /* Re-attach slotted children into their landing zones. */
    var projZone = this.querySelector('[data-slot="project"]');
    var actZone  = this.querySelector('[data-slot="action"]');
    for (i = 0; i < slotted.project.length; i++) projZone.appendChild(slotted.project[i]);
    for (i = 0; i < slotted.action.length;  i++) actZone.appendChild(slotted.action[i]);

    /* Dropdown wiring (only when switcher is rendered, i.e. inside
       an active project). */
    var btn = this.querySelector('.nav-switcher-btn');
    var dd  = this.querySelector('.nav-dropdown');
    if (btn && dd) {
      var close = function(){ dd.removeAttribute('data-open'); btn.setAttribute('aria-expanded','false'); };
      btn.addEventListener('click', function(){
        if (dd.hasAttribute('data-open')) close();
        else { dd.setAttribute('data-open',''); btn.setAttribute('aria-expanded','true'); }
      });
      document.addEventListener('click', function(e){
        if (!btn.contains(e.target) && !dd.contains(e.target)) close();
      });
      document.addEventListener('keydown', function(e){
        if (e.key === 'Escape' && dd.hasAttribute('data-open')) { close(); btn.focus(); }
      });
    }

    /* Account menu wiring (only present when ghUser is set) */
    var acctBtn = this.querySelector('.nav-acct-btn');
    var acctMenu = this.querySelector('.nav-acct-menu');
    var signOut = this.querySelector('.nav-acct-signout');
    if (acctBtn && acctMenu) {
      function closeAcct(){
        acctMenu.removeAttribute('data-open');
        acctBtn.setAttribute('aria-expanded','false');
      }
      acctBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (acctMenu.hasAttribute('data-open')) closeAcct();
        else {
          acctMenu.setAttribute('data-open','');
          acctBtn.setAttribute('aria-expanded','true');
        }
      });
      document.addEventListener('click', function (e) {
        if (!acctBtn.contains(e.target) && !acctMenu.contains(e.target)) closeAcct();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && acctMenu.hasAttribute('data-open')) {
          closeAcct();
          acctBtn.focus();
        }
      });
      if (signOut) {
        signOut.addEventListener('click', function () {
          var ok = window.confirm('Sign out of Design Token Forge?\n\nYou will be redirected to the Zoho login page.');
          if (!ok) return;
          /* DtfAuthLogout is aliased to DtfCatalystSignOut by auth-gate.js */
          if (typeof window.DtfCatalystSignOut === 'function') {
            window.DtfCatalystSignOut();
          } else if (typeof window.DtfAuthLogout === 'function') {
            window.DtfAuthLogout();
          } else {
            /* Fallback: clear session and redirect to Catalyst login page */
            try {
              sessionStorage.removeItem('dtf-auth-ok');
              sessionStorage.removeItem('dtf-catalyst-uid');
              sessionStorage.removeItem('dtf-catalyst-name');
              sessionStorage.removeItem('dtf-catalyst-email');
              localStorage.removeItem('dtf-active-project');
            } catch (_e) {}
            location.href = '/__catalyst/auth/login?logout=true';
          }
        });
      }
    }

    /* If auth-gate resolves AFTER the topbar mounts, the account chip
       is missing from the first render. Listen for dtf-auth-ready and
       remount so the avatar appears without a page reload. */
    if (!noAcct && !isAuthenticated && !this._authListenerWired) {
      this._authListenerWired = true;
      var self = this;
      function _hasAuth() {
        try {
          if (sessionStorage.getItem('dtf-auth-ok') === '1') return true;
          if (sessionStorage.getItem('dtf-catalyst-uid')) return true;
          if (sessionStorage.getItem('dtf-catalyst-name')) return true;
          if (sessionStorage.getItem('dtf-catalyst-email')) return true;
        } catch (_e) {}
        if (window.DTF_AUTH && window.DTF_AUTH.user) return true;
        return false;
      }
      var rerender = function () {
        if (!_hasAuth()) return;
        self._mounted = false;
        self.connectedCallback();
      };
      document.addEventListener('dtf-auth-ready', rerender, { once: true });
      /* Poll briefly in case dtf-auth-ready already fired. */
      var tries = 0;
      var iv = setInterval(function () {
        if (_hasAuth()) { clearInterval(iv); rerender(); return; }
        if (++tries > 60) clearInterval(iv);
      }, 50);
    }
  };

  DtfTopbar.prototype._labelFor = function (page) {
    // Explicit label attribute always wins (used by hub / index)
    var explicit = this.getAttribute('label');
    if (explicit) return explicit;
    if (!page) return 'All Components';
    for (var i = 0; i < NAV_ITEMS.length; i++) {
      if (NAV_ITEMS[i].href === page) return NAV_ITEMS[i].label;
    }
    return 'All Components';
  };

  customElements.define('dtf-topbar', DtfTopbar);
})();
