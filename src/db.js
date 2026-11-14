'use strict';

const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  dateStrings: true, // DATE / DATETIME 返回字符串，避免时区漂移
});

async function all(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function get(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows[0] || null;
}

async function run(sql, params = []) {
  const [result] = await pool.query(sql, params);
  return result;
}

function asyncHandler(fn) {
  return function wrapped(req, res, next) {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

module.exports = { pool, all, get, run, asyncHandler };
