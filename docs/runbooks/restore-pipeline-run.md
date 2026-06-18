# Runbook：日常启动「抓取 → 代审池 → 审核」流水线

> 还原版（51publisher 完整 pipeline）跑在隔离 worktree：
> **`/Users/dex/YDEX/INPORTANT WORK/发帖/51publisher-restore`**（分支 `restore/51publisher` @ 提交 `c812004`）。
> 这是「品牌改名(→51guapi)前最后一个 @51publisher 提交」——名字对、51acgs 抓取原生自带、开箱即 build。
> 主仓库（精简爬虫 v3.0.0）原封不动，互不影响。背景见 `docs/plans/2026-06-18-002-fix-restore-scrape-review-pipeline-plan.md`。

---

## 一、关键事实（速查）

| 项 | 值 |
| --- | --- |
| 还原代码目录 | `/Users/dex/YDEX/INPORTANT WORK/发帖/51publisher-restore` |
| 分支 | `restore/51publisher`（@ c812004） |
| Node 版本 | **22**（系统默认 `/Users/dex/.local/bin/node`，**不要**用 node@20，better-sqlite3 会 ABI 不匹配） |
| 后端地址 | `http://127.0.0.1:3001` |
| **后端配置文件** | **`~/.51publisher/.env`**（⚠️ 优先于 in-repo .env，见第四节） |
| 临时管理员密码 | `51publisher-2026`（登录扩展用；改密见第五节） |
| LLM endpoint / model | `https://la-sealion.inaiai.com/v1` / `gemma4-31b-heretic` |
| 扩展构建产物 | `packages/extension/.output/chrome-mv3/` |
| 扩展固定 ID | `iljimdgfajpgnmanklehhmapojbcjecd`（wxt 公钥钉死，CORS 配一次永久有效） |

---

## 二、每天怎么启动（顺序固定：先后端，再扩展）

### 1. 起后端
```
cd "/Users/dex/YDEX/INPORTANT WORK/发帖/51publisher-restore"
pnpm dev:backend
```
**验证起成功**（另开一个终端）：
```
curl http://127.0.0.1:3001/api/v1/healthz
```
看到 `{"ok":true,...}` 即正常。让这个终端一直开着别关。

### 2. 加载扩展（只有第一次 / 改过扩展代码后才需要重新构建+刷新）
- 如改过扩展代码，先构建：`pnpm build:extension`
- Chrome → `chrome://extensions` → 开「开发者模式」→「载入已解压的扩充功能」→ 选
  `packages/extension/.output/chrome-mv3/`（扩展名「51publisher 发帖填充助手」）
- 改过 content script 后，必须在 `chrome://extensions` 点 **↻ 刷新**，并刷新目标页。

### 3. 登录 + 配置
- 打开侧边栏 → 用密码 `51publisher-2026` 登录（后端地址默认 `127.0.0.1:3001`，不用配）
- 「⚙ 设置」填 LLM endpoint / model / key（能「拉取模型列表」即配置正确）

---

## 三、三段工作流怎么走

1. **抓取**：代审池视图点「⚡ 立即抓取」（或后端 `POST /api/v1/scraper/trigger {"siteName":"acgs51"}`）。
   - 走 list-discovery：扫 `ACGS51_LIST_URL`（=`https://51acgs.com/`）发现最新详情页，取一条 → LLM 提取事实 → 入代审池。
   - 实测一次 ~20 秒，产出 1 条 `status=pending`。
2. **代审池**：`PendingTopicsView` 列出待审条目；选一条进入审核。
3. **审核**：`BatchReviewPanel` 生成草稿 → 检视事实注入、连结来源红/绿标、grounding 硬闸预判 → dry-run → 一键填入后台表单。
   - **铁律**：草稿含【待補】或连结非来源时，硬闸 fail-closed 拦截；**绝不自动提交/发布**，发布动作必须人工。

---

## 四、⚠️ 后端配置在哪（最容易踩的坑）

