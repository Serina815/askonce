#!/usr/bin/env node
'use strict';

/**
 * 灌入一组示例数据，方便第一次登录就能看到完整界面。
 *   node bin/seed.js --user admin
 *   node bin/seed.js --user admin --reset   # 先清空该用户的卡，再灌
 *
 * 生成的数据：
 *   1. Docker 构建 EACCES —— 待复盘，今天到期，带截图/链接/三问/3 条尝试
 *   2. Nginx 502      —— 已掌握，30 天后复盘，带复盘历史
 *   3. MariaDB 死锁    —— 待整理（只有报错，没有答案）
 *   4. git push 被拒   —— 待复盘，昨天已过期（用来演示"逾期"）
 */

const path = require('path');
const fs = require('fs/promises');
const sharp = require('sharp');

const { get, all, run, pool } = require('../src/db');
const config = require('../src/config');
const { normalizeError } = require('../src/services/text');

const DAY = 86400000;

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function ymd(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** n 天前的某个时刻，返回 MySQL DATETIME 字符串 */
function dt(daysAgo, hour = 10, minute = 20) {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(hour, minute, 0, 0);
  return `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
}

/** 今天 +n 天的 DATE 字符串 */
function inDays(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return ymd(d);
}

function escapeXml(text) {
  return String(text).replace(/[<>&'"]/g, (ch) => ({
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    "'": '&apos;',
    '"': '&quot;',
  }[ch]));
}

/** 画一张假的终端截图，纯 ASCII，避免服务器缺中文字体 */
async function makeTerminalShot(text) {
  const lines = String(text).split('\n').slice(0, 12);
  const top = 84;
  const height = top + lines.length * 26 + 20;

  const body = lines
    .map(
      (line, i) =>
        `<text x="26" y="${top + i * 26}" font-family="monospace" font-size="18" fill="#dcdcdc">${escapeXml(line)}</text>`
    )
    .join('');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="${height}">
    <rect width="900" height="${height}" fill="#161616"/>
    <circle cx="26" cy="22" r="6" fill="#ff5f56"/>
    <circle cx="46" cy="22" r="6" fill="#ffbd2e"/>
    <circle cx="66" cy="22" r="6" fill="#27c93f"/>
    ${body}
  </svg>`;

  return sharp(Buffer.from(svg)).jpeg({ quality: 86 }).toBuffer();
}

const SAMPLE = [
  {
    title: 'Docker 构建时 npm ci 报 EACCES',
    error_text: [
      'npm ERR! code EACCES',
      'npm ERR! syscall mkdir',
      'npm ERR! path /root/.npm/_cacache/tmp',
      'npm ERR! errno -13',
      "npm ERR! Error: EACCES: permission denied, mkdir '/root/.npm/_cacache/tmp'",
    ].join('\n'),
    context: 'CentOS Stream 9 · Node 22 · docker build 里以 root 跑 npm ci',
    tags: 'docker,权限,npm',
    q_what: '构建阶段用 root 跑 npm，缓存目录属主是宿主机用户，容器里的 uid 对不上。',
    q_how: '1. COPY 时加 --chown=node:node\n2. 用 USER node 跑 npm ci\n3. 或把缓存指到 /tmp/.npm 再重跑 --no-cache',
    q_why: '镜像层保留了文件属主；挂载宿主机缓存时 uid 不一致，内核按 uid 判断写权限。',
    q_plain: '钥匙是甲的，锁是乙的，门当然开不了。',
    final_solution:
      'FROM node:22-slim\nWORKDIR /app\nCOPY --chown=node:node package*.json ./\nRUN npm ci --omit=dev\nUSER node\nCOPY --chown=node:node . .',
    source: 'mixed',
    status: 'solved',
    mastery: 2,
    review_stage: 2,
    next_review_on: inDays(0),
    last_reviewed_at: dt(2, 21, 0),
    recurrence_count: 2,
    last_seen_at: dt(5, 9, 40),
    created_at: dt(21, 14, 10),
    updated_at: dt(2, 21, 0),
    attempts: [
      { source: 'ai', tool: 'Claude', result: 'failed', solution: '在 Dockerfile 里加 RUN chown -R node:node /root/.npm 试试。', created_at: dt(21, 14, 25) },
      { source: 'doc', tool: '官方文档', result: 'partial', solution: 'npm ci --cache /tmp/.npm-cache：能跑，但每次构建都重新下载依赖。', created_at: dt(20, 10, 5) },
      { source: 'self', tool: '', result: 'effective', solution: '根本原因是 COPY 进来时属主是 root。改成 COPY --chown=node:node 并且 USER node 跑构建，缓存落到 /home/node/.npm，问题消失。', created_at: dt(19, 9, 30) },
    ],
    reviews: [
      { result: 'bad', stage_before: 1, stage_after: 0, reviewed_at: dt(7, 20, 10) },
      { result: 'good', stage_before: 0, stage_after: 1, reviewed_at: dt(2, 21, 0) },
    ],
    recurrences: [
      { note: '换了个项目又遇到，报错路径不同但错误码一样', occurred_at: dt(12, 15, 0) },
      { note: '同事的机器上同样现象', occurred_at: dt(5, 9, 40) },
    ],
    artifacts: [
      { kind: 'image', note: '报错截图' },
      { kind: 'link', url: 'https://docs.docker.com/build/building/best-practices/', note: 'Build best practices' },
    ],
  },
  {
    title: 'Nginx 反代本机 Node 返回 502',
    error_text:
      "connect() failed (111: Connection refused) while connecting to upstream, client: 10.0.0.7, server: _, request: \"GET / HTTP/1.1\", upstream: \"http://127.0.0.1:3000/\"",
    context: 'CentOS Stream 9 · Nginx 1.26 · Node 服务由 systemd 托管在 3000',
    tags: 'nginx,反向代理,selinux',
    q_what: 'SELinux 禁止 httpd_t 主动连本机端口，反代请求被拦；Node 其实活着。',
    q_how: '1. curl 127.0.0.1:3000 确认服务在\n2. setsebool -P httpd_can_network_connect 1\n3. systemctl restart nginx',
    q_why: 'SELinux 的域隔离默认只允许 httpd 监听端口，不允许主动外连；这个布尔值就是给反代开的门。',
    q_plain: '门卫放行"进来"，但没放行"出去问邻居"。',
    final_solution: 'setsebool -P httpd_can_network_connect 1\nsystemctl restart nginx\ncurl -I http://127.0.0.1/',
    source: 'self',
    status: 'mastered',
    mastery: 3,
    review_stage: 4,
    next_review_on: inDays(30),
    last_reviewed_at: dt(5, 20, 30),
    recurrence_count: 1,
    last_seen_at: dt(30, 11, 0),
    created_at: dt(63, 16, 40),
    updated_at: dt(5, 20, 30),
    attempts: [
      { source: 'ai', tool: 'ChatGPT', result: 'failed', solution: '检查 Node 是否启动、端口是否被占用、防火墙是否放行 3000。', created_at: dt(63, 16, 55) },
      { source: 'self', tool: '', result: 'effective', solution: 'ausearch -m avc -ts recent 看到 denied { name_connect }，是 SELinux 不是端口。setsebool 之后立刻通。', created_at: dt(62, 9, 10) },
    ],
    reviews: [
      { result: 'good', stage_before: 0, stage_after: 1, reviewed_at: dt(45, 20, 0) },
      { result: 'good', stage_before: 1, stage_after: 2, reviewed_at: dt(30, 20, 0) },
      { result: 'bad', stage_before: 2, stage_after: 0, reviewed_at: dt(15, 20, 0) },
      { result: 'good', stage_before: 0, stage_after: 1, reviewed_at: dt(5, 20, 30) },
    ],
    recurrences: [{ note: '重装系统后忘了 setsebool', occurred_at: dt(30, 11, 0) }],
    artifacts: [],
  },
  {
    title: 'MariaDB 两个事务互相等待，报 Deadlock found',
    error_text: 'ERROR 1213 (40001): Deadlock found when trying to get lock; try restarting transaction',
    context: 'MariaDB 10.11 · 订单表和库存表交叉更新',
    tags: 'mysql,死锁,事务',
    q_what: '',
    q_how: '',
    q_why: '',
    q_plain: '',
    final_solution: '',
    source: null,
    status: 'draft',
    mastery: 0,
    review_stage: 0,
    next_review_on: null,
    last_reviewed_at: null,
    recurrence_count: 0,
    last_seen_at: null,
    created_at: dt(3, 18, 5),
    updated_at: dt(3, 18, 5),
    attempts: [],
    reviews: [],
    recurrences: [],
    artifacts: [],
  },
  {
    title: 'git push 被拒：non-fast-forward',
    error_text: '! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs to \'git@example.com:me/repo.git\'',
    context: '本地 rebase 之后直接 push',
    tags: 'git',
    q_what: '本地已经 rebase，和远端历史分叉，push 默认不允许覆盖。',
    q_how: '1. git pull --rebase origin main\n2. 解决冲突\n3. git push',
    q_why: '非快进推送会让远端丢掉提交，Git 默认保守，除非显式 --force。',
    q_plain: '两个人同时改同一页，不能直接拿你的版本盖掉对方的。',
    final_solution: 'git pull --rebase origin main\ngit push',
    source: 'ai',
    status: 'solved',
    mastery: 1,
    review_stage: 0,
    next_review_on: inDays(-1),
    last_reviewed_at: null,
    recurrence_count: 0,
    last_seen_at: null,
    created_at: dt(5, 11, 15),
    updated_at: dt(5, 11, 30),
    attempts: [
      { source: 'ai', tool: 'Claude', result: 'effective', solution: '先 git pull --rebase origin main，冲突解决后再 push。', created_at: dt(5, 11, 20) },
    ],
    reviews: [],
    recurrences: [],
    artifacts: [],
  },
];

async function ensureShotDir() {
  await fs.mkdir(config.uploadDir, { recursive: true });
}

async function resetUser(userId) {
  const rows = await all('SELECT id FROM problems WHERE user_id = ?', [userId]);
  for (const row of rows) {
    await run('DELETE FROM reviews WHERE problem_id = ?', [row.id]);
    await run('DELETE FROM recurrences WHERE problem_id = ?', [row.id]);
    await run('DELETE FROM problems WHERE id = ?', [row.id]);
  }
  return rows.length;
}

async function main() {
  const username = arg('user', 'admin');
  const user = await get('SELECT id, username FROM users WHERE username = ?', [username]);
  if (!user) {
    console.error(`找不到用户「${username}」，先运行：node bin/create-admin.js --user ${username} --pass "至少8位"`);
    process.exitCode = 1;
    return;
  }

  const existing = await get('SELECT COUNT(*) AS c FROM problems WHERE user_id = ?', [user.id]);
  if (Number(existing.c) > 0) {
    if (!process.argv.includes('--reset')) {
      console.log(`「${user.username}」已经有 ${existing.c} 张卡了。要重来请加 --reset。`);
      await pool.end();
      return;
    }
    const removed = await resetUser(user.id);
    console.log(`已清空 ${removed} 张旧卡`);
  }

  await ensureShotDir();
  let inserted = 0;

  for (const item of SAMPLE) {
    const result = await run(
      `INSERT INTO problems
        (user_id, title, error_text, norm_error, context, tags,
         q_what, q_how, q_why, q_plain, final_solution, source, status,
         mastery, review_stage, next_review_on, last_reviewed_at,
         recurrence_count, last_seen_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        user.id,
        item.title,
        item.error_text,
        normalizeError(item.error_text),
        item.context,
        item.tags,
        item.q_what,
        item.q_how,
        item.q_why,
        item.q_plain,
        item.final_solution,
        item.source,
        item.status,
        item.mastery,
        item.review_stage,
        item.next_review_on,
        item.last_reviewed_at,
        item.recurrence_count,
        item.last_seen_at,
        item.created_at,
        item.updated_at,
      ]
    );

    const problemId = result.insertId;
    inserted += 1;

    for (const attempt of item.attempts) {
      await run(
        `INSERT INTO attempts (problem_id, source, tool, solution, result, created_at)
         VALUES (?,?,?,?,?,?)`,
        [problemId, attempt.source, attempt.tool, attempt.solution, attempt.result, attempt.created_at]
      );
    }

    for (const review of item.reviews) {
      await run(
        `INSERT INTO reviews (problem_id, result, stage_before, stage_after, reviewed_at)
         VALUES (?,?,?,?,?)`,
        [problemId, review.result, review.stage_before, review.stage_after, review.reviewed_at]
      );
    }

    for (const recurrence of item.recurrences) {
      await run(
        `INSERT INTO recurrences (problem_id, note, occurred_at) VALUES (?,?,?)`,
        [problemId, recurrence.note, recurrence.occurred_at]
      );
    }

    for (const artifact of item.artifacts) {
      if (artifact.kind === 'image') {
        const buffer = await makeTerminalShot(item.error_text);
        const name = `${problemId}-seed.jpg`;
        await sharp(buffer).jpeg({ quality: 86 }).toFile(path.join(config.uploadDir, name));
        await run(
          `INSERT INTO artifacts (problem_id, kind, path, note) VALUES (?, 'image', ?, ?)`,
          [problemId, `/uploads/shots/${name}`, artifact.note]
        );
      } else {
        await run(
          `INSERT INTO artifacts (problem_id, kind, url, note) VALUES (?, 'link', ?, ?)`,
          [problemId, artifact.url, artifact.note]
        );
      }
    }
  }

  console.log(`已为「${user.username}」写入 ${inserted} 张示例卡（含尝试、复盘、复发、截图）`);
  console.log('打开首页应该看到：2 张待复盘（1 张逾期）、1 张待整理、1 张已掌握。');
  await pool.end();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error('[seed] 失败：', err.message);
    process.exitCode = 1;
    try {
      await pool.end();
    } catch (_) {
      /* ignore */
    }
  });
}

module.exports = { SAMPLE, makeTerminalShot, main };
