/**
 * functions/getProjectTokens/index.js
 *
 * Downloads a project's tokens.json from Catalyst File Store.
 * Only the owning user can read their project's tokens.
 *
 * GET /server/getProjectTokens?project=<project_id>
 * Auth: Catalyst session (browser) or Authorization: Bearer <plugin-token> (Phase 2)
 */
'use strict';

const crypto   = require('crypto');
const catalyst = require('zcatalyst-sdk-node');

const ALLOWED_ORIGIN  = 'https://design-token-forge-crtmngny.onslate.in';
const TABLE           = 'dtf_projects';
const FOLDER_ID       = '38969000000065373';
const TOKEN_SECRET    = process.env.DTF_TOKEN_SECRET || 'dtf-default-dev-secret-change-in-prod';

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

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DTF-Token');
  res.setHeader('Cache-Control', 'no-store');
}

function verifyBearerJwt(req) {
  /* Check _auth query param first (avoids preflight header — gateway-safe) */
  const q = qs(req);
  const authHeader = q._auth || (req.headers && (req.headers['x-dtf-token'] || req.headers.authorization)) || '';
  /* X-DTF-Token: <raw-jwt>  OR  Authorization: Bearer <jwt> */
  const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
  const rawJwt = bearerMatch ? bearerMatch[1] : authHeader;
  if (!rawJwt || rawJwt.split('.').length !== 3) return null;
  try {
    const [header, payload, sig] = rawJwt.split('.');
    if (!header || !payload || !sig) return null;
    const sigInput = header + '.' + payload;
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(sigInput).digest('base64')
                      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    if (sig !== expected) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    if (!claims.uid) return null;
    if (claims.exp && Math.floor(Date.now() / 1000) > claims.exp) return null;
    return String(claims.uid);
  } catch (_) { return null; }
}

async function resolveUserId(req) {
  // Query param first — cross-origin browser calls never have a session cookie
  const qUserId = (qs(req).user_id || '').trim();
  if (qUserId) {
    const app = catalyst.initialize(req, { type: catalyst.type.advancedio });
    return { app, userId: qUserId };
  }
  const bearerUserId = verifyBearerJwt(req);
  if (bearerUserId) {
    const app = catalyst.initialize(req, { type: catalyst.type.advancedio });
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
  throw new Error('Could not resolve user identity');
}

function streamToString(stream) {
  return new Promise(function(resolve, reject) {
    var chunks = [];
    stream.on('data', function(c) { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); });
    stream.on('end', function() { resolve(Buffer.concat(chunks).toString('utf8')); });
    stream.on('error', reject);
  });
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

    /* Verify ownership + get file ID from DataStore */
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
    const row = matchRow;

    var descBlob = {};
    try { descBlob = JSON.parse(row.description || '{}'); } catch(_) {}

    /* Allow fetching a specific version snapshot by file_id.
       Used by the restore flow: History dialog stores fileId per version,
       then calls getProjectTokens?project=<id>&file_id=<snapshotFileId>. */
    const requestedFileId = qs(req).file_id || null;
    const fileId = requestedFileId || descBlob.tokens_file_id || null;

    if (!fileId) {
      /* Project exists but no tokens saved yet */
      res.statusCode = 404;
      res.end(JSON.stringify({ status: 'failure', error: 'No tokens saved yet for this project' }));
      return;
    }

    /* Download from File Store */
    const filestore = app.filestore();
    const folder = filestore.folder(FOLDER_ID);
    const stream = await folder.downloadFile(fileId);
    const content = await streamToString(stream);

    res.statusCode = 200;
    res.end(content);          /* raw tokens.json — already JSON, no double-wrap */
  } catch (err) {
    const is401 = /unauthorized|not authenticated/i.test(err.message || '');
    res.statusCode = is401 ? 401 : 500;
    res.end(JSON.stringify({ status: 'failure', error: err.message || 'Internal error' }));
  }
};
