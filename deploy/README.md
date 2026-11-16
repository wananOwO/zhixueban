# 智学伴线上站部署说明

适用：国内云服务器（域名已备案）、Linux（推荐 Ubuntu 22.04）、Node 22+。
需要管理员权限的命令以 `sudo` 开头，请在服务器上自己执行。

## 目录与文件

| 文件 | 放到 | 说明 |
|---|---|---|
| `zhixueban.service` | `/etc/systemd/system/` | 以 `zhixueban` 用户运行，只监听 `127.0.0.1:3101` |
| `env.example` | `/etc/zhixueban/env`（权限 600） | 运行模式、域名、访问码、数据库、示例课程、判题服务 |
| `nginx.conf.example` | `/etc/nginx/conf.d/zhixueban.conf` | HTTPS、HTTP 跳转、SSE 关闭缓冲、上传 21 MiB |
| `judge0/docker-compose.yml`、`judge0/judge0.conf.example` | `/srv/judge0/` | 编程题隔离判题（Judge0 CE 1.13.1） |

应用目录固定为 `/srv/zhixueban`。数据库与上传文件必须在应用目录的 `data/` 里（程序拒绝 `data/` 以外的路径和符号链接），所以 `data/` 是真实目录，不要做成链接。

## 一、准备服务器

```bash
sudo useradd --system --home /srv/zhixueban --shell /usr/sbin/nologin zhixueban
sudo mkdir -p /srv/zhixueban /etc/zhixueban
sudo chown zhixueban:zhixueban /srv/zhixueban
# Node 22（任选官方二进制或 NodeSource），pnpm 用 corepack 启用
sudo corepack enable
```

## 二、部署应用

```bash
cd /srv/zhixueban
sudo -u zhixueban git clone <仓库地址> .
sudo -u zhixueban pnpm install --frozen-lockfile
sudo -u zhixueban pnpm build
sudo -u zhixueban mkdir -p data/sample
# 新建数据库（schema v6）
sudo -u zhixueban pnpm vl:init --db data/app.db --create
```

## 三、环境变量

```bash
sudo cp deploy/env.example /etc/zhixueban/env
sudo chmod 600 /etc/zhixueban/env
sudo nano /etc/zhixueban/env   # 改域名、访问码、JUDGE0_TOKEN
```

- `VL_ACCESS_CODE` 写进评审材料。更换后，所有浏览器需要重新输入访问码（空间数据保留）。
- 不要设置 `LLM_API_KEY`：线上模式只用评委浏览器里填的 Key。

## 四、systemd 与 Nginx

```bash
sudo cp deploy/zhixueban.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now zhixueban
sudo systemctl status zhixueban

sudo cp deploy/nginx.conf.example /etc/nginx/conf.d/zhixueban.conf
sudo nano /etc/nginx/conf.d/zhixueban.conf   # 改域名与证书路径
sudo nginx -t && sudo systemctl reload nginx
```

检查：浏览器打开 `https://你的域名`，应出现「输入访问码」。`curl -I https://你的域名/` 的响应头应有 `Content-Security-Policy`、`X-Content-Type-Options: nosniff`、`Strict-Transport-Security`。

## 五、Judge0（编程题）

Judge0 只支持 Linux，且需要 cgroup v1。Ubuntu 22.04 默认是 cgroup v2，需要先改内核参数并重启：

```bash
sudo nano /etc/default/grub
# 在 GRUB_CMDLINE_LINUX 的引号里加上：systemd.unified_cgroup_hierarchy=0
sudo update-grub
sudo reboot
```

重启后：

```bash
sudo mkdir -p /srv/judge0 && cd /srv/judge0
sudo cp /srv/zhixueban/deploy/judge0/docker-compose.yml .
sudo cp /srv/zhixueban/deploy/judge0/judge0.conf.example judge0.conf
sudo chmod 600 judge0.conf
openssl rand -hex 16   # 运行三次，分别填 AUTHN_TOKEN、REDIS_PASSWORD、POSTGRES_PASSWORD
sudo nano judge0.conf
sudo docker compose up -d db redis
sleep 10
sudo docker compose up -d
curl -s -H "X-Auth-Token: <AUTHN_TOKEN>" http://127.0.0.1:2358/languages | head -c 300
```

