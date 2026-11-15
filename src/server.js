'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config');
const { pool } = require('./db');
const csrf = require('./middleware/csrf');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('view cache', config.isProd);
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        // blob: 是本地预览用的（粘贴/选图后 URL.createObjectURL）
        imgSrc: ["'self'", 'data:', 'blob:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
        // 纯 HTTP 部署必须关掉：helmet 默认带 upgrade-insecure-requests，
        // 会让浏览器把 CSS/JS 等子资源升级成 https，而服务端只有 80 端口 → 超时
        upgradeInsecureRequests: null,
      },
    },
  })
);

if (!config.isProd) app.use(morgan('dev'));

// 静态资源带 mtime 版本号：改完 CSS/JS 换一个 URL，避免浏览器拿 7 天的旧缓存
const staticDir = path.join(__dirname, '..', 'public', 'static');
function mtimeOf(file) {
  try {
    return Math.round(fs.statSync(path.join(staticDir, file)).mtimeMs);
  } catch (err) {
    return 0;
  }
}
const assetVersion = () => `${mtimeOf('style.css')}-${mtimeOf('app.js')}`;

app.use((req, res, next) => {
  // 每次渲染现算（两次 stat，代价可忽略）：改完静态资源不必重启也能换 URL
  res.locals.assetV = assetVersion();
  next();
});

app.use('/static', express.static(staticDir, { maxAge: '7d' }));
app.use('/uploads', express.static(path.join(config.publicDir, 'uploads'), { maxAge: '1d' }));

app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));

const sessionStore = new MySQLStore(
  {
    createDatabaseTable: true,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: 7 * 24 * 60 * 60 * 1000,
  },
  pool
);

app.use(
  session({
    key: 'sid',
    secret: config.sessionSecret,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false, // 纯 HTTP 部署；上 HTTPS 后必须改 true
      maxAge: 7 * 24 * 60 * 60 * 1000,
    },
  })
);

app.use(csrf);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.userId
    ? { id: req.session.userId, username: req.session.username }
    : null;
  res.locals.flash = req.session.flash || null;
  res.locals.aiEnabled = config.ai.enabled;
  res.locals.currentPath = req.path;
  res.locals.appUrl = config.appUrl;
  delete req.session.flash;
  next();
});

app.use('/', require('./routes/index'));
app.use('/', require('./routes/problems'));
app.use('/', require('./routes/review'));
app.use('/', require('./routes/stats'));
app.use('/', require('./routes/admin'));

app.use((req, res) => {
  res.status(404).render('error', {
    title: '没有这个页面',
    message: '这里什么都没有，回今天看看。',
    status: 404,
  });
});

app.use((err, req, res, next) => {
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status || 500;

  if (status >= 500) console.error('[error]', err.stack || err);

  res.locals.csrfToken = res.locals.csrfToken || '';
  res.locals.currentUser = res.locals.currentUser || null;
  res.locals.flash = res.locals.flash || null;
  res.locals.aiEnabled = res.locals.aiEnabled === true;
  res.locals.currentPath = res.locals.currentPath || req.path;
  res.locals.appUrl = res.locals.appUrl || config.appUrl;

  const messages = {
    400: '提交的内容有问题，检查一下再试。',
    403: '这个操作被拒绝了（表单可能过期）。',
    413: '截图太大了，压缩一下再传。',
    500: '服务器开小差了，稍后再试。',
  };

  res.status(status).render('error', {
    title: status === 500 ? '服务器开小差' : '请求没有完成',
    message: config.isProd ? messages[status] || '出了点问题。' : err.message,
    status,
  });
});

app.listen(config.port, config.host, () => {
  console.log(`[askonce] listening on http://${config.host}:${config.port} (env=${config.env}, ai=${config.ai.enabled ? 'on' : 'off'})`);
});
