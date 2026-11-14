#!/usr/bin/env node
'use strict';

/**
 * 初始化 / 重置唯一的站主账号
 *   node bin/create-admin.js --user admin --pass "至少8位的密码"
 */

const bcrypt = require('bcryptjs');
const { get, run, pool } = require('../src/db');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

(async () => {
  const username = String(arg('user', 'admin')).trim();
  const password = String(arg('pass', ''));

  if (!password || password.length < 8) {
    console.error('用法：node bin/create-admin.js --user admin --pass "至少8位的密码"');
    process.exitCode = 1;
    return;
  }

  const hash = await bcrypt.hash(password, 12);
  const existing = await get('SELECT id FROM users WHERE username = ?', [username]);

  if (existing) {
    await run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, existing.id]);
    console.log(`已重置「${username}」的密码`);
  } else {
    await run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, hash]);
    console.log(`已创建账号「${username}」`);
  }

  await pool.end();
})().catch(async (err) => {
  console.error('[create-admin] 失败：', err.message);
  process.exitCode = 1;
  try {
    await pool.end();
  } catch (_) {
    /* ignore */
  }
});