c812004 的 `packages/backend/src/index.ts` **优先加载 `~/.51publisher/.env`**，再用 in-repo `.env` 补全未设置的变量。**已设置的变量不会被 in-repo 覆盖**。所以：

> **改配置请改 `~/.51publisher/.env`，不是 worktree 里的 `.env`。**（worktree 的 .env 大部分会被前者压住。）

`~/.51publisher/.env` 里与本流水线相关的关键项：
```
LLM_API_KEY=...                              # la-sealion key（真）
LLM_ENDPOINT=https://la-sealion.inaiai.com/v1
CORS_ORIGIN=chrome-extension://iljimdgfajpgnmanklehhmapojbcjecd
JWT_SECRET=...                               # 32+ 随机
JWT_ADMIN_PASSWORD_HASH=...                  # 登录密码哈希（当前=51publisher-2026）
ALLOWED_HOSTS=https://dx-999-adm.ympxbys.xyz,https://51acgs.com   # 抓取目标须在内
ACGS51_ENABLED=true                          # 启用 51acgs 站点
ACGS51_START_URL=https://51acgs.com/comic/15149   # 单条详情页（fail-closed 必填）
ACGS51_LIST_URL=https://51acgs.com/          # 列表页（list-discovery）
```
> 原始备份：`~/.51publisher/.env.bak-restore-20260618`（还原本次改动用）。

---

## 五、常见故障排查

| 现象 | 原因 / 解法 |
| --- | --- |
| 登录报 `invalid password` | 改的是 worktree 的 .env 而非 `~/.51publisher/.env`（被前者压住）。改后者，重启后端。 |
| 后端起不来 / 3001 被占 | 可能僵尸 launchd 守护 `com.51publisher.backend` 又起来。查 `lsof -nP -iTCP:3001 -sTCP:LISTEN`；停 `launchctl bootout gui/$(id -u)/com.51publisher.backend`。 |
| 后端报 better-sqlite3 `NODE_MODULE_VERSION` 不匹配 | 用错 Node 了。确认 `node -v` 是 **22**。 |
| 后端报 `fail-closed env check` | `~/.51publisher/.env` 的 `JWT_SECRET`/`JWT_ADMIN_PASSWORD_HASH`/`CORS_ORIGIN` 缺失或占位；或 `ACGS51_ENABLED=true` 但 `ACGS51_START_URL`/LLM 没填。 |
| 抓取返回 `No articles found at list URL` | 51acgs.com 改版导致选择器漂移。改 `packages/backend/src/scraper/adapters/acgs51-adapter.ts` 解析正则。 |
| 抓取返回 SSRF/403 hostname blocked | `51acgs.com` 不在 `ALLOWED_HOSTS`。加进去重启。 |
| LLM 调用 403 | key 过期/失效。换新 la-sealion key（写 `~/.51publisher/.env`）。 |
| 扩展调后端被 CORS 挡 | 扩展 ID 与 `CORS_ORIGIN` 不一致。确认 ID = `iljimdgfajpgnmanklehhmapojbcjecd`。 |

---

## 六、改管理员密码

```
cd "/Users/dex/YDEX/INPORTANT WORK/发帖/51publisher-restore"
node packages/backend/scripts/hash-password.mjs '你的新密码'
```
把输出的 `JWT_ADMIN_PASSWORD_HASH=...` 整行替换进 **`~/.51publisher/.env`**，重启后端。

---

## 七、本次还原都改了什么

- **代码**：零改动。c812004 原生即含 51acgs adapter、background.ts 干净、开箱即 build。worktree 未 commit。
- **配置**：编辑 `~/.51publisher/.env`（启用 51acgs + 放行域名 + 重置密码为 51publisher-2026），原文件备份 `.bak-restore-20260618`。
- **系统**：launchctl bootout 停掉僵尸守护 `com.51publisher.backend`（占 3001 跑已删除旧代码）。plist 仍在 `~/Library/LaunchAgents/`，要彻底清理可删 plist。
- **待决**：精简版 `main` 的去向（保留为子工具 / 重设 canonical / 归档）。
