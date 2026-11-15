'use strict';

const express = require('express');
const { all, get, asyncHandler } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function ymd(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

router.get(
  '/stats',
  requireAuth,
  asyncHandler(async (req, res) => {
    const statusRows = await all('SELECT status, COUNT(*) AS c FROM problems GROUP BY status');
    const counts = { draft: 0, solved: 0, mastered: 0, archived: 0 };
    for (const row of statusRows) counts[row.status] = Number(row.c);

    const solved = await get(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(source = 'self'), 0) AS self_solved,
              ROUND(AVG(recurrence_count), 1) AS avg_recurrence,
              COALESCE(SUM(recurrence_count), 0) AS total_recurrence
         FROM problems WHERE status IN ('solved','mastered')`
    );

    const total = Number(solved.total) || 0;
    const selfSolved = Number(solved.self_solved) || 0;

    // 最近 8 周的复发次数
    const rows = await all(
      `SELECT DATE(occurred_at) AS d, COUNT(*) AS c
         FROM recurrences
        WHERE occurred_at >= DATE_SUB(CURDATE(), INTERVAL 56 DAY)
        GROUP BY d`
    );
    const dayMap = new Map(rows.map((r) => [String(r.d), Number(r.c)]));

    const weeks = [];
    for (let w = 7; w >= 0; w -= 1) {
      const end = new Date();
      end.setHours(0, 0, 0, 0);
      end.setDate(end.getDate() - w * 7);
      const start = new Date(end);
      start.setDate(start.getDate() - 6);

      let count = 0;
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        count += dayMap.get(ymd(d)) || 0;
      }
      weeks.push({ label: `${start.getMonth() + 1}/${start.getDate()}`, count });
    }

    // 薄弱标签（近 90 天复盘失败率）
    const reviewRows = await all(
      `SELECT p.tags, r.result
         FROM reviews r
         JOIN problems p ON p.id = r.problem_id
        WHERE r.reviewed_at >= DATE_SUB(CURDATE(), INTERVAL 90 DAY)`
    );
    const tagMap = new Map();
    for (const row of reviewRows) {
      for (const tag of String(row.tags || '').split(',').map((t) => t.trim()).filter(Boolean)) {
        const item = tagMap.get(tag) || { tag, total: 0, bad: 0 };
        item.total += 1;
        if (row.result === 'bad') item.bad += 1;
        tagMap.set(tag, item);
      }
    }
    const weakTags = [...tagMap.values()]
      .filter((x) => x.total >= 2)
      .map((x) => ({ ...x, rate: Math.round((x.bad / x.total) * 100) }))
      .sort((a, b) => b.rate - a.rate || b.total - a.total)
      .slice(0, 6);

    const topRecurring = await all(
      `SELECT id, title, status, recurrence_count, mastery
         FROM problems
        WHERE recurrence_count > 0
        ORDER BY recurrence_count DESC, mastery ASC
        LIMIT 5`
    );

    const recentReviews = await all(
      `SELECT r.result, r.reviewed_at, p.id, p.title
         FROM reviews r
         JOIN problems p ON p.id = r.problem_id
        ORDER BY r.reviewed_at DESC
        LIMIT 8`
    );

    return res.render('stats', {
      title: '统计',
      counts,
      selfRate: total ? Math.round((selfSolved / total) * 100) : null,
      total,
      selfSolved,
      avgRecurrence: solved.avg_recurrence === null ? 0 : Number(solved.avg_recurrence),
      totalRecurrence: Number(solved.total_recurrence) || 0,
      weeks,
      weakTags,
      topRecurring,
      recentReviews,
    });
  })
);

module.exports = router;
