# 51publisher 发帖填充助手

一个 Chrome 扩展(Manifest V3),辅助内容运营:用大模型生成一条帖子草稿,**人工预览/编辑**后一键填进 51publisher 后台发帖表单,再由**人工审核并手动点发布**。

> 📖 **第一次用?看[安装与使用指南](docs/install-and-usage.md)**(安装、配置、源接地输入语法、审核与发布档位、常见问题)。

> **硬约束:插件只「填充」,绝不自动提交、绝不自动点发布。最终发布动作必须由人工完成。**
> 代码层面由 `lib/fillers.ts` 的零提交测试守护(填充流程后 `<form>` 的 submit 事件计数必须为 0、不点击任何提交/发布按钮、不派发回车)。

## 工作流

```
输入选题 → 生成草稿(AI)→ 在 side panel 预览/编辑 → 填充到当前页 → 人工审核修改 → 人工点发布 → 下一条
```

- **正文**走 Quill 编辑器自身 API 写入(`Quill.find(#editor).clipboard.dangerouslyPasteHTML`),写入前按白名单消毒。
- **分类**是原生下拉、**标签**是 checkbox 多选、**封面**为文件上传(MVP 不自动填,人工上传)。
- 字段选择器集中在「设置 → 字段映射」一处,后台小改版只改这里。详见 [`docs/field-mapping-guide.md`](docs/field-mapping-guide.md)。

## 环境要求

- **仅支持 Chromium 内核浏览器**(Chrome/Edge 等)——正文写入依赖主世界 content script,Firefox 不支持。
- Node ≥ 20、pnpm。

## 安装(加载未打包扩展)

```bash
pnpm install
pnpm build          # 产出 .output/chrome-mv3/
```

然后在 Chrome:

1. 打开 `chrome://extensions`,右上角开启「开发者模式」。
2. 点「加载已解压的扩展程序」,选择 `.output/chrome-mv3/` 目录。
3. 点工具栏的扩展图标即可打开 side panel。

开发时可用 `pnpm dev`(带热更新)。

## 配置(设置页)

点 side panel 右上角「⚙ 设置」:

| 项          | 说明                                                                                                                                                |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| endpoint    | 大模型地址，填 `https://la-sealion.inaiai.com/v1`（系统会自动补 `/chat/completions`）。                                                              |
| 模型        | 填 `gemma4-31b-heretic`，或点「↻ 拉取模型列表」从下拉选择。                                                                                          |
| API key     | 你在 la-sealion 平台的 API Key。**明文存于本地浏览器(`chrome.storage.local`)**，随请求发往上面配置的 endpoint。                                        |
| Prompt 模板 | 注入 `{{topic}}`/`{{facts}}`/`{{fewshot}}`。模型只回口吻散文槽位(intro/highlights…);**正文由系统用你的事实组装**,模型不写连结/作品名(防幻觉,见下)。 |
| 字段映射    | 默认值来自现场勘查,通常无需改;后台改版时按指南更新。带 JSON + schema 校验与「恢复默认」。                                                           |

## 使用

### 单条流程

1. 在 51publisher 后台发帖页打开「添加」表单(side panel 的填充作用于当前标签页)。
2. side panel 输入主题 →「生成草稿」。
3. 预览区核对/修改;非 AI 字段(状态/发布时间/作品 id)可在折叠区手填。
4. 「填充到当前页」→ 看「填充结果」面板:绿=已填、黄=跳过、红=需手动。
5. 若正文显示「需手动」,点「复制正文」自行粘贴到编辑器。
6. **人工在后台核对后手动点发布。**
7. 「下一条」清空当前草稿,继续。

### 批量流程 (推荐)

点击 side panel 右上角 **≣ 批量** 进入批量视图:

1. 输入选题列表(每行一条) →「开始批量(生成+填充)」；或在**待审选题池**点击「今日一键备稿」，自动抓取质量分最高的 top-3 选题直接生成批次。
2. 批量视图展示批次状态:待审 / 发布中 / 已发布 / 失败
3. 点击每个选题可展开查看/编辑草稿；**批次审批前须逐篇展开阅读**,面板底部显示「已读 N/M 篇」进度
4. 在 Settings 页设置发布档位后批准:
   - `off`: 只填充,需人工手动发布
   - `dry-run`: 预演流程(填充+模拟发布),查看 DryRunReport
   - `authorized`: 真实发布(需输入 `publish` 手势确认)
