'use strict';

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  return res.redirect('/login');
}

module.exports = { requireAuth };
