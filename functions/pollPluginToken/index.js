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
    app = catalyst.initialize(req, { type: catalyst.type.advancedio });
  } catch (_) {
    try { app = catalyst.initialize(req); } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ status: 'failure', error: 'SDK init failed' }));
      return;
    }
  }

  const rawChallenge = qs(req).challenge || '';
  const challenge    = rawChallenge.replace(/[^a-fA-F0-9]/g, '').slice(0, 64);
  if (!challenge || challenge.length < 16) {
    res.statusCode = 400;
    res.end(JSON.stringify({ status: 'failure', error: 'Invalid challenge parameter' }));
    return;
  }

  try {
    const projectId = '__ptk__' + challenge.toLowerCase();
    const datastore = app.datastore();
    const table     = datastore.table(TABLE);

    /* ZCQL scoping varies per function — use getAllRows() + JS filter instead */
    const allRows   = await table.getAllRows();
    const rawList   = Array.isArray(allRows) ? allRows : (allRows && allRows.data ? allRows.data : []);
    const match     = rawList.find(function(r) {
      const d = r[TABLE] || r;
      return d.project_id === projectId;
    });

    if (!match) {
      /* Not yet stored — client should keep polling */
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 'pending' }));
      return;
    }

    const row      = match[TABLE] || match;
    const jwt      = row.description || '';  /* JWT is stored in description */
    const userId   = row.user_id      || '';

    if (!jwt) {
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 'pending' }));
      return;
    }

    /* Decode exp claim from JWT — no separate expiry column needed */
    try {
      const parts = jwt.split('.');
      if (parts.length === 3) {
        const claims = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
        if (claims.exp && Math.floor(Date.now() / 1000) > claims.exp) {
          try { await app.datastore().table(TABLE).deleteRow(row.ROWID); } catch (_) {}
          res.statusCode = 410;
          res.end(JSON.stringify({ status: 'failure', error: 'Challenge expired — start a new link flow' }));
          return;
        }
      }
    } catch (_) {}

    /* One-time use: delete the challenge row immediately */
    try { await app.datastore().table(TABLE).deleteRow(row.ROWID); } catch (_) {}

    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'success', data: { jwt, userId } }));
  } catch (err) {
    res.statusCode = 500;
    res.end(JSON.stringify({ status: 'failure', error: err.message || 'Internal error' }));
  }
};
