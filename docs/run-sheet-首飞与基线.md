# 首飞执行单（唯一入口 · 从头走到尾）

> **本文件是 U8 对齐版本（2026-06-10）**，全量覆盖旧版。
> 首飞定义 = 手动路径 + 待审池路径 **各 ≥1 篇真实可见帖**，两条都过才算 G2 完成。

---

## ◾ Part 0 · 密钥轮换（R14 — 首飞前必须完成，只做一次）

> 这一步不做，后端 fail-closed 拒绝启动。顺序：生成 → 供应商轮换 → 写 .env → 重启 → 验证。

### 0-A 生成 JWT_ADMIN_PASSWORD_HASH

```bash
node packages/backend/scripts/hash-password.mjs
# 提示输入密码（不回显），输出：
# JWT_ADMIN_PASSWORD_HASH=<saltHex>:<keyHex>
# 把这行复制到 .env
```

密码长度 ≥8 位，记在安全的地方（后续无法还原）。

### 0-B 生成新 JWT_SECRET

```bash
node -e "console.log(require('node:crypto').randomBytes(48).toString('hex'))"
# 输出 96 字符 hex，复制到 .env 的 JWT_SECRET=
```

要求 ≥32 字符，不能是占位值（`change-this-*`、`secret` 等）。

### 0-C LLM_API_KEY 轮换（无条件执行）

> probe-grounding.mjs 下落不明 + 机构记忆 G5「已曝光须轮换」→ 无条件执行。

1. 在 LLM 供应商（DeepSeek / OpenAI 等）控制台：**作废旧 key，生成新 key**。
2. 把新 key 写入 `.env` 的 `LLM_API_KEY=`。
3. 旧 key 在供应商侧生效失效大约需要几分钟——开窗前等它失效再启动。

### 0-D 写 `.env` 并重启后端

最终 `.env` 必须包含（缺任何一项后端会拒绝启动）：

```dotenv
JWT_SECRET=<96字符hex>
JWT_ADMIN_PASSWORD_HASH=<saltHex>:<keyHex>
LLM_API_KEY=<新key>
LLM_ENDPOINT=https://api.deepseek.com/v1   # 或你的供应商地址
```

```bash
# 停止旧进程后
cd packages/backend && pnpm start
# 启动日志应显示：Server listening on http://127.0.0.1:3001
# 若报 "Weak JWT_SECRET" 或 "Invalid JWT_ADMIN_PASSWORD_HASH" → 检查 .env 格式
```

### 0-E 扩展端验证轮换成功

1. `chrome://extensions` → 找 51publisher → 点 ↻ 重载。
2. 打开后台页，**刷新该页**（两个动作都要做）。
3. 侧边栏点「登录」，输入新密码 → 应收到新 token。
4. 旧 token（如有）401 是预期行为。

**0 步完成条件**：扩展登录 200 + 后台侧边栏显示已认证。

---

## ◾ Part 1 · G1 基线冒烟（首飞前置，每次开窗前确认）

| 检查项 | 方法 | 预期 |
|--------|------|------|
| 后端编译零错误 | `pnpm --filter publisher-backend compile` | 无红字 |
| 后端运行 | `curl http://127.0.0.1:3001/api/v1/auth/status` | `{"ok":true,"authenticated":false}` |
| 扩展已加载今天构建 | chrome://extensions → 查看「最后更新」时间 | 今天 |
| 登录 round-trip | 扩展侧边栏登录 | 200 + token |
| batch 写入 | `curl -X POST http://127.0.0.1:3001/api/v1/batches -H 'Authorization: Bearer <token>' -d '{"id":"smoke","tabId":1,"authorizedHost":"test","topics":["test"]}'` | `{"ok":true,...}` |
| pending 读取 | `curl http://127.0.0.1:3001/api/v1/pending-topics -H 'Authorization: Bearer <token>'` | `{"ok":true,"topics":[...]}` |

> **注意：data/ 恢复**：若此前跑了后端测试（会清空 data/），先恢复 Unit 1 备份的 `~/51publisher-backups/` 副本，待审池路径的数据源才就位。

