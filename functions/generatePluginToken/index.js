/**
 * functions/generatePluginToken/index.js
 *
 * GET /server/generatePluginToken?challenge=<hex>&uid=<string>
 * Auth: none — 192-bit random challenge is the proof of identity.
 *
 * Flow:
 *   1. Plugin opens this URL in the browser with its challenge + uid.
 *   2. Function creates a signed JWT, stores challenge->JWT in DataStore,
 *      returns a "Plugin linked!" HTML page (no hub.html needed).
 *   3. Plugin polls pollPluginToken until it gets the JWT.
 */
'use strict';

const crypto   = require('crypto');
const catalyst = require('zcatalyst-sdk-node');

const TABLE            = 'dtf_projects';
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const JWT_EXPIRY_S     = 7 * 24 * 3600;
const TOKEN_SECRET     = process.env.DTF_TOKEN_SECRET || 'dtf-default-dev-secret-change-in-prod';

function b64url(str) {
  return Buffer.from(str).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function makeJwt(userId) {
  var now = Math.floor(Date.now() / 1000);
  var header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  var payload = b64url(JSON.stringify({ uid: userId, iat: now, exp: now + JWT_EXPIRY_S }));
  var sig = crypto.createHmac('sha256', TOKEN_SECRET)
    .update(header + '.' + payload).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return header + '.' + payload + '.' + sig;
}

function htmlPage(icon, heading, body) {
  return [
    '<!DOCTYPE html><html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>DTF \u00b7 ' + heading + '</title>',
    '<style>',
    '*{box-sizing:border-box;margin:0;padding:0}',
    'body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;',
    '  background:#F8FAFC;display:flex;align-items:center;justify-content:center;',
    '  min-height:100vh;padding:24px}',
    '.card{background:#fff;border:1px solid #E2E8F0;border-radius:16px;',
    '  padding:48px 40px;text-align:center;max-width:380px;width:100%}',
    '.icon{font-size:48px;line-height:1;margin-bottom:20px}',
    'h1{font-size:22px;font-weight:700;color:#0F172A;margin-bottom:10px}',
    'p{font-size:14px;color:#64748B;line-height:1.6}',
    '.dim{font-size:12px;color:#94A3B8;margin-top:16px}',
    '</style></head><body>',
    '<div class="card">',
    '  <div class="icon">' + icon + '</div>',
    '  <h1>' + heading + '</h1>',
    '  <p>' + body + '</p>',
    '  <p class="dim">You can close this tab.</p>',
    '</div></body></html>'
  ].join('\n');
}

module.exports = async (req, res) => {
  const isBrowser = (req.headers['accept'] || '').includes('text/html');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') { res.statusCode = 204; res.end(''); return; }
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'failure', error: 'Method not allowed' }));
    return;
  }

  /* Initialize SDK FIRST — Catalyst populates req.query during initialize().
     Reading req.query before this returns an empty object (root cause of
     the "Invalid link" bug where challenge was visibly in the URL but
     req.query.challenge was undefined). */
  let app;
  try {
    app = catalyst.initialize(req, { type: 'applogic' });
  } catch (initErr) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'failure', error: 'SDK init failed: ' + initErr.message }));
    return;
  }

  const rawChallenge = (req.query && req.query.challenge) ? String(req.query.challenge) : '';
  const challenge    = rawChallenge.replace(/[^a-fA-F0-9]/g, '').slice(0, 64);
  if (!challenge || challenge.length < 16) {
    res.statusCode = 400;
    if (isBrowser) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(htmlPage('\u274c', 'Invalid link',
        'The link is missing a required parameter. Please try linking again from the Figma plugin.'));
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'failure', error: 'Invalid challenge parameter' }));
    }
    return;
  }

  const rawUid = (req.query && req.query.uid) ? String(req.query.uid) : '';
  const userId = rawUid.replace(/[^a-zA-Z0-9_\-. @]/g, '').slice(0, 128) || 'unknown';

  try {
    const jwt       = makeJwt(userId);
    const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
    const projectId = '__ptk__' + challenge.toLowerCase();
    const zcql      = app.zcql();

    try {
      const existing = await zcql.executeZCQLQuery(
        "SELECT ROWID FROM " + TABLE + " WHERE project_id = '" + projectId + "'"
      );
      if (existing && existing.length) {
        const rowId = (existing[0][TABLE] || existing[0]).ROWID;
        await app.datastore().table(TABLE).deleteRow(rowId);
      }
    } catch (_) {}

    await app.datastore().table(TABLE).insertRow({
      user_id:        userId,
      project_id:     projectId,
      name:           'plugin_token',
      description:    jwt,
      created_at:     new Date().toISOString(),
      last_hash:      expiresAt,
      last_synced_at: ''
    });

    if (isBrowser) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(htmlPage(
        '\u2705',
        'Plugin linked!',
        'Your Figma plugin is now connected to DTF. ' +
        'Return to Figma to continue \u2014 your projects will appear in the dropdown.'
      ));
    } else {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'success', data: { linked: true, expiresAt } }));
    }
  } catch (err) {
    console.error('[generatePluginToken] error:', err);
    if (isBrowser) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(htmlPage('\u274c', 'Something went wrong',
        'An error occurred: ' + (err.message || 'Unknown error') +
        '. Please try again from the Figma plugin.'));
    } else {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ status: 'failure', error: err.message || 'Internal error' }));
    }
  }
};
