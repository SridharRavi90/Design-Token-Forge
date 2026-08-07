/**
 * functions/getProjectVersions/index.js
 *
 * Returns the version history list for a project.
 * Version metadata is stored in the DataStore row's description blob
 * (written by saveTokens whenever a new version is published).
 *
 * GET /server/getProjectVersions?project=<project_id>
 * Auth: Catalyst session (browser) or Authorization: Bearer <plugin-token>
 *
 * Response:
 *   { status: 'success', data: { versions: [ { version, name, savedAt, savedBy, description, fileId } ] } }
 *   Newest version first.
 */
'use strict';

const crypto   = require('crypto');
const catalyst = require('zcatalyst-sdk-node');

const TABLE        = 'dtf_projects';
const TOKEN_SECRET = process.env.DTF_TOKEN_SECRET || 'dtf-default-dev-secret-change-in-prod';

function qs(req) {
  var raw = (req.url || '').split('?')[1] || '';
  var out = {};
  raw.split('&').forEach(function(p) {
    var i = p.indexOf('='); if (i < 0) return;
    try { out[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); } catch(_) {}
  });
  return out;
}

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DTF-Token');
  res.setHeader('Cache-Control', 'no-store');
}

function verifyBearerJwt(req) {
  const q = qs(req);
  const authHeader = q._auth || (req.headers && (req.headers['x-dtf-token'] || req.headers.authorization)) || '';
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const rawJwt = bearerMatch ? bearerMatch[1] : authHeader;
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

async function resolveUserId(req) {
  const bearerUserId = verifyBearerJwt(req);
  if (bearerUserId) {
    const app = catalyst.initialize(req, { type: 'applogic' });
    return { app, userId: bearerUserId };
  }
  // Try Catalyst session (same-origin Slate calls with cookie)
  try {
    const app = catalyst.initialize(req);
    const user = await app.auth().getCurrentUser();
    const ud = user && user.user_details ? user.user_details : (user || {});
    const uid = String(ud.user_id || ud.userId || '');
    if (uid) return { app, userId: uid };
  } catch (_) {}
  // Fall back to user_id query param (cross-origin browser call without session cookie)
  const qUserId = (qs(req).user_id || '').trim();
  if (qUserId) {
    const app = catalyst.initialize(req, { type: 'applogic' });
    return { app, userId: qUserId };
  }
  throw new Error('Could not resolve user identity');
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
    const { app, userId } = await resolveUserId(req);
    const projectId = (qs(req).project || '').replace(/[^a-z0-9_-]/g, '');
    if (!projectId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ status: 'failure', error: 'project query param is required' }));
      return;
    }

    const allRows = await app.datastore().table(TABLE).getAllRows();
    const rawList = Array.isArray(allRows) ? allRows : (allRows && allRows.data ? allRows.data : []);
    const LEGACY_UID = 'sridhar-2917';
    const matchRow = rawList.map(function(r) { return r[TABLE] || r; }).find(function(d) {
      return (d.user_id === userId || d.user_id === LEGACY_UID) && d.project_id === projectId;
    });

    if (!matchRow) {
      res.statusCode = 404;
      res.end(JSON.stringify({ status: 'failure', error: 'Project not found' }));
      return;
    }

    var descBlob = {};
    try { descBlob = JSON.parse(matchRow.description || '{}'); } catch(_) {}

    const versions = Array.isArray(descBlob.versions) ? descBlob.versions : [];

    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'success', data: { versions } }));
  } catch (err) {
    const is401 = /unauthorized|not authenticated/i.test(err.message || '');
    res.statusCode = is401 ? 401 : 500;
    res.end(JSON.stringify({ status: 'failure', error: err.message || 'Internal error' }));
  }
};
