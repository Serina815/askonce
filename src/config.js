'use strict';

const path = require('path');
const fs = require('fs');

// 生产环境由 systemd 的 EnvironmentFile 注入；本地开发读项目根目录 .env
const envFile = process.env.ENV_FILE || path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  require('dotenv').config({ path: envFile });
}

function pick(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

const env = pick('NODE_ENV', 'development');

const config = {
  env,
  isProd: env === 'production',
  port: Number(pick('PORT', 3000)),
  host: pick('HOST', '127.0.0.1'),
  appUrl: pick('APP_URL', 'http://127.0.0.1:3000'),
  sessionSecret: pick('SESSION_SECRET', 'dev-only-secret-change-me'),
  uploadMaxBytes: Number(pick('UPLOAD_MAX_BYTES', 8 * 1024 * 1024)),
  db: {
    host: pick('DB_HOST', '127.0.0.1'),
    port: Number(pick('DB_PORT', 3306)),
    user: pick('DB_USER', 'askonce'),
    password: pick('DB_PASS', ''),
    database: pick('DB_NAME', 'askonce'),
  },
  ai: {
    baseUrl: pick('AI_BASE_URL', 'https://api.deepseek.com').replace(/\/+$/, ''),
    apiKey: pick('AI_API_KEY', ''),
    model: pick('AI_MODEL', 'deepseek-chat'),
    timeoutMs: Number(pick('AI_TIMEOUT_MS', 30000)),
  },
  publicDir: path.resolve(__dirname, '..', 'public'),
};

config.uploadDir = path.join(config.publicDir, 'uploads', 'shots');
config.ai.enabled = Boolean(config.ai.apiKey);

if (config.isProd && config.sessionSecret === 'dev-only-secret-change-me') {
  throw new Error('生产环境必须设置 SESSION_SECRET（openssl rand -hex 32）');
}

module.exports = config;
