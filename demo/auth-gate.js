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
        /* Catalyst SDK never loaded. This means either:
           a) The page is being served locally (not via Slate), OR
           b) The SDK failed to load.
           In this case, release with null user so local dev still works. */
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function () { release(null); });
        } else {
          release(null);
        }
      }
      return;
    }

    var auth = sdk.auth ? sdk.auth() : null;
    if (!auth || typeof auth.getCurrentUser !== 'function') {
      /* SDK loaded but no auth module — release for local dev. */
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { release(null); });
      } else {
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
        /* getCurrentUser() failed — user is not authenticated.
           Catalyst Slate will redirect to login on the NEXT request.
           For now, release with null (page may redirect itself). */
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', function () {
            release(null);
            _redirectToLogin();
          });
        } else {
          release(null);
          _redirectToLogin();
        }
      });
  }

  function _redirectToLogin() {
    /* Redirect to Catalyst's login page with the current URL as the
       return URL so the user lands back here after signing in. */
    try {
      var returnUrl = encodeURIComponent(location.href);
      location.href = '/__catalyst/auth/login?redirect_url=' + returnUrl;
    } catch (_e) {
      location.href = '/__catalyst/auth/login';
    }
  }

  /* Start the SDK check immediately (synchronous script execution). */
  tryGetUser(0);

  /* ── Sign-out helper. ────────────────────────────────────────── */
  window.DtfCatalystSignOut = function () {
    try {
      sessionStorage.removeItem(SESSION_KEY);
      sessionStorage.removeItem(UID_KEY);
      sessionStorage.removeItem(NAME_KEY);
      sessionStorage.removeItem(EMAIL_KEY);
      localStorage.removeItem('dtf-active-project');
    } catch (_e) {}

    /* Delegate to catalyst-user.js's robust sign-out (tries multiple
       SDK patterns before falling back to a login-page redirect). */
    if (typeof window.DtfCatalystSignOut === 'function' &&
        window.DtfCatalystSignOut !== window.DtfAuthLogout) {
      window.DtfCatalystSignOut();
    } else {
      /* catalyst-user.js not loaded — minimal fallback. */
      location.href = '/__catalyst/auth/login?logout=true';
    }
  };

  /* Keep DtfAuthLogout as an alias so any existing code still works. */
  window.DtfAuthLogout = window.DtfCatalystSignOut;

})();
