/* demo/catalyst-user.js — Catalyst Slate user identity helper.
 *
 * Reads the currently signed-in user by calling the Catalyst serverless
 * function at /server/getUser (functions/getUser/index.js). That function
 * runs server-side and can access the Catalyst auth session that the
 * Web SDK cannot reach from the Slate (onslate.in) domain.
 *
 * /server/getUser is on the same onslate.in origin as the Slate app,
 * so session cookies are included automatically (credentials:'include').
 *
 * Exposed globals:
 *   window.DTF_USER        — { userId, firstName, lastName, email } or null
 *   window.DTF_USER_READY  — Promise that resolves with the same object
 *   window.DtfCatalystSignOut() — Signs the user out via Catalyst
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

  /* ── Read user from the Catalyst BaaS API (same-domain). ──────
     The Catalyst BaaS API is proxied through /__catalyst/ on the same
     onslate.in domain, so session cookies are included automatically.
     This replaces the old cross-domain serverless function call which
     was always blocked by CORS. */
  var PROJECT_ID = '38969000000013030';
  var BAAS_URL = '/__catalyst/baas/v1/project/' + PROJECT_ID + '/appuser/';

  function fetchCatalystUser() {
    fetch(BAAS_URL, {
      method: 'GET',
      credentials: 'include',
      headers: { 'Accept': 'application/json' }
    })
      .then(function (res) { return res.ok ? res.json() : Promise.reject(res.status); })
      .then(function (json) {
        /* BaaS returns { data: { user_details: {...} } } or { data: [{...}] } */
        var ud = null;
        if (json && json.data) {
          if (json.data.user_details) {
            ud = json.data.user_details;
          } else if (Array.isArray(json.data) && json.data[0]) {
            ud = json.data[0].user_details || json.data[0];
          } else if (json.data.user_id || json.data.email_id) {
            ud = json.data;
          }
        }
        if (ud) {
          var user = {
            userId:    String(ud.user_id    || ud.userId    || ''),
            firstName: String(ud.first_name || ud.firstName || ud.display_name || ud.name || ''),
            lastName:  String(ud.last_name  || ud.lastName  || ''),
            email:     String(ud.email_id   || ud.emailId   || ud.email || '')
          };
          setCached(user);
          publishUser(user);
        } else {
          if (!cached) publishUser(null);
        }
      })
      .catch(function () {
        if (!cached) publishUser(null);
      });
  }

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
          /* Always redirect after signOut — whether it resolves or rejects.
             The SDK may or may not navigate the browser itself; we
             force the redirect so the user always lands on the login page. */
          if (result && typeof result.then === 'function') {
            result.then(_doLogoutRedirect, _doLogoutRedirect);
          } else {
            _doLogoutRedirect();
          }
          return;
        }
      } catch (_e) {}

      /* Pattern B: sdk.signOut() — some Slate versions hoist it */
      try {
        if (typeof sdk.signOut === 'function') {
          var r2 = sdk.signOut();
          if (r2 && typeof r2.then === 'function') {
            r2.then(_doLogoutRedirect, _doLogoutRedirect);
          } else {
            _doLogoutRedirect();
          }
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
