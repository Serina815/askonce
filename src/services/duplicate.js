'use strict';

const { normalizeError, jaccard, score } = require('./text');

/**
 * 「这个坑我是不是踩过」——创建新卡时找历史候选。
 *
 * 只用两条能讲清楚的判据，不做自动判定：
 *   1) 报错原文归一化后的相似度（相同 / 互相包含 / 关键词重合）
 *   2) 标题关键词重合度 —— 给没贴报错的卡留一条路
 * 命中后交给人在页面上确认（合并 / 忽略），避免误伤。
 */
function findDuplicates(candidates, { title, errorText }, { limit = 3, threshold = 0.5 } = {}) {
  const norm = normalizeError(errorText);
  const currentTitle = String(title || '').trim();

  const scored = [];

  for (const item of candidates) {
    const itemNorm = item.norm_error || normalizeError(item.error_text);

    // 报错越像越可信；标题只作兜底，所以打个折扣，避免"报错"这种通用词误命中
    const byError = norm && itemNorm ? score(norm, itemNorm) : 0;
    const byTitle = currentTitle && item.title ? jaccard(currentTitle, item.title) * 0.85 : 0;
    const best = Math.max(byError, byTitle);

    if (best < threshold) continue;

    scored.push({
      id: item.id,
      title: item.title,
      created_at: item.created_at,
      score: Math.round(best * 100) / 100,
      reason: byError >= byTitle ? '报错相近' : '标题相近',
    });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}

module.exports = { findDuplicates };
