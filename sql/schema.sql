-- 只问一次 AskOnce —— 表结构
-- 用法：mariadb -uroot -p askonce < sql/schema.sql

CREATE DATABASE IF NOT EXISTS askonce
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE askonce;

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(32)  NOT NULL UNIQUE,
  password_hash VARCHAR(100) NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS problems (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id          INT UNSIGNED NOT NULL,
  title            VARCHAR(200) NOT NULL,
  error_text       TEXT,
  norm_error       VARCHAR(500),
  context          VARCHAR(500),
  tags             VARCHAR(255) NOT NULL DEFAULT '',

  q_what           TEXT,
  q_how            TEXT,
  q_why            TEXT,
  q_plain          TEXT,

  -- AI 参考答案：只写这里，绝不覆盖上面的 q_*
  ai_what          TEXT,
  ai_why           TEXT,
  ai_how           TEXT,
  ai_model         VARCHAR(64) DEFAULT NULL,
  ai_generated_at  DATETIME DEFAULT NULL,

  final_solution   TEXT,
  source           ENUM('self','ai','doc','mixed') DEFAULT NULL,
  status           ENUM('draft','solved','mastered','archived') NOT NULL DEFAULT 'draft',

  mastery          TINYINT UNSIGNED NOT NULL DEFAULT 0,
  review_stage     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  next_review_on   DATE DEFAULT NULL,
  last_reviewed_at DATETIME DEFAULT NULL,

  recurrence_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_seen_at     DATETIME DEFAULT NULL,

  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  KEY idx_user_status (user_id, status),
  KEY idx_next_review (user_id, next_review_on),
  KEY idx_norm (norm_error(191)),
  KEY idx_created (user_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attempts (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  problem_id INT UNSIGNED NOT NULL,
  source     ENUM('ai','doc','self','other') NOT NULL DEFAULT 'ai',
  tool       VARCHAR(64) NOT NULL DEFAULT '',
  solution   MEDIUMTEXT NOT NULL,
  result     ENUM('effective','partial','failed','unknown') NOT NULL DEFAULT 'unknown',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_problem (problem_id),
  CONSTRAINT fk_attempt_problem FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS artifacts (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  problem_id INT UNSIGNED NOT NULL,
  attempt_id INT UNSIGNED DEFAULT NULL,
  field      VARCHAR(32) DEFAULT NULL,
  kind       ENUM('image','link','file') NOT NULL,
  url        VARCHAR(1000) DEFAULT NULL,
  path       VARCHAR(255) DEFAULT NULL,
  note       VARCHAR(255) DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_problem (problem_id),
  CONSTRAINT fk_artifact_problem FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reviews (
  id           INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  problem_id   INT UNSIGNED NOT NULL,
  result       ENUM('good','fuzzy','bad') NOT NULL,
  stage_before TINYINT UNSIGNED NOT NULL,
  stage_after  TINYINT UNSIGNED NOT NULL,
  reviewed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_problem (problem_id),
  KEY idx_time (reviewed_at),
  CONSTRAINT fk_review_problem FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS recurrences (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  problem_id  INT UNSIGNED NOT NULL,
  note        VARCHAR(500) DEFAULT NULL,
  occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_problem (problem_id),
  CONSTRAINT fk_recurrence_problem FOREIGN KEY (problem_id) REFERENCES problems(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- sessions 表由 express-mysql-session 首次启动时自动创建。
