# 首飞 Runbook（首次真实上线）

> 来源计划：`docs/plans/2026-06-15-001-refactor-release-readiness-remediation-plan.md`（B1）。
> 衔接 `docs/plans/2026-06-11-004` Unit 5（路径 B 真实批次验收，仍未完成）——不重开。

本清单**严格有序**。规则铁律：**任何激活线上后端的部署/push，都不得先于密钥撤销（Step 1）**。
两类动作已标注：🟢 代码侧前置（可由 agent/CI 完成，多已就绪）／🔴 不可逆运营动作（运营者亲手，不可由代码代替）。

---

## Step 1 — 密钥撤销 + 轮换（先于一切线上暴露）🔴

> 代码闸门只能挡占位符/弱值，挡不了「已泄漏但够强」的旧密钥。撤销是唯一可靠边界。

- [ ] **LLM_API_KEY（疑两次曝光，无条件处理）**
  - [ ] 在 LLM 供应商控制台**显式 revoke 旧 key**（生成新 key ≠ 撤销旧 key）。
  - [ ] **验证旧 key 已死**：用旧 key 调一次供应商接口，确认返回 401/403。
  - [ ] 生成新 key，经 `.env`（运行时）/ GitHub Actions secrets（CI）注入——**绝不提交进 git**。
  - [ ] 确认 release 构建**不把 `LLM_API_KEY` 打进扩展 bundle**（grep 产物）。
  - [ ] 若旧 key 曾进 git 历史/打包产物：`git filter-repo`/BFG 清史 + force-push（**纵深防御，非主控**——清不掉已有 fork/clone/GitHub 缓存 SHA；revoke 才是真边界）。清史后跑**一次全史 gitleaks**（CI secret-scan job 的能力）确认旧 key 已除。
- [ ] **JWT_SECRET**：换强随机值（≥32 字节）。轮换后所有旧 token 失效，扩展须重登。
- [ ] **JWT_ADMIN_PASSWORD_HASH**：scrypt 生成（命令见 `AGENTS.md` 第 24–26 行 / `hash-password.mjs`）。
- [ ] 改 `.env` 后启动后端，确认 fail-closed 校验**通过**（弱值会被拒启动）。

## Step 2 — CORS 收紧 🟢前置 + 🔴核验

- [ ] 用扩展的 `chrome-extension://<id>` origin 填 `CORS_ORIGIN`（逗号分隔，含 dev + 打包 id）。id 由 `wxt.config.ts` 的 `EXTENSION_KEY` 默认值派生、已固定。
- [ ] **push 前先定 dev/prod 的 `EXTENSION_KEY` 是否一致**：若 CI/release 经 env 覆盖产生不同 id，allowlist 须含两者。**绝不为迁就 id 不符而放宽到 `*`/通配**（后端 fail-closed 会拒 `*`）。
- [ ] 🔴**CORS 负向核验**：伪造一个非 allowlist 的 `Origin` 请求后端 → 确认被拒；真实扩展 `Origin` → 放行。

## Step 3 — Dry-run 预演 🟢

- [ ] 发布档位设 `dry-run`，跑一遍 `orchestratePublish`，确认出 DryRunReport、闸链行为正常、**零真实提交**。

## Step 4 — 真实发布冒烟 🔴（确立填充基线有效）

> 验收口径接 06-11-004 Unit 5：用**真实批次**而非单篇。

- [ ] 准备真实批次 **≥3 项**，其中 **≥1 项人为制造 gate-failed**。
- [ ] 执行真发，验证：正常项发布成功、gate-failed 项被拦进隔离区、重试回流正常。
- [ ] 前台核验已发布内容正确。
- [ ] 踩坑提醒：后台是 layuiAdmin 弹层表单,**填充已 frame-agnostic**（`lib/frame-resolve.ts`:顶层优先、找不到下钻同源 iframe）;字段找不到先确认弹层已打开,再看 frame 是否被解析到;改 content script 须「**重载扩展 + 刷新后台页**」两步；重跑同批被 `filterReentrantTopics` 静默过滤时需 `bypassReentry`。
- [ ] 若重抓 fixture（含 D2 变体）在登录态下产生：**先过 `check:fixtures` 脱敏闸**再提交（登录窗口是新攻击面）。

## Step 5 — 推送 GitHub 🔴

- [ ] 确认 GitHub `redredchen02-rgb/51publisher` 仓库为**私有**。
- [ ] `git push` feat 分支与 rescue 分支。
- [ ] 首飞成功后再备份 `data/`（备份**绝不落 `data/` 内**——后端测试 `cleanData()` 会 `rmSync data/`）。

---

## 完成后

- [ ] 更新 `.ai-memory/project_51publisher.md` 的首飞状态（从「待运营者动作」移到「已完成」）。
- [ ] D 组重构（apiFetch / BatchReviewPanel 拆分）在此验证过的填充基线上进行。
