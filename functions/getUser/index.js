/**
 * functions/getUser/index.js
 *
 * Catalyst Advanced I/O function — returns the currently signed-in
 * Catalyst user's profile as JSON.
 *
 * URL (once deployed): /server/getUser
 *
 * Called by demo/catalyst-user.js to display the user's name in
 * the topbar. Runs server-side so it has access to the Catalyst
 * auth session that the Web SDK can't reach from a Slate domain.
 */
'use strict';

const catalyst = require('zcatalyst-sdk-node');

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json');

  /* Only allow GET requests. */
  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.end(JSON.stringify({ status: 'failure', error: 'Method not allowed' }));
    return;
  }

  try {
    const app = catalyst.initialize(req);
    const user = await app.auth().getCurrentUser();

    /* Normalize across Catalyst SDK response shapes. */
    const ud = (user && user.user_details) ? user.user_details : (user || {});

    res.statusCode = 200;
    res.end(JSON.stringify({
      status: 'success',
      data: {
        userId:    String(ud.user_id    || ud.userId    || ''),
        firstName: String(ud.first_name || ud.firstName || ud.display_name || ud.name || ''),
        lastName:  String(ud.last_name  || ud.lastName  || ''),
        email:     String(ud.email_id   || ud.email     || ud.emailId     || '')
      }
    }));
  } catch (err) {
    res.statusCode = 401;
    res.end(JSON.stringify({
      status: 'failure',
      error: err.message || 'Unauthorized'
    }));
  }
};
