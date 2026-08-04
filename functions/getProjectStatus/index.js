/**
 * functions/getProjectStatus/index.js
 *
 * Returns the current hash and last-synced timestamp for a project.
 * The Figma plugin polls this every 3 s to detect token changes.
 *
 * GET /server/getProjectStatus?project=<project_id>
 * Auth: Catalyst session (browser) or Authorization: Bearer <plugin-token> (Phase 2)
 *
 * Response shape matches the static status.json the plugin already knows:
 *   { hash, lastChanged, totalVariables, buildCommit }
 */
'use strict';

const crypto   = require('crypto');
const catalyst = require('zcatalyst-sdk-node');

const ALLOWED_ORIGIN  = 'https://design-token-forge-crtmngny.onslate.in';
const TABLE           = 'dtf_projects';
const TOKEN_SECRET    = process.env.DTF_TOKEN_SECRET || 'dtf-default-dev-secret-change-in-prod';

function setCors(res) {
  /* Allow both the web app origin and Figma plugin origin */
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-ZCSRF-TOKEN, Authorization');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

/* Verify a DTF plugin JWT and return the user_id claim.
   Returns null if the token is missing, malformed, expired, or has a bad signature. */
function verifyBearerJwt(req) {
  const authHeader = req.headers && req.headers.authorization || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  try {
    const [header, payload, sig] = match[1].split('.');
    if (!header || !payload || !sig) return null;
    const sigInput = header + '.' + payload;
    const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(sigInput).digest('base64')
                      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
    if (sig !== expected) return null;
    const claims = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
    if (!claims.uid) return null;
    if (claims.exp && Math.floor(Date.now() / 1000) > claims.exp) return null;
    return String(claims.uid);
  } catch (_) { return null; }
}

async function resolveUserId(req) {
  /* Try bearer token first (Figma plugin path — no Catalyst session cookie) */
  const bearerUserId = verifyBearerJwt(req);
  if (bearerUserId) {
    const app = catalyst.initialize(req, { type: 'applogic' });
    return { app, userId: bearerUserId };
  }
  /* Fall back to Catalyst session (web browser path) */
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
    const projectId = (req.query && req.query.project) ? String(req.query.project).replace(/[^a-z0-9_-]/g, '') : '';
    if (!projectId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ status: 'failure', error: 'project query param is required' }));
      return;
    }

    const zcql = app.zcql();
    const rows = await zcql.executeZCQLQuery(
      `SELECT last_hash, last_synced_at FROM ${TABLE} ` +
      `WHERE user_id = '${userId.replace(/'/g, "''")}' ` +
      `AND project_id = '${projectId.replace(/'/g, "''")}'`
    );
    if (!rows || rows.length === 0) {
      res.statusCode = 404;
      res.end(JSON.stringify({ status: 'failure', error: 'Project not found' }));
      return;
    }
    const row = rows[0][TABLE] || rows[0];

    /* Return a status.json-compatible shape so the plugin needs
       minimal changes to consume this endpoint. */
    res.statusCode = 200;
    res.end(JSON.stringify({
      hash:           row.last_hash      || '',
      lastChanged:    row.last_synced_at || null,
      totalVariables: 0,   /* populated by saveTokens in a future update */
      buildCommit:    'catalyst'
    }));
  } catch (err) {
    const is401 = /unauthorized|not authenticated/i.test(err.message || '');
    res.statusCode = is401 ? 401 : 500;
    res.end(JSON.stringify({ status: 'failure', error: err.message || 'Internal error' }));
  }
};
