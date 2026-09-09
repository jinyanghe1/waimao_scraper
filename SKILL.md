---
name: waimao-scraper
description: 网易外贸通客户线索采集工具。把外贸通「海关数据/全球搜索」里手动逐条复制的买家线索，批量导出为结构化 CSV（公司名/国家/联系人/职位/邮箱/电话/LinkedIn/交易额）。当用户要采集外贸通客户、海关数据买家、外贸获客线索、或要批量导出某关键词的海外买家联系方式时使用。仅限内部提效，数据不对外传播。
---

# 网易外贸通客户线索采集

把外贸通付费墙后「手动逐条复制」的买家线索，批量化为结构化 CSV。**仅限内部线索筛选提效，数据不传播、不转售**（见 references/compliance.md）。

## 能力

- 按**关键词**搜索海关数据买家（如 cargo、product 名）
- 按**筛选**收窄：采购地区（收货地/买家国）、供应地区（发货地，如中国）、HS Code
- 翻页批量采集公司线索：公司名/国家/域名/邮箱数/电话数/交易额/主营产品
- 逐公司抓**联系人**：姓名/职位/类型(高管/经理)/邮箱/电话/LinkedIn（邮箱有直接拿，没有留空不深挖）

## 前置条件（每次采集前必查）

**第 0 步：静默检查更新**（对客服隐身，仅一句提示）
```bash
cd {SKILL_DIR} && node src/update.js
```
- 已最新 / 未配远程 → 静默继续，不打断
- 有新版 → 提示「正在从 GitHub 拉取外贸通采集器新版本…」并自动完成更新，然后继续

**第 1 步：检测登录态**

采集依赖**用户本机已登录外贸通的 Chrome（9222 调试端口）**。运行任何采集前，先检测：

```bash
node src/login.js --check   # 退出码 0=已登录, 1=需登录
```

若未登录，引导用户完成登录（见下方「登录引导」）。

## 采集命令

在 skill 目录下运行（`{SKILL_DIR}` = 本 skill 所在目录）：

```bash
cd {SKILL_DIR}

# 1) 公司线索+联系人采集（默认含邮箱）：关键词 + 页数 + 可选筛选
node src/scrape.js --keyword cargo --pages 5

# 2) 带筛选：采购地区(收货地)=美国, 供应地区(发货地)=中国, HSCode
node src/scrape.js --keyword cargo --pages 5 --buy-country 美国 --supply-country 中国 --hscode 8471

# 3) 仅抓公司列表（不抓联系人，快速浏览用）
node src/scrape.js --keyword cargo --pages 5 --no-contacts

# 4) 自定义每公司联系人数量
node src/scrape.js --keyword cargo --pages 5 --topx 5
```

参数说明：
| 参数 | 含义 | 默认 |
|---|---|---|
| --keyword | 搜索关键词（产品名/描述） | cargo |
| --pages | 翻页数（每页20条） | 5 |
| --buy-country | 采购地区（买家所在国/收货地） | 空=不限 |
| --supply-country | 供应地区（卖家/发货地，如"中国"） | 空=不限 |
| --hscode | HS 海关编码 | 空 |
| --no-contacts | 仅抓公司列表，不抓联系人（快速浏览） | 关（默认抓联系人） |
| --topx | 每公司最多取几个联系人 | 3 |

输出：{SKILL_DIR}/data/leads_关键词_日期.csv（公司线索）+ contacts_关键词_日期.csv（联系人）

## 登录引导（会话失效时）

外贸通登录态会过期（几小时~几天）。失效时按以下步骤引导用户：

1. **告诉用户**：「外贸通登录已过期，需要你重新登录一次，只需 1 分钟」
2. 运行登录脚本（会弹出浏览器窗口）：
   ```bash
   cd {SKILL_DIR} && node src/login.js
   ```
3. 让用户在弹出窗口里**登录外贸通**（扫码或密码）
4. 脚本自动检测登录成功并保存会话，窗口自动关闭
5. 重新运行采集命令

**如果弹窗没出来**（某些环境下沙箱限制 GUI）：让用户**手动**打开终端运行上面命令，或手动重启 Chrome 到调试模式：
- macOS: `pkill -x "Google Chrome"; sleep 2; "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --remote-debugging-port=9222 --user-data-dir=/tmp/wm-chrome-profile &`
- Windows: `taskkill /F /IM chrome.exe & "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222 --user-data-dir=%TEMP%\wm-chrome-profile`
- 然后在该 Chrome 窗口登录外贸通，再重跑采集

## 工作原理（排错时参考）

