/* ════════════════════════════════════════════════════════════
   Design Token Forge — Nav injector

   The actual chrome (home, page switcher, project chip slot,
   actions, theme toggle) is owned by the <dtf-topbar> Web
   Component (see demo/dtf-topbar.js). This file just ensures the
   element exists at the top of <body> for the current page.

   nav.js must load AFTER dtf-topbar.js so the element upgrades
   immediately (shared.js's project-chip IIFE expects to find
   .nav-actions right after).
   ════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var path = location.pathname;
  var filename = path.substring(path.lastIndexOf('/') + 1) || 'index.html';

  // Onboard wizard is a focused, full-page task. Cancel button covers
  // navigation back to the caller — the global site nav would just be
  // visual noise + a confusing 'second header'.
  if (filename === 'onboard.html') return;

  // Editor v2 hand-authors its own <dtf-topbar> with slotted project
  // chip + action buttons; do not overwrite.
  if (document.querySelector('dtf-topbar')) return;

  var bar = document.createElement('dtf-topbar');
  bar.setAttribute('page', filename);

  // Replace existing <nav class="explorer-nav"> placeholder (if any).
  var oldNav = document.querySelector('nav.explorer-nav');
  if (oldNav && oldNav.parentNode) {
    oldNav.parentNode.replaceChild(bar, oldNav);
  } else {
    document.body.insertBefore(bar, document.body.firstChild);
  }
})();
