/* demo/auth-gate.js — Catalyst Slate authentication gate.
 *
 * ── What This File Does ──────────────────────────────────────────
 *
 * Catalyst Slate handles authentication entirely at the infrastructure
 * level. When a user visits a protected route without being signed in,
 * Slate automatically redirects them to the Zoho login page — no custom
 * login UI is needed.
 *
 * This file's job is much simpler than before:
 *   1. Hides the page briefly (prevents flash of unstyled content).
 *   2. Waits for the Catalyst Web SDK (auto-injected by Slate) to confirm
 *      the user is authenticated.
 *   3. Reads the user's Zoho account details (user ID, name, email).
 *   4. Exposes them on window.DTF_AUTH so the rest of the app can use them.
 *   5. Releases the page (removes the hiding rule) once ready.
 *
 * If Slate has already protected this route (recommended config), then
 * by the time this script runs the user is ALWAYS authenticated — Slate
 * would have redirected them to login before this page ever loaded.
 * This file adds a graceful fallback for unprotected / local dev contexts.
 *
 * ── Session Storage ──────────────────────────────────────────────
 *   sessionStorage 'dtf-catalyst-uid'   — Catalyst user_id (e.g. "60040413786")
 *   sessionStorage 'dtf-catalyst-name'  — User's display name
 *   sessionStorage 'dtf-catalyst-email' — User's email
 *   sessionStorage 'dtf-auth-ok'        — "1" once verified this tab session
 *
 * ── Backwards Compatibility ──────────────────────────────────────
 *   window.DTF_AUTH  — { ok: true, user: { userId, firstName, email } }
 *   window.DTF_AUTH_READY — Promise (same shape as before)
 *   window.DtfAuthLogout  — calls DtfCatalystSignOut (shim)
 */
