'use strict';

const express = require('express');
const { all, get, asyncHandler } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function str(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/** 标签复盘失败统计：找出"总也记不住"的方向 */
function weakTags(rows, limit = 5) {
  const map = new Map();
  for (const row of rows) {
    const tags = String(row.tags || '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    for (const tag of tags) {
      const item = map.get(tag) || { tag, total: 0, bad: 0 };
      item.total += 1;
      if (row.result === 'bad') item.bad += 1;
      map.set(tag, item);
    }
  }
  return [...map.values()]
    .filter((x) => x.total >= 2)
    .map((x) => ({ ...x, rate: Math.round((x.bad / x.total) * 100) }))
    .sort((a, b) => b.rate - a.rate || b.total - a.total)
    .slice(0, limit);
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    if (!req.session.userId) return res.redirect('/login');

    const due = await get(
      `SELECT COUNT(*) AS c FROM problems
        WHERE status IN ('solved','mastered') AND next_review_on <= CURDATE()`
    );
    const draftTotal = await get(`SELECT COUNT(*) AS c FROM problems WHERE status = 'draft'`);
    const recent = await all(
      `SELECT id, title, status, mastery, recurrence_count, next_review_on, tags, created_at, updated_at
         FROM problems
        ORDER BY updated_at DESC
        LIMIT 8`
    );
    // 首页只露最新的几张，完整清单在 /drafts
    const drafts = await all(
      `SELECT id, title, tags, error_text, created_at
         FROM problems
        WHERE status = 'draft'
        ORDER BY created_at DESC
        LIMIT 4`
    );
    const month = await get(
      `SELECT COUNT(*) AS solved, COALESCE(SUM(source = 'self'), 0) AS self_solved
         FROM problems
        WHERE status IN ('solved','mastered')
          AND DATE_FORMAT(updated_at, '%Y-%m') = DATE_FORMAT(CURDATE(), '%Y-%m')`
    );
    const avg = await get(
      `SELECT ROUND(AVG(recurrence_count), 1) AS avg_recurrence
         FROM problems WHERE status IN ('solved','mastered')`
    );
    const reviewRows = await all(
      `SELECT p.tags, r.result
         FROM reviews r
         JOIN problems p ON p.id = r.problem_id
        WHERE r.reviewed_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`
    );

    const solvedThisMonth = Number(month.solved) || 0;
    const selfSolved = Number(month.self_solved) || 0;

    return res.render('home', {
      title: '今天',
      dueCount: Number(due.c) || 0,
      draftCount: Number(draftTotal.c) || 0,
      recent,
      drafts,
      selfRate: solvedThisMonth ? Math.round((selfSolved / solvedThisMonth) * 100) : null,
      solvedThisMonth,
      avgRecurrence: avg.avg_recurrence === null ? 0 : Number(avg.avg_recurrence),
      weakTags: weakTags(reviewRows),
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
