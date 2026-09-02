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

采集依赖**用户本机已登录外贸通的 Chrome（9222 调试端口）**。运行任何采集前，先检测：

```bash
node src/login.js --check   # 退出码 0=已登录, 1=需登录
```

若未登录，引导用户完成登录（见下方「登录引导」）。

## 采集命令

在 skill 目录下运行（`{SKILL_DIR}` = 本 skill 所在目录）：

```bash
cd {SKILL_DIR}

# 1) 公司线索采集：关键词 + 页数 + 可选筛选
node src/scrape.js --keyword cargo --pages 5

# 2) 带筛选：采购地区(收货地)=美国, 供应地区(发货地)=中国, HSCode
node src/scrape.js --keyword cargo --pages 5 --buy-country 美国 --supply-country 中国 --hscode 8471

# 3) 同时采集联系人（姓名/职位/邮箱/LinkedIn），每公司取前3个
node src/scrape.js --keyword cargo --pages 5 --contacts --topx 3
```

参数说明：
| 参数 | 含义 | 默认 |
|---|---|---|
| --keyword | 搜索关键词（产品名/描述） | cargo |
| --pages | 翻页数（每页20条） | 5 |
| --buy-country | 采购地区（买家所在国/收货地） | 空=不限 |
| --supply-country | 供应地区（卖家/发货地，如"中国"） | 空=不限 |
| --hscode | HS 海关编码 | 空 |
| --contacts | 是否采集联系人 | 关 |
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

多平台兼容：脚本用 Playwright connectOverCDP 对接系统浏览器，Mac/Windows 均可；浏览器优先 Chrome，Edge 同理（改启动路径）。Node 用 WorkBuddy 自带 managed node。