**G1 满足时间**：\_\_\_\_\_\_ （写入，首飞 3 天窗口从此刻起算）

---

## ◾ Part 2 · 路径 A · 手动路径（变量最少，推荐先飞）

### A-1 准备题材

在侧边栏「≣ 批量」选题框，每行一条，格式：

```
作品名称 || 作品名=实际作品名 | 类型=動畫/漫畫 | 集数=XX | 制作=制作方 | 漢化=https://example.com/link | 简介=一句梗概
```

**注意**：
- 连结（漢化、無修）填真实 URL，**不要把真实 URL 存进任何代码文件**，只在运行时输入。
- 先用一条安全测试题（可以是不真实发的）跑通流程，再换真题材。

### A-2 生成 + 填充

1. 档位 → `dry-run`（先验证填充，不真发）。
2. 「开始批量(生成+填充)」→ 等生成完成。
3. 展开草稿，逐项核对：
   - 标题/副标题是否合适？
   - 分类是「漫畫文章」还是「動漫文章」？（若 degrade 记在回填表 D 列）
   - 标签有没有匹配上？（若黄色/降级记下模型吐的原始词）
   - 正文有没有编造的事实？

### A-3 media_id 手填

> **必须由操作者手填**，系统不会自动匹配。

在后台搜索或浏览找到对应作品的 media_id（数字），在填充结果面板或发帖表单里手动输入 `input[name="media_id"]`。

### A-4 cover_url 处理

`cover_url` 字段（`input[name="cover_url"]`）：
- 如果后台允许直接输入封面图 URL → 填入 CDN 地址。
- 如果必须走文件上传 → 操作者在表单里手动上传，并记录是否会因空 cover_url 报错（记入 Part 5 回填表）。
- MVP 阶段可先试 status=0 隐藏帖不带封面，看 save 是否成功。

### A-5 以 status=0 隐藏帖发布

1. 档位切 `authorized`。
2. 在表单里确认 `select[name="status"]` 设为 `0`（隐藏）。
3. 点「批准」→「发布」→ 操作者看到提示后手势确认（填充器不会替你点）。
4. F12 → Network → 找 `POST /admin/webarticle/save`：
   - 响应应为 `{"code":0,"msg":"操作成功"}` 或类似成功标志。
   - 若报错，记在 Part 5 回填表 F 列。

### A-6 后台核验

1. 进后台「文章管理 → 列表」，刷新。
2. 找到刚发的帖（状态=隐藏）：
   - 标题 ✓ / 正文渲染正常 ✓ / 分类 ✓ / 标签可见 ✓
   - cover_url 有没有错误？（记入回填表）
3. 核验通过 → 把状态改为「显示」（`status=1`）。
4. 前台访问路径确认帖子可见。

**路径 A 完成条件**：帖子在前台可见，回填表 A 列完整填写。

---

## ◾ Part 3 · 路径 B · 待审池路径

### B-1 确认待审池有数据

侧边栏切「⏳ 待审」标签 → 应能看到 pending topics 列表。

若列表为空：
- **方案 1**：手动触发 ACGS51 抓取（前提：ACGS51_ENABLED=true + 有效 URL）。
- **方案 2**：用 API 手动创建一条待审选题：
  ```bash
  curl -X POST http://127.0.0.1:3001/api/v1/pending-topics \
    -H 'Authorization: Bearer <token>' \
    -H 'Content-Type: application/json' \
    -d '{"sourceUrl":"https://example.com","siteName":"acgs51","title":"测试作品 · 首飞验证","facts":{"作品名":"测试作品","类型":"漫畫"},"confidence":0.8}'
  ```
- **方案 3**：若无法配置 ACGS51，用 Route B 等待——首飞允许从方案 2 注入的手工条目走完流程。

### B-2 从待审池发起一条

1. 侧边栏「⏳ 待审」→ 选一条 pending topic → 点「发起发帖」（或等价按钮）。
2. 系统从 pending topic 的 facts 字段预填题材，进入生成流程。
3. 后续步骤同 A-2 至 A-6（生成 → 核对 → media_id 手填 → status=0 → 核验 → 转正）。