(function () {
  'use strict';

  if (window.__dtfAuthGateLoaded) return;
  window.__dtfAuthGateLoaded = true;

  var SESSION_KEY  = 'dtf-auth-ok';
  var UID_KEY      = 'dtf-catalyst-uid';
  var NAME_KEY     = 'dtf-catalyst-name';
  var EMAIL_KEY    = 'dtf-catalyst-email';

  /* ── Hide page content until auth resolves. ─────────────────────
     Prevents a flash of project list / editor UI before we know
     who the user is. We inject a <style> into <head> (which exists
     at script parse time, even before <body>). */
  var styleEl = document.createElement('style');
  styleEl.id = 'dtf-auth-gate-style';
  styleEl.textContent =
    'body > *:not(.dtf-auth-overlay){visibility:hidden!important}' +
    'html.dtf-auth-locked,body.dtf-auth-locked{overflow:hidden!important}';
  (document.head || document.documentElement).appendChild(styleEl);
  document.documentElement.classList.add('dtf-auth-locked');

  /* ── Promise for other modules to await. ────────────────────── */
  var resolveReady;
  window.DTF_AUTH_READY = new Promise(function (r) { resolveReady = r; });

  /* ── Release page — called once we have a confirmed user. ────── */
  function release(user) {
    if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
    document.documentElement.classList.remove('dtf-auth-locked');
    if (document.body) document.body.classList.remove('dtf-auth-locked');

    window.DTF_AUTH = { ok: true, user: user || null };
    resolveReady({ ok: true, user: user || null });

    try {
      document.dispatchEvent(new CustomEvent('dtf-auth-ready', { detail: { user: user } }));
    } catch (_e) {}
  }

  /* ── Fast path: already verified this tab session. ──────────── */
  try {
    if (sessionStorage.getItem(SESSION_KEY) === '1') {
      var fastUser = {
        userId:    sessionStorage.getItem(UID_KEY)   || '',
        firstName: sessionStorage.getItem(NAME_KEY)  || '',
        email:     sessionStorage.getItem(EMAIL_KEY) || ''
      };
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { release(fastUser); });
      } else {
        release(fastUser);
      }
      return;
    }
  } catch (_e) {}

  /* ── Also fast-path if Catalyst SDK already set uid in sessionStorage
     (set by the root index.html entry point before routing here). ── */
  try {
    var _uid = sessionStorage.getItem(UID_KEY);
    if (_uid) {
      var _preUser = {
        userId:    _uid,
        firstName: sessionStorage.getItem(NAME_KEY)  || '',
        email:     sessionStorage.getItem(EMAIL_KEY) || ''
      };
      /* Mark session so subsequent pages use the top fast path. */
      sessionStorage.setItem(SESSION_KEY, '1');
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { release(_preUser); });
      } else {
        release(_preUser);
      }
      return;
    }
  } catch (_e) {}

  /* ── Fetch user from Catalyst SDK. ─────────────────────────────
     The Catalyst Web SDK is auto-injected by Slate at:
       /__catalyst/js/catalystApp.js
     It exposes `window.catalyst`. We wait for it to be available
     before calling getCurrentUser(). */
  function tryGetUser(attempts) {
    var sdk = window.catalyst || window.catalystApp;

    if (!sdk) {
      /* SDK not ready yet — retry up to 5 seconds. */
      if (attempts < 50) {
        setTimeout(function () { tryGetUser(attempts + 1); }, 100);
      } else {
        /* Catalyst SDK never appeared. Same loop-prevention logic — if we
           already set dtf-auth-pending, we came back from SSO → release.
           Otherwise redirect to login. */
        var pendingKey = 'dtf-auth-pending';
        try {
          if (sessionStorage.getItem(pendingKey) === '1') {
            sessionStorage.removeItem(pendingKey);
            sessionStorage.setItem(SESSION_KEY, '1');
            if (document.readyState === 'loading') {
              document.addEventListener('DOMContentLoaded', function () { release(null); });
            } else {
              release(null);
            }
          } else {
            sessionStorage.setItem(pendingKey, '1');
            _redirectToLogin();
          }
        } catch (_e) {
          release(null);
        }
      }
      return;
    }

    var auth = sdk.auth ? sdk.auth() : null;
    if (!auth || typeof auth.getCurrentUser !== 'function') {
      /* SDK present but no getCurrentUser — this is the Catalyst Slate
         context where the JS SDK loads but lacks auth methods.
         Use sessionStorage loop-prevention to distinguish a post-login
         return from a fresh unauthenticated visit:
           dtf-auth-pending=1  → we set this before redirecting to login;
                                  if it's here on page load, we just came
                                  back from a successful SSO login → release.
           (absent)            → first visit, unauthenticated → redirect. */
      var pendingKey = 'dtf-auth-pending';
      try {
        if (sessionStorage.getItem(pendingKey) === '1') {
          /* Back from login — authenticated. Clear flag, cache, release. */
          sessionStorage.removeItem(pendingKey);
          sessionStorage.setItem(SESSION_KEY, '1');
          if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { release(null); });
          } else {
            release(null);
          }
        } else {
          /* No auth signal — set pending flag then redirect to login. */
          sessionStorage.setItem(pendingKey, '1');
          _redirectToLogin();
        }
      } catch (_e) {
        /* sessionStorage blocked (rare) — release rather than loop. */
        release(null);
      }
      return;
    }

    auth.getCurrentUser()
      .then(function (details) {
        /* Catalyst SDK returns nested user_details. */
        var ud = (details && details.user_details) ? details.user_details : (details || {});
        var user = {
          userId:    String(ud.user_id    || ud.userId    || ud.id    || ''),
          firstName: String(ud.first_name || ud.firstName || ud.display_name || ud.displayName || ud.name || ud.user_name || ud.userName || ''),
          lastName:  String(ud.last_name  || ud.lastName  || ''),
          email:     String(ud.email_id   || ud.emailId   || ud.email || ud.email_address || ud.emailAddress || '')
        };

        /* Cache for fast path on next page navigation. */
        try {
          sessionStorage.setItem(SESSION_KEY, '1');
          sessionStorage.setItem(UID_KEY,   user.userId);
          sessionStorage.setItem(NAME_KEY,  user.firstName);
          sessionStorage.setItem(EMAIL_KEY, user.email);
        } catch (_e) {}

        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function () { release(user); });
        } else {
          release(user);
        }
      })
      .catch(function () {
        /* getCurrentUser() failed — user is NOT authenticated.
           Do NOT release the page (that would flash the project list).
           Go straight to the login redirect so the user never sees
           protected content. */
        _redirectToLogin();
      });
  }

  function _redirectToLogin() {
    /* Redirect to Catalyst's login page.
       Use the raw pathname — do NOT encodeURIComponent the slash.
       Catalyst validates redirect_url against its own domain; using the
       encoded form (%2Fhub.html) causes it to fall back to the app's
       configured default URL instead of honoring the param. */
    try {
      location.href = '/__catalyst/auth/login?redirect_url=' + location.pathname;
    } catch (_e) {
      location.href = '/__catalyst/auth/login';
    }
  }

  /* Start the SDK check immediately (synchronous script execution). */
  tryGetUser(0);

  /* ── Sign-out helper (stub — catalyst-user.js overwrites this). ── */
  /* This runs first (sync script). catalyst-user.js (deferred) will
     replace window.DtfCatalystSignOut with the full SDK-aware version.
     This stub is only ever called if catalyst-user.js never loaded. */
  window.DtfCatalystSignOut = function () {
    try {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(UID_KEY);
      sessionStorage.removeItem(NAME_KEY);
      sessionStorage.removeItem(EMAIL_KEY);
      localStorage.removeItem('dtf-active-project');
    } catch (_e) {}
    location.href = '/__catalyst/auth/login?logout=true';
  };

  /* Keep DtfAuthLogout as an alias so any existing code still works. */
  window.DtfAuthLogout = window.DtfCatalystSignOut;

})();
