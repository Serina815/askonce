'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');

const { all, get, run, asyncHandler } = require('../db');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { saveShot } = require('../services/shot');
const { normalizeError } = require('../services/text');
const { generateDraft } = require('../services/ai');
const { nextReviewDate } = require('../services/review');
const { findDuplicates } = require('../services/duplicate');

const router = express.Router();

const SOURCES = ['self', 'ai', 'doc', 'mixed'];
const ATTEMPT_SOURCES = ['ai', 'doc', 'self', 'other'];
const RESULTS = ['effective', 'partial', 'failed', 'unknown'];

const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'AI 调用太频繁了，一小时后再试。',
});

function toInt(value, fallback = 0, max = 1000000) {
  const n = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(max, n));
}

function str(value, max = 20000) {
  return String(value == null ? '' : value).trim().slice(0, max);
}

function parseTags(value) {
  return String(value || '')
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 10)
    .join(',');
}

function mergeTags(existing, extra) {
  const set = new Set(
    [...String(existing || '').split(','), ...extra].map((t) => t.trim()).filter(Boolean)
  );
  return [...set].slice(0, 10).join(',');
}

function readProblemForm(body = {}) {
  return {
    title: str(body.title, 200),
    errorText: str(body.error_text, 20000),
    context: str(body.context, 500),
    tags: parseTags(body.tags),
    qWhat: str(body.q_what, 4000),
    qHow: str(body.q_how, 8000),
    qWhy: str(body.q_why, 8000),
    qPlain: str(body.q_plain, 2000),
    finalSolution: str(body.final_solution, 20000),
    source: SOURCES.includes(body.source) ? body.source : null,
  };
}

async function loadProblem(id) {
  return get('SELECT * FROM problems WHERE id = ?', [id]);
}

router.get(
  '/p/:id',
  requireAuth,
  asyncHandler(async (req, res, next) => {
    const id = toInt(req.params.id);
    const problem = await loadProblem(id);
    if (!problem) return next();

    const [attempts, artifacts, recurrences, reviews] = await Promise.all([
      all('SELECT * FROM attempts WHERE problem_id = ? ORDER BY created_at ASC', [id]),
      all("SELECT * FROM artifacts WHERE problem_id = ? ORDER BY kind = 'image' DESC, created_at ASC", [id]),
      all('SELECT * FROM recurrences WHERE problem_id = ? ORDER BY occurred_at DESC LIMIT 20', [id]),
      all('SELECT * FROM reviews WHERE problem_id = ? ORDER BY reviewed_at DESC LIMIT 20', [id]),
    ]);

    // "你以前记过"的候选只在创建后的那一屏出现一次，之后不再打扰
    const hint = req.session.dupHint;
    const duplicates = hint && hint.problemId === id ? hint.items : [];
    delete req.session.dupHint;

    return res.render('problem', {
      title: problem.title,
      problem,
      attempts,
      artifacts,
      recurrences,
      reviews,
      duplicates,
      sources: ATTEMPT_SOURCES,
      results: RESULTS,
    });
  })
);

router.get('/new', requireAuth, (req, res) => {
  res.render('new', { title: '记一个问题' });
});

router.post(
  '/problems',
  requireAuth,
  upload.single('shot'),
  asyncHandler(async (req, res) => {
    const form = readProblemForm(req.body);
    if (!form.title) {
      req.session.flash = { type: 'warn', text: '至少写一句话说清是什么问题' };
      return res.redirect('/new');
    }

    const result = await run(
      `INSERT INTO problems (user_id, title, error_text, norm_error, context, tags, status)
       VALUES (?,?,?,?,?,?, 'draft')`,
      [req.session.userId, form.title, form.errorText, normalizeError(form.errorText), form.context, form.tags]
    );

    const id = result.insertId;

    if (req.file) {
      const shot = await saveShot(req.file.buffer, id);
      await run(
        `INSERT INTO artifacts (problem_id, kind, path, note) VALUES (?, 'image', ?, ?)`,
        [id, shot.path, '首次记录']
      );
    }

    // 这个坑以前踩过吗？命中就把候选带到详情页，由人决定合并还是忽略
    const candidates = await all(
      `SELECT id, title, error_text, norm_error, created_at
         FROM problems
        WHERE id <> ?
        ORDER BY id DESC
        LIMIT 300`,
      [id]
    );
    const duplicates = findDuplicates(candidates, {
      title: form.title,
      errorText: form.errorText,
    });
    if (duplicates.length) {
      req.session.dupHint = { problemId: id, items: duplicates };
    }

    req.session.flash = { type: 'ok', text: '已记下。解决之后回来补三问。' };
    return res.redirect(`/p/${id}`);
  })
);

router.get(
  '/p/:id/edit',
  requireAuth,
  asyncHandler(async (req, res, next) => {
    const problem = await loadProblem(toInt(req.params.id));
    if (!problem) return next();
    return res.render('edit', { title: `编辑：${problem.title}`, problem });
  })
);

