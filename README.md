# waimao-scraper · 网易外贸通客户线索采集器

把网易外贸通「海关数据/全球搜索」里**手动逐条复制**的买家线索，批量导出为结构化 CSV（公司名/国家/联系人/职位/邮箱/电话/LinkedIn/交易额）。

> 一个 WorkBuddy Skill。业务同事在 WorkBuddy 里说一句话（如「帮我采集 cargo 的美国买家联系方式」）即可触发采集。**仅限内部线索筛选提效，数据不传播、不转售**（见 [references/compliance.md](references/compliance.md)）。

---

## 它能做什么

- 按**关键词**搜索海关数据买家（cargo / 产品名 / HS Code）
- 按**筛选**收窄：采购地区（收货地/买家国）、供应地区（发货地，如中国）
- 翻页批量采集公司线索：公司名/国家/域名/邮箱数/电话数/交易额/主营产品
- 逐公司抓**联系人**：姓名/职位/类型(高管/经理)/邮箱/电话/LinkedIn
- 数据质量：邮箱有效性过滤（`emailStatus=1`）、按域名去重、联系人质量排序（有邮箱/高管优先）
- 稳定性：登录态预警、失败自动重试、风控检测硬熔断、限流冷却提示

## 快速开始（业务同事）

最简单的方式是在 WorkBuddy 里对 AI 说：

```
帮我安装并配置 waimao-scraper 这个 skill，仓库 https://github.com/jinyanghe1/waimao_scraper
```

或直接命令行：

```bash
git clone https://github.com/jinyanghe1/waimao_scraper.git ~/.workbuddy/skills/waimao-scraper
cd ~/.workbuddy/skills/waimao-scraper && npm install && node install.js
```

详见 [SKILL.md](SKILL.md)（含登录引导、采集命令、反馈、故障排查）。

## 反馈与贡献

- **提建议 / 报 bug**：在 WorkBuddy 里对你的 AI 说「给 waimao-scraper 提个建议/报个 bug」，会自动同步到本仓库 Issue；或直接 [开 Issue](https://github.com/jinyanghe1/waimao_scraper/issues/new/choose)
- **贡献代码**：欢迎提 PR！见 [CONTRIBUTING.md](CONTRIBUTING.md)

## 文档

| 文档 | 说明 |
|---|---|
| [SKILL.md](SKILL.md) | 使用与排错主文档（agent 路由） |
| [CONTRIBUTING.md](CONTRIBUTING.md) | 贡献指南（提 Issue / PR 流程） |
| [references/api.md](references/api.md) | 外贸通接口分析 |
| [references/compliance.md](references/compliance.md) | 合规与风控说明 |
| [references/maintainer.md](references/maintainer.md) | 维护者指南 |

## 测试

```bash
npm install
node --test tests/*.test.js   # 98 个测试
```

## License

内部提效工具。数据合规边界见 compliance.md。
