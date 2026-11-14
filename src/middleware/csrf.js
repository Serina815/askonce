'use strict';

const crypto = require('crypto');

/** 双提交 CSRF：会话里存令牌，写请求必须带回；multipart 走查询串 */
module.exports = function csrf(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(32).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;

  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const sent = (req.body && req.body._csrf) || req.query._csrf || req.get('x-csrf-token') || '';
    const expected = req.session.csrfToken;
    const ok =
      typeof sent === 'string' &&
      sent.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));

    if (!ok) {
      const err = new Error('表单已过期，请刷新页面后重试');
      err.status = 403;
      return next(err);
    }
  }

  return next();
};
