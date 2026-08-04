/**
 * functions/getTokenStatus/index.js
 *
 * Catalyst Advanced I/O function — returns the token status payload
 * (hash, lastChanged, totalVariables, etc.) for a given project.
 *
 * URL: GET /server/getTokenStatus?project=<projectId>
 *
 * Called by the Figma plugin's polling loop instead of hitting
 * GitHub Pages directly (which was down). This function adds the
 * CORS headers the plugin iframe requires.
 *
 * Resolution order:
 *   1. Zoho Slate static files (same-origin server-side call, no CORS)
 *   2. GitHub raw content (public repo, or private with DTF_GH_TOKEN)
 */
'use strict';

const SLATE_BASE = (process.env.DTF_SLATE_BASE || 'https://design-token-forge-crtmngny.onslate.in').replace(/\/$/, '');
const GH_REPO    = process.env.DTF_GH_REPO  || 'sridhar-ravi-2917/Design-Token-Forge';
const GH_TOKEN   = process.env.DTF_GH_TOKEN || '';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

async function fetchText(url, extraHeaders) {
  const headers = Object.assign({ 'User-Agent': 'DTF-Catalyst-Function/1.0' }, extraHeaders || {});
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' fetching ' + url);
  return res.text();
}

module.exports = async (req, res) => {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');

  // Handle CORS pre-flight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end('');
    return;
  }

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }

  const project = (req.query && req.query.project) ? String(req.query.project).replace(/[^a-zA-Z0-9_-]/g, '') : '';
  const filePath = project ? `/${project}/status.json` : '/status.json';

  let body;

  // Attempt 1: read from the Slate static files (same Catalyst project, server-side)
  try {
    body = await fetchText(SLATE_BASE + filePath);
  } catch (_slateErr) {
    // Attempt 2: fall back to GitHub raw content (pages branch)
    try {
      const ghPath = project ? `${project}/status.json` : 'status.json';
      const ghUrl  = `https://raw.githubusercontent.com/${GH_REPO}/pages/${ghPath}`;
      const ghHeaders = GH_TOKEN ? { Authorization: 'Bearer ' + GH_TOKEN } : {};
      body = await fetchText(ghUrl, ghHeaders);
    } catch (ghErr) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: 'Could not fetch status: ' + ghErr.message }));
      return;
    }
  }

  res.statusCode = 200;
  res.end(body);
};
