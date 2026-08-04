/**
 * functions/generatePluginToken/index.js
 *
 * Called from link-plugin.html (a page the user opens in their browser
 * while the Figma plugin is waiting). The user is authenticated via their
 * Zoho Catalyst session cookie — no additional credentials are required.
 *
 * Flow:
 *   1. Plugin generates a random `challenge` and opens link-plugin.html?challenge=<c>
 *   2. This page calls GET /server/generatePluginToken?challenge=<c>
 *   3. This function creates a signed JWT, stores challenge→JWT in DataStore
 *   4. Plugin polls /server/pollPluginToken?challenge=<c> until it gets the JWT
 *   5. Plugin stores JWT in figma.clientStorage — linked permanently
 *
 * GET /server/generatePluginToken?challenge=<challenge>
 * Auth: Catalyst session (browser)
 */
'use strict';

const crypto = require('crypto');
const catalyst = require('zcatalyst-sdk-node');

const ALLOWED_ORIGIN = 'https://design-token-forge-crtmngny.onslate.in';
const TABLE          = 'dtf_projects';
const TOKEN_TTL_MS   = 5 * 60 * 1000;   /* 5 minutes for the challenge to be polled */
const JWT_EXPIRY_S   = 7 * 24 * 3600;   /* 7 days for the bearer token */
const TOKEN_SECRET   = process.env.DTF_TOKEN_SECRET || 'dtf-default-dev-secret-change-in-prod';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-ZCSRF-TOKEN');
  res.setHeader('Cache-Control', 'no-store');
}

/* Minimal JWT builder — no third-party dep, uses Node crypto */
function b64url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function makeJwt(userId) {
  var now = Math.floor(Date.now() / 1000);
  var header  = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  var payload = b64url(JSON.stringify({ uid: userId, iat: now, exp: now + JWT_EXPIRY_S }));
  var sigInput = header + '.' + payload;
  var sig = crypto.createHmac('sha256', TOKEN_SECRET).update(sigInput).digest('base64')
              .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return sigInput + '.' + sig;
}

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
    const rawChallenge = (req.query && req.query.challenge) ? String(req.query.challenge) : '';
    /* Sanitise: only hex chars allowed (plugin generates hex) */
    const challenge = rawChallenge.replace(/[^a-fA-F0-9]/g, '').slice(0, 64);
    if (!challenge || challenge.length < 16) {
      res.statusCode = 400;
      res.end(JSON.stringify({ status: 'failure', error: 'Invalid challenge parameter' }));
      return;
    }

    /* Build the JWT */
    const jwt = makeJwt(userId);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

    /* Store challenge → JWT in DataStore as a temporary row.
       We reuse dtf_projects with a special project_id prefix so
       no additional table is needed. */
    const projectId = '__ptk__' + challenge.toLowerCase();
    const zcql = app.zcql();

    /* Delete any existing stale challenge row for this user (idempotent re-link) */
    try {
      const existing = await zcql.executeZCQLQuery(
        `SELECT ROWID FROM ${TABLE} WHERE user_id = '${userId.replace(/'/g, "''")}' AND project_id = '${projectId}'`
      );
      if (existing && existing.length) {
        const rowId = (existing[0][TABLE] || existing[0]).ROWID;
        await app.datastore().table(TABLE).deleteRow(rowId);
      }
    } catch (_) { /* ignore — stale cleanup is best-effort */ }

    /* Insert fresh challenge row */
    await app.datastore().table(TABLE).insertRow({
      user_id:        userId,
      project_id:     projectId,
      name:           'plugin_token',
      description:    jwt,
      created_at:     new Date().toISOString(),
      last_hash:      expiresAt,    /* reuse last_hash as expiry field */
      last_synced_at: ''
    });

    res.statusCode = 200;
    res.end(JSON.stringify({ status: 'success', data: { linked: true, expiresAt } }));
  } catch (err) {
    const is401 = /unauthorized|not authenticated/i.test(err.message || '');
    res.statusCode = is401 ? 401 : 500;
    res.end(JSON.stringify({ status: 'failure', error: err.message || 'Internal error' }));
  }
};
