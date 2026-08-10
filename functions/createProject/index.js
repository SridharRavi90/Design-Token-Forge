/**
 * functions/createProject/index.js
 *
 * Creates a new project for the signed-in user.
 * Inserts a row in dtf_projects DataStore table.
 *
 * POST /server/createProject
 * Body: { "project_id": "my-app", "name": "My App", "description": "..." }
 *
 * project_id must be URL-safe [a-z0-9-_] and unique per user.
 */
'use strict';

const crypto   = require('crypto');
const catalyst = require('zcatalyst-sdk-node');

const TABLE        = 'dtf_projects';
const TOKEN_SECRET = process.env.DTF_TOKEN_SECRET || 'dtf-default-dev-secret-change-in-prod';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-DTF-Token');
  res.setHeader('Cache-Control', 'no-store');
}

function verifyBearerJwt(req) {
  const auth = (req.headers && (req.headers['x-dtf-token'] || req.headers.authorization)) || '';
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
  const bearerUid = verifyBearerJwt(req);
  if (bearerUid) {
    const app = catalyst.initialize(req, { type: catalyst.type.advancedio });
    return { app, userId: bearerUid };
  }
  const app = catalyst.initialize(req);
  const user = await app.auth().getCurrentUser();
  const ud = user && user.user_details ? user.user_details : (user || {});
  const userId = String(ud.user_id || ud.userId || '');
  if (!userId) throw new Error('Could not resolve user identity');
  return { app, userId };
}

function readBody(req) {
  return new Promise(function(resolve, reject) {
    var body = '';
    req.on('data', function(chunk) { body += chunk; });
    req.on('end', function() {
      try { resolve(JSON.parse(body || '{}')); }
      catch(e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

module.exports = async (req, res) => {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(''); return; }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ status: 'failure', error: 'Method not allowed' }));
    return;
  }

  try {
    const { app, userId } = await resolveUserAndApp(req);
    const body = await readBody(req);

    var projectId = (body.project_id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (!projectId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ status: 'failure', error: 'project_id is required' }));
      return;
    }
    if (!body.name) {
      res.statusCode = 400;
      res.end(JSON.stringify({ status: 'failure', error: 'name is required' }));
      return;
    }

    /* Check for duplicate: same user + same project_id */
    const allRows  = await app.datastore().table(TABLE).getAllRows();
    const rawList  = Array.isArray(allRows) ? allRows : (allRows && allRows.data ? allRows.data : []);
    const existing = rawList.find(function(r) {
      const row = r[TABLE] || r;
      return row.user_id === userId && row.project_id === projectId;
    });
    if (existing) {
      res.statusCode = 409;
      res.end(JSON.stringify({ status: 'failure', error: 'A project with this id already exists' }));
      return;
    }

    /* Insert the row.  description is stored as a JSON blob so we can
       later add tokens_file_id without schema changes. */
    const datastore = app.datastore();
    const table = datastore.table(TABLE);
    const now = new Date().toISOString();
    const row = await table.insertRow({
      user_id:        userId,
      project_id:     projectId,
      name:           String(body.name).slice(0, 120),
      description:    JSON.stringify({ text: String(body.description || '').slice(0, 500), tokens_file_id: null }),
      last_hash:      '',
      last_synced_at: ''
    });

    res.statusCode = 201;
    res.end(JSON.stringify({
      status: 'success',
      data: { id: projectId, name: body.name, rowId: row.ROWID || row.rowId }
    }));
  } catch (err) {
    const is401 = /unauthorized|not authenticated/i.test(err.message || '');
    res.statusCode = is401 ? 401 : 500;
    res.end(JSON.stringify({ status: 'failure', error: err.message || 'Internal error' }));
  }
};
