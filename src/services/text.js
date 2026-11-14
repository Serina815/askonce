'use strict';

/**
 * 报错文本的归一化与相似度。
 * 目标：同一个报错，即使时间戳、路径、内存地址变了，也能被认出来。
 * 刻意不上向量检索——几十到几百张卡片，子串 + 关键词足够，且可解释。
 */

function normalizeError(input) {
  return String(input || '')
    .replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, '<time>')
    .replace(/\b0x[0-9a-f]{4,}\b/gi, '<hex>')
    .replace(/[A-Za-z]:\\[^\s:]+/g, '<path>') // Windows 路径
    .replace(/\/(?:[\w.@+-]+\/)+[\w.@+-]+\.[A-Za-z0-9]+/g, '<path>') // Unix 文件路径
    .replace(/:\d+:\d+/g, ':<line>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 500);
}

function tokens(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9\u4e00-\u9fa5]+/)
    .filter((t) => t.length > 1);
}

function jaccard(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / Math.max(A.size, B.size);
}

/** 0-1 的相似度：包含关系最强，其次是词集合重合 */
function score(a, b) {
  const x = String(a || '');
  const y = String(b || '');
  if (!x || !y) return 0;
  if (x === y) return 1;
  if (x.length >= 8 && y.includes(x)) return 0.95;
  if (y.length >= 8 && x.includes(y)) return 0.95;
  return jaccard(x, y);
}

/**
 * @param {Array<{id:number,title:string,norm_error:string,error_text:string}>} candidates
 * @param {{norm:string, raw:string}} target
 */
function topMatches(candidates, target, { limit = 3, threshold = 0.5 } = {}) {
  const scored = candidates
    .map((item) => ({
      ...item,
      score: Math.max(
        score(item.norm_error, target.norm),
        score(item.norm_error, normalizeError(item.error_text)),
        score(item.title, target.raw) * 0.6
      ),
    }))
    .filter((item) => item.score >= threshold)
    .sort((a, b) => b.score - a.score);

  // 去重：同一张卡只留最高分
  const seen = new Set();
  return scored
    .filter((item) => (seen.has(item.id) ? false : seen.add(item.id)))
    .slice(0, limit);
}

module.exports = { normalizeError, tokens, jaccard, score, topMatches };
