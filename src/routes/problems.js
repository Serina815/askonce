'use strict';

const path = require('path');
const fs = require('fs/promises');
const express = require('express');
const rateLimit = require('express-rate-limit');

const { all, get, run, asyncHandler } = require('../db');
const { requireAuth } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { saveShot } = require('../services/shot');
const { normalizeError } = require('../services/text');
const config = require('../config');
const { generateReference } = require('../services/ai');
const { nextReviewDate } = require('../services/review');
const { findDuplicates } = require('../services/duplicate');

const router = express.Router();

const SOURCES = ['self', 'ai', 'doc', 'mixed'];
const ATTEMPT_SOURCES = ['ai', 'doc', 'self', 'other'];
const RESULTS = ['effective', 'partial', 'failed', 'unknown'];

// 截图允许挂在这些输入框下；其余一律当"卡片级"附件
const ARTIFACT_FIELDS = new Set([
  'title',
  'error_text',
  'context',
  'q_what',
  'q_why',
  'q_how',
  'q_plain',
  'final_solution',
  'attempt',
]);

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

/**
 * 生成一份 AI 参考答案，只写 ai_* 字段。
 * 用户自己的 q_* 永远不动——这是"对照"，不是"代写"。
 */
async function saveAiReference(problem) {
  const result = await generateReference({
    title: problem.title,
    errorText: problem.error_text,
    context: problem.context,
    myWhat: problem.q_what,
    myWhy: problem.q_why,
    myHow: problem.q_how,
  });
  if (!result.ok) return result;

  await run(
    `UPDATE problems
        SET ai_what = ?, ai_why = ?, ai_how = ?, ai_model = ?, ai_generated_at = NOW()
      WHERE id = ?`,
    [result.ref.what, result.ref.why, result.ref.how, result.model, problem.id]
  );
  return { ok: true };
}

/** 把参考答案填进还空着的 q_*（已写的不覆盖），返回填了几个 */
async function applyAiReference(problem) {
  const map = [
    ['q_what', problem.q_what, problem.ai_what],
    ['q_why', problem.q_why, problem.ai_why],
    ['q_how', problem.q_how, problem.ai_how],
  ];

  const sets = [];
  const params = [];
  for (const [column, current, ref] of map) {
    if (!String(current || '').trim() && String(ref || '').trim()) {
      sets.push(`${column} = ?`);
      params.push(ref);
    }
  }
  if (!sets.length) return 0;

  await run(`UPDATE problems SET ${sets.join(', ')} WHERE id = ?`, [...params, problem.id]);
  return sets.length;
}

