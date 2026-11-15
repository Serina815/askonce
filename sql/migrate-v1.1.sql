-- 从 v1.0 升到 v1.1：截图归属字段 + AI 参考答案
-- 用法：mariadb -uroot -p askonce < sql/migrate-v1.1.sql
-- 只对已存在的旧库执行一次；新库直接跑 schema.sql 即可。

USE askonce;

-- 截图属于哪个输入框：error_text / q_what / q_why / q_how / q_plain / final_solution / title / context / attempt
ALTER TABLE artifacts
  ADD COLUMN field VARCHAR(32) DEFAULT NULL AFTER attempt_id;

-- AI 参考答案：独立存放，不覆盖用户写的 q_*
ALTER TABLE problems
  ADD COLUMN ai_what         TEXT DEFAULT NULL AFTER q_plain,
  ADD COLUMN ai_why          TEXT DEFAULT NULL AFTER ai_what,
  ADD COLUMN ai_how          TEXT DEFAULT NULL AFTER ai_why,
  ADD COLUMN ai_model        VARCHAR(64) DEFAULT NULL AFTER ai_how,
  ADD COLUMN ai_generated_at DATETIME DEFAULT NULL AFTER ai_model;

-- 回退（如果确认不要这些列）：
-- ALTER TABLE artifacts DROP COLUMN field;
-- ALTER TABLE problems DROP COLUMN ai_what, DROP COLUMN ai_why, DROP COLUMN ai_how,
--   DROP COLUMN ai_model, DROP COLUMN ai_generated_at;