router.post(
  '/p/:id',
  requireAuth,
  upload.single('shot'),
  asyncHandler(async (req, res, next) => {
    const id = toInt(req.params.id);
    const problem = await loadProblem(id);
    if (!problem) return next();

    const form = readProblemForm(req.body);
    if (!form.title) {
      req.session.flash = { type: 'warn', text: '标题不能为空' };
      return res.redirect(`/p/${id}/edit`);
    }

    await run(
      `UPDATE problems
          SET title = ?, error_text = ?, norm_error = ?, context = ?, tags = ?,
              q_what = ?, q_how = ?, q_why = ?, q_plain = ?,
              final_solution = ?, source = ?
        WHERE id = ?`,
      [
        form.title,
        form.errorText,
        normalizeError(form.errorText),
        form.context,
        form.tags,
        form.qWhat,
        form.qHow,
        form.qWhy,
        form.qPlain,
        form.finalSolution,
        form.source,
        id,
      ]
    );

    if (req.file) {
      const shot = await saveShot(req.file.buffer, id);
      await run(
        `INSERT INTO artifacts (problem_id, kind, path, note) VALUES (?, 'image', ?, ?)`,
        [id, shot.path, '补充截图']
      );
    }

    req.session.flash = { type: 'ok', text: '已保存' };
    return res.redirect(`/p/${id}`);
  })
);

router.post(
  '/p/:id/delete',
  requireAuth,
  asyncHandler(async (req, res, next) => {
    const id = toInt(req.params.id);
    const problem = await loadProblem(id);
    if (!problem) return next();

    // 显式清理：即使数据库是老版本、没有加外键，也不会留孤儿记录
    await run('DELETE FROM attempts WHERE problem_id = ?', [id]);
    await run('DELETE FROM artifacts WHERE problem_id = ?', [id]);
    await run('DELETE FROM reviews WHERE problem_id = ?', [id]);
    await run('DELETE FROM recurrences WHERE problem_id = ?', [id]);
    await run('DELETE FROM problems WHERE id = ?', [id]);

    req.session.flash = { type: 'ok', text: '这张卡已删除' };
    return res.redirect('/');
  })
);

router.post(
  '/p/:id/solve',
  requireAuth,
  asyncHandler(async (req, res, next) => {
    const id = toInt(req.params.id);
    const problem = await loadProblem(id);
    if (!problem) return next();

    if (!String(problem.final_solution || problem.q_how || '').trim()) {
      req.session.flash = { type: 'warn', text: '先写下最终方案（或"怎么解"），再标记解决' };
      return res.redirect(`/p/${id}/edit`);
    }

    await run(
      `UPDATE problems
          SET status = IF(mastery >= 3, 'mastered', 'solved'),
              mastery = GREATEST(mastery, 1),
              next_review_on = DATE_ADD(CURDATE(), INTERVAL 1 DAY)
        WHERE id = ?`,
      [id]
    );

    req.session.flash = { type: 'ok', text: '已进入复盘队列，明天第一次复盘。' };
    return res.redirect(`/p/${id}`);
  })
);

router.post(
  '/p/:id/recur',
  requireAuth,
  asyncHandler(async (req, res, next) => {
    const id = toInt(req.params.id);
    const problem = await loadProblem(id);
    if (!problem) return next();

    await run(
      `UPDATE problems
          SET recurrence_count = recurrence_count + 1,
              mastery = IF(mastery > 0, mastery - 1, 0),
              status = IF(status = 'mastered', 'solved', status),
              next_review_on = CURDATE(),
              last_seen_at = NOW()
        WHERE id = ?`,
      [id]
    );
    await run('INSERT INTO recurrences (problem_id, note) VALUES (?, ?)', [
      id,
      str(req.body.note, 500),
    ]);

    req.session.flash = { type: 'warn', text: '记一次复发：掌握度 -1，下次复盘提到了今天。' };
    return res.redirect(`/p/${id}`);
  })
);

router.post(
  '/p/:id/attempts',
  requireAuth,
  asyncHandler(async (req, res, next) => {
    const id = toInt(req.params.id);
    const problem = await loadProblem(id);
    if (!problem) return next();

    const solution = str(req.body.solution, 20000);
    if (!solution) {
      req.session.flash = { type: 'warn', text: '方案内容不能为空' };
      return res.redirect(`/p/${id}`);
    }

    const source = ATTEMPT_SOURCES.includes(req.body.source) ? req.body.source : 'ai';
    const result = RESULTS.includes(req.body.result) ? req.body.result : 'unknown';

    await run(
      `INSERT INTO attempts (problem_id, source, tool, solution, result) VALUES (?,?,?,?,?)`,
      [id, source, str(req.body.tool, 64), solution, result]
    );

    // 第一次拿到"有效"方案时，顺手写成最终方案（之后可在编辑页改）
    if (result === 'effective' && !String(problem.final_solution || '').trim()) {
      await run('UPDATE problems SET final_solution = ? WHERE id = ?', [solution, id]);
    }

    req.session.flash = { type: 'ok', text: '尝试已记录' };
    return res.redirect(`/p/${id}#attempts`);
  })
);