router.get(
  '/p/:id',
  requireAuth,
  asyncHandler(async (req, res, next) => {
    const id = toInt(req.params.id);
    const problem = await loadProblem(id);
    if (!problem) return next();

    const [attempts, artifacts, recurrences, reviews, clock] = await Promise.all([
      all('SELECT * FROM attempts WHERE problem_id = ? ORDER BY created_at ASC', [id]),
      all("SELECT * FROM artifacts WHERE problem_id = ? ORDER BY kind = 'image' DESC, created_at ASC", [id]),
      all('SELECT * FROM recurrences WHERE problem_id = ? ORDER BY occurred_at DESC LIMIT 20', [id]),
      all('SELECT * FROM reviews WHERE problem_id = ? ORDER BY reviewed_at DESC LIMIT 20', [id]),
      get('SELECT CURDATE() AS today'),
    ]);

    // 跟着某条尝试一起贴的图，渲染在那条尝试下面；带字段名的渲染在对应区块；其余归卡片
    const attemptShots = {};
    const fieldShots = {};
    const cardArtifacts = [];
    for (const art of artifacts) {
      if (art.attempt_id) {
        (attemptShots[art.attempt_id] = attemptShots[art.attempt_id] || []).push(art);
      } else if (art.field) {
        (fieldShots[art.field] = fieldShots[art.field] || []).push(art);
      } else {
        cardArtifacts.push(art);
      }
    }

    // "你以前记过"的候选只在创建后的那一屏出现一次，之后不再打扰
    const hint = req.session.dupHint;
    const duplicates = hint && hint.problemId === id ? hint.items : [];
    delete req.session.dupHint;

    return res.render('problem', {
      title: problem.title,
      problem,
      attempts,
      artifacts: cardArtifacts,
      attemptShots,
      fieldShots,
      today: clock ? clock.today : '',
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

    // 已经贴在这张卡上的图，按字段分组，回到编辑页还能看到、还能删
    const artifacts = await all(
      `SELECT * FROM artifacts
        WHERE problem_id = ? AND attempt_id IS NULL AND kind = 'image'
        ORDER BY id ASC`,
      [problem.id]
    );
    const fieldShots = {};
    const looseShots = [];
    for (const art of artifacts) {
      if (!art.field) {
        looseShots.push(art);
        continue;
      }
      (fieldShots[art.field] = fieldShots[art.field] || []).push(art);
    }

    return res.render('edit', { title: `编辑：${problem.title}`, problem, fieldShots, looseShots });
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

    // 「保存并返回预览」：编辑页顶部返回时如果选了保存
    if (req.body.action_back === '1') {
      req.session.flash = { type: 'ok', text: '已保存' };
      return res.redirect(`/p/${id}`);
    }

    // 编辑页的「AI 参考」：先保存当前内容，再生成一份独立参考，不碰你写的三问
    if (req.body.action_ai === '1') {
      const fresh = await loadProblem(id);
      const result = await saveAiReference(fresh);
      if (!result.ok) {
        req.session.flash = { type: 'warn', text: `已保存，但 AI 参考没生成成功：${result.error}` };
      } else {
        req.session.flash = { type: 'ok', text: '已保存，AI 参考已生成（灰框），可以对照你自己的答案。' };
      }
      return res.redirect(`/p/${id}/edit#ai-ref`);
    }

    // 用参考填空白：同样先保存，避免丢掉刚写的内容
    if (req.body.action_apply === '1') {
      const fresh = await loadProblem(id);
      const filled = await applyAiReference(fresh);
      req.session.flash = filled
        ? { type: 'ok', text: `已保存，并用参考填了 ${filled} 个空字段。记得改成自己的话。` }
        : { type: 'warn', text: '已保存。三问都写过，没有被覆盖。' };
      return res.redirect(`/p/${id}/edit#ai-ref`);
    }

    if (req.body.action_clear === '1') {
      await run(
        `UPDATE problems
            SET ai_what = NULL, ai_why = NULL, ai_how = NULL, ai_model = NULL, ai_generated_at = NULL
          WHERE id = ?`,
        [id]
      );
      req.session.flash = { type: 'ok', text: '已保存并清空 AI 参考，你自己的三问没动。' };
      return res.redirect(`/p/${id}/edit`);
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

    const inserted = await run(
      `INSERT INTO attempts (problem_id, source, tool, solution, result) VALUES (?,?,?,?,?)`,
      [id, source, str(req.body.tool, 64), solution, result]
    );

    // 粘贴时已经入库的截图，在这里挂到这条尝试上
    const ids = String(req.body.artifact_ids || '')
      .split(',')
      .map((x) => Number.parseInt(x, 10))
      .filter((n) => Number.isInteger(n) && n > 0)
      .slice(0, 20);
    if (ids.length) {
      await run(
        `UPDATE artifacts SET attempt_id = ? WHERE problem_id = ? AND id IN (${ids.map(() => '?').join(',')})`,
        [inserted.insertId, id, ...ids]
      );
    }

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

const singleShot = upload.single('shot');

/**
 * 粘贴即上传：前端拿到 path 先显示缩略图，保存表单时再把 id 挂到那条尝试上。
 * 单独上传的好处是任何一个输入框都能贴，不必给每个表单都加 multipart。
 */
router.post(
  '/p/:id/artifacts/upload',
  requireAuth,
  (req, res, next) => {
    singleShot(req, res, (err) => {
      if (!err) return next();
      const message = err.code === 'LIMIT_FILE_SIZE' ? '截图太大了（上限 8MB）' : err.message || '上传失败';
      return res.status(400).json({ ok: false, error: message });
    });
  },
  asyncHandler(async (req, res, next) => {
    const id = toInt(req.params.id);
    const problem = await loadProblem(id);
    if (!problem) return res.status(404).json({ ok: false, error: '卡片不存在' });
    if (!req.file) return res.status(400).json({ ok: false, error: '没有收到图片' });

    const shot = await saveShot(req.file.buffer, id);
    const field = ARTIFACT_FIELDS.has(String(req.body.field || '')) ? String(req.body.field) : null;
    const inserted = await run(
      `INSERT INTO artifacts (problem_id, field, kind, path, note) VALUES (?, ?, 'image', ?, ?)`,
      [id, field, shot.path, str(req.body.note, 60) || '粘贴']
    );

    return res.json({ ok: true, id: inserted.insertId, path: shot.path, field });
  })
);

/** 缩略图上的 × ：删记录 + 删文件 */
router.delete(
  '/p/:id/artifacts/:aid',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = toInt(req.params.id);
    const aid = toInt(req.params.aid);
    const artifact = await get('SELECT * FROM artifacts WHERE id = ? AND problem_id = ?', [aid, id]);
    if (!artifact) return res.status(404).json({ ok: false, error: '附件不存在' });

    await run('DELETE FROM artifacts WHERE id = ?', [aid]);

    if (artifact.path && artifact.path.startsWith('/uploads/shots/')) {
      const file = path.join(config.uploadDir, path.basename(artifact.path));
      await fs.unlink(file).catch(() => {});
    }

    return res.json({ ok: true });
  })
);

router.post(
  '/p/:id/ai-reference',
  requireAuth,
  aiLimiter,
  asyncHandler(async (req, res, next) => {
    const id = toInt(req.params.id);
    const problem = await loadProblem(id);
    if (!problem) return next();

    const result = await saveAiReference(problem);
    const back = req.body.next === 'edit' ? `/p/${id}/edit` : `/p/${id}`;

    if (!result.ok) {
      req.session.flash = { type: 'warn', text: `AI 参考没生成成功：${result.error}` };
      return res.redirect(back);
    }

    req.session.flash = { type: 'ok', text: 'AI 参考已生成。先写你自己的，再往下对照。' };
    return res.redirect(back);
  })
);

router.post(
  '/p/:id/ai-apply',
  requireAuth,
  asyncHandler(async (req, res, next) => {
    const id = toInt(req.params.id);
    const problem = await loadProblem(id);
    if (!problem) return next();

    const filled = await applyAiReference(problem);
    req.session.flash = filled
      ? { type: 'ok', text: `已用参考填了 ${filled} 个空字段，记得改成自己的话。` }
      : { type: 'warn', text: '三问都已经有内容了，没有被覆盖。' };

    return res.redirect(req.body.next === 'edit' ? `/p/${id}/edit` : `/p/${id}`);
  })
);

router.post(
  '/p/:id/ai-clear',
  requireAuth,
  asyncHandler(async (req, res, next) => {
    const id = toInt(req.params.id);
    const problem = await loadProblem(id);
    if (!problem) return next();

    await run(
      `UPDATE problems
          SET ai_what = NULL, ai_why = NULL, ai_how = NULL, ai_model = NULL, ai_generated_at = NULL
        WHERE id = ?`,
      [id]
    );

    req.session.flash = { type: 'ok', text: 'AI 参考已清空，你自己的三问没动。' };
    return res.redirect(req.body.next === 'edit' ? `/p/${id}/edit` : `/p/${id}`);
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
