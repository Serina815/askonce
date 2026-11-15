'use strict';

const express = require('express');
const { all, get, run, asyncHandler } = require('../db');
const { requireAuth } = require('../middleware/auth');
const { nextStage, masteryAfter, statusAfter, nextReviewDate, daysUntil } = require('../services/review');

const router = express.Router();

const DUE_WHERE = `status IN ('solved','mastered')`;

router.get(
  '/review',
  requireAuth,
  asyncHandler(async (req, res) => {
    const [due, remaining, todayCount] = await Promise.all([
      all(
        `SELECT * FROM problems
          WHERE ${DUE_WHERE} AND next_review_on <= CURDATE()
          ORDER BY next_review_on ASC, recurrence_count DESC, mastery ASC
          LIMIT 1`
      ),
      get(`SELECT COUNT(*) AS c FROM problems WHERE ${DUE_WHERE} AND next_review_on <= CURDATE()`),
      get(`SELECT COUNT(*) AS c FROM reviews WHERE DATE(reviewed_at) = CURDATE()`),
    ]);

    const reviewedToday = Number(todayCount.c) || 0;
    const cap = 5;
    const pushed = req.query.more === '1';
    const capReached = !pushed && reviewedToday >= cap && due.length > 0;

    const problem = capReached ? null : due[0] || null;

    return res.render('review', {
      title: '复盘',
      bodyClass: 'focus',
      problem,
      remaining: Number(remaining.c) || 0,
      reviewedToday,
      cap,
      capReached,
      overdueDays: problem ? daysUntil(problem.next_review_on) : null,
    });
  })
);

router.post(
  '/p/:id/review',
  requireAuth,
  asyncHandler(async (req, res, next) => {
    const id = Number.parseInt(req.params.id, 10);
    const problem = await get('SELECT * FROM problems WHERE id = ?', [id]);
    if (!problem) return next();

    const result = ['good', 'fuzzy', 'bad'].includes(req.body.result) ? req.body.result : 'fuzzy';

    const stageBefore = Number(problem.review_stage) || 0;
    const stageAfter = nextStage(stageBefore, result);
    const mastery = masteryAfter(problem.mastery, result);
    const status = statusAfter(mastery, problem.status);
    const nextOn = nextReviewDate(stageAfter);

    await run(
      `UPDATE problems
          SET review_stage = ?, mastery = ?, status = ?, next_review_on = ?, last_reviewed_at = NOW()
        WHERE id = ?`,
      [stageAfter, mastery, status, nextOn, id]
    );
    await run(
      `INSERT INTO reviews (problem_id, result, stage_before, stage_after) VALUES (?,?,?,?)`,
      [id, result, stageBefore, stageAfter]
    );

    const tips = {
      good: '记住了，下次间隔拉长。',
      fuzzy: '有点模糊，原档位再来一次。',
      bad: '忘了就回到 1 天后——这是间隔重复的正常动作，不是失败。',
    };

    req.session.flash = { type: result === 'bad' ? 'warn' : 'ok', text: tips[result] };
    return res.redirect('/review');
  })
);

module.exports = router;
