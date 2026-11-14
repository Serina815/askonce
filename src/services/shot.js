'use strict';

const path = require('path');
const fs = require('fs/promises');
const sharp = require('sharp');
const config = require('../config');

const ALLOWED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif']);

/** 截图：压到宽 1600，转 jpg，文件名带题目 id + 时间戳（允许一题多图） */
async function saveShot(buffer, problemId) {
  await fs.mkdir(config.uploadDir, { recursive: true });

  const meta = await sharp(buffer).metadata();
  if (!meta.format || !ALLOWED_FORMATS.has(meta.format)) {
    const err = new Error('这不是有效的图片文件');
    err.status = 400;
    throw err;
  }

  const name = `${problemId}-${Date.now()}.jpg`;
  const absolute = path.join(config.uploadDir, name);

  const out = await sharp(buffer)
    .rotate()
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(absolute);

  return {
    path: `/uploads/shots/${name}`,
    width: out.width,
    height: out.height,
  };
}

module.exports = { saveShot };
