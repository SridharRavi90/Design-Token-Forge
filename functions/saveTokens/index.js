/**
 * functions/saveTokens/index.js
 *
 * Saves a project's tokens.json payload to Catalyst File Store and
 * updates the last_hash + last_synced_at in the DataStore.
 *
 * Called by the DTF web editor whenever the user saves token changes.
 *
 * POST /server/saveTokens
 * Body: { "project_id": "my-app", "tokens": { ...full tokens object... }, "hash": "abc123" }
 *
 * The tokens field is the same JSON object that build-static.js produces.
 */
'use strict';

const { Readable } = require('stream');
const crypto   = require('crypto');
const catalyst = require('zcatalyst-sdk-node');

const TABLE        = 'dtf_projects';
const FOLDER_ID    = '38969000000065373';
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
    const app = catalyst.initialize(req, { type: 'applogic' });
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
    var chunks = [];
    req.on('data', function(chunk) { chunks.push(chunk); });
    req.on('end', function() {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch(e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function makeReadable(str) {
  const r = new Readable();
  r.push(Buffer.from(str, 'utf8'));
  r.push(null);
  return r;
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

    const projectId = (body.project_id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!projectId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ status: 'failure', error: 'project_id is required' }));
      return;
    }
    if (!body.tokens) {
      res.statusCode = 400;
      res.end(JSON.stringify({ status: 'failure', error: 'tokens payload is required' }));
      return;
    }

    /* Verify the project belongs to this user */
    const allRows  = await app.datastore().table(TABLE).getAllRows();
    const rawList  = Array.isArray(allRows) ? allRows : (allRows && allRows.data ? allRows.data : []);
    const match    = rawList.find(function(r) {
      const row = r[TABLE] || r;
      return row.user_id === userId && row.project_id === projectId;
    });
    if (!match) {
      res.statusCode = 404;
      res.end(JSON.stringify({ status: 'failure', error: 'Project not found' }));
      return;
    }
    const existingRow = match[TABLE] || match;
    const rowId = existingRow.ROWID;

    /* Parse existing description blob to get existing file ID */
    var descBlob = {};
    try { descBlob = JSON.parse(existingRow.description || '{}'); } catch(_) {}
    const existingFileId = descBlob.tokens_file_id || null;

    /* Serialise tokens payload */
    const tokensJson = JSON.stringify(body.tokens);
    const hash = body.hash || require('crypto').createHash('sha256').update(tokensJson).digest('hex').slice(0, 16);
    const now = new Date().toISOString();

    /* Upload to File Store — if a previous file exists, delete it first to
       avoid orphaned blobs (Catalyst File Store has no upsert). */
    const filestore = app.filestore();
    const folder = filestore.folder(FOLDER_ID);

    if (existingFileId) {
      try { await folder.deleteFile(existingFileId); } catch(_) { /* ignore if already gone */ }
    }

    const fileName = `${userId}__${projectId}__tokens.json`;
    const uploaded = await folder.uploadFile({
      code:     FOLDER_ID,
      content:  makeReadable(tokensJson),
      fileName: fileName,
      mimeType: 'application/json'
    });
    const newFileId = String(uploaded.id || uploaded.file_id || uploaded.fileId || '');

    /* Update DataStore: new hash, synced_at, and file ID in description */
    const datastore = app.datastore();
    const table = datastore.table(TABLE);
    await table.updateRow({
      ROWID:          rowId,
      last_hash:      hash,
      last_synced_at: now,
      description:    JSON.stringify({ text: descBlob.text || '', tokens_file_id: newFileId })
    });

    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'success', data: { hash, savedAt: now, fileId: newFileId } }));
  } catch (err) {
    const is401 = /unauthorized|not authenticated/i.test(err.message || '');
    res.statusCode = is401 ? 401 : 500;
    res.end(JSON.stringify({ status: 'failure', error: err.message || 'Internal error' }));
  }
};
