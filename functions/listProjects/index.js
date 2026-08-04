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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

/* Verify DTF Bearer JWT — identical to getProjectStatus / getProjectTokens */
function verifyBearerJwt(req) {
  const auth = (req.headers && (req.headers['x-dtf-token'] || req.headers.authorization)) || '';
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
    const app = catalyst.initialize(req, { type: 'applogic' });
    return { app, userId: bearerUid };
  }
  /* Catalyst session path (web browser) */
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

    const rows = rawList
      .map(function(r) { return r[TABLE] || r; })
      .filter(function(row) {
        /* Skip challenge-token rows (project_id starts with __ptk__) */
        return row.user_id === userId && !(row.project_id || '').startsWith('__ptk__');
      })
      .map(function(row) {
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
    res.end(JSON.stringify({ status: 'success', data: rows }));
  } catch (err) {
    const is401 = /unauthorized|not authenticated/i.test(err.message || '');
    res.statusCode = is401 ? 401 : 500;
    res.end(JSON.stringify({ status: 'failure', error: err.message || 'Internal error' }));
  }
};
