# Token 热力图（社区上报）

成员把自己的 AI 工具每天消耗多少 token 报上来，站点把它做成一张热力图和一份榜单。
模块开关：`industry/features.ts` 的 `FEATURES.tokenBoard`，关掉后 `/token`、`/join` 和
`/api/v1/token/*`、`/api/community/*` 都不注册。

## 数据

| 表 | 作用 |
|---|---|
| `community_users` / `community_sessions` / `community_email_tokens` | 社区账号。邮箱一次性链接登录，不存密码；与 `admin_users` 完全隔离 |
| `community_api_keys` | 上报用的 API Key，只存哈希 |
| `token_usage_events` | 每次上报一行，`(user_id, idempotency_key)` 唯一 |
| `token_usage_daily` | `(user_id, day, tool)` 汇总，页面只读这里 |

每次上报都会重算当天那一格的汇总，所以重复上报只会覆盖、不会叠加。

## 接口

### 上报（需要 API Key）

```
POST /api/v1/usage
Authorization: Bearer mh_live_…
content-type: application/json

{
  "day": "2026-10-01",              // 必填，今天或过去 6 天
  "tool": "claude-code",            // claude-code | codex | cursor | api | other
  "model": "claude-opus-4-6",       // 可选
  "tokensIn": 1200000,              // 可选，默认 0
  "tokensOut": 85000,               // 可选，默认 0
  "tokensTotal": 1285000,           // 可选，不给则按 in+out 算
  "costUsd": 4.82,                  // 可选
  "client": "cc-statusline/1.2",    // 可选
  "idempotencyKey": "2026-10-01-claude-code"   // 必填
}
```

返回 202：`{ day, tool, tokensTotal, replaced }`。`replaced` 为 true 表示这次覆盖了同一
`idempotencyKey` 的上一次上报。每 Key 每分钟 60 次。

### 读取（匿名）

| 路径 | 参数 |
|---|---|
| `GET /api/v1/token/board` | `range=today\|7d\|30d\|all`、`tool=`、`limit=1..100` |
| `GET /api/v1/token/heatmap` | `user=<handle>`、`days=7..365` |
| `GET /api/v1/token/summary` | 无 |

游客最多看到前 10 名；登录用户可以看到自己请求的条数（上限 100）。

### 账号（浏览器，session cookie + CSRF）

| 路径 | 说明 |
|---|---|
| `POST /api/community/auth/start` | 提交 `{ email, handle?, returnTo }`，发一次性链接 |
| `GET /api/community/auth/verify?token=` | 校验并落 session，跳转 `returnTo` |
| `POST /api/community/auth/logout` | 退出 |
| `GET /api/community/me` | 当前身份 + 密钥列表 + CSRF |
| `POST /api/community/keys` | 生成密钥，明文只返回这一次 |
| `DELETE /api/community/keys/:id` | 吊销 |

邮件走与日报相同的通道（`MAIL_FROM` + `RESEND_API_KEY`，或 `MAIL_RELAY_URL` / `MAIL_RELAY_TOKEN`）。
没有配置邮件服务时，非生产环境把链接直接回给前端（页面上可直接点），生产环境返回 503。

## 页面

- `/token`：榜单（今日 / 7 天 / 30 天 / 累计，可按工具筛选）、点开任意成员看 180 天热力图、接入面板
- `/join`：注册（邮箱 + 昵称）
- `/agent`：底部一节，写清楚上报接口与上报脚本

## 上报脚本 `scripts/myhot-report.ts`

零依赖的单文件脚本，读本地工具日志里的用量计数，算出当天总量后上报。它**只读 token 数字**，
不读也不传 prompt、回复内容、文件名和路径。

```bash
export MYHOT_TOKEN_KEY=mh_live_…
node scripts/myhot-report.ts                     # 两个工具都扫，各自上报今天
node scripts/myhot-report.ts --tool codex --dry-run
node scripts/myhot-report.ts --day 2026-09-30 --base https://news.coderfather.com
```

| 参数 | 说明 |
|---|---|
| `--key` | API Key（也可设 `MYHOT_TOKEN_KEY`） |
| `--tool` | `claude-code` 或 `codex`；不给就两个都扫 |
| `--day` | `YYYY-MM-DD`，默认今天（北京时间） |
| `--base` | 站点地址，默认 `SITE.defaultUrl` |
| `--dry-run` | 只算不传 |
| `--verbose` | 列出扫到的文件 |

日志位置：`~/.claude/projects/**/*.jsonl`（每条 assistant 消息的 `message.usage`）、
`~/.codex/sessions/YYYY/MM/DD/*.jsonl`（每个 `token_count` 事件的 `last_token_usage`）。
幂等键固定为 `<tool>:<day>`，所以一天跑多少次都是覆盖当天那一格，不会叠加 —— 可以放心挂 cron 或 hook：

```cron
# 每小时补一次今天的量
0 * * * * MYHOT_TOKEN_KEY=mh_live_… node /path/to/AIHOT/scripts/myhot-report.ts
```

Cursor 没有可读的本地计数，脚本不支持；这类来源请用 `--tool api` 之外的方式自己按接口上报。

## MCP（只读）

`FEATURES.tokenBoard` 打开时多注册两个工具，都是只读、匿名，走游客可见的前 10 名：

| 工具 | 参数 |
|---|---|
| `myhot_get_token_board` | `range=today\|7d\|30d\|all`、`tool=`、`limit=1..10` |
| `myhot_get_token_heatmap` | `user=<handle>`、`days=7..365` |

MCP 不提供上报：上报需要密钥，不属于匿名 MCP 的职责。两个工具的返回里都写明这些数字是自报、未核实。

## 关于数据可信度

这些数字**由成员自己上报**，服务端只做范围检查（日期窗口、非负整数、单次上限），不核实来源。
页面和文档都明确写了「自报数据，仅供参考」。只上传 token 数量和工具名，不上传对话内容、文件名或 prompt。