```
用户本机 Chrome(9222调试端口, 已登录) → CDP 接管
  → UI 驱动页面搜索/翻页/点联系人Tab
  → 页面自身带签名发请求(不逆向 sign) → 拦截响应拿 JSON
  → 解析 → CSV 落盘 data/ (仅本地)
```

关键：接口带前端动态签名 sign，**全程在已登录页面内由页面自发请求**，行为等同人工、不触发风控。不脱离浏览器发裸 HTTP（会 401/4002）。

## 风控与合规（已内置，不要关闭）

- 拟人随机延时 3~6.5s/页；日上限 30 页/800 条，触顶自动停止
- 失败指数退避，连续失败熔断停止
- 遇滑块/验证码/401 立即停止并提示用户，不硬闯
- 邮箱「有直接拿、没有留空」，**不触发深挖**（深挖耗配额且风控高）
- 数据仅存本地 data/，会话仅本地 profile，绝不外传

## 故障排查

| 现象 | 原因 | 处理 |
|---|---|---|
| "未找到外贸通标签页" | Chrome 没开调试端口或没登录 | 走登录引导 |
| 登录态失效 | 会话过期 | node src/login.js 重登 |
| 翻页连续空 | 风控/网络 | 停止，冷却后再试 |
| 联系人为空 | 该公司无可挖掘联系人 | 正常，跳过 |
| 命令卡住无输出 | nohup 后台兼容问题 | 改前台运行看实时输出 |
| UI 筛选失败 | 地区下拉是级联组件偶发失效 | **提醒用户**：「请在外贸通页面手动选好筛选（采购地区/供应地区/HS Code），选好告诉我，我来接管采集」 |

## 用户反馈（提建议 / 报 bug / 要新功能）

当用户说「提个建议」「报个 bug」「希望增加某功能」「反馈一个问题」时，调用反馈路由把内容同步给开发者：

```bash
cd {SKILL_DIR}
node src/feedback.js --type <bug|feature|suggestion> --title "<一句话标题>" --detail "<详细描述>"
```

- `--type`：`bug`(报错/异常) / `feature`(想要新功能) / `suggestion`(改进建议)
- 会自动在 GitHub 仓库建 Issue（含用户的平台/Node/skill版本等环境信息），开发者下一步开发时处理
- 提交成功后告诉用户 issue 链接；失败时内容会先存本地队列，联网后自动补发

**示例对话**：
- 用户：「这个工具跑到一半老卡死，帮我报个 bug」
- agent：提取标题「采集中途卡死」+ 详情 → 调 feedback.js → 回复「已帮你提交 bug 反馈（issue #N），开发同学会看到并处理」

**注意**：feedback.js 依赖 git remote 里的访问令牌建 Issue。若客服机器 clone 时用的 URL 不含 token，会自动降级到腾讯文档（见下）。

### 降级通道：腾讯文档智能表格

当 GitHub 不可用（无 token / 网络受限）时，feedback.js 会返回 `channel:'tencent-docs'` 及 `addRecordsArgs`。此时 **agent 用腾讯文档 connector 把记录追加到反馈表**：

1. 先调 feedback.js 拿到记录参数（agent 内执行）：
   ```js
   const { submitFeedback, getEnvInfo } = await import('{SKILL_DIR}/src/feedback.js');
   const r = await submitFeedback({ type, title, detail, env: getEnvInfo() });
   // r.channel === 'tencent-docs' 时，用 r.addRecordsArgs
   ```
2. 用 tencent-docs connector 追加到反馈表：
   ```
   tdoc_call tencent-docs smartsheet.add_records '<addRecordsArgs 的 JSON>'
   ```
   - 反馈表（已设所有人可编辑）：file_id `WWJNwfJLdUem`，sheet_id `t00i2h`
   - URL: https://docs.qq.com/smartsheet/DV1dKTndmSkxkVWVt
3. 追加成功后告诉用户「已同步到反馈表，开发同学会定期查看处理」

若腾讯文档也失败，feedback.js 最终落到本地队列 `data/feedback_queue.json`，联网后补发。

**三级降级链**：GitHub Issue → 腾讯文档智能表格 → 本地队列。

## 版本更新（对客服隐身）

本 skill 托管在 GitHub，作者会持续更新。每次调用前 agent 会自动检测新版：
- 有新版 → 提示「正在从 GitHub 拉取外贸通采集器新版本…」→ 自动更新 → 继续，客服无感知
- 全程无需客服理解 git 或手动操作

（管理员：发布/维护见 references/maintainer.md）

多平台兼容：脚本用 Playwright connectOverCDP 对接系统浏览器，Mac/Windows 均可；浏览器优先 Chrome，Edge 同理（改启动路径）。Node 用 WorkBuddy 自带 managed node。
