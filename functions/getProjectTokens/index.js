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

const catalyst = require('zcatalyst-sdk-node');

const ALLOWED_ORIGIN = 'https://design-token-forge-crtmngny.onslate.in';
const TABLE = 'dtf_projects';
const FOLDER_ID = '38969000000065373';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-ZCSRF-TOKEN, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

async function resolveUserId(req) {
  const app = catalyst.initialize(req);
  const user = await app.auth().getCurrentUser();
  const ud = user && user.user_details ? user.user_details : (user || {});
  const userId = String(ud.user_id || ud.userId || '');
  if (!userId) throw new Error('Could not resolve user identity');
  return { app, userId };
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
    const projectId = (req.query && req.query.project) ? String(req.query.project).replace(/[^a-z0-9_-]/g, '') : '';
    if (!projectId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ status: 'failure', error: 'project query param is required' }));
      return;
    }

    /* Verify ownership + get file ID from DataStore */
    const zcql = app.zcql();
    const rows = await zcql.executeZCQLQuery(
      `SELECT ROWID, description, last_hash FROM ${TABLE} ` +
      `WHERE user_id = '${userId.replace(/'/g, "''")}' ` +
      `AND project_id = '${projectId.replace(/'/g, "''")}'`
    );
    if (!rows || rows.length === 0) {
      res.statusCode = 404;
      res.end(JSON.stringify({ status: 'failure', error: 'Project not found' }));
      return;
    }
    const row = rows[0][TABLE] || rows[0];

    var descBlob = {};
    try { descBlob = JSON.parse(row.description || '{}'); } catch(_) {}
    const fileId = descBlob.tokens_file_id || null;

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
