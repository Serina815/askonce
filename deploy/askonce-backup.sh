#!/usr/bin/env bash
# AskOnce 每日备份：数据库 + 上传文件，保留 7 天
set -euo pipefail

DEST=/var/backups/askonce
mkdir -p "$DEST"
STAMP=$(date +%F_%H%M)

# 数据库一致性快照（不锁表）
mariadb-dump --defaults-extra-file=/etc/askonce/backup.cnf \
  --single-transaction --quick askonce | gzip > "$DEST/db-$STAMP.sql.gz"

# 上传的截图
tar -czf "$DEST/uploads-$STAMP.tar.gz" -C /var/www/askonce/public uploads

# 只保留 7 天
find "$DEST" -type f -mtime +7 -delete

echo "[$(date '+%F %T')] backup ok: $STAMP"
