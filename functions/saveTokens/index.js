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

function qs(req) {
  var raw = (req.url || '').split('?')[1] || '';
  var out = {};
  raw.split('&').forEach(function(p) {
    var i = p.indexOf('='); if (i < 0) return;
    try { out[decodeURIComponent(p.slice(0, i))] = decodeURIComponent(p.slice(i + 1)); } catch (_) {}
  });
  return out;
}

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
  // Always use applogic — cross-origin calls never carry a session cookie
  const qUserId = (qs(req).user_id || '').trim();
  const userId = qUserId || verifyBearerJwt(req) || '';
  const app = catalyst.initialize(req, { type: 'applogic' });
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

    /* Find or create the project row */
    const LEGACY_UID = 'sridhar-2917';
    const allRows  = await app.datastore().table(TABLE).getAllRows();
    const rawList  = Array.isArray(allRows) ? allRows : (allRows && allRows.data ? allRows.data : []);
    const match    = rawList.find(function(r) {
      const row = r[TABLE] || r;
      return (row.user_id === userId || row.user_id === LEGACY_UID) && row.project_id === projectId;
    });

    var existingRow, rowId;
    var descBlob = {};
    if (match) {
      existingRow = match[TABLE] || match;
      rowId = existingRow.ROWID;
      try { descBlob = JSON.parse(existingRow.description || '{}'); } catch(_) {}
    } else {
      /* First publish for this project — create the row */
      const created = await app.datastore().table(TABLE).insertRow({
        user_id:     userId || LEGACY_UID,
        project_id:  projectId,
        description: '{}'
      });
      existingRow = created[TABLE] || created;
      rowId = existingRow.ROWID;
    }

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

    /* If the payload includes version metadata, save a versioned snapshot so
       Version History can list and restore it later. Each version snapshot is
       stored as a separate file; only the last MAX_VERSIONS are kept. */
    const MAX_VERSIONS = 20;
    const meta = (body.tokens && body.tokens._meta) || {};
    const version = (meta.version || '').trim();
    var snapshotFileId = '';

    if (version) {
      const snapshotName = `${userId}__${projectId}__${version}__snapshot.json`;
      try {
        const snapshotUploaded = await folder.uploadFile({
          code:     FOLDER_ID,
          content:  makeReadable(tokensJson),
          fileName: snapshotName,
          mimeType: 'application/json'
        });
        snapshotFileId = String(snapshotUploaded.id || snapshotUploaded.file_id || snapshotUploaded.fileId || '');
      } catch (_snapErr) { /* non-fatal — main save already succeeded */ }
    }

    /* Build the updated versions list (newest first, capped at MAX_VERSIONS). */
    var existingVersions = Array.isArray(descBlob.versions) ? descBlob.versions : [];
    if (version && snapshotFileId) {
      /* Remove any duplicate entry for this version (safe retry idempotency). */
      existingVersions = existingVersions.filter(function(v) { return v.version !== version; });
      existingVersions.unshift({
        version:     version,
        name:        meta.name        || '',
        savedAt:     meta.savedAt     || now,
        savedBy:     meta.savedBy     || '',
        description: meta.description || '',
        fileId:      snapshotFileId
      });
      /* Evict oldest snapshots and delete their files (best-effort). */
      if (existingVersions.length > MAX_VERSIONS) {
        const toRemove = existingVersions.splice(MAX_VERSIONS);
        await Promise.all(toRemove.map(function(v) {
          return v.fileId ? folder.deleteFile(v.fileId).catch(function() {}) : Promise.resolve();
        }));
      }
    }

    /* Update DataStore: new hash, synced_at, file ID, and versions list. */
    const datastore = app.datastore();
    const table = datastore.table(TABLE);
    await table.updateRow({
      ROWID:          rowId,
      last_hash:      hash,
      last_synced_at: now,
      description:    JSON.stringify({
        text:           descBlob.text || '',
        tokens_file_id: newFileId,
        versions:       existingVersions
      })
    });

    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'success', data: { hash, savedAt: now, fileId: newFileId, snapshotFileId } }));
  } catch (err) {
    const is401 = /unauthorized|not authenticated/i.test(err.message || '');
    res.statusCode = is401 ? 401 : 500;
    res.end(JSON.stringify({ status: 'failure', error: err.message || 'Internal error' }));
  }
};
