'use strict';

/**
 * 复盘排期：1 → 3 → 7 → 21 → 45 天。
 * 上限 45 天是刻意的：这个产品的用户需要高频轻量，不是半年一次的仪式。
 */

const STAGES = [1, 3, 7, 21, 45];

function clampStage(stage) {
  const n = Number.parseInt(stage, 10);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, STAGES.length - 1);
}

/** 根据自评结果决定下一档 */
function nextStage(stage, result) {
  const current = clampStage(stage);
  if (result === 'good') return Math.min(current + 1, STAGES.length - 1);
  if (result === 'fuzzy') return current;
  return 0; // bad / 未知：回到起点
}

function masteryAfter(mastery, result) {
  const current = Math.max(0, Math.min(3, Number(mastery) || 0));
  if (result === 'good') return Math.min(3, current + 1);
  if (result === 'fuzzy') return current;
  return Math.max(0, current - 1);
}

function statusAfter(mastery, currentStatus) {
  if (currentStatus === 'archived') return 'archived';
  return mastery >= 3 ? 'mastered' : 'solved';
}

function ymd(date) {
  const d = new Date(date);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** 下一次复盘的日期（YYYY-MM-DD） */
function nextReviewDate(stage, from = new Date()) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + STAGES[clampStage(stage)]);
  return ymd(d);
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(`${String(dateStr).slice(0, 10)}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

module.exports = {
  STAGES,
  nextStage,
  masteryAfter,
  statusAfter,
  nextReviewDate,
  daysUntil,
  ymd,
};