router.post(
  '/attempts/:id/delete',
  requireAuth,
  asyncHandler(async (req, res, next) => {
    const id = toInt(req.params.id);
    const attempt = await get('SELECT * FROM attempts WHERE id = ?', [id]);
    if (!attempt) return next();
    await run('DELETE FROM attempts WHERE id = ?', [id]);
    return res.redirect(`/p/${attempt.problem_id}#attempts`);
  })
);

router.post(
  '/p/:id/artifacts',
  requireAuth,
  asyncHandler(async (req, res, next) => {
    const id = toInt(req.params.id);
    const problem = await loadProblem(id);
    if (!problem) return next();

    const url = str(req.body.url, 1000);
    if (!/^https?:\/\//i.test(url)) {
      req.session.flash = { type: 'warn', text: '链接需要以 http(s):// 开头' };
      return res.redirect(`/p/${id}`);
    }

    await run(`INSERT INTO artifacts (problem_id, kind, url, note) VALUES (?, 'link', ?, ?)`, [
      id,
      url,
      str(req.body.note, 255),
    ]);

    req.session.flash = { type: 'ok', text: '链接已添加' };
    return res.redirect(`/p/${id}`);
  })
);

router.post(
  '/p/:id/ai',
  requireAuth,
  aiLimiter,
  asyncHandler(async (req, res, next) => {
    const id = toInt(req.params.id);
    const problem = await loadProblem(id);
    if (!problem) return next();

    const filled = [];
    const result = await generateDraft({
      title: problem.title,
      errorText: problem.error_text,
      context: problem.context,
    });

    if (!result.ok) {
      req.session.flash = { type: 'warn', text: `AI 没生成成功：${result.error}` };
      return res.redirect(`/p/${id}`);
    }

    const sets = [];
    const params = [];
    const map = [
      ['q_what', problem.q_what, result.draft.what],
      ['q_how', problem.q_how, result.draft.how],
      ['q_why', problem.q_why, result.draft.why],
      ['q_plain', problem.q_plain, result.draft.plain],
    ];
    for (const [column, current, draft] of map) {
      if (!String(current || '').trim() && draft) {
        sets.push(`${column} = ?`);
        params.push(draft);
        filled.push(column);
      }
    }

    if (result.draft.tags.length) {
      const merged = mergeTags(problem.tags, result.draft.tags);
      if (merged !== problem.tags) {
        sets.push('tags = ?');
        params.push(merged);
        filled.push('tags');
      }
    }

    if (!sets.length) {
      req.session.flash = { type: 'ok', text: '三问已经写过了，AI 没有覆盖你的内容。' };
      return res.redirect(`/p/${id}`);
    }

    await run(`UPDATE problems SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);

    req.session.flash = {
      type: 'ok',
      text: `AI 补了 ${filled.length} 个空字段。记得用你自己的话改一遍——看懂 ≠ 会讲。`,
    };
    return res.redirect(`/p/${id}`);
  })
);

/**
 * 合并：确认"新卡其实就是旧卡那个坑"。
 * 把新卡的截图搬到旧卡、旧卡记一次复发（掌握度 -1、复盘提前到今天），再删掉重复的新卡。
 */
router.post(
  '/p/:id/merge/:oldId',
  requireAuth,
  asyncHandler(async (req, res, next) => {
    const id = toInt(req.params.id);
    const oldId = toInt(req.params.oldId);
    if (!id || !oldId || id === oldId) return next();

    const [fresh, older] = await Promise.all([loadProblem(id), loadProblem(oldId)]);
    if (!fresh || !older) return next();

    // 截图先搬过去，再删卡片（表上有级联删除，顺序反了图就没了）
    await run('UPDATE artifacts SET problem_id = ? WHERE problem_id = ?', [oldId, id]);

    await run('INSERT INTO recurrences (problem_id, note) VALUES (?, ?)', [
      oldId,
      str(`再次遇到：${fresh.title}`, 480),
    ]);
    await run(
      `UPDATE problems
          SET recurrence_count = recurrence_count + 1,
              mastery = IF(mastery > 0, mastery - 1, 0),
              status = IF(status = 'mastered', 'solved', status),
              next_review_on = CURDATE(),
              last_seen_at = NOW()
        WHERE id = ?`,
      [oldId]
    );

    await run('DELETE FROM attempts WHERE problem_id = ?', [id]);
    await run('DELETE FROM reviews WHERE problem_id = ?', [id]);
    await run('DELETE FROM recurrences WHERE problem_id = ?', [id]);
    await run('DELETE FROM problems WHERE id = ?', [id]);

    req.session.flash = {
      type: 'ok',
      text: '已合并：复发 +1，这次的截图和记录都并到了那张卡。',
    };
    return res.redirect(`/p/${oldId}`);
  })
);

module.exports = router;
