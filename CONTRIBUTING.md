# 贡献指南（Contributing）

感谢你来一起完善这个采集器！无论是**提建议/报 bug** 还是**直接改代码提 PR**，都欢迎。

## 方式一：提建议 / 报 bug（不用写代码）

### A. 在 WorkBuddy 里说（推荐，最省事）

直接对你电脑上的 WorkBuddy AI 说：
> 「给 waimao-scraper 提个建议：……」
> 「waimao-scraper 报个 bug：采集到第 5 页就卡住不动了」

AI 会自动把内容（含你的系统/Node/skill 版本等环境信息）同步到本仓库 Issue 或腾讯文档反馈表，开发者会处理。

### B. 直接在 GitHub 开 Issue

打开 https://github.com/jinyanghe1/waimao_scraper/issues/new/choose ，选模板填写即可。

**报 bug 时请尽量提供**：
- 你执行的命令或操作
- 报错信息 / 卡住的位置（截图最佳）
- 你的系统（Mac/Windows）和是否已登录外贸通

## 方式二：提 PR 改代码（会写代码的同事）

如果你在业务使用中顺手优化了代码（比如改了某个选择器让它更稳、加了导出字段、优化了限速），欢迎提 PR 合并回来：

```bash
# 1. fork 本仓库，或直接 clone
git clone https://github.com/jinyanghe1/waimao_scraper.git
cd waimao_scraper

# 2. 建分支
git checkout -b fix/你的改动名    # 或 feat/xxx

# 3. 改代码 + 跑测试（必须通过）
npm install
node --test tests/*.test.js     # 确保全绿

# 4. 提交并 push，然后到 GitHub 开 Pull Request
git add -A && git commit -m "fix: 简要说明改动"
git push origin fix/你的改动名
```

### PR 要求

- ✅ 所有测试通过：`node --test tests/*.test.js`
- ✅ 改逻辑请**先写/改测试**（项目遵循 TDD）
- ✅ 一个 PR 只做一件事（便于 review）
- ✅ PR 描述写清：改了什么、为什么、怎么验证的
- ❌ 不要提交任何 token / 登录态 / 采集到的客户数据（`data/` 已在 .gitignore）

### 代码结构速览

```
src/
  scrape.js     主采集器（关键词+筛选+翻页+联系人）
  contacts.js   联系人采集器（断点续传）
  parser.js     数据解析（列表/联系人→CSV 行，含去重/排序/邮箱过滤）
  ratelimit.js  限速 + 风控检测
  stability.js  登录预警 / 失败重试 / 冷却提示
  feedback.js   用户反馈闭环（GitHub Issue / 腾讯文档 / 本地队列）
  login.js      登录态管理
tests/          node:test 单元测试（改动请同步）
```

## 行为准则

- 这是**内部提效工具**：采集的数据仅限内部线索筛选使用，不传播、不转售
- 尊重外贸通的风控：不要调高采集速度/量上限（会连累所有同事的账号）
- 沟通直接友善，对事不对人
