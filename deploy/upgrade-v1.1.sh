#!/usr/bin/env bash
# 升级到 v1.1：截图归属字段 + AI 参考答案
# 用法（在服务器上，用 root 执行）：bash deploy/upgrade-v1.1.sh
set -euo pipefail

APP_DIR="/var/www/askonce"
SERVICE="askonce"
DB_NAME="askonce"
BACKUP_DIR="/var/backups/askonce"

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 执行：sudo bash deploy/upgrade-v1.1.sh"
  exit 1
fi

cd "$APP_DIR"

echo "== 1/5 备份数据库与上传目录 =="
TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
mariadb-dump --single-transaction "$DB_NAME" | gzip > "$BACKUP_DIR/db-$TS.sql.gz"
tar -czf "$BACKUP_DIR/uploads-$TS.tar.gz" -C "$APP_DIR/public" uploads 2>/dev/null || true
ls -lh "$BACKUP_DIR" | tail -3

echo "== 2/5 检查并执行迁移 =="
HAS_COL="$(mariadb -N -B "$DB_NAME" -e "SHOW COLUMNS FROM artifacts LIKE 'field'" | wc -l)"
if [ "$HAS_COL" -eq 0 ]; then
  mariadb "$DB_NAME" < sql/migrate-v1.1.sql
  echo "迁移完成"
else
  echo "已经迁移过，跳过"
fi

echo "== 3/5 修正权限 =="
chown -R askonce:askonce "$APP_DIR"
find "$APP_DIR" -type d -exec chmod 755 {} \;
find "$APP_DIR" -type f -exec chmod 644 {} \;

echo "== 4/5 重启服务 =="
systemctl restart "$SERVICE"
sleep 2
systemctl is-active "$SERVICE"

echo "== 5/5 健康检查 =="
curl -fsS http://127.0.0.1:3000/healthz
echo
curl -fsS -o /dev/null -w "首页 HTTP %{http_code}\n" http://127.0.0.1/

echo
echo "完成。浏览器打开公网地址，按一次 Ctrl+F5 强制刷新。"
echo "如果要回退数据库：gunzip -c $BACKUP_DIR/db-$TS.sql.gz | mariadb $DB_NAME"
