'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const { all, get, asyncHandler } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { toMarkdown, toAnkiCsv } = require('../services/export');
const config = require('../config');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: '尝试太频繁，请一分钟后再来。',
});

router.get('/login', (req, res) => {
  if (req.session.userId) return res.redirect('/');
  return res.render('login', { title: '登录', error: null, username: '' });
});

router.post(
  '/login',
  loginLimiter,
  asyncHandler(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    const user = await get('SELECT * FROM users WHERE username = ?', [username]);
    const ok = user ? await bcrypt.compare(password, user.password_hash) : false;

    if (!ok) {
      return res.status(401).render('login', {
        title: '登录',
        error: '用户名或密码不对',
        username,
      });
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate((err) => (err ? reject(err) : resolve()));
    });
    req.session.userId = user.id;
    req.session.username = user.username;

    const target =
      typeof req.session.returnTo === 'string' && req.session.returnTo.startsWith('/')
        ? req.session.returnTo
        : '/';
    delete req.session.returnTo;
    return res.redirect(target);
  })
);

router.post('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie('sid');
    return res.redirect('/login');
  });
});

async function loadAll() {
  const problems = await all('SELECT * FROM problems ORDER BY id ASC');
  const attempts = await all('SELECT * FROM attempts ORDER BY problem_id ASC, id ASC');
  const grouped = {};
  for (const attempt of attempts) {
    (grouped[attempt.problem_id] = grouped[attempt.problem_id] || []).push(attempt);
  }
  return { problems, attempts, grouped };
}

router.get(
  '/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { problems } = await loadAll();
    const counts = problems.reduce(
      (acc, p) => {
        acc[p.status] = (acc[p.status] || 0) + 1;
        return acc;
      },
      { draft: 0, solved: 0, mastered: 0, archived: 0 }
    );

    return res.render('export', {
      title: '导出与设置',
      total: problems.length,
      counts,
      aiEnabled: config.ai.enabled,
      aiModel: config.ai.model,
      nodeVersion: process.version,
    });
  })
);

router.get(
  '/export.md',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { problems, grouped } = await loadAll();
    const text = toMarkdown(problems, grouped);
    res.set('Content-Type', 'text/markdown; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="askonce-${Date.now()}.md"`);
    res.send(text);
  })
);

router.get(
  '/export.csv',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { problems } = await loadAll();
    const text = toAnkiCsv(problems);
    // 加 BOM，Excel / Anki 打开中文不乱码
    res.set('Content-Type', 'text/csv; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="askonce-anki-${Date.now()}.csv"`);
    res.send('\uFEFF' + text);
  })
);

router.get(
  '/export.json',
  requireAuth,
  asyncHandler(async (req, res) => {
    const { problems, attempts } = await loadAll();
    const payload = {
      exportedAt: new Date().toISOString(),
      problems,
      attempts,
    };
    res.set('Content-Type', 'application/json; charset=utf-8');
    res.set('Content-Disposition', `attachment; filename="askonce-${Date.now()}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  })
);

module.exports = router;
