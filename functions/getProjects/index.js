/**
 * functions/getProjects/index.js
 *
 * Catalyst Advanced I/O function — returns the projects.json list.
 *
 * URL: GET /server/getProjects
 *
 * Replaces the GitHub API call the plugin previously made to list
 * project directories. All Catalyst users see the same central
 * project list (no per-fork filtering needed).
 *
 * Resolution order:
 *   1. Zoho Slate static files (same-origin server-side call)
 *   2. GitHub raw content (pages branch, with optional DTF_GH_TOKEN)
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
  const r = await fetch(url, { headers });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching ' + url);
  return r.text();
}

module.exports = async (req, res) => {
  setCors(res);
  res.setHeader('Content-Type', 'application/json');

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

  let body;

  // Attempt 1: Slate static files
  try {
    body = await fetchText(SLATE_BASE + '/projects.json');
  } catch (_slateErr) {
    // Attempt 2: GitHub raw content (pages branch)
    try {
      const ghUrl = `https://raw.githubusercontent.com/${GH_REPO}/pages/projects.json`;
      const ghHeaders = GH_TOKEN ? { Authorization: 'Bearer ' + GH_TOKEN } : {};
      body = await fetchText(ghUrl, ghHeaders);
    } catch (ghErr) {
      res.statusCode = 502;
      res.end(JSON.stringify({ error: 'Could not fetch projects: ' + ghErr.message }));
      return;
    }
  }

  res.statusCode = 200;
  res.end(body);
};
