/**
 * functions/listProjects/index.js
 *
 * Returns all projects owned by the currently signed-in Catalyst user.
 * Reads from the dtf_projects DataStore table.
 *
 * GET /server/listProjects
 * Auth: Catalyst session (browser) or Authorization: Bearer <plugin-token> (Phase 2)
 */
'use strict';

const catalyst = require('zcatalyst-sdk-node');

const ALLOWED_ORIGIN = 'https://design-token-forge-crtmngny.onslate.in';
const TABLE = 'dtf_projects';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-ZCSRF-TOKEN, Authorization');
  res.setHeader('Cache-Control', 'no-store');
}

/* Resolve the user_id from the Catalyst session.
   Returns the stable Catalyst user_id string. */
async function resolveUserId(req) {
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
    const { app, userId } = await resolveUserId(req);

    const zcql = app.zcql();
    const result = await zcql.executeZCQLQuery(
      `SELECT ROWID, user_id, project_id, name, description, last_hash, last_synced_at ` +
      `FROM ${TABLE} WHERE user_id = '${userId.replace(/'/g, "''")}'`
    );

    /* Normalise rows — ZCQL wraps each row in a table-name key. */
    const rows = (result || []).map(function(r) {
      const row = r[TABLE] || r;
      /* description is stored as JSON blob:
         { "text": "<user desc>", "tokens_file_id": "<catalyst file id>" } */
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
