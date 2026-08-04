/**
 * functions/pollPluginToken/index.js
 *
 * Polled by the Figma plugin every 2 seconds after the user has opened
 * link-plugin.html. Returns the JWT once generatePluginToken has stored it.
 * Deletes the temporary challenge row on first successful read (one-time use).
 *
 * GET /server/pollPluginToken?challenge=<challenge>
 * Auth: none — the challenge code acts as the secret
 */
'use strict';

const crypto   = require('crypto');
const catalyst = require('zcatalyst-sdk-node');

const ALLOWED_ORIGIN = '*';   /* plugin origin is figma.com — must be open */
const TABLE = 'dtf_projects';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
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

  /* pollPluginToken needs an app instance for DataStore access.
     It does NOT need an authenticated user — the challenge is the secret.
     Initialize in anonymous/app mode. */
  let app;
  try {
    app = catalyst.initialize(req, { type: 'applogic' });
  } catch (_) {
    try { app = catalyst.initialize(req); } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ status: 'failure', error: 'SDK init failed' }));
      return;
    }
  }

  const rawChallenge = (req.query && req.query.challenge) ? String(req.query.challenge) : '';
  const challenge    = rawChallenge.replace(/[^a-fA-F0-9]/g, '').slice(0, 64);
  if (!challenge || challenge.length < 16) {
    res.statusCode = 400;
    res.end(JSON.stringify({ status: 'failure', error: 'Invalid challenge parameter' }));
    return;
  }

  try {
    const projectId = '__ptk__' + challenge.toLowerCase();
    const zcql      = app.zcql();
    const rows      = await zcql.executeZCQLQuery(
      `SELECT ROWID, user_id, description, last_hash FROM ${TABLE} WHERE project_id = '${projectId}' AND name = 'plugin_token'`
    );

    if (!rows || rows.length === 0) {
      /* Not yet stored — client should keep polling */
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 'pending' }));
      return;
    }

    const row      = rows[0][TABLE] || rows[0];
    const expiresAt = row.last_hash || '';
    if (expiresAt && new Date(expiresAt) < new Date()) {
      /* Expired — clean up and reject */
      try { await app.datastore().table(TABLE).deleteRow(row.ROWID); } catch (_) {}
      res.statusCode = 410;
      res.end(JSON.stringify({ status: 'failure', error: 'Challenge expired — start a new link flow' }));
      return;
    }

    const jwt    = row.description || '';
    const userId = row.user_id     || '';

    /* One-time use: delete the challenge row immediately */
    try { await app.datastore().table(TABLE).deleteRow(row.ROWID); } catch (_) {}

    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'success', data: { jwt, userId } }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ status: 'failure', error: err.message || 'Internal error' }));
  }
};
