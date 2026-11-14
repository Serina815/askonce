'use strict';

/** 导出：Markdown（给 Obsidian）、Anki CSV、JSON */

function ymd(value) {
  return value ? String(value).slice(0, 10) : '';
}

function renderProblemMd(problem, attempts = []) {
  const lines = [];
  lines.push(`# ${problem.title}`);
  lines.push('');
  lines.push(`- 状态：${problem.status}`);
  lines.push(`- 标签：${problem.tags || '—'}`);
  lines.push(`- 复发：${problem.recurrence_count} 次`);
  lines.push(`- 记录：${ymd(problem.created_at)}`);
  lines.push('');

  if (problem.error_text) {
    lines.push('## 报错原文');
    lines.push('```');
    lines.push(problem.error_text);
    lines.push('```');
    lines.push('');
  }

  if (problem.q_what) lines.push(`## 是什么\n\n${problem.q_what}\n`);
  if (problem.q_how) lines.push(`## 怎么解\n\n${problem.q_how}\n`);
  if (problem.q_why) lines.push(`## 为什么\n\n${problem.q_why}\n`);
  if (problem.q_plain) lines.push(`## 人话版\n\n${problem.q_plain}\n`);
  if (problem.final_solution) lines.push(`## 最终方案\n\n\`\`\`\n${problem.final_solution}\n\`\`\`\n`);

  if (attempts.length) {
    lines.push('## 尝试记录');
    for (const a of attempts) {
      lines.push(`### ${a.source}${a.tool ? ` / ${a.tool}` : ''} — ${a.result}`);
      lines.push('');
      lines.push(a.solution);
      lines.push('');
    }
  }

  return lines.join('\n');
}

function toMarkdown(problems, attemptsByProblem = {}) {
  const head = `# 只问一次 · 问题卡导出\n\n导出时间：${new Date().toISOString().slice(0, 10)}\n\n---\n\n`;
  return head + problems.map((p) => renderProblemMd(p, attemptsByProblem[p.id] || [])).join('\n\n---\n\n');
}

function csvCell(value) {
  const text = String(value == null ? '' : value).replace(/\r?\n/g, '<br>');
  return `"${text.replace(/"/g, '""')}"`;
}

function toAnkiCsv(problems) {
  const rows = [['Front', 'Back', 'Tags'].join(',')];
  for (const p of problems) {
    const front = `${p.title}${p.error_text ? `\n\n${p.error_text}` : ''}`;
    const back = [
      p.q_what ? `是什么：${p.q_what}` : '',
      p.q_how ? `怎么解：${p.q_how}` : '',
      p.q_why ? `为什么：${p.q_why}` : '',
      p.final_solution ? `最终方案：${p.final_solution}` : '',
    ]
      .filter(Boolean)
      .join('\n\n');
    rows.push([csvCell(front), csvCell(back), csvCell(p.tags)].join(','));
  }
  return rows.join('\n');
}

module.exports = { toMarkdown, toAnkiCsv, renderProblemMd };