5. 查看「历史」标签页确认发布轨迹

> 当前在编草稿会临时存入 `chrome.storage.local`,side panel 重开/页面刷新时自动恢复,避免「编辑半天一刷新全没」。「下一条」时清除。

## 安全与边界

- **防幻觉(程序化结构化生成)**:模型只写口吻散文,作品名/集数/连结由程式从操作者事实 verbatim 注入正文,模型碰不到——连结/作品事实编造面归零;authorized 发布前有硬闸(残留【待补】/无来源连结即拦)。见 `lib/post-assembler.ts`、`lib/grounding-gate.ts`。
- 不自动提交/发布(硬约束)。
- API key 明文存本地、只在 background 使用、绝不进入页面上下文,也不写入错误日志;但仍会发往你配置的 endpoint——**请只配置可信地址,建议用权限受限的专用 key**。
- 正文 HTML 来自大模型(最不可信输入),写入 Quill 前在隔离世界按白名单消毒(剥除 `<script>`/事件处理器/`javascript:` 等),防 XSS。
- `host_permissions` 仅声明 `*://*.ympxbys.xyz/*`(后台域名)。

## 后端运维

### macOS 开机自动启动

```bash
pnpm build:backend
bash scripts/launchd/install.sh      # 注册 launchd daemon,开机自启
# 卸载:
bash scripts/launchd/uninstall.sh
```

后端日志写入 `/tmp/51publisher-backend.log`。`GET /api/v1/healthz`(无需鉴权)可供监控探针使用。

### Telegram 告警

在 `packages/backend/.env` 中配置:

```
TG_ENABLED=true
TG_BOT_TOKEN=<@BotFather 生成的 token>
TG_CHAT_ID=<你的 chat id>
```

抓取管线连续失败 3 次或发布健康监控发现帖子离线/删除时,自动推送 Telegram 通知。

## 高级功能

### Web 搜索富化

从 51acgs.com 抓取作品后,自动搜索 pixiv 补充作者信息和作品描述,让生成的文章更丰富。

配置:
```bash
ENRICHMENT_ENABLED=true
ENRICHMENT_MAX_QUERIES=3
```

### 质量门禁

生成的草稿自动经过 5 维度质量评估:
- 正文长度 (≥150 字)
- 事实完整性 (≥50%)
- 标题质量 (无占位符)
- 社区口吻 (口语化词汇)
- 标签准确性 (2-10 个)

查看质量统计: `GET /api/v1/healthz`

### 自动批量生成

从待审选题池自动批量生成草稿,减少人工干预。

详见 [`docs/auto-generate-guide.md`](docs/auto-generate-guide.md)

## 局限

- 仅适配 51publisher 当前后台(Quill 2.0.2、layui 弹层表单)。后台若更换富文本编辑器或大改表单结构,需改代码而非仅改字段映射(见指南的 Tier 分级)。
- 极端情况下若 `window.Quill` 不可用,正文走兜底写入(质量较差),此时建议人工粘贴。
- **authorized 模式下真实发布后无法自动撤回**，请务必先用 `dry-run` 预演验证。

## 开发

```bash
pnpm test          # 单元测试(vitest,jsdom + mock)
pnpm test:e2e      # 端到端:本地 fixture + 真实 Quill,核心填充路径 + 降级 + contract
pnpm check:fixtures # 脱敏闸门:扫 fixture 是否夹带机密(pre-commit 会自动跑)
pnpm compile       # tsc 类型检查
pnpm build         # 构建
```

三层结构:`entrypoints/background.ts`(调大模型)、`entrypoints/content.ts`(隔离世界填充)+ `entrypoints/quill-bridge.content.ts`(主世界写 Quill,逻辑在 `lib/body-responder.ts`)、`entrypoints/sidepanel/`(React UI);共享逻辑在 `lib/`。

e2e 测什么、不测什么、后台改版怎么修、漂移靠什么兜,见 [`docs/e2e-and-iteration-guide.md`](docs/e2e-and-iteration-guide.md)。
首次克隆后启用脱敏 pre-commit hook:`git config core.hooksPath scripts/git-hooks`。
