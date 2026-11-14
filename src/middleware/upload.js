'use strict';

const multer = require('multer');
const config = require('../config');

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

/** 截图上传：先放内存，交给 sharp 压到 1600px 再落盘 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.uploadMaxBytes,
    files: 1,
    fields: 24,
  },
  fileFilter(req, file, cb) {
    if (!ALLOWED.has(file.mimetype)) {
      const err = new Error('只支持 JPG / PNG / WebP / GIF 截图');
      err.status = 400;
      return cb(err);
    }
    return cb(null, true);
  },
});

module.exports = upload;
