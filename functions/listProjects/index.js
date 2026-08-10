/**
 * functions/listProjects/index.js
 *
 * Returns all projects owned by the requesting user.
 *
 * GET /server/listProjects
 * Auth: Authorization: Bearer <plugin-token>  (Figma plugin)
 *       OR Catalyst session cookie             (web browser)
 */
'use strict';

const crypto   = require('crypto');
const catalyst = require('zcatalyst-sdk-node');

const TABLE        = 'dtf_projects';
const TOKEN_SECRET = process.env.DTF_TOKEN_SECRET || 'dtf-default-dev-secret-change-in-prod';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DTF-Token');
  res.setHeader('Cache-Control', 'no-store');
}

/* Catalyst Advanced I/O does NOT populate req.query — parse from req.url */
function qs(req) {
  var raw = (req.url || '').split('?')[1] || '';
  var out = {};
  raw.split('&').forEach(function(p) {
    var i = p.indexOf('='); if (i < 0) return;
    try { out[decodeURIComponent(p.slice(0,i))] = decodeURIComponent(p.slice(i+1)); } catch(_){}
  });
  return out;
}

/* Verify DTF Bearer JWT — identical to getProjectStatus / getProjectTokens */
function verifyBearerJwt(req) {
  /* Check _auth query param first (avoids preflight header — gateway-safe) */
  const q = qs(req);
  const auth = q._auth || (req.headers && (req.headers['x-dtf-token'] || req.headers.authorization)) || '';
  /* X-DTF-Token: <raw-jwt>  OR  Authorization: Bearer <jwt> */
  const bearerMatch = auth.match(/^Bearer\s+(.+)$/i);
  const rawJwt = bearerMatch ? bearerMatch[1] : auth;
  if (!rawJwt || rawJwt.split('.').length !== 3) return null;
  try {
    const [header, payload, sig] = rawJwt.split('.');
    if (!header || !payload || !sig) return null;
    const expected = crypto.createHmac('sha256', TOKEN_SECRET)
      .update(header + '.' + payload).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    if (sig !== expected) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    if (!claims.uid) return null;
    if (claims.exp && Math.floor(Date.now() / 1000) > claims.exp) return null;
    return String(claims.uid);
  } catch (_) { return null; }
}

async function resolveUserAndApp(req) {
  /* Bearer JWT path (Figma plugin — no session cookie) */
  const bearerUid = verifyBearerJwt(req);
  if (bearerUid) {
    const app = catalyst.initialize(req, { type: catalyst.type.advancedio });
    return { app, userId: bearerUid };
  }
  /* Catalyst session path (web browser) — bail fast if no cookie to avoid 60s hang */
  if (!(req.headers && req.headers.cookie)) throw new Error('Not authenticated');
  const app = catalyst.initialize(req);
  const user = await app.auth().getCurrentUser();
  const ud = user && user.user_details ? user.user_details : (user || {});
  const userId = String(ud.user_id || ud.userId || '');
  if (!userId) throw new Error('Could not resolve user identity');
  return { app, userId };
}

module.exports = async (req, res) => {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(''); return; }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end(JSON.stringify({ status: 'failure', error: 'Method not allowed' }));
    return;
  }

  try {
    const { app, userId } = await resolveUserAndApp(req);

    /* Use getAllRows + JS filter — ZCQL scoping is inconsistent across functions */
    const allRows  = await app.datastore().table(TABLE).getAllRows();
    const rawList  = Array.isArray(allRows) ? allRows : (allRows && allRows.data ? allRows.data : []);

    const normalised = rawList.map(function(r) { return r[TABLE] || r; });

    let rows = normalised
      .filter(function(row) {
        /* Skip challenge-token rows (project_id starts with __ptk__) */
        return row.user_id === userId && !(row.project_id || '').startsWith('__ptk__');
      });

    /* One-time migration: the Pearl row was manually seeded with user_id='sridhar-2917'.
       If this user has a different uid (Figma display name) and gets no results, adopt any
       rows with the legacy sentinel so the project becomes visible under the real uid. */
    if (rows.length === 0) {
      const LEGACY_UID = 'sridhar-2917';
      const legacyRows = normalised.filter(function(row) {
        return row.user_id === LEGACY_UID && !(row.project_id || '').startsWith('__ptk__');
      });
      if (legacyRows.length > 0) {
        await Promise.all(legacyRows.map(function(row) {
          return app.datastore().table(TABLE).updateRow({ ROWID: String(row.ROWID), user_id: userId });
        }));
        /* Re-query with updated ownership */
        const refreshed = await app.datastore().table(TABLE).getAllRows();
        const freshList  = Array.isArray(refreshed) ? refreshed : (refreshed && refreshed.data ? refreshed.data : []);
        rows = freshList
          .map(function(r) { return r[TABLE] || r; })
          .filter(function(row) {
            return row.user_id === userId && !(row.project_id || '').startsWith('__ptk__');
          });
      }
    }

    const result = rows.map(function(row) {
        var desc = '';
        try {
          var d = JSON.parse(row.description || '{}');
          desc = d.text || '';
        } catch(_) { desc = row.description || ''; }
        return {
          id:           row.project_id,
          name:         row.name,
          description:  desc,
          lastHash:     row.last_hash      || null,
          lastSyncedAt: row.last_synced_at  || null,
          rowId:        row.ROWID
        };
      });

    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'success', data: result }));
  } catch (err) {
    const is401 = /unauthorized|not authenticated/i.test(err.message || '');
    res.statusCode = is401 ? 401 : 500;
    res.end(JSON.stringify({ status: 'failure', error: err.message || 'Internal error' }));
  }
};
