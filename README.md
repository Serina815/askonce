# 只问一次 · AskOnce

> 同一个问题，不问第二遍。

一个给「用 AI 学习的人」的问题库：把卡住过你的问题记下来，用间隔重复逼自己真的记住，并在同一个坑再次出现时提醒你。

不是笔记软件。**记录只是入口，复盘才是发动机。**

## 为什么不是普通笔记

只做记录的工具会变成第二个收藏夹。这里的三条设计铁律：

1. **一张卡 = 一个问题**（不是一次对话、不是一篇笔记）
2. **录入 ≤ 10 秒**（全站按 `N`，必填只有一句话，其余后补）
3. **复盘由系统排队**，不靠自觉（首页永远写着"今天 N 张"）

闭环：`记录 → 复盘（遮答案自测）→ 复发（再遇到就提醒）→ 掌握度上升 → 自主解决率上升`

## 功能

- **秒记**：按 `N` 弹浮层，回车保存；`Ctrl+V` 直接贴截图
- **三问**：是什么 / 怎么解 / 为什么 / 人话版
- **尝试时间线**：AI 方案 A、文档、自己想的都留下，标注有效 / 部分 / 无效
- **遮答案复盘**：先自己想，再看答案，自评三档 → 自动排到 1 / 3 / 7 / 21 / 45 天后
- **复发追踪**：报错归一化 + 子串匹配，命中后掌握度 -1、复盘提前到今天
- **自主解决率**：自己想的 / AI 给的，月度统计
- **导出**：Markdown（Obsidian）、Anki CSV、JSON

## 本地跑起来

```bash
cp .env.example .env          # 填 DB_*、SESSION_SECRET，按需填 AI_API_KEY
npm ci --omit=dev
mysql -uroot -p < sql/schema.sql
node bin/create-admin.js --user admin --pass "你的密码"
node bin/seed.js --user admin   # 可选：灌 4 张示例卡，先看看界面
npm start                     # http://127.0.0.1:3000
```

### 示例数据

`bin/seed.js` 会写入 4 张处于不同状态的卡，方便第一眼看到完整效果：

| 卡片 | 状态 | 用来看什么 |
|---|---|---|
| Docker 构建 EACCES | 待复盘（今天到期） | 三问、3 条尝试、截图、复发 2 次 |
| Nginx 502 | 已掌握 | 掌握度点、复盘历史、30 天后排期 |
| MariaDB 死锁 | 待整理 | 只有报错没有答案的初始状态 |
| git push 被拒 | 待复盘（已逾期 1 天） | 首页"逾期"提示 |

```bash
node bin/seed.js --user admin --reset   # 清空该用户的卡后重新灌
```

示例截图是用 `sharp` 现场画的终端图，不依赖任何外部素材。

## AI 配置

接口是 **OpenAI 兼容格式**，换供应商只改三个环境变量：

| 供应商 | AI_BASE_URL | AI_MODEL |
|---|---|---|
| DeepSeek | `https://api.deepseek.com` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |

AI 只做一件事：把「问题 + 报错」变成三问草稿，而且**只填空字段，不覆盖你写的内容**。每次生成后它都会提醒你改写成自己的话。

## 部署到 CentOS Stream 9

