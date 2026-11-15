'use strict';

const express = require('express');
const { all, get, asyncHandler } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    const due = await get(
      `SELECT COUNT(*) AS c FROM problems
        WHERE status IN ('solved','mastered') AND next_review_on <= CURDATE()`
    );

    // 首页只放卡片：数字都在统计页
    const cards = await all(
      `SELECT id, title, status, mastery, recurrence_count, next_review_on, tags, created_at, updated_at
         FROM problems
        ORDER BY updated_at DESC
        LIMIT 60`
    );

    return res.render('home', {
      title: '全部',
      dueCount: Number(due.c) || 0,
      cards,
    });
  })
);

router.get(
  '/drafts',
  requireAuth,
  asyncHandler(async (req, res) => {
    const drafts = await all(
      `SELECT id, title, error_text, context, tags, created_at
         FROM problems
        WHERE status = 'draft'
        ORDER BY created_at DESC
        LIMIT 100`
    );

    return res.render('drafts', { title: '待整理', drafts });
  })
);

router.get(
  '/search',
  asyncHandler(async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    const q = str(req.query.q);
    let problems = [];
    if (q) {
      const like = `%${q}%`;
      problems = await all(
        `SELECT id, title, status, mastery, recurrence_count, tags, error_text, created_at
           FROM problems
          WHERE title LIKE ? OR error_text LIKE ? OR tags LIKE ? OR norm_error LIKE ?
          ORDER BY updated_at DESC
          LIMIT 50`,
        [like, like, like, like]
      );
    }

    return res.render('search', { title: q ? `搜索：${q}` : '搜索', q, problems });
  })
);

router.get('/healthz', (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()), version: '1.0.0' });
});

module.exports = router;
