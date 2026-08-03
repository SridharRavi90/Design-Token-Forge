/* demo/catalyst-user.js — Catalyst Slate user identity helper.
 *
 * Catalyst Slate handles all authentication at the infrastructure level:
 *   - Unauthenticated requests to protected routes are intercepted by Slate
 *     and redirected to the Zoho login page automatically.
 *   - After login, Slate sets a session cookie and the Catalyst Web SDK
 *     (auto-injected by Slate at /__catalyst/js/catalystApp.js) is available.
 *
 * This file does only two things:
 *   1. Reads the currently signed-in user from the Catalyst SDK.
 *   2. Exposes the user info on window.DTF_USER so the rest of the app
 *      can build personalized paths like /{userId}/pearl/editor.html.
 *
 * Page integration:
 *   Load this AFTER /__catalyst/js/catalystApp.js (Slate injects that
 *   automatically). Include it early in <head> with defer so it resolves
 *   before the page tries to build user-specific links.
 *
 * Exposed globals:
 *   window.DTF_USER        — { userId, firstName, lastName, email } or null
 *   window.DTF_USER_READY  — Promise that resolves with the same object
 *   window.DtfCatalystSignOut() — Signs the user out via Catalyst SDK
 */
(function () {
  'use strict';

  if (window.__dtfCatalystUserLoaded) return;
  window.__dtfCatalystUserLoaded = true;

  var USER_CACHE_KEY = 'dtf-catalyst-user';

  /* ── Promise other modules can await. ───────────────────────── */
  var resolveReady;
  window.DTF_USER_READY = new Promise(function (resolve) {
    resolveReady = resolve;
  });

  /* ── Try to get cached user info (fast path for page navigation). ─
     Catalyst's session is managed server-side (cookie), so we don't
     need to re-verify on every page — just read the cached profile.
     The SDK will error naturally if the session has expired. */
  function getCached() {
    try {
      var raw = sessionStorage.getItem(USER_CACHE_KEY);
      if (raw) return JSON.parse(raw);
    } catch (_e) {}
    return null;
  }

  function setCached(user) {
    try { sessionStorage.setItem(USER_CACHE_KEY, JSON.stringify(user)); } catch (_e) {}
  }

  function publishUser(user) {
    window.DTF_USER = user;
    resolveReady(user);
    try {
      document.dispatchEvent(new CustomEvent('dtf-user-ready', { detail: user }));
    } catch (_e) {}
  }

  /* Fast path: already have user in session. */
  var cached = getCached();
  if (cached) {
    publishUser(cached);
    /* Still kick off a background refresh so the cache stays fresh. */
  }

  /* ── Read user from Catalyst SDK. ───────────────────────────── */
  function fetchCatalystUser() {
    /* catalystApp is the Catalyst Web SDK instance injected by Slate.
       It's available as window.catalyst after /__catalyst/js/catalystApp.js loads. */
    var sdk = window.catalyst || window.catalystApp;
    if (!sdk) {
      /* SDK not loaded yet — wait for it. This can happen if this script
         runs before Slate's injected catalystApp.js. Retry briefly. */
      if (window._dtfCatalystRetries === undefined) window._dtfCatalystRetries = 0;
      if (window._dtfCatalystRetries < 50) {
        window._dtfCatalystRetries++;
        setTimeout(fetchCatalystUser, 100);
      } else {
        /* Give up — publish null so the app can show a fallback. */
        if (!cached) publishUser(null);
      }
      return;
    }

    var auth = sdk.auth ? sdk.auth() : null;
    if (!auth || typeof auth.getCurrentUser !== 'function') {
      if (!cached) publishUser(null);
      return;
    }

    auth.getCurrentUser()
      .then(function (details) {
        /* Catalyst SDK returns an object with nested user_details. */
        var ud = (details && details.user_details) ? details.user_details : details;
        var user = {
          userId:    String(ud.user_id    || ud.userId    || ud.id    || ''),
          firstName: String(ud.first_name || ud.firstName || ud.display_name || ud.displayName || ud.name || ud.user_name || ud.userName || ''),
          lastName:  String(ud.last_name  || ud.lastName  || ''),
          email:     String(ud.email_id   || ud.emailId   || ud.email || ud.email_address || ud.emailAddress || '')
        };
        setCached(user);
        publishUser(user);
      })
      .catch(function () {
        /* Session expired or not authenticated. Catalyst Slate will
           intercept the NEXT protected-page request and redirect to
           login automatically — no action needed here. */
        if (!cached) publishUser(null);
      });
  }

  /* Wait for DOM so catalystApp.js (injected in <head> by Slate) has run. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fetchCatalystUser);
  } else {
    fetchCatalystUser();
  }

  /* ── Sign-out helper ─────────────────────────────────────────── */
  window.DtfCatalystSignOut = function () {
    /* 1. Wipe all local auth caches so the app forgets the session. */
    try {
      sessionStorage.removeItem(USER_CACHE_KEY);
      sessionStorage.removeItem('dtf-auth-ok');
      sessionStorage.removeItem('dtf-catalyst-uid');
      sessionStorage.removeItem('dtf-catalyst-name');
      sessionStorage.removeItem('dtf-catalyst-email');
      localStorage.removeItem('dtf-active-project');
    } catch (_e) {}

    /* 2. Try every known Catalyst SDK sign-out pattern.
          The SDK (injected by Slate at /__catalyst/js/catalystApp.js)
          varies across Slate versions — try all known shapes. */
    var sdk = window.catalyst || window.catalystApp;
    if (sdk) {
      /* Pattern A: sdk.auth().signOut() — standard Catalyst Web SDK */
      try {
        var auth = typeof sdk.auth === 'function' ? sdk.auth() : sdk.auth;
        if (auth && typeof auth.signOut === 'function') {
          var result = auth.signOut();
          /* signOut may or may not return a Promise depending on SDK version */
          if (result && typeof result.catch === 'function') {
            result.catch(function () { _doLogoutRedirect(); });
          }
          return;
        }
      } catch (_e) {}

      /* Pattern B: sdk.signOut() — some Slate versions hoist it */
      try {
        if (typeof sdk.signOut === 'function') {
          sdk.signOut().catch(function () { _doLogoutRedirect(); });
          return;
        }
      } catch (_e) {}
    }

    /* 3. SDK sign-out unavailable — redirect to Catalyst login so
          Slate re-challenges the user for credentials. */
    _doLogoutRedirect();
  };

  function _doLogoutRedirect() {
    /* Redirect to Catalyst login page. Appending ?logout=true hints
       to the Catalyst platform that this is a deliberate sign-out.
       The /__catalyst/auth/signout endpoint returns INVALID_URL_PATTERN
       on some Slate deployments, so we use the login endpoint instead. */
    location.href = '/__catalyst/auth/login?logout=true';
  }

  /* ── Legacy compatibility shim ───────────────────────────────── */
  /* The old DtfAuthLogout() was called by any code that still has the
     GitHub PAT auth pattern. Route it to the Catalyst sign-out so we
     don't need to update every call site immediately. */
  window.DtfAuthLogout = window.DtfCatalystSignOut;

})();