**路径 B 完成条件**：来自待审池的帖子在前台可见，回填表 B 列完整填写。

---

## ◾ Part 4 · 首飞收尾

### 清理测试帖

后台「文章管理」→ 搜索 `TEST_勿用` → 删除全部结果。
同样检查 id 110 / 111 / 112 是否仍存在（遗留测试帖） → 若存在，删除。

### 备份 data/（R0 第二次备份）

```bash
# 停止后端
sqlite3 packages/backend/data/pending.db ".backup '$HOME/51publisher-backups/pending-$(date +%Y%m%d-%H%M).db'"
cp -r packages/backend/data/ "$HOME/51publisher-backups/data-postflight-$(date +%Y%m%d-%H%M)/"
```

记录备份路径：\_\_\_\_\_\_

### 首飞完成声明

两条路径都完成后，在此记录：

- **路径 A 完成时间**：\_\_\_\_\_\_
- **路径 B 完成时间**：\_\_\_\_\_\_
- **帖子 URL（路径 A）**：\_\_\_\_\_\_ （若愿意记录）
- **帖子 URL（路径 B）**：\_\_\_\_\_\_ （若愿意记录）

**G2 完成** → 可以进行 U13 CORS 收紧。

---

## ◾ Part 5 · 回填表（每条帖子记一行）

| # | 路径 | 分类 degrade 词 | 标签命中? | cover_url 报错? | media_id 来源 | save 结果 | 前台核验 | 摩擦点备注 |
|---|------|----------------|-----------|----------------|--------------|-----------|---------|-----------|
| A-1 | 手动 | | | | | | | |
| B-1 | 待审池 | | | | | | | |

**degrade 词**：填充器匹配不到标签时，模型吐的原始词（如「成人動畫」「校園/日常」），是 G4 词表的真底料。

---

## ◾ 附录 · 常见问题与排查

### Q1: 「字段全部未找到」

原因：发帖表单在 layuiAdmin 的内容区 **iframe** 内，而非顶层文档。
解法：`frame-resolve.ts` 自动处理，无需手动干预。
但若 iframe 未完全加载 → 先等后台页面完全稳定再触发填充。

### Q2: 标签全部 degrade（黄色）

1. 侧边栏「⚙ 设置 → 字段映射」确认 `tags` selector 是 `input[name="tags[]"]`，fieldType 是 `checkbox-multi`。
2. 标签系统有 ~3912 个标签，可在弹层搜索框输入关键词过滤。
3. AI 吐的英文标签（如「anime」「adult」）可能找不到对应中文选项 → 正常 degrade，记录词表。

### Q3: 后端启动失败 / fail-closed

报错内容指向哪个字段就修哪个：
- `Weak JWT_SECRET` → 换强密钥（≥32 字符，无占位词）。
- `Invalid JWT_ADMIN_PASSWORD_HASH` → 重新跑 `hash-password.mjs`。
- `LLM_ENDPOINT missing` → 填入真实端点 URL。

### Q4: 扩展填充后表单没变化

1. `chrome://extensions` → 51publisher → ↻ 重载扩展。
2. 回到后台页 → **刷新页面**（两步都要做）。
3. 重新点「添加」打开弹层，再触发填充。

### Q5: save 响应非 `code:0`

记入回填表 F 列，截图保留 Network 请求体 + 响应体，作为 R7 阻塞问题的定位素材。
不要连续重试——先检查表单字段是否有必填项未填（cover_url / media_id 最常见）。

### Q6: 首飞窗口落空（3 天内未完成）

触发兜底规则：
1. 阶段 C（U10–U12）已完成，以此收工。
2. 在 `.ai-memory/project_51publisher.md` 写入带日期的改期承诺。
3. U13 CORS 收紧随首飞延期。

---

## ◾ 附录 · 扩展重载速查

每次修改 extension 代码后必须做两步，**缺任何一步填充不生效**：

1. `chrome://extensions` → 51publisher → ↻（重载按钮）。
2. 后台页 → **F5 刷新**（重新注入 content script）。