```bash
# 1. 依赖
cat > /etc/yum.repos.d/nginx.repo <<'EOF'
[nginx-stable]
name=nginx stable repo
baseurl=http://nginx.org/packages/centos/9/$basearch/
gpgcheck=1
enabled=1
gpgkey=https://nginx.org/keys/nginx_signing.key
module_hotfixes=true
EOF
yum -y install nginx
yum -y module enable nodejs:22 && yum -y module install nodejs:22/common
yum -y module enable mariadb:10.11 && yum -y install mariadb-server
yum -y install policycoreutils-python-utils
systemctl enable --now nginx mariadb

# 2. 数据库
mariadb-secure-installation
mariadb -uroot -p -e "CREATE DATABASE askonce CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mariadb -uroot -p -e "CREATE USER 'askonce'@'127.0.0.1' IDENTIFIED BY '强密码'; GRANT SELECT,INSERT,UPDATE,DELETE ON askonce.* TO 'askonce'@'127.0.0.1';"
mariadb -uroot -p askonce < sql/schema.sql

# 3. 代码
useradd -m -s /bin/bash askonce 2>/dev/null || true
mkdir -p /var/www/askonce /etc/askonce
# 上传代码到 /var/www/askonce 后：
chown -R askonce:askonce /var/www/askonce
# 注意：目录 755、文件 644。Nginx 以 nginx 用户跑，750 会让它读不到静态文件
find /var/www/askonce -type d -exec chmod 755 {} \;
find /var/www/askonce -type f -exec chmod 644 {} \;
su - askonce -c 'cd /var/www/askonce && npm ci --omit=dev'
su - askonce -c 'cd /var/www/askonce && ENV_FILE=/etc/askonce/askonce.env node bin/create-admin.js --user admin --pass "强密码"'

# 4. 环境变量（不进 Web 目录）
cat > /etc/askonce/askonce.env <<'EOF'
NODE_ENV=production
PORT=3000
DB_HOST=127.0.0.1
DB_USER=askonce
DB_PASS=强密码
DB_NAME=askonce
SESSION_SECRET=openssl rand -hex 32 的结果
AI_BASE_URL=https://api.deepseek.com
AI_API_KEY=你的 key
AI_MODEL=deepseek-chat
EOF
chmod 640 /etc/askonce/askonce.env
```

systemd（`/etc/systemd/system/askonce.service`）：

```ini
[Unit]
Description=AskOnce
After=network-online.target mariadb.service
Wants=network-online.target

[Service]
Type=simple
User=askonce
WorkingDirectory=/var/www/askonce
EnvironmentFile=/etc/askonce/askonce.env
ExecStart=/usr/bin/node src/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=/var/www/askonce/public/uploads
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
```

Nginx（`/etc/nginx/conf.d/askonce.conf`）：

```nginx
server {
    listen 80;
    server_name _;
    server_tokens off;
    client_max_body_size 12m;

    root /var/www/askonce/public;
    location /static/ { expires 30d; }
    location /uploads/ {
        expires 7d;
        add_header X-Content-Type-Options nosniff;
        location ~* \.(php|js|html?|sh)$ { deny all; }
    }
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
    location ~ /\.(?!well-known) { deny all; }
}
```

SELinux 与防火墙（CentOS 必做）：

```bash
setsebool -P httpd_can_network_connect 1
semanage fcontext -a -t httpd_sys_content_t "/var/www/askonce(/.*)?"
semanage fcontext -a -t httpd_sys_rw_content_t "/var/www/askonce/public/uploads(/.*)?"
restorecon -Rv /var/www/askonce
firewall-cmd --permanent --add-service=http && firewall-cmd --reload
```

## 路由

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/` | 今天：待复盘 + 最近 + 指标 |
| GET | `/review` | 遮答案复盘 |
| POST | `/p/:id/review` | 自评并排下次 |
| GET | `/p/:id` | 问题卡详情 |
| POST | `/problems` | 秒记（multipart） |
| POST | `/p/:id/ai` | AI 补三问（只填空字段） |
| POST | `/p/:id/solve` | 标记已解决，进入复盘队列 |
| POST | `/p/:id/recur` | 记一次复发 |
| POST | `/p/:id/attempts` | 加一条尝试 |
| GET | `/search` | 按报错 / 标题 / 标签 |
| GET | `/stats` | 自主解决率、复发曲线、薄弱标签 |
| GET | `/export.md` `/export.csv` `/export.json` | 导出 |

## 设计取舍

- **不上向量检索**：归一化 + 子串 + 关键词 Jaccard，几十到几百张卡足够，且可解释。
- **纯 HTTP 部署要关掉 CSP 的 `upgrade-insecure-requests`**：helmet 默认开启这一项，会让浏览器把页面里的 CSS/JS 等子资源升级成 https。只开 80 端口时，表现就是「页面能打开但完全没有样式」，而且 `curl` 一切正常，非常难查。上 HTTPS 后可以再打开。
- **AI 不自动入库**：只填空白字段，避免把模型的猜测当成你的理解。
- **SSE 暂未做**：单用户单设备时价值不高；要做时用 `text/event-stream` + Nginx `proxy_buffering off` 即可。
- **间隔上限 45 天**：这个产品的用户需要高频轻量，不是半年一次的仪式。
