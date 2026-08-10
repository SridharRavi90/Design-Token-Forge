'use strict';
const crypto   = require('crypto');
const catalyst = require('zcatalyst-sdk-node');
const TABLE = 'dtf_projects';

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
    // 'advancedio' is the correct SDK type for Advanced I/O functions (not 'applogic')
    const app  = catalyst.initialize(req, { type: catalyst.type.advancedio });
    const body = await readBody(req);
    const projectId = (body.project_id || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!projectId) { res.statusCode = 400; res.end(JSON.stringify({ status: 'failure', error: 'project_id required' })); return; }
    if (!body.tokens) { res.statusCode = 400; res.end(JSON.stringify({ status: 'failure', error: 'tokens required' })); return; }

    const tokensJson = JSON.stringify(body.tokens);
    const hash = crypto.createHash('sha256').update(tokensJson).digest('hex').slice(0, 16);
    const now  = new Date().toISOString();
    const meta = (body.tokens && body.tokens._meta) || {};
    const version = (meta.version || '').trim();

    /* DataStore upsert — store tokens inline in description field */
    const LEGACY_UID = 'sridhar-2917';
    const ds = app.datastore().table(TABLE);
    const allRows = await ds.getAllRows();
    const rawList = Array.isArray(allRows) ? allRows : (allRows && allRows.data ? allRows.data : []);
    const match = rawList.find(function(r) {
      const row = r[TABLE] || r;
      return row.project_id === projectId;
    });

    var versions = [];
    var rowId;
    if (match) {
      const existingRow = match[TABLE] || match;
      rowId = existingRow.ROWID;
      try {
        const d = JSON.parse(existingRow.description || '{}');
        versions = Array.isArray(d.versions) ? d.versions : [];
      } catch(_) {}
    }

    if (version) {
      versions = versions.filter(function(v) { return v.version !== version; });
      versions.unshift({ version, name: meta.name || '', savedAt: meta.savedAt || now, savedBy: meta.savedBy || '' });
      if (versions.length > 20) versions.length = 20;
    }

    const newDesc = JSON.stringify({ tokens_json: tokensJson, versions, last_hash: hash, last_synced_at: now });

    if (rowId) {
      await ds.updateRow({ ROWID: rowId, last_hash: hash, last_synced_at: now, description: newDesc });
    } else {
      await ds.insertRow({ user_id: LEGACY_UID, project_id: projectId, last_hash: hash, last_synced_at: now, description: newDesc });
    }

    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'success', data: { hash, savedAt: now } }));
  } catch(err) {
    if (!res.headersSent) {
      res.statusCode = 500;
      res.end(JSON.stringify({ status: 'failure', error: err.message || 'Internal error' }));
    }
  }
};
