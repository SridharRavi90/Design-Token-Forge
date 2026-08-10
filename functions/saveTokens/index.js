'use strict';
const { Readable } = require('stream');
const crypto   = require('crypto');
const catalyst = require('zcatalyst-sdk-node');
const FOLDER_ID = '38969000000065373';

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
  const r = new Readable(); r.push(Buffer.from(str, 'utf8')); r.push(null); return r;
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
    const app  = catalyst.initialize(req, { type: 'applogic' });
    const body = await readBody(req);
    const projectId = (body.project_id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!projectId) { res.statusCode = 400; res.end(JSON.stringify({ status: 'failure', error: 'project_id required' })); return; }
    if (!body.tokens) { res.statusCode = 400; res.end(JSON.stringify({ status: 'failure', error: 'tokens required' })); return; }

    const tokensJson = JSON.stringify(body.tokens);
    const hash = crypto.createHash('sha256').update(tokensJson).digest('hex').slice(0, 16);
    const now  = new Date().toISOString();
    const meta = (body.tokens && body.tokens._meta) || {};
    const version = (meta.version || '').trim();

    // Write-only — no reads, no listFiles, no DataStore (all hang/fail in dev env)
    const folder = app.filestore().folder(FOLDER_ID);
    const mainName = projectId + '__tokens__' + Date.now() + '.json';
    const uploaded = await folder.uploadFile({
      code: FOLDER_ID, content: makeReadable(tokensJson), name: mainName, mimeType: 'application/json'
    });
    const newFileId = String(uploaded.id || uploaded.file_id || uploaded.fileId || '');

    let snapshotFileId = '';
    if (version) {
      try {
        const snap = await folder.uploadFile({
          code: FOLDER_ID,
          content: makeReadable(tokensJson),
          name: projectId + '__' + version + '__snapshot.json',
          mimeType: 'application/json'
        });
        snapshotFileId = String(snap.id || snap.file_id || snap.fileId || '');
      } catch(_) {}
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'success', data: { hash, savedAt: now, fileId: newFileId, snapshotFileId } }));
  } catch(err) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end(JSON.stringify({ status: 'failure', error: err.message || 'Internal error' }));
    }
  }
};
