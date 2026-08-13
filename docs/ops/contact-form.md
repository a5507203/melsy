# 联系表单运维

## 服务边界

公开首页将合作需求提交到 Cloudflare Worker `melsy-contact` 的 `POST /contact`。Worker 完成 CORS、请求大小和字段校验，随后通过 Resend 发送一封事务邮件。站点和 Worker 不保存数据库副本；邮件内容仍会进入 Resend 的处理链路和墨悉团队邮箱。

## 生产配置

在 Worker 的 Variables and Secrets 中配置：

| 名称 | 类型 | 用途 |
|---|---|---|
| `RESEND_API_KEY` | Secret | Resend 发送权限密钥；不得写入仓库、日志或浏览器 |
| `CONTACT_FROM_EMAIL` | Text | 已验证发件身份，例如 `Melsy Website <website@mail.melsyai.com>` |
| `CONTACT_TO_EMAIL` | Text | 团队收件箱，例如 `contact@melsyai.com` |
| `ALLOWED_ORIGINS` | Text | 逗号分隔的精确 Origin；不含路径或末尾斜杠 |

Wrangler 配置使用 `keep_vars: true`，部署时不会覆盖 Dashboard 中的普通变量；Secret 也不会由普通部署删除。若以后改为让仓库配置成为变量权威来源，应先迁移配置并单独评审。

## 本地验证

```powershell
npm test
npm run worker:dry-run
```

本地联调若需要真实密钥，只能在 `worker/.dev.vars` 中设置，且该文件已被 `.gitignore` 排除。不要同时创建 `.env`。

## 部署与回滚

1. `npx wrangler whoami` 核对当前 Cloudflare 账号。
2. `npm run worker:dry-run` 检查打包和 binding 配置。
3. 经部署确认后运行 `npm run worker:deploy`。
4. 访问 Workers.dev 的 `/health`，确认返回 `ok: true`。
5. 从允许的网页 Origin 提交一条明确标注为测试的需求，在 Resend Logs 确认 accepted，并在 `contact@melsyai.com` 确认真正收件和 Reply-To。
6. 若部署后异常，在 Cloudflare Worker Deployments 中回滚到上一个已知正常版本；前端失败提示和二维码仍提供恢复路径。

## 监控与安全

- 日志只能包含 `requestId`、事件、结果、HTTP 状态与耗时，不记录姓名、邮箱、电话、需求正文、API key 或完整 Resend payload。
- 关注 429、502、503 与 Resend 配额。平台限流按 Cloudflare 节点生效并为最终一致，不能当作精确账本。
- 当前采用隐藏蜜罐、邮箱摘要限流、全局限流和 Resend 幂等键。若自动化滥用仍明显，再接入适用于中国大陆访问的验证码，并在 Worker 端验证。
- 轮换 Resend key 时先新增并验证新 Secret，再撤销旧 key；不要通过聊天、截图或 issue 传递密钥。
