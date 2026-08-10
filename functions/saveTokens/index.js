'use strict';

const { Readable } = require('stream');
const crypto   = require('crypto');
const catalyst = require('zcatalyst-sdk-node');

const FOLDER_ID = '38969000000065373';

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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
}

function readBody(req) {
  return new Promise(function(resolve, reject) {
    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
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
  if (req.method \!== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ status: 'failure', error: 'Method not allowed' }));
    return;
  }

  try {
    const app = catalyst.initialize(req, { type: 'applogic' });
    const body = await readBody(req);

    const projectId = (body.project_id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (\!projectId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ status: 'failure', error: 'project_id is required' }));
      return;
    }
    if (\!body.tokens) {
      res.statusCode = 400;
      res.end(JSON.stringify({ status: 'failure', error: 'tokens payload is required' }));
      return;
    }

    const tokensJson = JSON.stringify(body.tokens);
    const hash = crypto.createHash('sha256').update(tokensJson).digest('hex').slice(0, 16);
    const now = new Date().toISOString();
    const meta = (body.tokens && body.tokens._meta) || {};
    const version = (meta.version || '').trim();

    const folder = app.filestore().folder(FOLDER_ID);

    /* Read the index file to find previous file IDs for cleanup */
    const indexName = projectId + '__index.json';
    let indexData = {};
    try {
      const fileList = await folder.listFiles();
      const files = Array.isArray(fileList) ? fileList : (fileList && fileList.data ? fileList.data : []);
      const indexEntry = files.find(function(f) { return (f.file_name || f.name) === indexName; });
      if (indexEntry) {
        const dlRes = await folder.downloadFile(indexEntry.id || indexEntry.file_id);
        const buf = [];
        await new Promise(function(ok, fail) {
          dlRes.on('data', function(c) { buf.push(c); });
          dlRes.on('end', ok);
          dlRes.on('error', fail);
        });
        indexData = JSON.parse(Buffer.concat(buf).toString('utf8'));
        await folder.deleteFile(indexEntry.id || indexEntry.file_id).catch(function() {});
      }
    } catch(_) {}

    /* Delete previous main tokens file */
    if (indexData.tokens_file_id) {
      await folder.deleteFile(indexData.tokens_file_id).catch(function() {});
    }

    /* Upload current tokens */
    const uploaded = await folder.uploadFile({
      code:     FOLDER_ID,
      content:  makeReadable(tokensJson),
      name:     projectId + '__tokens.json',
      mimeType: 'application/json'
    });
    const newFileId = String(uploaded.id || uploaded.file_id || uploaded.fileId || '');

    /* Upload versioned snapshot (non-fatal) */
    let snapshotFileId = '';
    if (version) {
      try {
        const snap = await folder.uploadFile({
          code:     FOLDER_ID,
          content:  makeReadable(tokensJson),
          name:     projectId + '__' + version + '__snapshot.json',
          mimeType: 'application/json'
        });
        snapshotFileId = String(snap.id || snap.file_id || snap.fileId || '');
      } catch(_) {}
    }

    /* Build updated version list */
    var versions = Array.isArray(indexData.versions) ? indexData.versions : [];
    if (version && snapshotFileId) {
      versions = versions.filter(function(v) { return v.version \!== version; });
      versions.unshift({ version, name: meta.name || '', savedAt: meta.savedAt || now, savedBy: meta.savedBy || '', description: meta.description || '', fileId: snapshotFileId });
      if (versions.length > 20) versions.length = 20;
    }

    /* Upload updated index */
    await folder.uploadFile({
      code:     FOLDER_ID,
      content:  makeReadable(JSON.stringify({ tokens_file_id: newFileId, versions, last_hash: hash, last_synced_at: now })),
      name:     indexName,
      mimeType: 'application/json'
    }).catch(function() {});

    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'success', data: { hash, savedAt: now, fileId: newFileId, snapshotFileId } }));
  } catch (err) {
    if (\!res.headersSent) {
      res.statusCode = 500;
      res.end(JSON.stringify({ status: 'failure', error: err.message || 'Internal error' }));
    }
  }
};