把 `AUTHN_TOKEN` 同时填进 `/etc/zhixueban/env` 的 `JUDGE0_TOKEN`，然后 `sudo systemctl restart zhixueban`。设置页「判题服务」应显示可用语言。

不部署 Judge0 时：编程题无法生成和判分，界面明确显示「判题服务未配置」；选择题、填空题不受影响。程序不会在主机上直接执行学生代码。

## 六、示例课程

线上站的每个新空间会自动复制一门预置示例课程，评委不填模型 Key 也能读课件、答题、看生成过程回放。已有空间不受影响。

1. 在一个一次性本地库里上传可公开的教材（例如 Python 官方中文教程、OI Wiki），按正常流程生成方案并确认，学完第一个课件并生成第一组练习（不作答）。这一步会调用模型、产生费用。
2. 导出（只读打开数据库）：

```bash
pnpm vl:sample-export --db data/<一次性库>.db --scope local-owner --course <课程ID> --out course.json
```

3. 把 `course.json` 放到 `/srv/zhixueban/data/sample/course.json`（`env.example` 里的 `VL_SAMPLE_PATH` 已指向它），然后 `sudo systemctl restart zhixueban`。

导出内容：课程版本与审核记录、用到的资料快照（不带上传文件）、重置为未开始的学习会话、已生成的课件与题组、生成任务的结果与轨迹。轨迹只保留工具名、读取区间、搜索词、引用段号等，不含提示词与模型原文。不导出作答、笔记和其他草稿。未配置 `VL_SAMPLE_PATH` 或文件不存在时跳过，线上站照常可用。

## 七、备份

`data/` 里是 SQLite 数据库（含 `-wal`、`-shm`）与上传文件。每日备份用 SQLite 在线备份，不要直接复制正在写入的数据库文件：

```bash
sudo apt install sqlite3
sudo tee /etc/cron.daily/zhixueban-backup >/dev/null <<'EOF'
#!/bin/sh
set -e
dest=/var/backups/zhixueban/$(date +%F)
mkdir -p "$dest"
sqlite3 /srv/zhixueban/data/app.db ".backup '$dest/app.db'"
tar -C /srv/zhixueban/data -czf "$dest/uploads.tar.gz" verified-learning
find /var/backups/zhixueban -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
EOF
sudo chmod 755 /etc/cron.daily/zhixueban-backup
```

## 八、升级

```bash
cd /srv/zhixueban
sudo -u zhixueban git pull
sudo -u zhixueban pnpm install --frozen-lockfile
sudo -u zhixueban pnpm build
sudo -u zhixueban pnpm vl:init --db data/app.db   # 有新迁移时自动备份后升级
sudo systemctl restart zhixueban
```

重启会清空内存里的模型 Key。正在生成的任务会在页面上提示「服务器已重启，确认 Key 后点继续」，已通过验收的部分不重复生成。

## 九、日志与 Key

- 应用日志在 journald：`sudo journalctl -u zhixueban -f`。程序不记录请求头；模型供应商返回的错误里出现的 Key 会被替换为 `[已隐藏]`。
- Nginx 访问日志用的是只含方法、路径、状态码的格式（见 `nginx.conf.example`），不记录 Cookie 与请求头。
- 验证 Key 没有落盘（用一个测试 Key 跑一次完整生成后）：

```bash
cd /srv/zhixueban
sudo -u zhixueban pnpm exec tsx scripts/check-key-leak.ts --key '<测试用的 Key>' data /var/log/nginx
```

输出最后一行「命中 0 处」即通过。

## 十、空间清理

线上模式启动时与之后每 6 小时，自动删除 30 天未访问的空间及其上传文件，不需要额外配置。
